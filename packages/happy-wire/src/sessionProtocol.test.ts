import { describe, expect, it } from "vitest";
import { createId } from "@paralleldrive/cuid2";
import {
  createEnvelope,
  sessionEnvelopeSchema,
  sessionEnvelopeSchemaPermissive,
  sessionEventSchema,
  sessionEventSchemaPermissive,
  type SessionEvent,
} from "./sessionProtocol";

describe("session protocol schemas", () => {
  it("accepts all supported event types", () => {
    const events: SessionEvent[] = [
      { t: "text", text: "hello" },
      { t: "text", text: "thinking", thinking: true },
      { t: "text-delta", stream: "stream-1", delta: "hel" },
      { t: "service", text: "**Service:** restarting MCP bridge" },
      {
        t: "tool-call-start",
        call: "call-1",
        name: "CodexBash",
        title: "Run `ls`",
        description: "Run `ls -la` in the repo root",
        args: { command: "ls -la" },
      },
      { t: "tool-call-end", call: "call-1" },
      {
        t: "tool-call-end",
        call: "call-2",
        backgroundTaskId: "bn6l4zult",
        outputFile: "/tmp/tasks/bn6l4zult.output",
      },
      { t: "file", ref: "upload-1", name: "report.txt", size: 1024 },
      {
        t: "file",
        ref: "upload-2",
        name: "image.png",
        size: 2048,
        image: { thumbhash: "abc", width: 100, height: 80 },
      },
      { t: "turn-start" },
      { t: "start", title: "Research agent" },
      { t: "turn-end", status: "completed" },
      { t: "stop" },
      {
        t: "task-start",
        taskId: "task-1",
        toolUseId: "tool-1",
        description: "Execute background task",
        taskType: "code-writer",
      },
      {
        t: "task-progress",
        taskId: "task-1",
        description: "Running tool calls",
        usage: { totalTokens: 100, toolUses: 2, durationMs: 5000 },
        lastToolName: "bash",
      },
      {
        t: "task-end",
        taskId: "task-1",
        status: "completed",
        summary: "Task completed successfully",
        usage: { totalTokens: 150, toolUses: 3, durationMs: 10000 },
      },
      {
        t: "tool-progress",
        toolUseId: "tool-1",
        toolName: "bash",
        elapsedSeconds: 2.5,
        taskId: "task-1",
      },
      { t: "prompt-suggestion", suggestion: "What should we focus on next?" },
      { t: "needs-continue" },
      { t: "session-state-changed", state: "running" },
      { t: "session-state-changed", state: "idle" },
      { t: "session-state-changed", state: "requires_action" },
      {
        t: "task-start",
        taskId: "task-wf",
        description: "Run workflow",
        taskType: "local_workflow",
        workflowName: "spec",
      },
      {
        t: "workflow-run-start",
        runId: "wf_abc123",
        toolUseId: "tool_use_xyz",
        name: "demo",
        description: "demo workflow",
        phases: [{ title: "调研" }, { title: "汇总", detail: "synth" }],
        startedAt: 1000,
      },
      {
        t: "workflow-phase-start",
        runId: "wf_abc123",
        index: 0,
        title: "调研",
        startedAt: 1001,
      },
      {
        t: "workflow-agent-start",
        runId: "wf_abc123",
        agentId: "agent-1",
        label: "CLI 端",
        phase: "调研",
        parallelGroupId: "agent-1",
        promptPreview: "在仓库中调研...",
        hasSchema: false,
        startedAt: 1002,
      },
      {
        t: "workflow-agent-end",
        runId: "wf_abc123",
        agentId: "agent-1",
        status: "completed",
        tokens: { input: 1200, output: 800, cacheRead: 500 },
        durationMs: 12000,
        outputPreview: "结果...",
        endedAt: 13002,
      },
      {
        t: "workflow-run-end",
        runId: "wf_abc123",
        status: "completed",
        agentCount: 3,
        totalTokens: 2400,
        durationMs: 55205,
        endedAt: 56205,
      },
    ];

    for (const event of events) {
      expect(sessionEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it("rejects malformed events", () => {
    expect(
      sessionEventSchema.safeParse({ t: "tool-call-start", call: "1" }).success,
    ).toBe(false);
    expect(
      sessionEventSchema.safeParse({ t: "file", ref: "x", name: "x" }).success,
    ).toBe(false);
    expect(
      sessionEventSchema.safeParse({
        t: "file",
        ref: "x",
        name: "x",
        size: 1,
        image: { width: 10, height: 10 },
      }).success,
    ).toBe(false);
    expect(sessionEventSchema.safeParse({ t: "turn-end" }).success).toBe(false);
    expect(
      sessionEventSchema.safeParse({ t: "turn-end", status: "canceled" })
        .success,
    ).toBe(false);
    expect(sessionEventSchema.safeParse({ t: "start", title: 1 }).success).toBe(
      false,
    );
    expect(sessionEventSchema.safeParse({ t: "service" }).success).toBe(false);
    expect(
      sessionEventSchema.safeParse({ t: "text-delta", delta: "x" }).success,
    ).toBe(false);
    expect(sessionEventSchema.safeParse({ t: "not-real" }).success).toBe(false);
    expect(
      sessionEventSchema.safeParse({ t: "session-state-changed", state: "invalid" })
        .success,
    ).toBe(false);
    expect(
      sessionEventSchema.safeParse({ t: "session-state-changed" }).success,
    ).toBe(false);
    // workflow-* malformed
    expect(
      sessionEventSchema.safeParse({ t: "workflow-run-start" }).success,
    ).toBe(false);
    expect(
      sessionEventSchema.safeParse({
        t: "workflow-agent-end",
        runId: "x",
        agentId: "y",
        status: "invalid",
        durationMs: 0,
        endedAt: 0,
      }).success,
    ).toBe(false);
    expect(
      sessionEventSchema.safeParse({
        t: "workflow-agent-start",
        runId: "x",
        agentId: "y",
        promptPreview: "a".repeat(501),
        hasSchema: false,
        startedAt: 0,
      }).success,
    ).toBe(false);
  });

  it("validates envelopes that include turn/subagent", () => {
    const subagent = createId();
    const envelope = {
      id: "msg-1",
      time: 1234,
      role: "agent" as const,
      turn: "turn-1",
      subagent,
      ev: { t: "text", text: "hello" } as const,
    };

    const parsed = sessionEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);
  });

  it("rejects session role envelopes for text events", () => {
    const parsed = sessionEnvelopeSchema.safeParse({
      id: "msg-session-1",
      role: "session",
      ev: { t: "text", text: "shadow copy of user message" },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects service from non-agent role", () => {
    const parsed = sessionEnvelopeSchema.safeParse({
      id: "msg-2",
      role: "user",
      ev: { t: "service", text: "internal event" },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects start from non-agent role", () => {
    const subagent = createId();
    const parsed = sessionEnvelopeSchema.safeParse({
      id: "msg-3",
      role: "user",
      subagent,
      ev: { t: "start", title: "Research agent" },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects workflow events from non-agent role", () => {
    const minimalEvents: SessionEvent[] = [
      {
        t: "workflow-run-start",
        runId: "wf_x",
        toolUseId: "t1",
        name: "n",
        description: "d",
        startedAt: 0,
      },
      {
        t: "workflow-phase-start",
        runId: "wf_x",
        index: 0,
        title: "p",
        startedAt: 0,
      },
      {
        t: "workflow-agent-start",
        runId: "wf_x",
        agentId: "a",
        promptPreview: "p",
        hasSchema: false,
        startedAt: 0,
      },
      {
        t: "workflow-agent-end",
        runId: "wf_x",
        agentId: "a",
        status: "completed",
        durationMs: 0,
        endedAt: 0,
      },
      {
        t: "workflow-run-end",
        runId: "wf_x",
        status: "completed",
        agentCount: 0,
        totalTokens: 0,
        durationMs: 0,
        endedAt: 0,
      },
    ];

    for (const ev of minimalEvents) {
      const parsed = sessionEnvelopeSchema.safeParse({
        id: "m",
        time: 0,
        role: "user",
        ev,
      });
      expect(parsed.success, `${ev.t} should require role agent`).toBe(false);
    }
  });

  it("rejects non-cuid subagent values", () => {
    const parsed = sessionEnvelopeSchema.safeParse({
      id: "msg-4",
      role: "agent",
      turn: "turn-1",
      subagent: "provider-tool-id",
      ev: { t: "text", text: "hello" },
    });

    expect(parsed.success).toBe(false);
  });
});

describe("createEnvelope", () => {
  it("creates id by default", () => {
    const envelope = createEnvelope("agent", { t: "turn-start" });
    expect(typeof envelope.id).toBe("string");
    expect(typeof envelope.time).toBe("number");
    expect(envelope.id.length).toBeGreaterThan(0);
    expect(envelope.role).toBe("agent");
    expect(envelope.ev.t).toBe("turn-start");
  });

  it("respects explicit options", () => {
    const subagent = createId();
    const envelope = createEnvelope(
      "agent",
      { t: "tool-call-end", call: "call-1" },
      {
        id: "fixed-id",
        time: 12345,
        turn: "turn-1",
        subagent,
      },
    );

    expect(envelope).toEqual({
      id: "fixed-id",
      time: 12345,
      role: "agent",
      turn: "turn-1",
      subagent,
      ev: { t: "tool-call-end", call: "call-1" },
    });
  });

  it("validates role/event compatibility", () => {
    expect(() =>
      createEnvelope("user", { t: "service", text: "internal event" }),
    ).toThrow();
  });

  it("threads claudeUuid through when provided", () => {
    const envelope = createEnvelope(
      "agent",
      { t: "text", text: "hi" },
      { id: "env-1", time: 1, claudeUuid: "claude-msg-uuid-123" },
    );
    expect(envelope.claudeUuid).toBe("claude-msg-uuid-123");
  });

  it("omits claudeUuid when not provided", () => {
    const envelope = createEnvelope(
      "agent",
      { t: "text", text: "hi" },
      { id: "env-1", time: 1 },
    );
    expect("claudeUuid" in envelope).toBe(false);
  });

  it("rejects empty claudeUuid string on the schema", () => {
    // createEnvelope's spread skips falsy claudeUuid, so the schema's min(1)
    // check is only exercised when something else writes the field directly.
    expect(() =>
      sessionEnvelopeSchema.parse({
        id: "env-1",
        time: 1,
        role: "agent",
        claudeUuid: "",
        ev: { t: "text", text: "hi" },
      }),
    ).toThrow();
  });

  it("creates tool-call-end with background task fields", () => {
    const envelope = createEnvelope("agent", {
      t: "tool-call-end",
      call: "call-bg",
      backgroundTaskId: "btask123",
      outputFile: "/tmp/tasks/btask123.output",
    });

    expect(envelope.ev).toEqual({
      t: "tool-call-end",
      call: "call-bg",
      backgroundTaskId: "btask123",
      outputFile: "/tmp/tasks/btask123.output",
    });
  });
});

describe("sessionEventSchemaPermissive", () => {
  it("parses known event types into their typed shape", () => {
    const parsed = sessionEventSchemaPermissive.safeParse({
      t: "text",
      text: "hello",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && "text" in parsed.data && parsed.data.t === "text") {
      expect(parsed.data.text).toBe("hello");
    }
  });

  it("parses known workflow events into their typed shape", () => {
    const parsed = sessionEventSchemaPermissive.safeParse({
      t: "workflow-run-start",
      runId: "wf_x",
      toolUseId: "t1",
      name: "n",
      description: "d",
      startedAt: 0,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.t === "workflow-run-start") {
      expect(parsed.data.runId).toBe("wf_x");
    }
  });

  it("falls through unknown event types into passthrough bucket", () => {
    const parsed = sessionEventSchemaPermissive.safeParse({
      t: "some-future-event",
      payload: { foo: 1 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.t).toBe("some-future-event");
      expect((parsed.data as Record<string, unknown>).payload).toEqual({
        foo: 1,
      });
    }
  });

  it("rejects events with non-string discriminator", () => {
    expect(sessionEventSchemaPermissive.safeParse({ t: 42 }).success).toBe(
      false,
    );
    expect(sessionEventSchemaPermissive.safeParse({}).success).toBe(false);
  });
});

describe("sessionEnvelopeSchemaPermissive", () => {
  it("accepts envelopes with known event types (same as strict)", () => {
    const parsed = sessionEnvelopeSchemaPermissive.safeParse({
      id: "m",
      time: 0,
      role: "agent",
      ev: { t: "text", text: "hello" },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts envelopes with unknown event types into passthrough bucket", () => {
    const parsed = sessionEnvelopeSchemaPermissive.safeParse({
      id: "m",
      time: 0,
      role: "agent",
      ev: { t: "future-event", payload: { foo: 1 } },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.ev.t).toBe("future-event");
    }
  });

  it("still enforces role=agent for known workflow events", () => {
    const parsed = sessionEnvelopeSchemaPermissive.safeParse({
      id: "m",
      time: 0,
      role: "user",
      ev: {
        t: "workflow-run-start",
        runId: "wf_x",
        toolUseId: "t1",
        name: "n",
        description: "d",
        startedAt: 0,
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("does NOT enforce role constraints for unknown event types", () => {
    // Cannot encode constraints we don't know about — receivers should still
    // gate behavior on a known t.
    const parsed = sessionEnvelopeSchemaPermissive.safeParse({
      id: "m",
      time: 0,
      role: "user",
      ev: { t: "future-agent-only-event" },
    });
    expect(parsed.success).toBe(true);
  });

  it("still rejects malformed envelopes (non-cuid subagent)", () => {
    const parsed = sessionEnvelopeSchemaPermissive.safeParse({
      id: "m",
      time: 0,
      role: "agent",
      subagent: "not-a-cuid",
      ev: { t: "text", text: "x" },
    });
    expect(parsed.success).toBe(false);
  });
});
