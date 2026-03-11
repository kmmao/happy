import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Mock external dependencies before importing the module under test.
 * sessionCache.ts depends on db (Prisma), log, and Prometheus metrics.
 */

const mockSessionUpdate = vi.fn();
const mockSessionFindUnique = vi.fn();
const mockMachineUpdate = vi.fn();
const mockMachineFindUnique = vi.fn();

vi.mock("@/storage/db", () => ({
    db: {
        session: {
            update: (...args: unknown[]) => mockSessionUpdate(...args),
            findUnique: (...args: unknown[]) => mockSessionFindUnique(...args),
        },
        machine: {
            update: (...args: unknown[]) => mockMachineUpdate(...args),
            findUnique: (...args: unknown[]) => mockMachineFindUnique(...args),
        },
    },
}));

vi.mock("@/utils/log", () => ({
    log: vi.fn(),
}));

vi.mock("@/app/monitoring/metrics2", () => ({
    sessionCacheCounter: { inc: vi.fn() },
    databaseUpdatesSkippedCounter: { inc: vi.fn() },
}));

describe("ActivityCache", () => {
    let cache: any;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        // Reset the module to get a fresh ActivityCache instance each test
        vi.resetModules();
        const mod = await import("./sessionCache");
        cache = mod.activityCache;
    });

    afterEach(() => {
        cache?.shutdown?.();
        vi.useRealTimers();
    });

    describe("flushPendingUpdates — session archive safety", () => {
        it("should NOT set active=true when flushing session updates (critical for PR merge archive)", async () => {
            const sessionId = "sess-archived-123";
            const userId = "user-1";
            const now = Date.now();

            // Simulate: session was validated and cached
            mockSessionFindUnique.mockResolvedValueOnce({
                id: sessionId,
                accountId: userId,
                lastActiveAt: new Date(now - 60_000),
                active: true,
            });

            await cache.isSessionValid(sessionId, userId);

            // Queue an activity update (timestamp >30s newer than last update)
            cache.queueSessionUpdate(sessionId, now);

            // Simulate: between queueing and flushing, PR merge sets active=false in DB.
            // The flush should NOT re-set active=true — it only updates lastActiveAt.

            mockSessionUpdate.mockResolvedValueOnce({
                id: sessionId,
                lastActiveAt: new Date(now),
            });

            // Trigger the batch timer (5 second interval)
            await vi.advanceTimersByTimeAsync(5_000);

            // Verify the DB update call
            expect(mockSessionUpdate).toHaveBeenCalledTimes(1);

            const updateCall = mockSessionUpdate.mock.calls[0][0];
            expect(updateCall).toEqual({
                where: { id: sessionId },
                data: { lastActiveAt: new Date(now) },
            });

            // The critical assertion: `active` must NOT be in the update data.
            // Before the fix, flushPendingUpdates set { active: true } which would
            // reactivate sessions that were archived by PR merge.
            expect(updateCall.data).not.toHaveProperty("active");
            expect(Object.keys(updateCall.data)).toEqual(["lastActiveAt"]);
        });

        it("should not reactivate an already-archived session during flush", async () => {
            const sessionId = "sess-456";
            const userId = "user-2";
            const now = Date.now();

            // Session was already archived (active=false) but still in DB
            mockSessionFindUnique.mockResolvedValueOnce({
                id: sessionId,
                accountId: userId,
                lastActiveAt: new Date(now - 60_000),
                active: false,
            });

            await cache.isSessionValid(sessionId, userId);
            cache.queueSessionUpdate(sessionId, now);

            mockSessionUpdate.mockResolvedValueOnce({
                id: sessionId,
                lastActiveAt: new Date(now),
            });

            await vi.advanceTimersByTimeAsync(5_000);

            expect(mockSessionUpdate).toHaveBeenCalledTimes(1);
            const data = mockSessionUpdate.mock.calls[0][0].data;
            // Only lastActiveAt should be updated, `active` field must be absent
            expect(Object.keys(data)).toEqual(["lastActiveAt"]);
        });
    });

    describe("queueSessionUpdate", () => {
        it("should not queue update when session is not cached", () => {
            const result = cache.queueSessionUpdate("unknown-session", Date.now());
            expect(result).toBe(false);
        });

        it("should not queue update when time diff is below threshold", async () => {
            const sessionId = "sess-789";
            const userId = "user-3";
            const now = Date.now();

            mockSessionFindUnique.mockResolvedValueOnce({
                id: sessionId,
                accountId: userId,
                lastActiveAt: new Date(now),
                active: true,
            });

            await cache.isSessionValid(sessionId, userId);

            // Try to update with only 5 seconds difference (threshold is 30s)
            const result = cache.queueSessionUpdate(sessionId, now + 5_000);
            expect(result).toBe(false);
        });

        it("should queue update when time diff exceeds threshold", async () => {
            const sessionId = "sess-abc";
            const userId = "user-4";
            const now = Date.now();

            mockSessionFindUnique.mockResolvedValueOnce({
                id: sessionId,
                accountId: userId,
                lastActiveAt: new Date(now - 60_000),
                active: true,
            });

            await cache.isSessionValid(sessionId, userId);

            const result = cache.queueSessionUpdate(sessionId, now);
            expect(result).toBe(true);
        });
    });
});
