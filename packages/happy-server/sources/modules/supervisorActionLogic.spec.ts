import { describe, expect, it } from "vitest";
import {
    decideApprovalTransition,
    DISMISSED_APPROVALS,
} from "./supervisorActionLogic";

describe("decideApprovalTransition", () => {
    it("forwards approve from the pending queue only, keeping fix state", () => {
        expect(decideApprovalTransition("approved")).toEqual({
            allowedFrom: ["pending"],
            blockWhileActivelyFixing: false,
            resetFix: false,
        });
    });

    it("dismisses (skipped) from pending or approved and resets fix", () => {
        expect(decideApprovalTransition("skipped")).toEqual({
            allowedFrom: ["pending", "approved"],
            blockWhileActivelyFixing: false,
            resetFix: true,
        });
    });

    it("dismisses (ignored) from pending or approved and resets fix", () => {
        expect(decideApprovalTransition("ignored")).toEqual({
            allowedFrom: ["pending", "approved"],
            blockWhileActivelyFixing: false,
            resetFix: true,
        });
    });

    it("restores to pending from dismissed/approved, guarded against active fixing, resetting fix", () => {
        expect(decideApprovalTransition("pending")).toEqual({
            allowedFrom: ["skipped", "ignored", "approved"],
            blockWhileActivelyFixing: true,
            resetFix: true,
        });
    });
});

describe("supervisor action vocabulary", () => {
    it("treats skipped and ignored as dismissed", () => {
        expect([...DISMISSED_APPROVALS]).toEqual(["skipped", "ignored"]);
    });
});
