import { describe, it, expect } from "vitest";
import { buildOptionScoringContext } from "./buildOptionScoringContext";
import { type Message } from "@/sync/typesMessage";

function userMsg(text: string): Message {
    return {
        kind: "user-text",
        id: `u-${Math.random()}`,
        realId: null,
        localId: null,
        createdAt: Date.now(),
        text,
    };
}

function agentMsg(text: string, isThinking = false): Message {
    return {
        kind: "agent-text",
        id: `a-${Math.random()}`,
        localId: null,
        createdAt: Date.now(),
        text,
        isThinking,
    };
}

describe("buildOptionScoringContext", () => {
    it("extracts latest user and agent messages", () => {
        const messages: Message[] = [
            agentMsg("I fixed the bug in auth.ts"),
            userMsg("请修复登录问题"),
        ];
        const result = buildOptionScoringContext(messages, null);
        expect(result).toContain("- User: 请修复登录问题");
        expect(result).toContain("- Agent: I fixed the bug in auth.ts");
    });

    it("includes session title when provided", () => {
        const messages: Message[] = [userMsg("hello")];
        const result = buildOptionScoringContext(messages, "Fix auth flow");
        expect(result).toContain("- Task: Fix auth flow");
    });

    it("omits task line when sessionTitle is null", () => {
        const messages: Message[] = [userMsg("hello")];
        const result = buildOptionScoringContext(messages, null);
        expect(result).not.toContain("Task:");
    });

    it("skips thinking messages", () => {
        const messages: Message[] = [
            agentMsg("thinking about the problem...", true),
            agentMsg("Here is my answer"),
            userMsg("question"),
        ];
        const result = buildOptionScoringContext(messages, null);
        expect(result).toContain("- Agent: Here is my answer");
        expect(result).not.toContain("thinking about the problem");
    });

    it("returns empty string for empty messages", () => {
        const result = buildOptionScoringContext([], null);
        expect(result).toBe("");
    });

    it("returns only user text when no agent messages exist", () => {
        const messages: Message[] = [userMsg("just user")];
        const result = buildOptionScoringContext(messages, null);
        expect(result).toContain("- User: just user");
        expect(result).not.toContain("- Agent:");
    });

    it("truncates long user text to 200 chars", () => {
        const longText = "X".repeat(300);
        const messages: Message[] = [userMsg(longText)];
        const result = buildOptionScoringContext(messages, null);
        const userLine = result.split("\n").find((l) => l.startsWith("- User:"));
        expect(userLine).toBeDefined();
        expect(userLine!.length).toBeLessThanOrEqual(8 + 200);
    });

    it("truncates long agent text to 300 chars", () => {
        const longText = "Y".repeat(500);
        const messages: Message[] = [agentMsg(longText)];
        const result = buildOptionScoringContext(messages, null);
        const agentLine = result.split("\n").find((l) => l.startsWith("- Agent:"));
        expect(agentLine).toBeDefined();
        expect(agentLine!.length).toBeLessThanOrEqual(9 + 300);
    });

    it("truncates session title to 100 chars", () => {
        const longTitle = "T".repeat(200);
        const messages: Message[] = [userMsg("hi")];
        const result = buildOptionScoringContext(messages, longTitle);
        const taskLine = result.split("\n").find((l) => l.startsWith("- Task:"));
        expect(taskLine).toBeDefined();
        expect(taskLine!.length).toBeLessThanOrEqual(8 + 100);
    });

    it("total output stays under 1000 chars", () => {
        const messages: Message[] = [
            agentMsg("A".repeat(500)),
            userMsg("B".repeat(500)),
        ];
        const result = buildOptionScoringContext(messages, "C".repeat(200));
        expect(result.length).toBeLessThanOrEqual(1000);
    });

    it("takes only the first user and agent messages (newest-first order)", () => {
        const messages: Message[] = [
            agentMsg("newest agent"),
            userMsg("newest user"),
            agentMsg("older agent"),
            userMsg("older user"),
        ];
        const result = buildOptionScoringContext(messages, null);
        expect(result).toContain("newest agent");
        expect(result).toContain("newest user");
        expect(result).not.toContain("older agent");
        expect(result).not.toContain("older user");
    });
});
