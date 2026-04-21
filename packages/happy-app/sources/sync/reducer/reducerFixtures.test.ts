import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Message, ToolCallMessage } from "../typesMessage";
import { NormalizedMessage, normalizeRawMessage } from "../typesRaw";
import { createReducer, reducer, type ReducerState } from "./reducer";

type TraceFixtureName = "trace_0.json" | "trace_1.json" | "trace_2.json";

type TraceFixtureRecord = {
    id: string;
    localId: string | null;
    createdAt: number;
    content: Parameters<typeof normalizeRawMessage>[3];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadTraceFixture(name: TraceFixtureName): {
    rawRecords: TraceFixtureRecord[];
    normalized: NormalizedMessage[];
    result: ReturnType<typeof reducer>;
    state: ReducerState;
} {
    const fixturePath = join(__dirname, "..", "__testdata__", name);
    const rawRecords = JSON.parse(
        readFileSync(fixturePath, "utf8"),
    ) as TraceFixtureRecord[];
    const normalized = rawRecords
        .map((record) =>
            normalizeRawMessage(
                record.id,
                record.localId,
                record.createdAt,
                record.content,
            ),
        )
        .filter((message): message is NormalizedMessage => message !== null);
    const state = createReducer();
    const result = reducer(state, normalized);

    return {
        rawRecords,
        normalized,
        result,
        state,
    };
}

function isToolCallMessage(message: Message): message is ToolCallMessage {
    return message.kind === "tool-call";
}

function isAgentTextMessage(message: Message | undefined): message is Extract<Message, { kind: "agent-text" }> {
    return message?.kind === "agent-text";
}

function getToolCallMessages(messages: Message[]): ToolCallMessage[] {
    return messages.filter(isToolCallMessage);
}

describe("reducer fixture traces", () => {
    it("loads trace_1 and keeps the trailing Task tool call running", () => {
        const { rawRecords, normalized, result } = loadTraceFixture("trace_1.json");

        expect(rawRecords.length).toBeGreaterThan(0);
        expect(normalized.length).toBeGreaterThan(0);

        const taskMessage = result.messages.find(
            (message): message is ToolCallMessage =>
                isToolCallMessage(message) && message.tool.name === "Task",
        );

        expect(taskMessage).toBeDefined();
        expect(taskMessage?.tool.state).toBe("running");
        expect(taskMessage?.tool.description).toBe("Demo fake tool calls");
        expect(taskMessage?.children).toHaveLength(0);
    });

    it("nests trace_0 Task sidechains under their originating tool calls", () => {
        const { rawRecords, normalized, result, state } = loadTraceFixture("trace_0.json");

        expect(rawRecords).toHaveLength(83);
        expect(normalized).toHaveLength(83);
        expect(result.messages).toHaveLength(6);
        expect(state.sidechains.size).toBe(3);

        const taskMessages = getToolCallMessages(result.messages);
        expect(taskMessages).toHaveLength(3);
        expect(
            taskMessages.map((message) => ({
                name: message.tool.name,
                state: message.tool.state,
                description: message.tool.description,
                children: message.children.length,
            })),
        ).toEqual([
            {
                name: "Task",
                state: "completed",
                description: "Search for config files",
                children: 19,
            },
            {
                name: "Task",
                state: "completed",
                description: "Find test files",
                children: 12,
            },
            {
                name: "Task",
                state: "completed",
                description: "Analyze API structure",
                children: 14,
            },
        ]);

        const [configTask, testTask, apiTask] = taskMessages;
        expect(configTask.children[0]?.kind).toBe("user-text");
        expect(configTask.children[2]?.kind).toBe("tool-call");
        if (configTask.children[2]?.kind === "tool-call") {
            expect(configTask.children[2].tool.name).toBe("Glob");
        }
        const configSummary = configTask.children.at(-1);
        expect(configSummary?.kind).toBe("agent-text");
        if (isAgentTextMessage(configSummary)) {
            expect(configSummary.text).toContain(
                "Summary of Configuration Files Found",
            );
        }

        expect(testTask.children[0]?.kind).toBe("user-text");
        const testSummary = testTask.children.at(-1);
        expect(testSummary?.kind).toBe("agent-text");
        if (isAgentTextMessage(testSummary)) {
            expect(testSummary.text).toContain(
                "Summary of Test Files in the Project",
            );
        }

        expect(apiTask.children[0]?.kind).toBe("user-text");
        const apiSummary = apiTask.children.at(-1);
        expect(apiSummary?.kind).toBe("agent-text");
        if (isAgentTextMessage(apiSummary)) {
            expect(apiSummary.text).toContain(
                "Summary of API Module Structure",
            );
        }
    });

    it("surfaces trace_2 Task failures as errored tool calls", () => {
        const { rawRecords, normalized, result, state } = loadTraceFixture("trace_2.json");

        expect(rawRecords).toHaveLength(5);
        expect(normalized).toHaveLength(5);
        expect(result.messages).toHaveLength(3);
        expect(state.sidechains.size).toBe(0);

        const taskMessages = getToolCallMessages(result.messages);
        expect(taskMessages).toHaveLength(1);
        expect(taskMessages[0]?.tool.name).toBe("Task");
        expect(taskMessages[0]?.tool.state).toBe("error");
        expect(taskMessages[0]?.tool.description).toBe("Search for socket.io usage");
        expect(taskMessages[0]?.children).toHaveLength(0);
        expect(typeof taskMessages[0]?.tool.result).toBe("string");
        expect(String(taskMessages[0]?.tool.result)).toContain(
            "Request interrupted by user",
        );
    });
});
