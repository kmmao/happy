/**
 * Unit-level coverage for the pure helpers in agentLoopEngine.
 * DB-bound functions (create/update/delete/tick/handleCallback) get
 * exercised by the integration spec in supervisorLoopRoutes.spec.ts'
 * companion file.
 */

import { describe, it, expect } from "vitest";
import {
    buildCallbackToken,
    verifyCallbackToken,
    computeNextRunAt,
} from "./agentLoopEngine";

describe("agentLoopEngine.buildCallbackToken / verifyCallbackToken", () => {
    it("round-trips a freshly built token", () => {
        const token = buildCallbackToken("loop-abc", 7);
        expect(verifyCallbackToken("loop-abc", 7, token)).toBe(true);
    });

    it("rejects a token for a different iteration", () => {
        const token = buildCallbackToken("loop-abc", 7);
        expect(verifyCallbackToken("loop-abc", 8, token)).toBe(false);
    });

    it("rejects a token for a different loop", () => {
        const token = buildCallbackToken("loop-abc", 7);
        expect(verifyCallbackToken("loop-xyz", 7, token)).toBe(false);
    });

    it("rejects malformed tokens without throwing", () => {
        expect(verifyCallbackToken("loop-abc", 7, "")).toBe(false);
        expect(verifyCallbackToken("loop-abc", 7, "not-a-hex-token")).toBe(false);
    });
});

describe("agentLoopEngine.computeNextRunAt", () => {
    const now = new Date("2026-06-14T12:00:00.000Z").getTime();

    it("adds intervalMs when no cron present", () => {
        const next = computeNextRunAt(60_000, null, now);
        expect(next).toBe(now + 60_000);
    });

    it("floors very small intervals at 30s", () => {
        const next = computeNextRunAt(1_000, null, now);
        expect(next - now).toBe(30_000);
    });

    it("uses cron expression when present (every hour)", () => {
        const next = computeNextRunAt(null, "0 * * * *", now);
        // 12:00 UTC → next on the hour is 13:00.
        expect(next).toBe(new Date("2026-06-14T13:00:00.000Z").getTime());
    });

    it("falls back to +1h on malformed cron, no throw", () => {
        const next = computeNextRunAt(null, "not a cron", now);
        expect(next).toBe(now + 60 * 60 * 1000);
    });

    it("returns a far-future sentinel when nothing scheduled", () => {
        const next = computeNextRunAt(null, null, now);
        expect(next - now).toBe(365 * 24 * 60 * 60 * 1000);
    });
});
