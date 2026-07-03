import { describe, expect, it, vi } from "vitest";

// @/text drags in expo-localization / persistence / log (RN-only). Stub it with
// a formatter that echoes the key + count so assertions stay legible.
vi.mock("@/text", () => ({
  t: (key: string, opts?: { count?: number }) =>
    opts?.count !== undefined ? `${key}:${opts.count}` : key,
}));

import { generateGroupSummary } from "./toolGroupSummary";
import type { Message, ToolCall } from "@/sync/typesMessage";

function toolMessage(id: string, name: string): Message {
  return {
    kind: "tool-call",
    id,
    realID: null,
    localId: null,
    createdAt: 0,
    tool: {
      name,
      state: "completed",
      input: {},
      createdAt: 0,
      startedAt: 0,
      completedAt: 0,
      description: null,
    } as ToolCall,
    children: [],
  } as Message;
}

describe("generateGroupSummary", () => {
  it("counts and phrases a single category", () => {
    expect(generateGroupSummary([toolMessage("1", "Edit")])).toBe(
      "toolGroup.editedFiles:1",
    );
  });

  it("aggregates counts within a category across tool aliases", () => {
    const summary = generateGroupSummary([
      toolMessage("1", "Edit"),
      toolMessage("2", "Write"),
      toolMessage("3", "MultiEdit"),
    ]);
    expect(summary).toBe("toolGroup.editedFiles:3");
  });

  it("joins multiple categories in a stable order (edit, read, terminal, ...)", () => {
    const summary = generateGroupSummary([
      toolMessage("1", "Bash"),
      toolMessage("2", "Read"),
      toolMessage("3", "Edit"),
    ]);
    expect(summary).toBe(
      "toolGroup.editedFiles:1, toolGroup.readFiles:1, toolGroup.ranCommands:1",
    );
  });

  it("maps unknown tools to the 'other' category", () => {
    expect(generateGroupSummary([toolMessage("1", "SomethingNew")])).toBe(
      "toolGroup.usedTools:1",
    );
  });

  it("falls back to a message-count summary when nothing categorised", () => {
    // A group with no tool-call messages produces no category parts.
    const nonTool = {
      kind: "agent-text",
      id: "x",
      localId: null,
      createdAt: 0,
      text: "hi",
    } as Message;
    expect(generateGroupSummary([nonTool])).toBe("toolGroup.usedTools:1");
  });
});
