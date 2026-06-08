import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createId, isCuid } from "@paralleldrive/cuid2";
import {
  closeClaudeTurnWithStatus,
  createClaudeProtocolState,
  mapClaudeLogMessageToSessionEnvelopes,
} from "./sessionProtocolMapper";

describe("mapClaudeLogMessageToSessionEnvelopes", () => {
  it("maps user text to a user text envelope", () => {
    const result = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "user",
        uuid: "u-1",
        message: {
          role: "user",
          content: "hello from user",
        },
        timestamp: "2025-01-01T00:00:00.000Z",
      } as any,
      { ...createClaudeProtocolState(), currentTurnId: null },
    );

    expect(result.currentTurnId).toBeNull();
    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0].role).toBe("user");
    expect(result.envelopes[0].ev).toEqual({
      t: "text",
      text: "hello from user",
    });
  });

  it("starts a turn and maps assistant text blocks", () => {
    const result = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "assistant",
        uuid: "a-1",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "working..." },
            { type: "thinking", thinking: "internal" },
          ],
        },
        timestamp: "2025-01-01T00:00:01.000Z",
      } as any,
      { ...createClaudeProtocolState(), currentTurnId: null },
    );

    expect(result.currentTurnId).not.toBeNull();
    expect(result.envelopes).toHaveLength(3);
    expect(result.envelopes[0].ev.t).toBe("turn-start");
    expect(result.envelopes[1].ev).toEqual({ t: "text", text: "working..." });
    expect(result.envelopes[2].ev).toEqual({
      t: "text",
      text: "internal",
      thinking: true,
    });
  });

  it("skips empty thinking blocks (Opus 4.7 display=omitted default)", () => {
    const result = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "assistant",
        uuid: "a-omitted",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "", signature: "sig-abc" },
            { type: "text", text: "answer" },
          ],
        },
        timestamp: "2025-01-01T00:00:01.000Z",
      } as any,
      { ...createClaudeProtocolState(), currentTurnId: null },
    );

    expect(result.envelopes).toHaveLength(2);
    expect(result.envelopes[0].ev.t).toBe("turn-start");
    expect(result.envelopes[1].ev).toEqual({ t: "text", text: "answer" });
  });

  it("maps tool use and tool result blocks to tool-call lifecycle", () => {
    const started = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "assistant",
        uuid: "a-2",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: { command: "ls" },
            },
          ],
        },
      } as any,
      { ...createClaudeProtocolState(), currentTurnId: null },
    );

    expect(started.envelopes.some((e) => e.ev.t === "tool-call-start")).toBe(
      true,
    );

    const ended = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "user",
        uuid: "u-2",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tool-1", content: "ok" },
          ],
        },
      } as any,
      { ...createClaudeProtocolState(), currentTurnId: started.currentTurnId },
    );

    expect(ended.currentTurnId).toBe(started.currentTurnId);
    expect(ended.envelopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ev: { t: "tool-call-end", call: "tool-1" },
        }),
      ]),
    );
  });

  it("uses parent_tool_use_id as subagent and emits subagent start", () => {
    const mappedSubagent = createId();
    const state = {
      ...createClaudeProtocolState(), currentTurnId: "turn-1",
      providerSubagentToSessionSubagent: new Map<string, string>([
        ["task-1", mappedSubagent],
      ]),
    };

    const result = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "assistant",
        uuid: "a-side-1",
        parent_tool_use_id: "task-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "sidechain text" }],
        },
      } as any,
      state,
    );

    expect(result.envelopes).toHaveLength(2);
    expect(result.envelopes[0].subagent).toBe(mappedSubagent);
    expect(result.envelopes[0].ev).toEqual({ t: "start" });
    expect(result.envelopes[1].subagent).toBe(mappedSubagent);
    expect(result.envelopes[1].ev).toEqual({
      t: "text",
      text: "sidechain text",
    });
  });

  it("buffers subagent messages until parent Task registration is known", () => {
    const state = { ...createClaudeProtocolState(), currentTurnId: null };

    const buffered = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "assistant",
        uuid: "a-side-buffered-1",
        parent_tool_use_id: "task-buffer-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "buffer me" }],
        },
      } as any,
      state,
    );
    expect(buffered.envelopes).toHaveLength(0);

    const parent = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "assistant",
        uuid: "a-parent-buffered-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "task-buffer-1",
              name: "Task",
              input: { prompt: "run side task" },
            },
          ],
        },
      } as any,
      state,
    );

    const taskStart = parent.envelopes.find((envelope) => {
      return (
        envelope.ev.t === "tool-call-start" &&
        envelope.ev.call === "task-buffer-1"
      );
    });
    expect(taskStart).toBeDefined();
    // Task tool-call-start should carry _subagentId in args for App sidechain linking
    const taskStartArgs = (taskStart!.ev as { args: Record<string, unknown> })
      .args;
    expect(taskStartArgs._subagentId).toBeDefined();
    expect(isCuid(taskStartArgs._subagentId as string)).toBe(true);

    const bufferedText = parent.envelopes.find((envelope) => {
      return envelope.ev.t === "text" && envelope.ev.text === "buffer me";
    });
    expect(bufferedText?.subagent).toBeDefined();
    expect(isCuid(bufferedText!.subagent!)).toBe(true);
    expect(bufferedText?.subagent).not.toBe("task-buffer-1");
    // The subagent ID on child messages should match _subagentId in Task args
    expect(bufferedText!.subagent).toBe(taskStartArgs._subagentId);
  });

  it("creates and tags subagent chain from Task prompt when parent_tool_use_id is absent", () => {
    const state = { ...createClaudeProtocolState(), currentTurnId: null };
    const prompt = "Search for TypeScript 5.6 features";

    const taskToolUse = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "assistant",
        uuid: "task-parent-assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "task-call-1",
              name: "Task",
              input: {
                prompt,
                description: "Search TypeScript docs",
              },
            },
          ],
        },
      } as any,
      state,
    );

    const taskStart = taskToolUse.envelopes.find((envelope) => {
      return (
        envelope.ev.t === "tool-call-start" &&
        envelope.ev.call === "task-call-1"
      );
    });
    expect(taskStart).toBeDefined();
    // Task tool-call-start should carry _subagentId in args
    const taskStartArgs = (taskStart!.ev as { args: Record<string, unknown> })
      .args;
    expect(taskStartArgs._subagentId).toBeDefined();
    expect(isCuid(taskStartArgs._subagentId as string)).toBe(true);

    expect(
      taskToolUse.envelopes.some((envelope) => {
        return (
          envelope.ev.t === "tool-call-start" &&
          envelope.ev.call === "task-call-1"
        );
      }),
    ).toBe(true);

    const sidechainRoot = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "user",
        uuid: "sidechain-root",
        isSidechain: true,
        parentUuid: null,
        message: {
          role: "user",
          content: prompt,
        },
      } as any,
      state,
    );

    expect(sidechainRoot.envelopes).toHaveLength(2);
    const mappedSubagent = sidechainRoot.envelopes[0].subagent;
    expect(mappedSubagent).toBeDefined();
    expect(isCuid(mappedSubagent!)).toBe(true);
    expect(mappedSubagent).not.toBe("task-call-1");
    expect(sidechainRoot.envelopes[0].role).toBe("agent");
    expect(sidechainRoot.envelopes[0].subagent).toBe(mappedSubagent);
    expect(sidechainRoot.envelopes[0].ev).toEqual({
      t: "start",
      title: "Search TypeScript docs",
    });
    expect(sidechainRoot.envelopes[1].subagent).toBe(mappedSubagent);
    expect(sidechainRoot.envelopes[1].ev).toEqual({ t: "text", text: prompt });

    const sidechainChild = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "assistant",
        uuid: "sidechain-child",
        isSidechain: true,
        parentUuid: "sidechain-root",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Subagent result" }],
        },
      } as any,
      state,
    );

    expect(sidechainChild.envelopes).toHaveLength(1);
    expect(sidechainChild.envelopes[0].subagent).toBe(mappedSubagent);
    expect(sidechainChild.envelopes[0].ev).toEqual({
      t: "text",
      text: "Subagent result",
    });
  });

  it("infers subagent for non-SDK sidechain fixture logs", () => {
    const fixturePath = join(__dirname, "__fixtures__", "task_non_sdk.jsonl");
    const rows = readFileSync(fixturePath, "utf8")
      .trim()
      .split("\n")
      .slice(0, 6)
      .map((line) => JSON.parse(line));

    const state = { ...createClaudeProtocolState(), currentTurnId: null };
    const envelopes = rows.flatMap((row) => {
      return mapClaudeLogMessageToSessionEnvelopes(row as any, state).envelopes;
    });

    const subagentRoot = envelopes.find((envelope) => {
      return (
        envelope.ev.t === "text" &&
        envelope.ev.text.startsWith(
          "Search the web for information about TypeScript 5.6",
        )
      );
    });
    expect(subagentRoot?.subagent).toBeDefined();
    expect(isCuid(subagentRoot!.subagent!)).toBe(true);
    expect(subagentRoot?.subagent).not.toBe("toolu_01EmKA8FJ7B2Ah9seGxK1Wct");

    const subagentChild = envelopes.find((envelope) => {
      return (
        envelope.ev.t === "text" &&
        envelope.ev.text.includes(
          "I'll search for information about TypeScript 5.6",
        )
      );
    });
    expect(subagentChild?.subagent).toBe(subagentRoot?.subagent);
  });

  it("emits stop for completed subagent when parent Task tool returns", () => {
    const mappedSubagent = createId();
    const state = {
      ...createClaudeProtocolState(), currentTurnId: "turn-1",
      providerSubagentToSessionSubagent: new Map<string, string>([
        ["task-2", mappedSubagent],
      ]),
    };

    const started = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "assistant",
        uuid: "a-side-2",
        parent_tool_use_id: "task-2",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "subagent running" }],
        },
      } as any,
      state,
    );

    expect(
      started.envelopes.some((envelope) => {
        return (
          envelope.ev.t === "start" && envelope.subagent === mappedSubagent
        );
      }),
    ).toBe(true);

    const stopped = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "user",
        uuid: "u-parent-2",
        isSidechain: false,
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "task-2", content: "done" },
          ],
        },
      } as any,
      state,
    );

    expect(stopped.envelopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subagent: mappedSubagent,
          ev: { t: "stop" },
        }),
      ]),
    );
    expect(
      stopped.envelopes.some((envelope) => {
        return (
          envelope.ev.t === "tool-call-end" && envelope.ev.call === "task-2"
        );
      }),
    ).toBe(true);
  });

  it("does not emit envelopes for summary messages", () => {
    const result = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "summary",
        summary: "Done",
        leafUuid: "leaf-1",
      } as any,
      { ...createClaudeProtocolState(), currentTurnId: "turn-1" },
    );

    expect(result.currentTurnId).toBe("turn-1");
    expect(result.envelopes).toHaveLength(0);
  });
});

