import { describe, expect, it } from "vitest";
import {
    ACTIVE_FIX_STATUSES,
    TERMINAL_FIX_STATUSES,
    STALE_FIX_RESOLUTION,
    isActiveFixStatus,
    isTerminalFixStatus,
    canTriggerFix,
    decideAutoApproveAndQueueFix,
    decideFixStatusReport,
    supervisorActionViewFilter,
    isUpdatedAtOrderedView,
    selectTrulyStaleFixActions,
    type SupervisorFixStatus,
    type SupervisorActionView,
} from "./supervisorFixStatusLogic";

const ALL_STATUSES: (SupervisorFixStatus | null)[] = [
    null,
    "pending",
    "running",
    "completed",
    "failed",
    "analyzed",
];

describe("fix status vocabulary", () => {
    it("treats pending and running as active", () => {
        expect([...ACTIVE_FIX_STATUSES]).toEqual(["pending", "running"]);
    });

    it("treats completed, failed, and analyzed as terminal", () => {
        expect([...TERMINAL_FIX_STATUSES]).toEqual(["completed", "failed", "analyzed"]);
    });

    it("partitions every status into exactly one of active / terminal / null", () => {
        for (const status of ALL_STATUSES) {
            const active = isActiveFixStatus(status);
            const terminal = isTerminalFixStatus(status);
            if (status === null) {
                expect(active).toBe(false);
                expect(terminal).toBe(false);
            } else {
                expect(active !== terminal).toBe(true);
            }
        }
    });
});

describe("canTriggerFix", () => {
    it("refuses while a fix is active, allows from null and any terminal status", () => {
        expect(canTriggerFix(null)).toBe(true);
        expect(canTriggerFix("pending")).toBe(false);
        expect(canTriggerFix("running")).toBe(false);
        expect(canTriggerFix("completed")).toBe(true);
        expect(canTriggerFix("failed")).toBe(true);
        expect(canTriggerFix("analyzed")).toBe(true);
    });
});

describe("decideAutoApproveAndQueueFix", () => {
    it("approves from pending only and queues the fix in the same write", () => {
        expect(decideAutoApproveAndQueueFix()).toEqual({
            allowedFrom: "pending",
            data: { approval: "approved", fixStatus: "pending" },
        });
    });
});

describe("decideFixStatusReport", () => {
    it("running: not terminal, no side effects, no notification", () => {
        expect(decideFixStatusReport("running", "Fix X")).toEqual({
            isTerminal: false,
            archiveSessionInDb: false,
            requestSessionKill: false,
            progressLoop: false,
            notification: null,
        });
    });

    it("completed: archives, kills, progresses, notifies success", () => {
        expect(decideFixStatusReport("completed", "Fix X")).toEqual({
            isTerminal: true,
            archiveSessionInDb: true,
            requestSessionKill: true,
            progressLoop: true,
            notification: {
                type: "fix_complete",
                title: "Fix Applied Successfully",
                body: "Fixed: Fix X",
            },
        });
    });

    it("failed: archives, kills, progresses, notifies error", () => {
        expect(decideFixStatusReport("failed", "Fix X")).toEqual({
            isTerminal: true,
            archiveSessionInDb: true,
            requestSessionKill: true,
            progressLoop: true,
            notification: {
                type: "error",
                title: "Fix Failed",
                body: "Failed to fix: Fix X",
            },
        });
    });

    it("analyzed: does NOT archive (session stays reviewable) but still kills, progresses, notifies", () => {
        expect(decideFixStatusReport("analyzed", "Fix X")).toEqual({
            isTerminal: true,
            archiveSessionInDb: false,
            requestSessionKill: true,
            progressLoop: true,
            notification: {
                type: "fix_complete",
                title: "Analysis Complete",
                body: "Analyzed: Fix X",
            },
        });
    });
});

describe("supervisorActionViewFilter", () => {
    it("approved: approved with no fix queued", () => {
        expect(supervisorActionViewFilter("approved")).toEqual({
            approval: "approved",
            fixStatus: null,
        });
    });

    it("fixing: active fix, not analyze-first", () => {
        expect(supervisorActionViewFilter("fixing")).toEqual({
            approval: "approved",
            fixStatus: { in: ["pending", "running"] },
            fixMode: { not: "analyze-first" },
        });
    });

    it("analyzing: active fix, analyze-first", () => {
        expect(supervisorActionViewFilter("analyzing")).toEqual({
            approval: "approved",
            fixStatus: { in: ["pending", "running"] },
            fixMode: "analyze-first",
        });
    });

    it("analyzed / done / failed: approved at that terminal status", () => {
        expect(supervisorActionViewFilter("analyzed")).toEqual({
            approval: "approved",
            fixStatus: "analyzed",
        });
        expect(supervisorActionViewFilter("done")).toEqual({
            approval: "approved",
            fixStatus: "completed",
        });
        expect(supervisorActionViewFilter("failed")).toEqual({
            approval: "approved",
            fixStatus: "failed",
        });
    });

    it("dismissed: skipped or ignored, no fix constraint", () => {
        expect(supervisorActionViewFilter("dismissed")).toEqual({
            approval: { in: ["skipped", "ignored"] },
        });
    });
});

describe("isUpdatedAtOrderedView", () => {
    it("orders fix-progress views by updatedAt, the rest by createdAt", () => {
        const byUpdatedAt: SupervisorActionView[] = ["done", "fixing", "analyzing", "analyzed"];
        const byCreatedAt: (SupervisorActionView | undefined)[] = ["approved", "failed", "dismissed", undefined];
        for (const view of byUpdatedAt) expect(isUpdatedAtOrderedView(view)).toBe(true);
        for (const view of byCreatedAt) expect(isUpdatedAtOrderedView(view)).toBe(false);
    });
});

describe("selectTrulyStaleFixActions", () => {
    const actions = [
        { id: "a", fixSessionId: null },
        { id: "b", fixSessionId: "s-live" },
        { id: "c", fixSessionId: "s-dead" },
    ];

    it("selects actions with no session or an inactive session", () => {
        const stale = selectTrulyStaleFixActions(actions, new Set(["s-live"]));
        expect(stale.map((a) => a.id)).toEqual(["a", "c"]);
    });

    it("selects everything when no sessions are active", () => {
        const stale = selectTrulyStaleFixActions(actions, new Set());
        expect(stale.map((a) => a.id)).toEqual(["a", "b", "c"]);
    });

    it("forces stale fixes to failed", () => {
        expect(STALE_FIX_RESOLUTION).toBe("failed");
    });
});
