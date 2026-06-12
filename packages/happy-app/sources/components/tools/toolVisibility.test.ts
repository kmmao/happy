import { describe, expect, it } from "vitest";
import { isHiddenTool, isToolVisibleWithoutInline } from "./toolVisibility";

// Pins the visible-without-inline tool set (#129). A diff here is a
// deliberate product decision about what users see with viewInline off —
// not a refactor side effect.
const PINNED_ALWAYS_VISIBLE = [
    "Task",
    "Agent",
    "AskUserQuestion",
    "TodoWrite",
    "Read",
    "Edit",
    "MultiEdit",
    "Write",
    "Grep",
    "Glob",
    "LS",
    "NotebookEdit",
    "CodexDynamicTool",
    "CodexPermissions",
    "unknown",
    "CodexPatch",
    "GeminiPatch",
    "CodexDiff",
    "GeminiDiff",
    "edit",
];

describe("toolVisibility", () => {
    it("pins the always-visible set when viewInline is off", () => {
        for (const name of PINNED_ALWAYS_VISIBLE) {
            expect(isToolVisibleWithoutInline(name), name).toBe(true);
        }
    });

    it("keeps MCP tools visible without inline view", () => {
        expect(isToolVisibleWithoutInline("mcp__happy__change_title")).toBe(true);
        expect(isToolVisibleWithoutInline("mcp__anything")).toBe(true);
    });

    it("hides ordinary tools without inline view", () => {
        expect(isToolVisibleWithoutInline("Bash")).toBe(false);
        expect(isToolVisibleWithoutInline("WebFetch")).toBe(false);
        expect(isToolVisibleWithoutInline("ToolSearch")).toBe(false);
    });

    it("marks internal plumbing tools as hidden from the UI", () => {
        expect(isHiddenTool("ToolSearch")).toBe(true);
        expect(isHiddenTool("Bash")).toBe(false);
        expect(isHiddenTool("Task")).toBe(false);
    });
});
