import { describe, expect, it } from "vitest";
import { ToolCall } from "@/sync/typesMessage";
import {
    SubagentStatus,
    getSubagentStatus,
    isSubagentTool,
} from "./subagentStatus";

/**
 * Minimal ToolCall factory — we only set the fields the status machine
 * actually inspects (name, state, result). Everything else gets a
 * harmless default so the tests don't drift when ToolCall grows new
 * optional fields.
 */
function makeTool(overrides: Partial<ToolCall> & Pick<ToolCall, "name" | "state">): ToolCall {
    return {
        id: "tool-1",
        input: {},
        createdAt: 0,
        startedAt: null,
        completedAt: null,
        description: null,
        ...overrides,
    };
}

describe("isSubagentTool", () => {
    it.each([
        ["Agent", true],
        ["Task", true],
        ["Bash", false],
        ["Read", false],
        ["mcp__server__doThing", false],
    ] as const)("returns %s for tool name %s", (name, expected) => {
        expect(isSubagentTool(makeTool({ name, state: "running" }))).toBe(expected);
    });
});

describe("getSubagentStatus", () => {
    it("returns null for non-sub-agent tools so callers cannot mis-bucket Bash", () => {
        expect(getSubagentStatus(makeTool({ name: "Bash", state: "running" }))).toBeNull();
    });

    it("running Agent → running", () => {
        const status: SubagentStatus | null = getSubagentStatus(
            makeTool({ name: "Agent", state: "running" }),
        );
        expect(status).toBe("running");
    });

    it("completed Agent with a payload → exited (the normal happy path)", () => {
        expect(
            getSubagentStatus(
                makeTool({
                    name: "Agent",
                    state: "completed",
                    result: { content: "done" },
                }),
            ),
        ).toBe("exited");
    });

    it("completed Task with empty-string result counts as exited, not zombie", () => {
        // An empty string is still a publishable payload — the parent saw
        // *something*. Only null / undefined should fall into zombie.
        expect(
            getSubagentStatus(
                makeTool({ name: "Task", state: "completed", result: "" }),
            ),
        ).toBe("exited");
    });

    it("errored Task → exited (the parent reaped a definite failure status)", () => {
        expect(
            getSubagentStatus(makeTool({ name: "Task", state: "error" })),
        ).toBe("exited");
    });

    it("completed Agent with result === null → zombie (the misleading 40ms Explore case)", () => {
        expect(
            getSubagentStatus(
                makeTool({ name: "Agent", state: "completed", result: null }),
            ),
        ).toBe("zombie");
    });

    it("completed Agent with result === undefined → zombie", () => {
        expect(
            getSubagentStatus(makeTool({ name: "Agent", state: "completed" })),
        ).toBe("zombie");
    });
});
