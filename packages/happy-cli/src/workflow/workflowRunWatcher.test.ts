import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { WorkflowRunWatcher } from "./workflowRunWatcher";

interface CapturedEvent {
  kind: "start" | "end";
  taskId: string;
  runId: string;
  agentId: string;
  outputPreview?: string;
  durationMs?: number;
  label?: string;
  promptPreview?: string;
  model?: string;
  tokens?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
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
      onAgentStart: (taskId, runId, agentId, _startedAt, label, promptPreview) => {
        captured.push({ kind: "start", taskId, runId, agentId, label, promptPreview });
      },
      onAgentEnd: (taskId, runId, agentId, outputPreview, durationMs, _endedAt, model, tokens) => {
        captured.push({
          kind: "end",
          taskId,
          runId,
          agentId,
          outputPreview,
          durationMs,
          model,
          tokens,
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

  it("processes only new lines on subsequent polls", () => {
    vi.useFakeTimers();
    try {
      watcher.start("task-1", "wf_test", runDir);
      fs.writeFileSync(
        journalPath,
        '{"type":"started","key":"v2:k1","agentId":"a1"}\n',
      );
      // Trigger one poll cycle manually via private timer
      vi.advanceTimersByTime(700);
      expect(captured.filter((e) => e.kind === "start")).toHaveLength(1);

      // Append a result; should fire on next poll without re-emitting start
      fs.appendFileSync(
        journalPath,
        '{"type":"result","key":"v2:k1","agentId":"a1","result":"done"}\n',
      );
      vi.advanceTimersByTime(700);
      expect(captured.filter((e) => e.kind === "start")).toHaveLength(1);
      expect(captured.filter((e) => e.kind === "end")).toHaveLength(1);

      watcher.stop("task-1");
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
