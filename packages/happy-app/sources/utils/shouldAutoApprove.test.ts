import { describe, it, expect } from "vitest";
import { shouldAutoApprove } from "./shouldAutoApprove";

// Default the yolo-plan toggle to true (its settings default) unless a test
// exercises the off state explicitly.
const AUTO = true;

describe("shouldAutoApprove", () => {
    describe("yolo mode", () => {
        it.each(["Bash", "CodexBash", "Edit", "Write", "Read", "Grep"])(
            "auto-approves %s",
            (tool) => {
                expect(shouldAutoApprove("yolo", tool, AUTO)).toBe(true);
            },
        );

        it("does not auto-approve AskUserQuestion", () => {
            expect(shouldAutoApprove("yolo", "AskUserQuestion", AUTO)).toBe(false);
        });
    });

    // AskUserQuestion: never auto-approve in any mode
    describe("AskUserQuestion", () => {
        it.each([
            "default",
            "bypassPermissions",
            "yolo",
            "plan",
            "acceptEdits",
            null,
            undefined,
        ] as const)("returns false in %s mode", (mode) => {
            expect(shouldAutoApprove(mode, "AskUserQuestion", AUTO)).toBe(false);
        });
    });

    // mcp__happy__ask_user: same Q&A guarantee as AskUserQuestion, but routed
    // through happy-cli's MCP server. Auto-approving would silently call the
    // wrong RPC and drop the user's answers.
    describe("mcp__happy__ask_user", () => {
        it.each([
            "default",
            "bypassPermissions",
            "yolo",
            "plan",
            "acceptEdits",
            "auto",
            "dontAsk",
            null,
            undefined,
        ] as const)("returns false in %s mode", (mode) => {
            expect(shouldAutoApprove(mode, "mcp__happy__ask_user", AUTO)).toBe(false);
        });
    });

    // ExitPlanMode: gated by the autoApprovePlanInYolo toggle in yolo/bypass.
    describe("ExitPlanMode", () => {
        // Toggle ON + yolo/bypass → auto-approve (skip the picker, continue
        // with full context).
        it.each(["yolo", "bypassPermissions"] as const)(
            "auto-approves in %s when the toggle is on",
            (mode) => {
                expect(shouldAutoApprove(mode, "ExitPlanMode", true)).toBe(true);
                expect(shouldAutoApprove(mode, "exit_plan_mode", true)).toBe(true);
            },
        );

        // Toggle OFF + yolo/bypass → manual picker (so "Clear context &
        // execute" stays reachable).
        it.each(["yolo", "bypassPermissions"] as const)(
            "requires manual approval in %s when the toggle is off",
            (mode) => {
                expect(shouldAutoApprove(mode, "ExitPlanMode", false)).toBe(false);
                expect(shouldAutoApprove(mode, "exit_plan_mode", false)).toBe(false);
            },
        );

        // Non-yolo modes always require manual approval regardless of toggle.
        it.each([
            "default",
            "plan",
            "acceptEdits",
            null,
            undefined,
        ] as const)("requires manual approval in %s mode (picker must render)", (mode) => {
            expect(shouldAutoApprove(mode, "ExitPlanMode", true)).toBe(false);
            expect(shouldAutoApprove(mode, "exit_plan_mode", true)).toBe(false);
        });
    });

    // bypassPermissions: auto-approve everything except AskUserQuestion
    describe("bypassPermissions mode", () => {
        it.each(["Bash", "Edit", "Read", "Grep", "Write", "MultiEdit", "NotebookEdit"])(
            "auto-approves %s",
            (tool) => {
                expect(shouldAutoApprove("bypassPermissions", tool, AUTO)).toBe(true);
            },
        );
    });

    // plan mode: auto-approve all except ExitPlanMode and AskUserQuestion
    describe("plan mode", () => {
        it.each(["Bash", "Edit", "Read", "Grep", "Write"])("auto-approves %s", (tool) => {
            expect(shouldAutoApprove("plan", tool, AUTO)).toBe(true);
        });

        it("does not auto-approve ExitPlanMode", () => {
            expect(shouldAutoApprove("plan", "ExitPlanMode", AUTO)).toBe(false);
        });
    });

    // acceptEdits: only edit tools
    describe("acceptEdits mode", () => {
        it.each(["Edit", "MultiEdit", "Write", "NotebookEdit"])(
            "auto-approves %s",
            (tool) => {
                expect(shouldAutoApprove("acceptEdits", tool, AUTO)).toBe(true);
            },
        );

        it.each(["Bash", "Read", "Grep", "Glob", "Agent"])("does not auto-approve %s", (tool) => {
            expect(shouldAutoApprove("acceptEdits", tool, AUTO)).toBe(false);
        });
    });

    // auto mode: SDK handles permissions server-side — no App-side auto-approve
    describe("auto mode", () => {
        it.each(["Bash", "Edit", "Read", "Write", "MultiEdit", "Grep"])(
            "does not auto-approve %s (SDK handles it)",
            (tool) => {
                expect(shouldAutoApprove("auto", tool, AUTO)).toBe(false);
            },
        );
    });

    // dontAsk mode: auto-deny unapproved — SDK handles it
    describe("dontAsk mode", () => {
        it.each(["Bash", "Edit", "Read", "Write", "MultiEdit", "Grep"])(
            "does not auto-approve %s (SDK denies)",
            (tool) => {
                expect(shouldAutoApprove("dontAsk", tool, AUTO)).toBe(false);
            },
        );
    });

    // default mode: never auto-approve
    describe("default mode", () => {
        it.each(["Bash", "Edit", "Read", "Write", "MultiEdit", "Grep"])(
            "does not auto-approve %s",
            (tool) => {
                expect(shouldAutoApprove("default", tool, AUTO)).toBe(false);
            },
        );
    });

    // null/undefined: treated as default
    describe("null/undefined mode", () => {
        it("treats null as default (no auto-approve)", () => {
            expect(shouldAutoApprove(null, "Edit", AUTO)).toBe(false);
            expect(shouldAutoApprove(null, "Bash", AUTO)).toBe(false);
        });

        it("treats undefined as default (no auto-approve)", () => {
            expect(shouldAutoApprove(undefined, "Edit", AUTO)).toBe(false);
            expect(shouldAutoApprove(undefined, "Bash", AUTO)).toBe(false);
        });
    });

    // Unknown mode: treated as default
    describe("unknown mode", () => {
        it("treats unknown mode as default", () => {
            expect(shouldAutoApprove("someRandomMode", "Edit", AUTO)).toBe(false);
        });
    });
});
