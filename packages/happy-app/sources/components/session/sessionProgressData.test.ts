import { describe, expect, it } from "vitest";

import type { Message, ToolCall } from "@/sync/typesMessage";
import {
    computeSessionProgress,
    countTodoProgress,
    resolveChecklist,
} from "./sessionProgressData";

function makeTool(overrides: Partial<ToolCall> & Pick<ToolCall, "name">): ToolCall {
    return {
        state: "completed",
        input: {},
        createdAt: 0,
        startedAt: 0,
        completedAt: 0,
        description: null,
        ...overrides,
    };
}

function makeToolCallMessage(
    id: string,
    createdAt: number,
    tool: ToolCall,
    children: Message[] = [],
): Message {
    return {
        kind: "tool-call",
        id,
        localId: null,
        createdAt,
        tool,
        children,
    };
}

function makeUserText(id: string, createdAt: number, text = "ask"): Message {
    return {
        kind: "user-text",
        id,
        realId: null,
        localId: null,
        createdAt,
        text,
    };
}

function makeAgentText(id: string, createdAt: number, text = "reply"): Message {
    return {
        kind: "agent-text",
        id,
        localId: null,
        createdAt,
        text,
    };
}

describe("computeSessionProgress", () => {
    it("returns empty aggregate when no messages", () => {
        const result = computeSessionProgress([]);
        expect(result).toEqual({
            todos: null,
            todosUpdatedAt: null,
            files: [],
            commands: [],
            userTurns: 0,
            agentTurns: 0,
            toolCalls: 0,
        });
    });

    it("picks the latest TodoWrite call and ignores earlier ones", () => {
        const earlier = makeToolCallMessage(
            "tc1",
            100,
            makeTool({
                name: "TodoWrite",
                completedAt: 100,
                input: {
                    todos: [
                        { content: "A", status: "pending" },
                        { content: "B", status: "pending" },
                    ],
                },
                result: {
                    newTodos: [
                        { content: "A", status: "pending" },
                        { content: "B", status: "pending" },
                    ],
                },
            }),
        );
        const later = makeToolCallMessage(
            "tc2",
            200,
            makeTool({
                name: "TodoWrite",
                completedAt: 200,
                input: {
                    todos: [
                        { content: "A", status: "completed" },
                        { content: "B", status: "in_progress" },
                        { content: "C", status: "pending", priority: "high" },
                    ],
                },
                result: {
                    newTodos: [
                        { content: "A", status: "completed" },
                        { content: "B", status: "in_progress" },
                        { content: "C", status: "pending", priority: "high" },
                    ],
                },
            }),
        );

        const result = computeSessionProgress([earlier, later]);
        expect(result.todos).toEqual([
            { content: "A", status: "completed", priority: undefined, id: undefined },
            { content: "B", status: "in_progress", priority: undefined, id: undefined },
            { content: "C", status: "pending", priority: "high", id: undefined },
        ]);
        expect(result.todosUpdatedAt).toBe(200);
    });

    it("falls back to input.todos when result.newTodos absent", () => {
        const msg = makeToolCallMessage(
            "tc1",
            50,
            makeTool({
                name: "TodoWrite",
                state: "running",
                completedAt: null,
                startedAt: 50,
                input: {
                    todos: [{ content: "X", status: "in_progress" }],
                },
            }),
        );
        const result = computeSessionProgress([msg]);
        expect(result.todos).toEqual([
            { content: "X", status: "in_progress", priority: undefined, id: undefined },
        ]);
        expect(result.todosUpdatedAt).toBe(50);
    });

    it("aggregates file edits and commands with dedup and recency ordering", () => {
        const messages: Message[] = [
            makeToolCallMessage(
                "e1",
                100,
                makeTool({
                    name: "Edit",
                    completedAt: 100,
                    input: { file_path: "/repo/a.ts" },
                }),
            ),
            makeToolCallMessage(
                "e2",
                200,
                makeTool({
                    name: "Write",
                    completedAt: 200,
                    input: { file_path: "/repo/b.ts" },
                }),
            ),
            makeToolCallMessage(
                "e3",
                300,
                makeTool({
                    name: "Edit",
                    completedAt: 300,
                    input: { file_path: "/repo/a.ts" },
                }),
            ),
            makeToolCallMessage(
                "b1",
                150,
                makeTool({
                    name: "Bash",
                    completedAt: 150,
                    input: { command: "yarn test" },
                }),
            ),
            makeToolCallMessage(
                "b2",
                250,
                makeTool({
                    name: "Bash",
                    completedAt: 250,
                    input: { command: "yarn test\n--filter foo" },
                }),
            ),
        ];

        const result = computeSessionProgress(messages);
        expect(result.files).toEqual([
            { path: "/repo/a.ts", edits: 2, lastTouchedAt: 300 },
            { path: "/repo/b.ts", edits: 1, lastTouchedAt: 200 },
        ]);
        expect(result.commands).toEqual([
            { command: "yarn test", count: 2, lastRanAt: 250 },
        ]);
    });

    it("counts user and agent turns and tool calls", () => {
        const messages: Message[] = [
            makeUserText("u1", 1),
            makeAgentText("a1", 2),
            makeToolCallMessage(
                "t1",
                3,
                makeTool({ name: "Bash", input: { command: "ls" }, completedAt: 3 }),
            ),
            makeUserText("u2", 4),
            makeAgentText("a2", 5),
            makeAgentText("a3", 6),
        ];
        const result = computeSessionProgress(messages);
        expect(result.userTurns).toBe(2);
        expect(result.agentTurns).toBe(3);
        expect(result.toolCalls).toBe(1);
    });

    it("walks nested tool-call children (Task sub-agent tools)", () => {
        const nestedEdit = makeToolCallMessage(
            "nested",
            500,
            makeTool({
                name: "Edit",
                completedAt: 500,
                input: { file_path: "/repo/nested.ts" },
            }),
        );
        const parent = makeToolCallMessage(
            "parent",
            400,
            makeTool({ name: "Task", completedAt: 400 }),
            [nestedEdit],
        );
        const result = computeSessionProgress([parent]);
        expect(result.files.map((f) => f.path)).toContain("/repo/nested.ts");
    });
});

