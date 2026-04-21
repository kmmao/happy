import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    type NormalizedMessage,
    normalizeRawMessage,
} from "./typesRaw";

type TraceFixtureName = "trace_0.json" | "trace_1.json" | "trace_2.json";

type TraceFixtureRecord = {
    id: string;
    localId: string | null;
    createdAt: number;
    content: Parameters<typeof normalizeRawMessage>[3];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadNormalizedTraceFixture(name: TraceFixtureName): {
    rawRecords: TraceFixtureRecord[];
    normalized: NormalizedMessage[];
} {
    const fixturePath = join(__dirname, "__testdata__", name);
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

    return {
        rawRecords,
        normalized,
    };
}

function countNormalizedMessages(messages: readonly NormalizedMessage[]): Record<string, number> {
    const counts = new Map<string, number>();

    for (const message of messages) {
        const key = `${message.role}:${message.isSidechain ? "sidechain" : "main"}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return Object.fromEntries(counts);
}

function isAgentNormalizedMessage(
    message: NormalizedMessage,
): message is Extract<NormalizedMessage, { role: "agent" }> {
    return message.role === "agent";
}

describe("normalizeRawMessage fixture traces", () => {
    it("normalizes trace_0 into main-session Task calls plus sidechain messages", () => {
        const { rawRecords, normalized } = loadNormalizedTraceFixture("trace_0.json");

        expect(rawRecords).toHaveLength(83);
        expect(normalized).toHaveLength(83);
        expect(countNormalizedMessages(normalized)).toEqual({
            "user:main": 1,
            "agent:main": 8,
            "agent:sidechain": 74,
        });

        expect(normalized[0]).toMatchObject({
            role: "user",
            isSidechain: false,
            content: {
                type: "text",
                text: "Run few test tasks using Task tool",
            },
        });

        const topLevelTaskMessages = normalized.filter(
            (message): message is Extract<NormalizedMessage, { role: "agent" }> =>
                isAgentNormalizedMessage(message) &&
                !message.isSidechain &&
                message.content.length > 0 &&
                message.content[0]?.type === "tool-call" &&
                message.content[0].name === "Task",
        );

        expect(topLevelTaskMessages).toHaveLength(3);
        expect(
            topLevelTaskMessages.map((message) => {
                const content = message.content[0];
                if (content?.type !== "tool-call") {
                    throw new Error("Expected top-level Task tool call");
                }

                return {
                    toolId: content.id,
                    description: content.description,
                };
            }),
        ).toEqual([
            {
                toolId: "toolu_017KjYtqRtBF4J9j74LsbkYX",
                description: "Search for config files",
            },
            {
                toolId: "toolu_019xaKUz8YYoZ8TbnwvPxnW7",
                description: "Find test files",
            },
            {
                toolId: "toolu_01XrmLKxmd4NvNNgGcCbpdLq",
                description: "Analyze API structure",
            },
        ]);

        expect(
            normalized.some(
                (message) =>
                    message.role === "agent" &&
                    message.isSidechain &&
                    message.content.length > 0 &&
                    message.content[0]?.type === "sidechain" &&
                    message.content[0].prompt.includes("Search for all test files"),
            ),
        ).toBe(true);

        expect(
            normalized.some(
                (message) =>
                    message.role === "agent" &&
                    message.isSidechain &&
                    message.content.some(
                        (item) =>
                            item.type === "text" &&
                            item.text.includes("Summary of Configuration Files Found"),
                    ),
            ),
        ).toBe(true);

        expect(normalized.at(-1)).toMatchObject({
            role: "agent",
            isSidechain: false,
        });
        const lastMessage = normalized.at(-1);
        expect(lastMessage?.role).toBe("agent");
        if (lastMessage?.role === "agent") {
            expect(lastMessage.content[0]?.type).toBe("text");
            if (lastMessage.content[0]?.type === "text") {
                expect(lastMessage.content[0].text).toContain(
                    "I've successfully run 3 test tasks using the Task tool",
                );
            }
        }
    });

    it("normalizes trace_1 as a main-thread-only session ending with a Task tool call", () => {
        const { rawRecords, normalized } = loadNormalizedTraceFixture("trace_1.json");

        expect(rawRecords).toHaveLength(43);
        expect(normalized).toHaveLength(42);
        expect(countNormalizedMessages(normalized)).toEqual({
            "user:main": 5,
            "agent:main": 37,
        });

        expect(normalized[0]).toMatchObject({
            role: "user",
            isSidechain: false,
            content: {
                type: "text",
                text: "Run some fake tool calling using Task tool",
            },
        });

        expect(
            normalized.some(
                (message) =>
                    message.role === "agent" &&
                    !message.isSidechain &&
                    message.content.length === 0,
            ),
        ).toBe(true);

        const finalMessage = normalized.at(-1);
        expect(finalMessage?.role).toBe("agent");
        expect(finalMessage?.isSidechain).toBe(false);
        if (finalMessage?.role === "agent") {
            expect(finalMessage.content).toHaveLength(1);
            expect(finalMessage.content[0]?.type).toBe("tool-call");
            if (finalMessage.content[0]?.type === "tool-call") {
                expect(finalMessage.content[0].name).toBe("Task");
                expect(finalMessage.content[0].id).toBe("toolu_019cMraL5FuYNd5PVkq5U2xb");
                expect(finalMessage.content[0].description).toBe("Demo fake tool calls");
            }
        }
    });

    it("normalizes trace_2 as a failed Task flow without sidechains", () => {
        const { rawRecords, normalized } = loadNormalizedTraceFixture("trace_2.json");

        expect(rawRecords).toHaveLength(5);
        expect(normalized).toHaveLength(5);
        expect(countNormalizedMessages(normalized)).toEqual({
            "user:main": 1,
            "agent:main": 4,
        });

        expect(normalized[0]).toMatchObject({
            role: "user",
            isSidechain: false,
            content: {
                type: "text",
                text: "show me some tool callilng, use Task, but make it not too long",
            },
        });

        const taskCall = normalized[2];
        expect(taskCall?.role).toBe("agent");
        expect(taskCall?.isSidechain).toBe(false);
        if (taskCall?.role === "agent") {
            expect(taskCall.content[0]?.type).toBe("tool-call");
            if (taskCall.content[0]?.type === "tool-call") {
                expect(taskCall.content[0].name).toBe("Task");
                expect(taskCall.content[0].description).toBe("Search for socket.io usage");
            }
        }

        const taskResult = normalized[3];
        expect(taskResult?.role).toBe("agent");
        expect(taskResult?.isSidechain).toBe(false);
        if (taskResult?.role === "agent") {
            expect(taskResult.content[0]?.type).toBe("tool-result");
            if (taskResult.content[0]?.type === "tool-result") {
                expect(taskResult.content[0].tool_use_id).toBe("toolu_01B3dLjLkkLqViKvxsJRwhCw");
                expect(taskResult.content[0].is_error).toBe(true);
            }
        }

        expect(normalized[4]).toMatchObject({
            role: "agent",
            isSidechain: false,
            content: [],
        });
    });
});
