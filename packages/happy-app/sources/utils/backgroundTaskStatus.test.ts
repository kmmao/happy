import { describe, expect, it } from "vitest";
import {
    BackgroundTaskStateContainer,
    BackgroundTaskStatus,
    canTransitionBackgroundTaskStatus,
    getBackgroundTaskState,
    isTerminalBackgroundTaskStatus,
    setBackgroundTaskState,
    transitionBackgroundTaskEntry,
} from "./backgroundTaskStatus";

describe("isTerminalBackgroundTaskStatus", () => {
    it.each([
        ["running", false],
        ["completed", true],
        ["failed", true],
        ["stopped", true],
    ] as const)("treats %s as terminal=%s", (status, expected) => {
        expect(isTerminalBackgroundTaskStatus(status)).toBe(expected);
    });
});

describe("canTransitionBackgroundTaskStatus", () => {
    // Full 4 × 4 = 16 combination table. Keeping it exhaustive forces a
    // deliberate test update whenever the state machine grows new edges.
    const cases: ReadonlyArray<
        [BackgroundTaskStatus, BackgroundTaskStatus, boolean]
    > = [
        // Only running has outgoing edges — three legal transitions.
        ["running", "completed", true],
        ["running", "failed", true],
        ["running", "stopped", true],
        ["running", "running", false], // no self-loop
        // completed is absorbing
        ["completed", "running", false],
        ["completed", "completed", false],
        ["completed", "failed", false],
        ["completed", "stopped", false],
        // failed is absorbing
        ["failed", "running", false],
        ["failed", "completed", false],
        ["failed", "failed", false],
        ["failed", "stopped", false],
        // stopped is absorbing — including no "stopped → failed" race
        ["stopped", "running", false],
        ["stopped", "completed", false],
        ["stopped", "failed", false],
        ["stopped", "stopped", false],
    ];

    it.each(cases)("%s → %s should be %s", (from, to, expected) => {
        expect(canTransitionBackgroundTaskStatus(from, to)).toBe(expected);
    });
});

describe("getBackgroundTaskState / setBackgroundTaskState", () => {
    const initial: BackgroundTaskStateContainer = {
        status: "running",
        enteredAt: 1000,
    };

    it("getBackgroundTaskState reads the current status out of the container", () => {
        expect(getBackgroundTaskState(initial)).toBe("running");
    });

    it.each([
        ["completed"],
        ["failed"],
        ["stopped"],
    ] as const)(
        "setBackgroundTaskState produces a new container on running → %s",
        (next) => {
            const after = setBackgroundTaskState(initial, next, 2000);
            expect(after).toEqual({ status: next, enteredAt: 2000 });
        },
    );

    it("setBackgroundTaskState pins enteredAt to the injected clock", () => {
        expect(
            setBackgroundTaskState(initial, "completed", 42).enteredAt,
        ).toBe(42);
    });

    it("setBackgroundTaskState defaults enteredAt to Date.now() when no clock is given", () => {
        const before = Date.now();
        const next = setBackgroundTaskState(initial, "completed");
        const after = Date.now();
        expect(next.enteredAt).toBeGreaterThanOrEqual(before);
        expect(next.enteredAt).toBeLessThanOrEqual(after);
    });

    it("setBackgroundTaskState never mutates the input container", () => {
        const snapshot = { ...initial };
        setBackgroundTaskState(initial, "completed", 2000);
        expect(initial).toEqual(snapshot);
    });

    it.each([
        ["completed", "running"],
        ["completed", "failed"],
        ["failed", "completed"],
        ["failed", "running"],
        ["stopped", "completed"],
        ["stopped", "failed"],
        ["stopped", "running"],
    ] as const)(
        "setBackgroundTaskState throws on illegal %s → %s with the offending pair in the message",
        (from, to) => {
            const terminal: BackgroundTaskStateContainer = {
                status: from,
                enteredAt: 5000,
            };
            expect(() => setBackgroundTaskState(terminal, to, 6000)).toThrowError(
                new RegExp(`${from}.*${to}`),
            );
        },
    );

    it("setBackgroundTaskState refuses self-loops even on running", () => {
        expect(() => setBackgroundTaskState(initial, "running", 2000)).toThrow();
    });

    it("setBackgroundTaskState refuses self-loops on terminal states", () => {
        const done: BackgroundTaskStateContainer = {
            status: "completed",
            enteredAt: 5000,
        };
        expect(() => setBackgroundTaskState(done, "completed", 6000)).toThrow();
    });
});

// ---------------------------------------------------------------------------
// transitionBackgroundTaskEntry — record-shaped adapter
// ---------------------------------------------------------------------------

describe("transitionBackgroundTaskEntry", () => {
    // A stand-in for the reducer's BackgroundTaskEntry. We don't import the
    // real one because backgroundTaskStatus must not depend on the reducer.
    type Entry = {
        readonly status: BackgroundTaskStatus;
        readonly taskId: string;
        readonly startedAt: number;
        readonly summary: string | null;
    };

    const baseEntry: Entry = {
        status: "running",
        taskId: "bg-1",
        startedAt: 1000,
        summary: null,
    };

    it.each([
        ["completed"],
        ["failed"],
        ["stopped"],
    ] as const)(
        "produces a new entry on running → %s with status overwritten and sibling fields preserved",
        (next) => {
            const after = transitionBackgroundTaskEntry(baseEntry, next);
            expect(after).toEqual({ ...baseEntry, status: next });
            // Reference equality must change — callers rely on spread for Map invalidation.
            expect(after).not.toBe(baseEntry);
        },
    );

    it("never mutates the input entry", () => {
        const snapshot = { ...baseEntry };
        transitionBackgroundTaskEntry(baseEntry, "completed");
        expect(baseEntry).toEqual(snapshot);
    });

    it.each([
        ["completed", "running"],
        ["completed", "failed"],
        ["failed", "running"],
        ["stopped", "completed"],
    ] as const)(
        "throws on illegal %s → %s with the offending pair in the message",
        (from, to) => {
            const terminal: Entry = { ...baseEntry, status: from };
            expect(() => transitionBackgroundTaskEntry(terminal, to)).toThrowError(
                new RegExp(`${from}.*${to}`),
            );
        },
    );

    it("refuses self-loops on running", () => {
        expect(() => transitionBackgroundTaskEntry(baseEntry, "running")).toThrow();
    });

    it("refuses self-loops on terminal states", () => {
        const done: Entry = { ...baseEntry, status: "completed" };
        expect(() => transitionBackgroundTaskEntry(done, "completed")).toThrow();
    });

    it("preserves the caller's record type — extra fields survive intact", () => {
        // The generic signature should return E, not a stripped union. Verify
        // by reading a sibling field off the result without a cast.
        const after = transitionBackgroundTaskEntry(baseEntry, "completed");
        expect(after.taskId).toBe("bg-1");
        expect(after.startedAt).toBe(1000);
        expect(after.summary).toBeNull();
    });
});
