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

    describe("streaming responses", () => {
        type Event =
            | { t: "start"; d: unknown }
            | { t: "body"; b: Buffer }
            | { t: "end" }
            | { t: "error"; m: string };

        function makeSubscriber() {
            const events: Event[] = [];
            return {
                events,
                sub: {
                    onStart: (d: unknown) => events.push({ t: "start", d }),
                    onBody: (b: Buffer) => events.push({ t: "body", b }),
                    onEnd: () => events.push({ t: "end" }),
                    onError: (m: string) => events.push({ t: "error", m }),
                },
            };
        }

        it("routes response start to the subscriber with mapped fields", () => {
            const { events, sub } = makeSubscriber();
            previewStore.subscribeProxyResponse("r1", "t1", sub);
            previewStore.resolveResponseStart("r1", {
                status: 200,
                statusText: "OK",
                headers: { "content-type": "text/html" },
                hasBody: true,
            });
            expect(events).toEqual([
                { t: "start", d: { status: 200, statusText: "OK", headers: { "content-type": "text/html" }, hasBody: true } },
            ]);
        });

        it("decodes base64 body chunks to the subscriber", () => {
            const { events, sub } = makeSubscriber();
            previewStore.subscribeProxyResponse("r2", "t1", sub);
            previewStore.resolveResponseBody("r2", Buffer.from("hello").toString("base64"));
            expect(events).toHaveLength(1);
            expect(events[0]).toMatchObject({ t: "body" });
            expect((events[0] as { b: Buffer }).b.toString()).toBe("hello");
        });

        it("reports an invalid base64 chunk as an error", () => {
            const { events, sub } = makeSubscriber();
            previewStore.subscribeProxyResponse("r2b", "t1", sub);
            // Buffer.from is lenient, so force the throw path via a subscriber whose onBody rejects.
            const throwingSub = {
                ...sub,
                onBody: () => { throw new Error("boom"); },
            };
            previewStore.subscribeProxyResponse("r2b", "t1", throwingSub);
            previewStore.resolveResponseBody("r2b", "###");
            expect(events).toEqual([{ t: "error", m: "Invalid base64 chunk" }]);
        });

        it("ends the stream and unsubscribes (later resolves are no-ops)", () => {
            const { events, sub } = makeSubscriber();
            previewStore.subscribeProxyResponse("r3", "t1", sub);
            previewStore.resolveResponseEnd("r3");
            previewStore.resolveResponseStart("r3", { status: 200 }); // subscriber already gone
            expect(events).toEqual([{ t: "end" }]);
        });

        it("errors the stream and unsubscribes", () => {
            const { events, sub } = makeSubscriber();
            previewStore.subscribeProxyResponse("r4", "t1", sub);
            previewStore.resolveResponseError("r4", "Connection refused");
            previewStore.resolveResponseBody("r4", "x"); // subscriber already gone
            expect(events).toEqual([{ t: "error", m: "Connection refused" }]);
        });

        it("unsubscribe removes the subscriber", () => {
            const { events, sub } = makeSubscriber();
            const unsub = previewStore.subscribeProxyResponse("r5", "t1", sub);
            unsub();
            previewStore.resolveResponseStart("r5", { status: 200 });
            expect(events).toEqual([]);
        });

        it("resolves for an unknown request are silent no-ops", () => {
            expect(() => previewStore.resolveResponseStart("nope", {})).not.toThrow();
            expect(() => previewStore.resolveResponseBody("nope", "eA==")).not.toThrow();
            expect(() => previewStore.resolveResponseEnd("nope")).not.toThrow();
            expect(() => previewStore.resolveResponseError("nope", "err")).not.toThrow();
        });

        it("keeps concurrent request streams independent", () => {
            const a = makeSubscriber();
            const b = makeSubscriber();
            previewStore.subscribeProxyResponse("ra", "t1", a.sub);
            previewStore.subscribeProxyResponse("rb", "t1", b.sub);
            previewStore.resolveResponseStart("ra", { status: 200 });
            previewStore.resolveResponseError("rb", "Failed");
            expect(a.events).toEqual([{ t: "start", d: { status: 200, statusText: undefined, headers: {}, hasBody: false } }]);
            expect(b.events).toEqual([{ t: "error", m: "Failed" }]);
        });
    });
});
