import { describe, expect, it } from "vitest";
import { ToolCall } from "@/sync/typesMessage";
import {
    SubagentStateContainer,
    SubagentStatus,
    canTransitionSubagentStatus,
    getSubagentState,
    getSubagentStatus,
    isSubagentTool,
    setSubagentState,
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

// ---------------------------------------------------------------------------
// State machine API
// ---------------------------------------------------------------------------

describe("canTransitionSubagentStatus", () => {
    // Exhaustive 3 × 3 table — easier to read than 9 individual `it`s and
    // guarantees we update tests when the state machine grows new edges.
    const cases: ReadonlyArray<[SubagentStatus, SubagentStatus, boolean]> = [
        // running has the only outgoing edges
        ["running", "exited", true],
        ["running", "zombie", true],
        ["running", "running", false], // no self-loop — must actually move
        // exited and zombie are absorbing states with no outgoing edges,
        // including no resurrection back to running.
        ["exited", "running", false],
        ["exited", "exited", false],
        ["exited", "zombie", false],
        ["zombie", "running", false],
        ["zombie", "exited", false],
        ["zombie", "zombie", false],
    ];

    it.each(cases)("%s → %s should be %s", (from, to, expected) => {
        expect(canTransitionSubagentStatus(from, to)).toBe(expected);
    });
});

describe("getSubagentState / setSubagentState", () => {
    const initial: SubagentStateContainer = { status: "running", enteredAt: 1000 };

    it("getSubagentState reads the current status out of the container", () => {
        expect(getSubagentState(initial)).toBe("running");
    });

    it("setSubagentState produces a new container on a legal transition", () => {
        const next = setSubagentState(initial, "exited", 2000);
        expect(next).toEqual({ status: "exited", enteredAt: 2000 });
    });

    it("setSubagentState pins enteredAt to the injected clock", () => {
        // The `now` parameter is the only way callers should be able to
        // influence enteredAt — otherwise tests become flaky.
        expect(setSubagentState(initial, "zombie", 12345).enteredAt).toBe(12345);
    });

    it("setSubagentState defaults enteredAt to Date.now() when no clock is given", () => {
        const before = Date.now();
        const next = setSubagentState(initial, "exited");
        const after = Date.now();
        expect(next.enteredAt).toBeGreaterThanOrEqual(before);
        expect(next.enteredAt).toBeLessThanOrEqual(after);
    });

    it("setSubagentState never mutates the input container", () => {
        const snapshot = { ...initial };
        setSubagentState(initial, "exited", 2000);
        expect(initial).toEqual(snapshot);
    });

    it("setSubagentState throws on an illegal transition with the offending pair in the message", () => {
        const terminal: SubagentStateContainer = { status: "exited", enteredAt: 5000 };
        expect(() => setSubagentState(terminal, "running", 6000)).toThrowError(
            /exited.*running/,
        );
    });

    it("setSubagentState refuses self-loops even on running", () => {
        expect(() => setSubagentState(initial, "running", 2000)).toThrow();
    });
});
