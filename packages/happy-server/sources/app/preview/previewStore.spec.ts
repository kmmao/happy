import { describe, it, expect, beforeEach } from "vitest";
import { previewStore } from "./previewStore";

describe("PreviewStore", () => {
    beforeEach(() => {
        // Clear the store before each test by removing test data
        // Since previewStore is a singleton, we can't easily reset it,
        // so we use unique IDs per test to avoid conflicts
    });

    describe("candidates", () => {
        it("adds and retrieves a candidate", () => {
            const candidate = {
                id: "cand-test-1",
                machineId: "machine-test",
            sessionId: "sess-1",
                state: "available",
                protocol: "http",
                host: "127.0.0.1",
                port: 5173,
                reportedAt: Date.now(),
            };
            previewStore.addCandidate(candidate);
            expect(previewStore.getCandidate("cand-test-1")).toEqual(candidate);
        });

        it("returns undefined for missing candidate", () => {
            expect(previewStore.getCandidate("nonexistent-candidate-id")).toBeUndefined();
        });

        it("finds latest candidate by session", () => {
            const sessionId = "sess-latest-" + Date.now();
            const older = {
                id: "cand-sess-old-" + Date.now(),
                sessionId,
                machineId: "machine-test",
                state: "available",
                protocol: "http",
                host: "127.0.0.1",
                port: 3000,
                reportedAt: 1000,
            };
            const newer = {
                id: "cand-sess-new-" + Date.now(),
                sessionId,
                machineId: "machine-test",
                state: "available",
                protocol: "http",
                host: "127.0.0.1",
                port: 5173,
                reportedAt: 2000,
            };
            previewStore.addCandidate(older);
            previewStore.addCandidate(newer);
            const result = previewStore.getCandidateBySession(sessionId);
            expect(result?.id).toBe(newer.id);
            expect(result?.reportedAt).toBe(2000);
        });

        it("returns undefined when no candidates for session", () => {
            expect(previewStore.getCandidateBySession("nonexistent-session")).toBeUndefined();
        });

        it("stores optional candidate fields", () => {
            const candidate = {
                id: "cand-full-" + Date.now(),
                machineId: "machine-test",
            sessionId: "sess-full",
                state: "available",
                protocol: "http",
                host: "127.0.0.1",
                port: 8080,
                path: "/app",
                devServerType: "vite",
                command: "npm run dev",
                cwd: "/home/user/project",
                pid: 12345,
                reportedAt: Date.now(),
            };
            previewStore.addCandidate(candidate);
            const retrieved = previewStore.getCandidate(candidate.id);
            expect(retrieved?.path).toBe("/app");
            expect(retrieved?.devServerType).toBe("vite");
            expect(retrieved?.command).toBe("npm run dev");
            expect(retrieved?.cwd).toBe("/home/user/project");
            expect(retrieved?.pid).toBe(12345);
        });
    });

    describe("connections", () => {
        it("adds and retrieves a connection", () => {
            const tunnelId = "tunnel-test-" + Date.now();
            const connection = {
                tunnelId,
                candidateId: "cand-1",
                sessionId: "sess-conn-1",
                machineId: "machine-1",
                publicUrl: `https://server/preview/${tunnelId}`,
                status: "active",
                createdAt: Date.now(),
                leaseExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
                idleTimeoutMs: 45 * 60 * 1000,
                lastActiveAt: Date.now(),
            };
            previewStore.addConnection(connection);
            expect(previewStore.getConnection(tunnelId)).toEqual(connection);
        });

        it("finds connection by session", () => {
            const sessionId = "sess-conn-" + Date.now();
            const tunnelId = "tunnel-by-sess-" + Date.now();
            const connection = {
                tunnelId,
                candidateId: "cand-2",
                sessionId,
                machineId: "machine-2",
                publicUrl: `https://server/preview/${tunnelId}`,
                status: "active",
                createdAt: Date.now(),
                leaseExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
                idleTimeoutMs: 45 * 60 * 1000,
                lastActiveAt: Date.now(),
            };
            previewStore.addConnection(connection);
            const result = previewStore.getConnectionBySession(sessionId);
            expect(result?.tunnelId).toBe(tunnelId);
        });

        it("returns undefined for missing connection", () => {
            expect(previewStore.getConnection("nonexistent-tunnel")).toBeUndefined();
        });

        it("returns undefined for missing session connection", () => {
            expect(previewStore.getConnectionBySession("nonexistent-session")).toBeUndefined();
        });

        it("removes connection and clears session mapping", () => {
            const sessionId = "sess-remove-" + Date.now();
            const tunnelId = "tunnel-remove-" + Date.now();
            const connection = {
                tunnelId,
                candidateId: "cand-3",
                sessionId,
                machineId: "machine-3",
                publicUrl: `https://server/preview/${tunnelId}`,
                status: "active",
                createdAt: Date.now(),
                leaseExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
                idleTimeoutMs: 45 * 60 * 1000,
                lastActiveAt: Date.now(),
            };
            previewStore.addConnection(connection);
            previewStore.removeConnection(tunnelId);
            expect(previewStore.getConnection(tunnelId)).toBeUndefined();
            expect(previewStore.getConnectionBySession(sessionId)).toBeUndefined();
        });

        it("handles removing nonexistent connection gracefully", () => {
            expect(() => previewStore.removeConnection("nonexistent")).not.toThrow();
        });
    });

    describe("pending requests", () => {
        it("resolves on response start", async () => {
            const requestId = "req-resolve-" + Date.now();
            const promise = previewStore.createPendingRequest(requestId, 5000);
            previewStore.resolveResponseStart(requestId, {
                status: 200,
                statusText: "OK",
                headers: { "content-type": "text/html" },
                hasBody: true,
            });
            const result = await promise;
            expect(result.type).toBe("start");
            expect(result.status).toBe(200);
            expect(result.statusText).toBe("OK");
            expect(result.headers).toEqual({ "content-type": "text/html" });
        });

        it("resolves on response end", async () => {
            const requestId = "req-end-" + Date.now();
            const promise = previewStore.createPendingRequest(requestId, 5000);
            previewStore.resolveResponseEnd(requestId);
            const result = await promise;
            expect(result.type).toBe("end");
        });

        it("rejects on timeout", async () => {
            const requestId = "req-timeout-" + Date.now();
            const promise = previewStore.createPendingRequest(requestId, 50); // 50ms
            await expect(promise).rejects.toThrow("Preview request timeout");
        });

        it("rejects on error", async () => {
            const requestId = "req-error-" + Date.now();
            const promise = previewStore.createPendingRequest(requestId, 5000);
            previewStore.resolveResponseError(requestId, "Connection refused");
            await expect(promise).rejects.toThrow("Connection refused");
        });

        it("ignores resolve for unknown request", () => {
            const unknownId = "unknown-" + Date.now();
            expect(() => previewStore.resolveResponseStart(unknownId, {})).not.toThrow();
            expect(() => previewStore.resolveResponseEnd(unknownId)).not.toThrow();
            expect(() => previewStore.resolveResponseError(unknownId, "err")).not.toThrow();
        });

        it("resolves response body chunk", async () => {
            const requestId = "req-body-" + Date.now();
            const promise = previewStore.createPendingRequest(requestId, 5000);
            const chunk = "<html>test</html>";
            previewStore.resolveResponseBody(requestId, chunk);
            const result = await promise;
            expect(result.type).toBe("body");
            expect(result.chunk).toBe(chunk);
        });

        it("clears timeout when resolving response start", async () => {
            const requestId = "req-clear-timeout-" + Date.now();
            const promise = previewStore.createPendingRequest(requestId, 100);
            previewStore.resolveResponseStart(requestId, { status: 200 });
            const result = await promise;
            expect(result.status).toBe(200);
            // If timeout wasn't cleared, it would reject after 100ms
            // This test passes if it resolves before the timeout
        });

        it("handles multiple pending requests independently", async () => {
            const req1 = "req-multi-1-" + Date.now();
            const req2 = "req-multi-2-" + Date.now();
            const promise1 = previewStore.createPendingRequest(req1, 5000);
            const promise2 = previewStore.createPendingRequest(req2, 5000);

            previewStore.resolveResponseStart(req1, { status: 200 });
            previewStore.resolveResponseError(req2, "Failed");

            const result1 = await promise1;
            expect(result1.status).toBe(200);

            await expect(promise2).rejects.toThrow("Failed");
        });
    });
});
