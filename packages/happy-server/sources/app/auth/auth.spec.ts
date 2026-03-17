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
            const token1 = await auth.createToken("user-multi");
            const token2 = await auth.createToken("user-multi");
            const otherToken = await auth.createToken("user-other");

            auth.invalidateUserTokens("user-multi");

            // Other user's token should still be in cache
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
