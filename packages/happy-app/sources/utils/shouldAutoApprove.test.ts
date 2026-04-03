import { describe, it, expect } from "vitest";
import { shouldAutoApprove } from "./shouldAutoApprove";

describe("shouldAutoApprove", () => {
    describe("yolo mode", () => {
        it.each(["Bash", "CodexBash", "Edit", "Write", "Read", "Grep"])(
            "auto-approves %s",
            (tool) => {
                expect(shouldAutoApprove("yolo", tool)).toBe(true);
            },
        );

        it("does not auto-approve AskUserQuestion", () => {
            expect(shouldAutoApprove("yolo", "AskUserQuestion")).toBe(false);
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
            expect(shouldAutoApprove(mode, "AskUserQuestion")).toBe(false);
        });
    });

    // ExitPlanMode: only auto-approve in bypassPermissions
    describe("ExitPlanMode", () => {
        it("returns true only in bypassPermissions mode", () => {
            expect(shouldAutoApprove("bypassPermissions", "ExitPlanMode")).toBe(true);
            expect(shouldAutoApprove("bypassPermissions", "exit_plan_mode")).toBe(true);
        });

        it.each(["default", "plan", "acceptEdits", null, undefined] as const)(
            "returns false in %s mode",
            (mode) => {
                expect(shouldAutoApprove(mode, "ExitPlanMode")).toBe(false);
                expect(shouldAutoApprove(mode, "exit_plan_mode")).toBe(false);
            },
        );
    });

    // bypassPermissions: auto-approve everything except AskUserQuestion
    describe("bypassPermissions mode", () => {
        it.each(["Bash", "Edit", "Read", "Grep", "Write", "MultiEdit", "NotebookEdit"])(
            "auto-approves %s",
            (tool) => {
                expect(shouldAutoApprove("bypassPermissions", tool)).toBe(true);
            },
        );
    });

    // plan mode: auto-approve all except ExitPlanMode and AskUserQuestion
    describe("plan mode", () => {
        it.each(["Bash", "Edit", "Read", "Grep", "Write"])("auto-approves %s", (tool) => {
            expect(shouldAutoApprove("plan", tool)).toBe(true);
        });

        it("does not auto-approve ExitPlanMode", () => {
            expect(shouldAutoApprove("plan", "ExitPlanMode")).toBe(false);
        });
    });

    // acceptEdits: only edit tools
    describe("acceptEdits mode", () => {
        it.each(["Edit", "MultiEdit", "Write", "NotebookEdit"])(
            "auto-approves %s",
            (tool) => {
                expect(shouldAutoApprove("acceptEdits", tool)).toBe(true);
            },
        );

        it.each(["Bash", "Read", "Grep", "Glob", "Agent"])("does not auto-approve %s", (tool) => {
            expect(shouldAutoApprove("acceptEdits", tool)).toBe(false);
        });
    });

    // auto mode: SDK handles permissions server-side — no App-side auto-approve
    describe("auto mode", () => {
        it.each(["Bash", "Edit", "Read", "Write", "MultiEdit", "Grep"])(
            "does not auto-approve %s (SDK handles it)",
            (tool) => {
                expect(shouldAutoApprove("auto", tool)).toBe(false);
            },
        );
    });

    // dontAsk mode: auto-deny unapproved — SDK handles it
    describe("dontAsk mode", () => {
        it.each(["Bash", "Edit", "Read", "Write", "MultiEdit", "Grep"])(
            "does not auto-approve %s (SDK denies)",
            (tool) => {
                expect(shouldAutoApprove("dontAsk", tool)).toBe(false);
            },
        );
    });

    // default mode: never auto-approve
    describe("default mode", () => {
        it.each(["Bash", "Edit", "Read", "Write", "MultiEdit", "Grep"])(
            "does not auto-approve %s",
            (tool) => {
                expect(shouldAutoApprove("default", tool)).toBe(false);
            },
        );
    });

    // null/undefined: treated as default
    describe("null/undefined mode", () => {
        it("treats null as default (no auto-approve)", () => {
            expect(shouldAutoApprove(null, "Edit")).toBe(false);
            expect(shouldAutoApprove(null, "Bash")).toBe(false);
        });

        it("treats undefined as default (no auto-approve)", () => {
            expect(shouldAutoApprove(undefined, "Edit")).toBe(false);
            expect(shouldAutoApprove(undefined, "Bash")).toBe(false);
        });
    });

    // Unknown mode: treated as default
    describe("unknown mode", () => {
        it("treats unknown mode as default", () => {
            expect(shouldAutoApprove("someRandomMode", "Edit")).toBe(false);
        });
    });
});
