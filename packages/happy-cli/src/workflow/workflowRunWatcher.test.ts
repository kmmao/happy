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
      onAgentStart: (taskId, runId, agentId) => {
        captured.push({ kind: "start", taskId, runId, agentId });
      },
      onAgentEnd: (taskId, runId, agentId, outputPreview, durationMs) => {
        captured.push({
          kind: "end",
          taskId,
          runId,
          agentId,
          outputPreview,
          durationMs,
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
