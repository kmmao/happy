import { describe, expect, it } from "vitest";
import {
    ACTIVE_LOOP_STATUSES,
    ACTIVE_RUN_STATUSES,
    INITIAL_LOOP_STATE,
    canProgressAfterRun,
    canProgressAfterFix,
    shouldDecideOnResume,
    decidePauseTransition,
    decideResumeTransition,
    decideStopTransition,
    decideEnterFixingTransition,
    decideEnterAnalyzingTransition,
    decideCompleteTransition,
    type SupervisorLoopStatus,
    type SupervisorLoopPhase,
} from "./supervisorLoopPhaseLogic";

const ALL_STATUSES: SupervisorLoopStatus[] = ["running", "paused", "completed", "stopped"];
const ALL_PHASES: SupervisorLoopPhase[] = ["analyzing", "deciding", "fixing", "idle"];

describe("loop status vocabulary", () => {
    it("running and paused hold the per-project mutual exclusion", () => {
        expect([...ACTIVE_LOOP_STATUSES]).toEqual(["running", "paused"]);
    });

    it("pending and running runs hold the one-off-run mutual exclusion", () => {
        expect([...ACTIVE_RUN_STATUSES]).toEqual(["pending", "running"]);
    });

    it("a fresh loop starts running its first analysis", () => {
        expect(INITIAL_LOOP_STATE).toEqual({
            status: "running",
            currentPhase: "analyzing",
            currentIteration: 1,
        });
    });
});

describe("progression gates", () => {
    it("run completion progresses only a running loop", () => {
        for (const status of ALL_STATUSES) {
            expect(canProgressAfterRun({ status })).toBe(status === "running");
        }
    });

    it("fix completion progresses only a running loop in the fixing phase", () => {
        for (const status of ALL_STATUSES) {
            for (const currentPhase of ALL_PHASES) {
                expect(canProgressAfterFix({ status, currentPhase })).toBe(
                    status === "running" && currentPhase === "fixing",
                );
            }
        }
    });

    it("resume pushes the loop forward only when it paused between steps", () => {
        expect(shouldDecideOnResume("deciding")).toBe(true);
        expect(shouldDecideOnResume("idle")).toBe(true);
        expect(shouldDecideOnResume("analyzing")).toBe(false);
        expect(shouldDecideOnResume("fixing")).toBe(false);
    });
});

describe("optimistic-locking transitions", () => {
    it("pause: running → paused", () => {
        expect(decidePauseTransition()).toEqual({
            allowedFrom: "running",
            data: { status: "paused" },
        });
    });

    it("resume: paused → running", () => {
        expect(decideResumeTransition()).toEqual({
            allowedFrom: "paused",
            data: { status: "running" },
        });
    });

    it("stop: running|paused → stopped with user_stopped", () => {
        expect(decideStopTransition()).toEqual({
            allowedFrom: ["running", "paused"],
            data: { status: "stopped", exitReason: "user_stopped" },
        });
    });

    it("enter fixing: running-only phase advance", () => {
        expect(decideEnterFixingTransition()).toEqual({
            allowedFrom: "running",
            data: { currentPhase: "fixing" },
        });
    });

    it("enter analyzing: running-only, stamps the next iteration", () => {
        expect(decideEnterAnalyzingTransition(4)).toEqual({
            allowedFrom: "running",
            data: { currentPhase: "analyzing", currentIteration: 4 },
        });
    });

    it("complete: running|paused → completed, parked at idle, reason stamped", () => {
        expect(decideCompleteTransition("goal_achieved")).toEqual({
            allowedFrom: ["running", "paused"],
            data: {
                status: "completed",
                currentPhase: "idle",
                exitReason: "goal_achieved",
            },
        });
    });

    it("a terminal loop can never be paused, resumed, or advanced (CAS excludes it)", () => {
        // The guard is the allowedFrom set: neither completed nor stopped
        // appears in any transition's allowedFrom.
        const froms = [
            decidePauseTransition().allowedFrom,
            decideResumeTransition().allowedFrom,
            decideEnterFixingTransition().allowedFrom,
            decideEnterAnalyzingTransition(2).allowedFrom,
            ...decideStopTransition().allowedFrom,
            ...decideCompleteTransition("timeout").allowedFrom,
        ];
        expect(froms).not.toContain("completed");
        expect(froms).not.toContain("stopped");
    });
});
