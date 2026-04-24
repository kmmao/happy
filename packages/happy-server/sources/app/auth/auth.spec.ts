import { describe, it, expect, beforeEach } from "vitest";

// Set test secret before importing auth module
process.env.HANDY_MASTER_SECRET = "test-secret-for-auth-unit-tests-only";

import { auth } from "./auth";

describe("AuthModule", () => {
    beforeEach(async () => {
        await auth.init();
    });

    describe("init", () => {
        it("should initialize without error", async () => {
            await expect(auth.init()).resolves.toBeUndefined();
        });

        it("should be idempotent", async () => {
            await auth.init();
            await auth.init();
        });
    });

    describe("createToken + verifyToken", () => {
        it("should create a token and verify it", async () => {
            const token = await auth.createToken("user-1");
            const result = await auth.verifyToken(token);

            expect(result).not.toBeNull();
            expect(result!.userId).toBe("user-1");
        });

        it("should include extras in the token", async () => {
            const extras = { role: "admin", level: 42 };
            const token = await auth.createToken("user-2", extras);
            const result = await auth.verifyToken(token);

            expect(result).not.toBeNull();
            expect(result!.userId).toBe("user-2");
            expect(result!.extras).toEqual(extras);
        });

        it("should return null for an invalid token", async () => {
            const result = await auth.verifyToken("invalid-token-string");
            expect(result).toBeNull();
        });

        it("should cache tokens after creation", async () => {
            const token = await auth.createToken("user-cache");
            const stats = auth.getCacheStats();
            expect(stats.size).toBeGreaterThanOrEqual(1);

            const result = await auth.verifyToken(token);
            expect(result!.userId).toBe("user-cache");
        });
    });

    describe("task result tokens", () => {
        it("should create and verify a task result token", async () => {
            const token = await auth.createTaskResultToken({
                userId: "user-1",
                taskId: "task-1",
                expiresInMs: 60_000,
            });

            const result = await auth.verifyTaskResultToken(token);
            expect(result).not.toBeNull();
            expect(result!.userId).toBe("user-1");
            expect(result!.taskId).toBe("task-1");
            expect(result!.scope).toBe("task-result");
            expect(result!.jti).toBeTypeOf("string");
        });
    });

    describe("supervisor callback tokens", () => {
        it("should create and verify a run-status callback token", async () => {
            const token = await auth.createSupervisorCallbackToken({
                userId: "user-1",
                projectId: "proj-1",
                machineId: "machine-1",
                purpose: "run-status",
                runId: "run-1",
                expiresInMs: 60_000,
            });

            const result = await auth.verifySupervisorCallbackToken(token);
            expect(result).not.toBeNull();
            expect(result!.userId).toBe("user-1");
            expect(result!.projectId).toBe("proj-1");
            expect(result!.machineId).toBe("machine-1");
            expect(result!.purpose).toBe("run-status");
            expect(result!.runId).toBe("run-1");
            expect(result!.scope).toBe("supervisor-callback");
            expect(result!.expiresAt).toBeTypeOf("number");
        });

        it("should create and verify a fix-status callback token", async () => {
            const token = await auth.createSupervisorCallbackToken({
                userId: "user-2",
                projectId: "proj-2",
                machineId: "machine-2",
                purpose: "fix-status",
                actionId: "action-1",
                expiresInMs: 60_000,
            });

            const result = await auth.verifySupervisorCallbackToken(token);
            expect(result).not.toBeNull();
            expect(result!.purpose).toBe("fix-status");
            expect(result!.actionId).toBe("action-1");
        });

        it("should reject expired callback tokens", async () => {
            const token = await auth.createSupervisorCallbackToken({
                userId: "user-3",
                projectId: "proj-3",
                machineId: "machine-3",
                purpose: "run-status",
                runId: "run-3",
                expiresInMs: -1000,
            });

            const result = await auth.verifySupervisorCallbackToken(token);
            expect(result).toBeNull();
        });

        it("should still verify after cache eviction (crypto path)", async () => {
            const token = await auth.createSupervisorCallbackToken({
                userId: "user-4",
                projectId: "proj-4",
                machineId: "machine-4",
                purpose: "run-status",
                runId: "run-4",
                expiresInMs: 60_000,
            });

            auth.invalidateToken(token);

            const result = await auth.verifySupervisorCallbackToken(token);
            expect(result).not.toBeNull();
            expect(result!.userId).toBe("user-4");
            expect(result!.projectId).toBe("proj-4");
        });
    });

    describe("invalidateToken", () => {
        it("should remove token from cache", async () => {
            const token = await auth.createToken("user-inv");
            expect(await auth.verifyToken(token)).not.toBeNull();

            auth.invalidateToken(token);

            // Token still verifiable via crypto (not cache)
            const after = await auth.verifyToken(token);
            expect(after).not.toBeNull();
        });
    });

    describe("invalidateUserTokens", () => {
        it("should invalidate all tokens for a user", async () => {
            await auth.createToken("user-multi");
            await auth.createToken("user-multi");
            const otherToken = await auth.createToken("user-other");

            auth.invalidateUserTokens("user-multi");

            const otherResult = await auth.verifyToken(otherToken);
            expect(otherResult).not.toBeNull();
            expect(otherResult!.userId).toBe("user-other");
        });
    });

    describe("getCacheStats", () => {
        it("should return correct cache size", async () => {
            const initialSize = auth.getCacheStats().size;
            await auth.createToken("stats-user");
            expect(auth.getCacheStats().size).toBe(initialSize + 1);
        });

        it("should return oldestEntry timestamp", async () => {
            await auth.createToken("oldest-user");
            const stats = auth.getCacheStats();
            expect(stats.oldestEntry).not.toBeNull();
            expect(stats.oldestEntry).toBeLessThanOrEqual(Date.now());
        });
    });

    describe("GitHub tokens", () => {
        it("should create and verify a GitHub token", async () => {
            const token = await auth.createGithubToken("gh-user-1");
            expect(token).toBeTruthy();

            const result = await auth.verifyGithubToken(token);
            expect(result).not.toBeNull();
            expect(result!.userId).toBe("gh-user-1");
        });

        it("should return null for invalid GitHub token", async () => {
            const result = await auth.verifyGithubToken("invalid-github-token");
            expect(result).toBeNull();
        });
    });
});
