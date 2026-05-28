import { describe, expect, it } from "vitest";
import {
    normalizeTaskStatusReport,
    shouldApplyTaskStatus,
    decideTaskTransition,
} from "./taskStatusLogic";

describe("normalizeTaskStatusReport", () => {
    it("maps blocked outcome to failed status", () => {
        expect(normalizeTaskStatusReport({
            status: "completed",
            outcome: "blocked",
        })).toEqual({
            status: "failed",
            outcome: "blocked",
        });
    });

    it("prefers explicit completed outcome over incoming status", () => {
        expect(normalizeTaskStatusReport({
            status: "running",
            outcome: "completed",
        })).toEqual({
            status: "completed",
            outcome: "completed",
        });
    });

    it("keeps status when outcome is absent", () => {
        expect(normalizeTaskStatusReport({
            status: "failed",
        })).toEqual({
            status: "failed",
            outcome: undefined,
        });
    });
});

describe("shouldApplyTaskStatus", () => {
    it("accepts terminal transitions from running", () => {
        expect(shouldApplyTaskStatus("running", "failed")).toBe(true);
        expect(shouldApplyTaskStatus("running", "completed")).toBe(true);
    });

    it("rejects regressions after terminal state", () => {
        expect(shouldApplyTaskStatus("completed", "failed")).toBe(false);
        expect(shouldApplyTaskStatus("failed", "running")).toBe(false);
    });
});

describe("decideTaskTransition", () => {
    const now = new Date("2026-05-28T00:00:00Z");

    it("stamps dispatchedAt on the first running transition", () => {
        const decision = decideTaskTransition({
            current: { status: "dispatching", dispatchedAt: null },
            resolvedStatus: "running",
            now,
        });
        expect(decision).toEqual({ apply: true, isTerminal: false, timestamps: { dispatchedAt: now } });
    });

    it("does not re-stamp dispatchedAt when already dispatched", () => {
        const earlier = new Date("2026-05-27T00:00:00Z");
        const decision = decideTaskTransition({
            current: { status: "running", dispatchedAt: earlier },
            resolvedStatus: "running",
            now,
        });
        // current === incoming non-terminal → applies, but no timestamps move.
        expect(decision).toEqual({ apply: true, isTerminal: false, timestamps: {} });
    });

    it("stamps completedAt on a terminal transition", () => {
        const decision = decideTaskTransition({
            current: { status: "running", dispatchedAt: new Date("2026-05-27T00:00:00Z") },
            resolvedStatus: "completed",
            now,
        });
        expect(decision).toEqual({ apply: true, isTerminal: true, timestamps: { completedAt: now } });
    });

    it("rejects a redundant terminal report as duplicate-terminal", () => {
        const decision = decideTaskTransition({
            current: { status: "completed", dispatchedAt: null },
            resolvedStatus: "completed",
            now,
        });
        expect(decision).toEqual({ apply: false, reason: "duplicate-terminal" });
    });

    it("rejects a regression out of a terminal state as stale", () => {
        const decision = decideTaskTransition({
            current: { status: "completed", dispatchedAt: null },
            resolvedStatus: "running",
            now,
        });
        expect(decision).toEqual({ apply: false, reason: "stale" });
    });

    it("rejects backward progress (running → queued) as stale", () => {
        const decision = decideTaskTransition({
            current: { status: "running", dispatchedAt: new Date("2026-05-27T00:00:00Z") },
            resolvedStatus: "queued",
            now,
        });
        expect(decision).toEqual({ apply: false, reason: "stale" });
    });
});
