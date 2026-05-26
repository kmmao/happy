import { describe, expect, it } from "vitest";

import { compareMessagesDesc } from "./messageOrdering";
import { Message } from "./typesMessage";

// The comparator only reads kind / createdAt / id, so partial fixtures are fine.
function msg(kind: Message["kind"], id: string, createdAt: number): Message {
  return { kind, id, createdAt } as unknown as Message;
}

// Helper: sorted array is newest-first; the chat list is inverted, so a HIGHER
// index renders HIGHER on screen. "above" therefore means a larger index.
function sortedKinds(messages: Message[]): string[] {
  return [...messages].sort(compareMessagesDesc).map((m) => m.kind);
}

describe("compareMessagesDesc", () => {
  it("当 createdAt 相同时，agent-text 排在 tool-call 之上（修复选项跑到消息上方）", () => {
    // Same source assistant message → identical createdAt. Text introduces the
    // AskUserQuestion card, so the prose must sit above the card. In the
    // descending array that means agent-text takes the HIGHER index.
    const result = sortedKinds([
      msg("tool-call", "b", 1000),
      msg("agent-text", "a", 1000),
    ]);
    expect(result).toEqual(["tool-call", "agent-text"]);
    // agent-text is at the larger index → drawn above the card in the inverted list.
    expect(result.indexOf("agent-text")).toBeGreaterThan(
      result.indexOf("tool-call"),
    );
  });

  it("createdAt 不同的时候只按时间降序，忽略 kind 优先级", () => {
    expect(
      sortedKinds([
        msg("agent-text", "a", 1000),
        msg("tool-call", "b", 3000),
        msg("user-text", "c", 2000),
      ]),
    ).toEqual(["tool-call", "user-text", "agent-text"]);
  });

  it("同一轮内 createdAt 相同的四种消息按既定优先级排列", () => {
    // Bottom → top on screen should read: user prompt, ready summary, tool
    // cards, then the assistant prose at the top. In the newest-first array
    // that is the reverse: user-text first … agent-text last.
    expect(
      sortedKinds([
        msg("agent-text", "d", 5000),
        msg("tool-call", "c", 5000),
        msg("agent-event", "b", 5000),
        msg("user-text", "a", 5000),
      ]),
    ).toEqual(["user-text", "agent-event", "tool-call", "agent-text"]);
  });

  it("createdAt 与 kind 都相同的时候用 id 做稳定 tie-breaker", () => {
    const ordered = [...[
      msg("tool-call", "z", 1000),
      msg("tool-call", "a", 1000),
    ]].sort(compareMessagesDesc);
    expect(ordered.map((m) => m.id)).toEqual(["a", "z"]);
  });
});