describe("background task metadata in tool-call-end", () => {
  it("extracts backgroundTaskId and outputFile from Bash background tool_result", () => {
    const started = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "assistant",
        uuid: "a-bg-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-bg-1",
              name: "Bash",
              input: { command: "npm run dev", run_in_background: true },
            },
          ],
        },
      } as any,
      { ...createClaudeProtocolState(), currentTurnId: null },
    );

    const ended = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "user",
        uuid: "u-bg-1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-bg-1",
              content:
                "Command running in background with ID: bn6l4zult. Output is being written to: /private/tmp/claude-501/project/tasks/bn6l4zult.output",
            },
          ],
        },
      } as any,
      { ...createClaudeProtocolState(), currentTurnId: started.currentTurnId },
    );

    const toolCallEnd = ended.envelopes.find((e) => e.ev.t === "tool-call-end");
    expect(toolCallEnd).toBeDefined();
    expect((toolCallEnd!.ev as any).backgroundTaskId).toBe("bn6l4zult");
    expect((toolCallEnd!.ev as any).outputFile).toBe(
      "/private/tmp/claude-501/project/tasks/bn6l4zult.output",
    );
  });

  it("does not add background fields to normal tool_result", () => {
    const started = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "assistant",
        uuid: "a-normal-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-normal-1",
              name: "Bash",
              input: { command: "ls" },
            },
          ],
        },
      } as any,
      { ...createClaudeProtocolState(), currentTurnId: null },
    );

    const ended = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "user",
        uuid: "u-normal-1",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-normal-1",
              content: "file1.txt\nfile2.txt",
            },
          ],
        },
      } as any,
      { ...createClaudeProtocolState(), currentTurnId: started.currentTurnId },
    );

    const toolCallEnd = ended.envelopes.find((e) => e.ev.t === "tool-call-end");
    expect(toolCallEnd).toBeDefined();
    expect((toolCallEnd!.ev as any).backgroundTaskId).toBeUndefined();
    expect((toolCallEnd!.ev as any).outputFile).toBeUndefined();
  });
});

