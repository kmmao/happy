import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { WorkflowRunWatcher } from "./workflowRunWatcher";

interface CapturedEvent {
  kind: "phase" | "start" | "end";
  taskId: string;
  runId: string;
  agentId: string;
  outputPreview?: string;
  durationMs?: number;
  label?: string;
  promptPreview?: string;
  phase?: string;
  agentType?: string;
  model?: string;
  tokens?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  status?: "completed" | "errored" | "skipped";
  outputFull?: string;
  // phase fields
  index?: number;
  title?: string;
}

describe("WorkflowRunWatcher", () => {
  let tmpDir: string;
  let runDir: string;
  let journalPath: string;
  let captured: CapturedEvent[];
  let watcher: WorkflowRunWatcher;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfw-"));
    runDir = path.join(tmpDir, "wf_test");
    fs.mkdirSync(runDir);
    journalPath = path.join(runDir, "journal.jsonl");
    captured = [];
    watcher = new WorkflowRunWatcher({
      onPhaseStart: (taskId, runId, index, title) => {
        captured.push({ kind: "phase", taskId, runId, agentId: "", index, title });
      },
      onAgentStart: (
        taskId,
        runId,
        agentId,
        _startedAt,
        label,
        promptPreview,
        phase,
        agentType,
      ) => {
        captured.push({
          kind: "start",
          taskId,
          runId,
          agentId,
          label,
          promptPreview,
          phase,
          agentType,
        });
      },
      onAgentEnd: (
        taskId,
        runId,
        agentId,
        outputPreview,
        durationMs,
        _endedAt,
        model,
        tokens,
        status,
        outputFull,
      ) => {
        captured.push({
          kind: "end",
          taskId,
          runId,
          agentId,
          outputPreview,
          durationMs,
          model,
          tokens,
          status,
          outputFull,
        });
      },
    });
  });

  afterEach(() => {
    watcher.shutdown();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  /**
   * Helper: write the given list of journal entries, then trigger a stop()
   * which performs a synchronous final poll. This avoids waiting on the
   * 600ms timer in tests.
   */
  function flushAndStop(taskId: string, lines: string[]): { agentCount: number } {
    fs.writeFileSync(journalPath, lines.join("\n"));
    return watcher.stop(taskId);
  }

  it("emits onAgentStart for each new started entry", () => {
    watcher.start("task-1", "wf_test", runDir);
    const { agentCount } = flushAndStop("task-1", [
      '{"type":"started","key":"v2:k1","agentId":"a1"}',
      '{"type":"started","key":"v2:k2","agentId":"a2"}',
    ]);

    const starts = captured.filter((e) => e.kind === "start");
    expect(starts).toHaveLength(2);
    expect(starts[0]).toMatchObject({ taskId: "task-1", runId: "wf_test", agentId: "a1" });
    expect(starts[1]).toMatchObject({ agentId: "a2" });
    expect(agentCount).toBe(2);
  });

  it("emits onAgentEnd with outputPreview truncated to 500 chars", () => {
    watcher.start("task-1", "wf_test", runDir);
    const longResult = "x".repeat(800);
    flushAndStop("task-1", [
      '{"type":"started","key":"v2:k1","agentId":"a1"}',
      `{"type":"result","key":"v2:k1","agentId":"a1","result":${JSON.stringify(longResult)}}`,
    ]);

    const ends = captured.filter((e) => e.kind === "end");
    expect(ends).toHaveLength(1);
    expect(ends[0].outputPreview).toHaveLength(500);
    expect(ends[0].outputPreview).toBe("x".repeat(500));
  });

  it("emits durationMs >= 0 even if started entry was missed", () => {
    watcher.start("task-1", "wf_test", runDir);
    flushAndStop("task-1", [
      // Only a result entry — no preceding started (e.g. journal truncation)
      '{"type":"result","key":"v2:k1","agentId":"ghost","result":"x"}',
    ]);

    const ends = captured.filter((e) => e.kind === "end");
    expect(ends).toHaveLength(1);
    expect(ends[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("does not double-emit on duplicate started entries", () => {
    watcher.start("task-1", "wf_test", runDir);
    flushAndStop("task-1", [
      '{"type":"started","key":"v2:k1","agentId":"a1"}',
      '{"type":"started","key":"v2:k1","agentId":"a1"}',
    ]);

    expect(captured.filter((e) => e.kind === "start" && e.agentId === "a1")).toHaveLength(1);
  });

  it("skips agent events for runs that were never started", () => {
    flushAndStop("unknown-task", [
      '{"type":"started","key":"v2:k1","agentId":"a1"}',
    ]);
    expect(captured).toHaveLength(0);
  });

  it("emits omitsoutputPreview when result is empty string", () => {
    watcher.start("task-1", "wf_test", runDir);
    flushAndStop("task-1", [
      '{"type":"started","key":"v2:k1","agentId":"a1"}',
      '{"type":"result","key":"v2:k1","agentId":"a1","result":""}',
    ]);
    const ends = captured.filter((e) => e.kind === "end");
    expect(ends[0].outputPreview).toBeUndefined();
  });

  it("defers the journal fallback to stop() — timer polls never emit from it", () => {
    // The journal is a last resort: with no progress snapshot present, timer
    // polls during the run must NOT emit (emitting prompt-headline labels with
    // no phase would poison the start-once reducer). Only stop()'s final poll
    // flushes the journal.
    vi.useFakeTimers();
    try {
      watcher.start("task-1", "wf_test", runDir);
      fs.writeFileSync(
        journalPath,
        [
          '{"type":"started","key":"v2:k1","agentId":"a1"}',
          '{"type":"result","key":"v2:k1","agentId":"a1","result":"done"}',
        ].join("\n"),
      );
      // Several timer polls — still nothing, because the snapshot never showed
      // up and this isn't the final poll.
      vi.advanceTimersByTime(2000);
      expect(captured).toHaveLength(0);

      // The final stop() poll flushes the journal as a last resort.
      watcher.stop("task-1");
      expect(captured.filter((e) => e.kind === "start")).toHaveLength(1);
      expect(captured.filter((e) => e.kind === "end")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sources label/promptPreview on start and model/tokens on end from agent-<id>.jsonl", () => {
    const agentId = "a7c67f4";
    const prompt =
      "调研 happy-app 的结构,找出 workflow 卡片相关组件。请尽量详细。第二句应被截断。";
    fs.writeFileSync(
      path.join(runDir, `agent-${agentId}.jsonl`),
      [
        JSON.stringify({ type: "user", message: { content: prompt } }),
        JSON.stringify({
          type: "assistant",
          message: {
            model: "claude-haiku-4-5",
            usage: {
              input_tokens: 1000,
              output_tokens: 200,
              cache_read_input_tokens: 50,
              cache_creation_input_tokens: 30,
            },
          },
        }),
        JSON.stringify({
          type: "assistant",
          message: {
            model: "claude-haiku-4-5",
            usage: { input_tokens: 500, output_tokens: 100 },
          },
        }),
      ].join("\n"),
    );

    watcher.start("task-1", "wf_test", runDir);
    flushAndStop("task-1", [
      `{"type":"started","key":"v2:k1","agentId":"${agentId}"}`,
      `{"type":"result","key":"v2:k1","agentId":"${agentId}","result":"done"}`,
    ]);

    const start = captured.find((e) => e.kind === "start" && e.agentId === agentId);
    expect(start?.label).toBe("调研 happy-app 的结构,找出 workflow 卡片相关组件。");
    expect(start?.promptPreview).toBe(prompt);

    const end = captured.find((e) => e.kind === "end" && e.agentId === agentId);
    expect(end?.model).toBe("claude-haiku-4-5");
    expect(end?.tokens).toEqual({
      input: 1500,
      output: 300,
      cacheRead: 50,
      cacheWrite: 30,
    });
  });

  it("returns empty meta when the agent transcript is missing", () => {
    watcher.start("task-1", "wf_test", runDir);
    flushAndStop("task-1", [
      '{"type":"started","key":"v2:k1","agentId":"no-file"}',
      '{"type":"result","key":"v2:k1","agentId":"no-file","result":"x"}',
    ]);
    const start = captured.find((e) => e.kind === "start" && e.agentId === "no-file");
    expect(start?.label).toBeUndefined();
    const end = captured.find((e) => e.kind === "end" && e.agentId === "no-file");
    expect(end?.model).toBeUndefined();
    expect(end?.tokens).toBeUndefined();
  });

  it("shutdown drops in-flight runs without further emission", () => {
    watcher.start("task-1", "wf_test", runDir);
    fs.writeFileSync(
      journalPath,
      '{"type":"started","key":"v2:k1","agentId":"a1"}\n',
    );
    watcher.shutdown();
    // No emissions because shutdown drops the run before the next poll cycle
    expect(captured).toHaveLength(0);
  });
});

describe("WorkflowRunWatcher — progress JSON snapshot source", () => {
  let tmpDir: string;
  let sessionDir: string;
  let runDir: string;
  let progressPath: string;
  let captured: CapturedEvent[];
  let watcher: WorkflowRunWatcher;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wfp-"));
    // Mirror the real layout: <session>/subagents/workflows/wf_test  and
    // <session>/workflows/wf_test.json as its sibling.
    sessionDir = path.join(tmpDir, "session");
    runDir = path.join(sessionDir, "subagents", "workflows", "wf_test");
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.join(sessionDir, "workflows"), { recursive: true });
    progressPath = path.join(sessionDir, "workflows", "wf_test.json");
    captured = [];
    watcher = new WorkflowRunWatcher({
      onPhaseStart: (taskId, runId, index, title) => {
        captured.push({ kind: "phase", taskId, runId, agentId: "", index, title });
      },
      onAgentStart: (taskId, runId, agentId, _startedAt, label, promptPreview, phase, agentType) => {
        captured.push({
          kind: "start",
          taskId,
          runId,
          agentId,
          label,
          promptPreview,
          phase,
          agentType,
        });
      },
      onAgentEnd: (taskId, runId, agentId, outputPreview, durationMs, _endedAt, model, tokens, status, outputFull) => {
        captured.push({
          kind: "end",
          taskId,
          runId,
          agentId,
          outputPreview,
          durationMs,
          model,
          tokens,
          status,
          outputFull,
        });
      },
    });
  });

  afterEach(() => {
    watcher.shutdown();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  /** Real-shape snapshot: 2 phases + 2 done agents across both phases. */
  function doneSnapshot(): unknown {
    return {
      status: "completed",
      agentCount: 2,
      workflowProgress: [
        { type: "workflow_phase", index: 1, title: "Explore" },
        { type: "workflow_phase", index: 2, title: "Synthesize" },
        {
          type: "workflow_agent",
          index: 1,
          label: "explore:root",
          phaseIndex: 1,
          phaseTitle: "Explore",
          agentId: "a4f6f161bb236f946",
          agentType: "Explore",
          model: "claude-haiku-4-5-20251001",
          state: "done",
          tokens: 28456,
          durationMs: 36592,
          promptPreview: "Explore the directory `/Users/.../happy` …",
          resultPreview: '{"name":"Happy Coder",…}',
          startedAt: 1780307480941,
        },
        {
          type: "workflow_agent",
          index: 2,
          label: "synthesize",
          phaseIndex: 2,
          phaseTitle: "Synthesize",
          agentId: "ab31c256ac25e3213",
          agentType: "None",
          model: "claude-haiku-4-5-20251001",
          state: "done",
          tokens: 32268,
          durationMs: 54958,
          promptPreview: "Merge the package maps …",
          resultPreview: "完成。结构概览文档已生成。",
          startedAt: 1780307490000,
        },
      ],
    };
  }

  it("emits real phase + agent data from the progress snapshot", () => {
    fs.writeFileSync(progressPath, JSON.stringify(doneSnapshot()));
    watcher.start("task-1", "wf_test", runDir);
    const { agentCount } = watcher.stop("task-1");

    const phases = captured.filter((e) => e.kind === "phase");
    expect(phases.map((p) => p.title)).toEqual(["Explore", "Synthesize"]);
    expect(phases[0]).toMatchObject({ index: 1, title: "Explore" });

    const start = captured.find((e) => e.kind === "start" && e.agentId === "a4f6f161bb236f946");
    expect(start).toMatchObject({
      label: "explore:root",
      phase: "Explore",
      agentType: "Explore",
    });

    const end = captured.find((e) => e.kind === "end" && e.agentId === "a4f6f161bb236f946");
    expect(end?.model).toBe("claude-haiku-4-5-20251001");
    // Single integer total mapped onto input, output 0.
    expect(end?.tokens).toEqual({ input: 28456, output: 0 });
    expect(end?.durationMs).toBe(36592);
    expect(end?.status).toBe("completed");
    expect(end?.outputPreview).toBe('{"name":"Happy Coder",…}');

    expect(agentCount).toBe(2);
  });

  it("sources the untruncated outputFull from the agent StructuredOutput transcript", () => {
    // The snapshot resultPreview is short/truncated; the full structured
    // result lives in the agent transcript's StructuredOutput tool input.
    const agentId = "a4f6f161bb236f946";
    const structured = {
      package: "@kmmao/happy-coder",
      purpose: "x".repeat(1200),
      techStack: ["TypeScript", "Fastify", "Zod"],
    };
    fs.writeFileSync(
      path.join(runDir, `agent-${agentId}.jsonl`),
      [
        JSON.stringify({ type: "user", message: { content: "explore root" } }),
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "text", text: "done" },
              { type: "tool_use", name: "StructuredOutput", input: structured },
            ],
          },
        }),
      ].join("\n"),
    );
    fs.writeFileSync(progressPath, JSON.stringify(doneSnapshot()));

    watcher.start("task-1", "wf_test", runDir);
    watcher.stop("task-1");

    const end = captured.find((e) => e.kind === "end" && e.agentId === agentId);
    expect(end?.outputFull).toBeDefined();
    // Full structured result, not the ~400-char preview.
    expect(end!.outputFull!.length).toBeGreaterThan(1000);
    expect(JSON.parse(end!.outputFull!)).toEqual(structured);
  });

  it("maps non-done terminal states to errored / skipped", () => {
    const snap = {
      workflowProgress: [
        { type: "workflow_agent", agentId: "x1", state: "error", label: "a", phaseTitle: "P" },
        { type: "workflow_agent", agentId: "x2", state: "cancelled", label: "b", phaseTitle: "P" },
      ],
    };
    fs.writeFileSync(progressPath, JSON.stringify(snap));
    watcher.start("task-1", "wf_test", runDir);
    watcher.stop("task-1");

    expect(captured.find((e) => e.kind === "end" && e.agentId === "x1")?.status).toBe("errored");
    expect(captured.find((e) => e.kind === "end" && e.agentId === "x2")?.status).toBe("skipped");
  });

  it("does not double-emit across incremental snapshot rewrites", () => {
    vi.useFakeTimers();
    try {
      // First snapshot: phase known, agent still running → only start fires.
      fs.writeFileSync(
        progressPath,
        JSON.stringify({
          workflowProgress: [
            { type: "workflow_phase", index: 1, title: "Explore" },
            {
              type: "workflow_agent",
              agentId: "a1",
              label: "explore:root",
              phaseTitle: "Explore",
              state: "running",
            },
          ],
        }),
      );
      watcher.start("task-1", "wf_test", runDir);
      vi.advanceTimersByTime(700);
      expect(captured.filter((e) => e.kind === "phase")).toHaveLength(1);
      expect(captured.filter((e) => e.kind === "start")).toHaveLength(1);
      expect(captured.filter((e) => e.kind === "end")).toHaveLength(0);

      // Rewrite with the same agent now done → exactly one end, no re-start,
      // no re-phase.
      fs.writeFileSync(
        progressPath,
        JSON.stringify({
          workflowProgress: [
            { type: "workflow_phase", index: 1, title: "Explore" },
            {
              type: "workflow_agent",
              agentId: "a1",
              label: "explore:root",
              phaseTitle: "Explore",
              state: "done",
              tokens: 100,
            },
          ],
        }),
      );
      vi.advanceTimersByTime(700);
      expect(captured.filter((e) => e.kind === "phase")).toHaveLength(1);
      expect(captured.filter((e) => e.kind === "start")).toHaveLength(1);
      expect(captured.filter((e) => e.kind === "end")).toHaveLength(1);

      watcher.stop("task-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never falls back to the journal once a snapshot was seen (no poisoning)", () => {
    // Snapshot present AND a journal with a different agent also present. The
    // snapshot must win and the journal agent must never leak in — even after
    // a transient snapshot read miss before stop().
    fs.writeFileSync(
      progressPath,
      JSON.stringify({
        workflowProgress: [
          {
            type: "workflow_agent",
            agentId: "snap1",
            label: "analyze:happy-cli",
            phaseTitle: "Analyze",
            state: "done",
            tokens: 10,
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(runDir, "journal.jsonl"),
      [
        '{"type":"started","key":"v2:k1","agentId":"jrnl"}',
        '{"type":"result","key":"v2:k1","agentId":"jrnl","result":"x"}',
      ].join("\n"),
    );

    vi.useFakeTimers();
    try {
      watcher.start("task-1", "wf_test", runDir);
      // A timer poll reads the snapshot → sawProgress latches.
      vi.advanceTimersByTime(700);
      // Now the file vanishes mid-rewrite right before the final poll.
      fs.rmSync(progressPath);
      watcher.stop("task-1");
    } finally {
      vi.useRealTimers();
    }

    const starts = captured.filter((e) => e.kind === "start");
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      agentId: "snap1",
      label: "analyze:happy-cli",
      phase: "Analyze",
    });
    // The journal agent "jrnl" must not appear.
    expect(starts.find((s) => s.agentId === "jrnl")).toBeUndefined();
  });
});