describe("resolveChecklist", () => {
    it("prefers MCP-sourced progress over TodoWrite fallback", () => {
        const result = resolveChecklist(
            {
                todos: [
                    { content: "A", status: "completed" },
                    { content: "B", status: "pending" },
                ],
                currentStage: "Phase 2",
                updatedAt: 1000,
            },
            {
                todos: [
                    { content: "old", status: "pending" },
                ],
                todosUpdatedAt: 500,
            },
        );
        expect(result.source).toBe("mcp");
        expect(result.todos).toHaveLength(2);
        expect(result.currentStage).toBe("Phase 2");
        expect(result.updatedAt).toBe(1000);
    });

    it("falls back to TodoWrite when MCP progress absent", () => {
        const result = resolveChecklist(undefined, {
            todos: [{ content: "fallback", status: "in_progress" }],
            todosUpdatedAt: 200,
        });
        expect(result.source).toBe("todowrite");
        expect(result.todos).toHaveLength(1);
        expect(result.updatedAt).toBe(200);
    });

    it("returns empty checklist when no source present", () => {
        const result = resolveChecklist(undefined, {
            todos: null,
            todosUpdatedAt: null,
        });
        expect(result.source).toBe("none");
        expect(result.todos).toEqual([]);
        expect(result.updatedAt).toBeNull();
    });

    it("treats empty MCP todos as absent and falls back", () => {
        const result = resolveChecklist(
            { todos: [], updatedAt: 900 },
            {
                todos: [{ content: "x", status: "pending" }],
                todosUpdatedAt: 100,
            },
        );
        expect(result.source).toBe("todowrite");
    });
});

describe("countTodoProgress", () => {
    it("returns zero counts for null or empty", () => {
        expect(countTodoProgress(null)).toEqual({
            completed: 0,
            inProgress: 0,
            pending: 0,
            total: 0,
            completionRatio: 0,
        });
        expect(countTodoProgress([])).toEqual({
            completed: 0,
            inProgress: 0,
            pending: 0,
            total: 0,
            completionRatio: 0,
        });
    });

    it("tallies status and computes completion ratio", () => {
        const counts = countTodoProgress([
            { content: "a", status: "completed" },
            { content: "b", status: "completed" },
            { content: "c", status: "in_progress" },
            { content: "d", status: "pending" },
        ]);
        expect(counts).toEqual({
            completed: 2,
            inProgress: 1,
            pending: 1,
            total: 4,
            completionRatio: 0.5,
        });
    });
});