describe("closeClaudeTurnWithStatus", () => {
  it("emits turn-end with provided status when turn is active", () => {
    const result = closeClaudeTurnWithStatus(
      { ...createClaudeProtocolState(), currentTurnId: "turn-1" },
      "cancelled",
    );
    expect(result.currentTurnId).toBeNull();
    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0].ev).toEqual({
      t: "turn-end",
      status: "cancelled",
    });
    expect(result.dropped).toEqual([]);
  });
});

/**
 * The mapper used to swallow whole classes of messages into an
 * indistinguishable `envelopes: []`. The drop taxonomy makes each intentional
 * non-emit an explicit, classified decision — so these tests assert *why* a
 * message produced nothing, not merely that it did.
 */
describe("drop taxonomy", () => {
  it("classifies a summary message as summary-message", () => {
    const result = mapClaudeLogMessageToSessionEnvelopes(
      { type: "summary", summary: "Done", leafUuid: "leaf-1" } as any,
      { ...createClaudeProtocolState(), currentTurnId: "turn-1" },
    );
    expect(result.envelopes).toHaveLength(0);
    expect(result.dropped).toEqual([
      { type: "summary", reason: "summary-message" },
    ]);
  });

  it("classifies a system message as system-message", () => {
    const result = mapClaudeLogMessageToSessionEnvelopes(
      { type: "system", uuid: "s-1" } as any,
      { ...createClaudeProtocolState(), currentTurnId: "turn-1" },
    );
    expect(result.envelopes).toHaveLength(0);
    expect(result.dropped).toEqual([
      { type: "system", reason: "system-message" },
    ]);
  });

  it("classifies an isMeta user message as meta-user-message", () => {
    const result = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "user",
        uuid: "u-meta-1",
        isMeta: true,
        message: { role: "user", content: "skill prompt body" },
      } as any,
      { ...createClaudeProtocolState(), currentTurnId: null },
    );
    expect(result.envelopes).toHaveLength(0);
    expect(result.dropped).toEqual([
      { type: "user", reason: "meta-user-message" },
    ]);
  });

  it("classifies an empty-content user message as empty-user-content", () => {
    const result = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "user",
        uuid: "u-empty-1",
        message: { role: "user", content: [] },
      } as any,
      { ...createClaudeProtocolState(), currentTurnId: null },
    );
    expect(result.envelopes).toHaveLength(0);
    expect(result.dropped).toEqual([
      { type: "user", reason: "empty-user-content" },
    ]);
  });

  it("classifies an unhandled message type as unhandled-message-type", () => {
    const result = mapClaudeLogMessageToSessionEnvelopes(
      { type: "result", uuid: "r-1", subtype: "success" } as any,
      { ...createClaudeProtocolState(), currentTurnId: "turn-1" },
    );
    expect(result.envelopes).toHaveLength(0);
    expect(result.dropped).toEqual([
      { type: "result", reason: "unhandled-message-type" },
    ]);
  });

  it("classifies a pending-subagent message as a deferral, then clears it on replay", () => {
    const state = { ...createClaudeProtocolState(), currentTurnId: null };

    const buffered = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "assistant",
        uuid: "a-defer-1",
        parent_tool_use_id: "task-defer-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "deferred child" }],
        },
      } as any,
      state,
    );
    expect(buffered.envelopes).toHaveLength(0);
    expect(buffered.dropped).toEqual([
      { type: "assistant", reason: "buffered-pending-subagent" },
    ]);

    // Once the parent Task registers, the buffered child is replayed and
    // genuinely emitted — so the parent's result reports no drops.
    const parent = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "assistant",
        uuid: "a-defer-parent-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "task-defer-1",
              name: "Task",
              input: { prompt: "run deferred task" },
            },
          ],
        },
      } as any,
      state,
    );
    expect(parent.dropped).toEqual([]);
    expect(
      parent.envelopes.some(
        (e) => e.ev.t === "text" && e.ev.text === "deferred child",
      ),
    ).toBe(true);
  });

  it("reports no drops for a normally-emitted user message", () => {
    const result = mapClaudeLogMessageToSessionEnvelopes(
      {
        type: "user",
        uuid: "u-ok-1",
        message: { role: "user", content: "hello" },
      } as any,
      { ...createClaudeProtocolState(), currentTurnId: null },
    );
    expect(result.envelopes).toHaveLength(1);
    expect(result.dropped).toEqual([]);
  });
});
