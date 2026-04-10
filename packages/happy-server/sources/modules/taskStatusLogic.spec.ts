import { describe, expect, it } from "vitest";
import {
    normalizeTaskStatusReport,
    shouldApplyTaskStatus,
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
