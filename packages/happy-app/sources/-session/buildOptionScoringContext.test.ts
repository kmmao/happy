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
        expect(result).toContain("  U: 请修复登录问题");
        expect(result).toContain("  A: I fixed the bug in auth.ts");
    });

    it("includes session title when provided", () => {
        const messages: Message[] = [userMsg("hello")];
        const result = buildOptionScoringContext(messages, "Fix auth flow");
        expect(result).toContain("Task: Fix auth flow");
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
        expect(result).toContain("  A: Here is my answer");
        expect(result).not.toContain("thinking about the problem");
    });

    it("returns empty string for empty messages", () => {
        const result = buildOptionScoringContext([], null);
        expect(result).toBe("");
    });

    it("returns only user text when no agent messages exist", () => {
        const messages: Message[] = [userMsg("just user")];
        const result = buildOptionScoringContext(messages, null);
        expect(result).toContain("  U: just user");
        expect(result).not.toContain("  A:");
    });

    it("truncates long user text to 200 chars", () => {
        const longText = "X".repeat(300);
        const messages: Message[] = [userMsg(longText)];
        const result = buildOptionScoringContext(messages, null);
        const userLine = result.split("\n").find((l) => l.startsWith("  U:"));
        expect(userLine).toBeDefined();
        expect(userLine!.length).toBeLessThanOrEqual(5 + 200);
    });

    it("truncates long agent text to 200 chars", () => {
        const longText = "Y".repeat(500);
        const messages: Message[] = [
            agentMsg(longText),
            userMsg("question"),
        ];
        const result = buildOptionScoringContext(messages, null);
        const agentLine = result.split("\n").find((l) => l.startsWith("  A:"));
        expect(agentLine).toBeDefined();
        expect(agentLine!.length).toBeLessThanOrEqual(5 + 200);
    });

    it("truncates session title to 100 chars", () => {
        const longTitle = "T".repeat(200);
        const messages: Message[] = [userMsg("hi")];
        const result = buildOptionScoringContext(messages, longTitle);
        const taskLine = result.split("\n").find((l) => l.startsWith("Task:"));
        expect(taskLine).toBeDefined();
        expect(taskLine!.length).toBeLessThanOrEqual(6 + 100);
    });

    it("total output stays under 1800 chars", () => {
        const messages: Message[] = [
            agentMsg("A".repeat(500)),
            userMsg("B".repeat(500)),
        ];
        const result = buildOptionScoringContext(messages, "C".repeat(200));
        expect(result.length).toBeLessThanOrEqual(1800);
    });

    it("takes only the first user and agent messages (newest-first order)", () => {
        const messages: Message[] = [
            agentMsg("turn4 agent"),
            userMsg("turn4 user"),
            agentMsg("turn3 agent"),
            userMsg("turn3 user"),
            agentMsg("turn2 agent"),
            userMsg("turn2 user"),
            agentMsg("turn1 agent"),
            userMsg("turn1 user"),
        ];
        const result = buildOptionScoringContext(messages, null);
        expect(result).toContain("turn4 agent");
        expect(result).toContain("turn4 user");
        expect(result).toContain("turn3 agent");
        expect(result).toContain("turn3 user");
        expect(result).toContain("turn2 agent");
        expect(result).toContain("turn2 user");
        // turn1 user is shown in Goal line (oldest turn since totalTurns > MAX_TURNS)
        expect(result).toContain("Goal:");
        expect(result).toContain("turn1 user");
        // but turn1 agent is not shown in recent turns
        expect(result).not.toContain("turn1 agent");
    });
});
