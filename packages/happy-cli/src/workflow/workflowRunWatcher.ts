/**
 * Polls each active workflow run's `journal.jsonl` and emits structured
 * agent-level events as the runtime appends new entries.
 *
 * State machine, per run:
 *   start(taskId, runId, runDir)
 *     ↓
 *   poll loop (POLL_INTERVAL_MS) reads journal.jsonl, processes lines
 *   beyond `processedLines` cursor:
 *       "started" → onAgentStart(taskId, runId, agentId)
 *       "result"  → onAgentEnd(taskId, runId, agentId, outputPreview, durationMs)
 *     ↓
 *   stop(taskId) — final synchronous poll to flush any pending lines, then
 *                  drops the run. Caller (claudeRemoteLauncherCore) then
 *                  emits workflow-run-end with the agent count we return.
 *     ↓
 *   shutdown() — clear all runs, stop timer (called when launcher exits).
 *
 * Parallel grouping is NOT computed here — the App reducer (PR 3) groups
 * agents heuristically by closeness of startedAt. Keeping that logic on the
 * reducer side avoids coupling the CLI to a heuristic that may need tuning.
 */

import * as path from "path";

import { readJournalEntries, type WorkflowJournalEntry } from "./workflowJournal";

export interface WorkflowAgentEventCallbacks {
  onAgentStart: (taskId: string, runId: string, agentId: string, startedAt: number) => void;
  onAgentEnd: (
    taskId: string,
    runId: string,
    agentId: string,
    outputPreview: string | undefined,
    durationMs: number,
    endedAt: number,
  ) => void;
}

interface AgentTracker {
  startedAt: number;
}

interface ActiveRun {
  taskId: string;
  runId: string;
  journalPath: string;
  processedLines: number;
  agents: Map<string, AgentTracker>;
}

const POLL_INTERVAL_MS = 600;
const OUTPUT_PREVIEW_LIMIT = 500;

export class WorkflowRunWatcher {
  private readonly runs = new Map<string, ActiveRun>();
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(private readonly callbacks: WorkflowAgentEventCallbacks) {}

  /**
   * Start watching a workflow run. `runDir` must contain a `journal.jsonl`
   * that the workflow runtime is appending to. If the caller couldn't
   * resolve a runDir (no fallback) it should NOT call start() — agent
   * events simply don't fire for that run, and workflow-run-end still
   * emits via the outer claudeRemoteLauncherCore hook.
   */
  start(taskId: string, runId: string, runDir: string): void {
    this.runs.set(taskId, {
      taskId,
      runId,
      journalPath: path.join(runDir, "journal.jsonl"),
      processedLines: 0,
      agents: new Map(),
    });
    this.ensurePolling();
  }

  /**
   * Stop tracking. Runs one final synchronous poll so any `result` entries
   * written between the last poll and the workflow's task_notification land
   * before the caller emits workflow-run-end.
   *
   * Returns the observed agent count so the caller can populate
   * workflow-run-end.agentCount.
   */
  stop(taskId: string): { agentCount: number } {
    const run = this.runs.get(taskId);
    if (!run) return { agentCount: 0 };
    this.poll(run);
    const result = { agentCount: run.agents.size };
    this.runs.delete(taskId);
    if (this.runs.size === 0 && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    return result;
  }

  /**
   * Re-key an active run from one task id to another, preserving its journal
   * cursor and emitted-agent state. Used when a direct Workflow tool call's
   * tracking moves from the tool_use id to the background task id (so a later
   * task_notification can stop it). No-op if `fromTaskId` isn't tracked.
   */
  rekey(fromTaskId: string, toTaskId: string): void {
    if (fromTaskId === toTaskId) return;
    const run = this.runs.get(fromTaskId);
    if (!run) return;
    run.taskId = toTaskId;
    this.runs.delete(fromTaskId);
    this.runs.set(toTaskId, run);
  }

  /**
   * Hard reset — clears all in-flight runs without emitting. Used when the
   * launcher process exits (or switches sessions) so we don't leak timers.
   */
  shutdown(): void {
    this.runs.clear();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private ensurePolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      for (const run of this.runs.values()) {
        this.poll(run);
      }
    }, POLL_INTERVAL_MS);
    // Don't keep the event loop alive on this timer alone — if the launcher
    // is otherwise idle, allow Node to exit.
    this.pollTimer.unref?.();
  }

  private poll(run: ActiveRun): void {
    const entries = readJournalEntries(run.journalPath);
    if (entries.length <= run.processedLines) return;
    const fresh = entries.slice(run.processedLines);
    run.processedLines = entries.length;
    for (const entry of fresh) {
      this.handleEntry(run, entry);
    }
  }

  private handleEntry(run: ActiveRun, entry: WorkflowJournalEntry): void {
    if (entry.type === "started") {
      // Idempotent — duplicate "started" entries (shouldn't happen, but
      // resume scenarios could replay) don't re-emit.
      if (run.agents.has(entry.agentId)) return;
      const startedAt = Date.now();
      run.agents.set(entry.agentId, { startedAt });
      // Guard the consumer: a throwing callback must not abort the poll
      // loop, which would drop every later entry and wedge the watcher.
      try {
        this.callbacks.onAgentStart(run.taskId, run.runId, entry.agentId, startedAt);
      } catch {
        // Swallow; the next entry/poll continues unaffected.
      }
      return;
    }
    if (entry.type === "result") {
      const agent = run.agents.get(entry.agentId);
      const endedAt = Date.now();
      const startedAt = agent?.startedAt ?? endedAt;
      const durationMs = Math.max(0, endedAt - startedAt);
      const outputPreview =
        typeof entry.result === "string" && entry.result.length > 0
          ? entry.result.slice(0, OUTPUT_PREVIEW_LIMIT)
          : undefined;
      try {
        this.callbacks.onAgentEnd(
          run.taskId,
          run.runId,
          entry.agentId,
          outputPreview,
          durationMs,
          endedAt,
        );
      } catch {
        // Swallow; the next entry/poll continues unaffected.
      }
    }
    // Future types (errored / skipped / phase-*) flow through here once
    // the runtime starts writing them; for now they're silently ignored.
  }
}
