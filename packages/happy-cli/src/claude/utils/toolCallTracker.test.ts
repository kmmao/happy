import { describe, it, expect } from "vitest";
import { createToolCallTracker } from "./toolCallTracker";
import type { ClaudeJsonlMessage } from "../jsonl";

function assistantToolUse(
  calls: Array<{ id: string; name: string; input: unknown }>,
): ClaudeJsonlMessage {
  return {
    type: "assistant",
    message: {
      content: calls.map((c) => ({
        type: "tool_use",
        id: c.id,
        name: c.name,
        input: c.input,
      })),
    },
  } as unknown as ClaudeJsonlMessage;
}

function userToolResult(toolUseId: string): ClaudeJsonlMessage {
  return {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: toolUseId }],
    },
  } as unknown as ClaudeJsonlMessage;
}

describe("toolCallTracker", () => {
  it("resolves a tool call id by name + deep-equal input", () => {
    const t = createToolCallTracker();
    t.ingest(assistantToolUse([{ id: "call_1", name: "Read", input: { file: "a.ts" } }]));
    expect(t.resolveId("Read", { file: "a.ts" })).toBe("call_1");
  });

  it("returns null for an unknown call and for a mismatched input", () => {
    const t = createToolCallTracker();
    t.ingest(assistantToolUse([{ id: "call_1", name: "Read", input: { file: "a.ts" } }]));
    expect(t.resolveId("Write", { file: "a.ts" })).toBeNull();
    expect(t.resolveId("Read", { file: "b.ts" })).toBeNull();
  });

  it("resolves to the most recent match, then bails to null once it is used", () => {
    // Preserved quirk from the original resolveToolCallId: the reverse scan
    // returns null as soon as the FIRST (most-recent) name+input match it hits
    // is already used — it does NOT fall through to an older identical unused
    // call. Encoded here so a future refactor can't silently change it.
    const t = createToolCallTracker();
    t.ingest(
      assistantToolUse([
        { id: "call_1", name: "Bash", input: { command: "ls" } },
        { id: "call_2", name: "Bash", input: { command: "ls" } },
      ]),
    );
    expect(t.resolveId("Bash", { command: "ls" })).toBe("call_2");
    // call_2 is now used; the scan hits it first and bails, never reaching call_1.
    expect(t.resolveId("Bash", { command: "ls" })).toBeNull();
  });

  it("a tool_result retires the matching call so it no longer resolves", () => {
    const t = createToolCallTracker();
    t.ingest(assistantToolUse([{ id: "call_1", name: "Read", input: { file: "a.ts" } }]));
    t.ingest(userToolResult("call_1"));
    expect(t.resolveId("Read", { file: "a.ts" })).toBeNull();
  });

  it("markUsed retires a call by id", () => {
    const t = createToolCallTracker();
    t.ingest(assistantToolUse([{ id: "call_1", name: "Read", input: {} }]));
    t.markUsed("call_1");
    expect(t.resolveId("Read", {})).toBeNull();
  });

  it("isExitPlanCall recognizes exit_plan_mode / ExitPlanMode", () => {
    const t = createToolCallTracker();
    t.ingest(
      assistantToolUse([
        { id: "call_plan", name: "ExitPlanMode", input: {} },
        { id: "call_snake", name: "exit_plan_mode", input: {} },
        { id: "call_read", name: "Read", input: {} },
      ]),
    );
    expect(t.isExitPlanCall("call_plan")).toBe(true);
    expect(t.isExitPlanCall("call_snake")).toBe(true);
    expect(t.isExitPlanCall("call_read")).toBe(false);
    expect(t.isExitPlanCall("unknown")).toBe(false);
  });

  it("clear() forgets every tracked call", () => {
    const t = createToolCallTracker();
    t.ingest(assistantToolUse([{ id: "call_1", name: "Read", input: {} }]));
    t.clear();
    expect(t.resolveId("Read", {})).toBeNull();
    expect(t.isExitPlanCall("call_1")).toBe(false);
  });
});
