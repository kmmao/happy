import { describe, expect, it } from "vitest";

import {
  compareMessagesDesc,
  mergeProcessedMessages,
  type SortedMessageList,
} from "./messageOrdering";
import { Message } from "./typesMessage";

// The comparator only reads kind / createdAt / id, so partial fixtures are fine.
function msg(kind: Message["kind"], id: string, createdAt: number): Message {
  return { kind, id, createdAt } as unknown as Message;
}

// Build a newest-first SortedMessageList from messages in any order — the same
// invariant mergeProcessedMessages assumes of its `existing` argument.
function listOf(...messages: Message[]): SortedMessageList {
  const sorted = [...messages].sort(compareMessagesDesc);
  const messagesMap: Record<string, Message> = {};
  for (const m of sorted) {
    messagesMap[m.id] = m;
  }
  return { messages: sorted, messagesMap };
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

describe("mergeProcessedMessages", () => {
  it("processedMessages 为空时原样返回（零分配，引用复用）", () => {
    const existing = listOf(msg("agent-text", "a", 2000), msg("user-text", "b", 1000));
    const result = mergeProcessedMessages(existing, [], false);
    // Same object reference back — no allocation when there is nothing to merge.
    expect(result).toBe(existing);
  });

  it("只就地更新已有消息时保持顺序、仅替换被改的引用", () => {
    const a = msg("agent-text", "a", 2000);
    const b = msg("user-text", "b", 1000);
    const existing = listOf(a, b);
    const updatedA = msg("agent-text", "a", 2000);

    const result = mergeProcessedMessages(existing, [updatedA], false);

    // Order unchanged, but the changed id now points at the new reference.
    expect(result.messages.map((m) => m.id)).toEqual(["a", "b"]);
    expect(result.messages[0]).toBe(updatedA);
    expect(result.messages[1]).toBe(b);
    expect(result.messagesMap.a).toBe(updatedA);
  });

  it("新消息都不早于现有最新消息时走 prepend 快路径", () => {
    const existing = listOf(msg("agent-text", "a", 2000), msg("user-text", "b", 1000));
    const c = msg("user-text", "c", 3000);
    const d = msg("agent-text", "d", 3000);

    const result = mergeProcessedMessages(existing, [c, d], false);

    // New batch is sorted (same createdAt → user-text before agent-text) then
    // prepended; the existing tail keeps its order.
    expect(result.messages.map((m) => m.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("prepend 时若批次里同时更新了已有消息，则重映射 tail 引用", () => {
    const a = msg("agent-text", "a", 2000);
    const b = msg("user-text", "b", 1000);
    const existing = listOf(a, b);
    const newest = msg("user-text", "c", 3000);
    const updatedB = msg("user-text", "b", 1000);

    const result = mergeProcessedMessages(existing, [newest, updatedB], false);

    expect(result.messages.map((m) => m.id)).toEqual(["c", "a", "b"]);
    // The updated existing message's reference is swapped in the tail.
    expect(result.messages[2]).toBe(updatedB);
    expect(result.messagesMap.b).toBe(updatedB);
  });

  it("prepend 且没有更新任何已有消息时直接复用旧 tail 数组", () => {
    const existing = listOf(msg("agent-text", "a", 2000), msg("user-text", "b", 1000));
    const newest = msg("user-text", "c", 3000);

    const result = mergeProcessedMessages(existing, [newest], false);

    // Tail messages keep their exact references (no per-element re-map).
    expect(result.messages[1]).toBe(existing.messages[0]);
    expect(result.messages[2]).toBe(existing.messages[1]);
  });

  it("新消息时间戳早于现有最新消息时退回整表重排（慢路径）", () => {
    const existing = listOf(msg("agent-text", "a", 2000), msg("user-text", "b", 1000));
    // createdAt 1500 falls between the existing two → cannot be prepended.
    const middle = msg("agent-event", "c", 1500);

    const result = mergeProcessedMessages(existing, [middle], false);

    expect(result.messages.map((m) => m.id)).toEqual(["a", "c", "b"]);
  });

  it("reordered=true 时即使没有新消息也强制整表重排", () => {
    const existing = listOf(msg("agent-text", "a", 2000), msg("user-text", "b", 1000));
    // Same id but createdAt moved earlier — only a re-sort can place it correctly.
    const movedA = msg("agent-text", "a", 500);

    const result = mergeProcessedMessages(existing, [movedA], true);

    expect(result.messages.map((m) => m.id)).toEqual(["b", "a"]);
    expect(result.messages[1]).toBe(movedA);
  });

  it("各路径结果都与「合并后整表重排」保持一致", () => {
    const existing = listOf(
      msg("agent-text", "a", 2000),
      msg("user-text", "b", 1000),
    );
    const processed = [
      msg("user-text", "c", 3000), // new, prependable
      msg("agent-text", "a", 2000), // in-place update
    ];

    const result = mergeProcessedMessages(existing, processed, false);

    // Reference oracle: merge the map and sort the whole thing.
    const oracleMap: Record<string, Message> = { ...existing.messagesMap };
    for (const m of processed) {
      oracleMap[m.id] = m;
    }
    const oracle = Object.values(oracleMap).sort(compareMessagesDesc);
    expect(result.messages.map((m) => m.id)).toEqual(oracle.map((m) => m.id));
    // And the map agrees with the array.
    for (const m of result.messages) {
      expect(result.messagesMap[m.id]).toBe(m);
    }
  });
});
