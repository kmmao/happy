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

import * as fs from "fs";
import * as path from "path";

import { readJournalEntries, type WorkflowJournalEntry } from "./workflowJournal";

export interface WorkflowAgentTokenStats {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * Metadata extracted from an agent's `agent-<id>.jsonl` transcript:
 *   - label:  first user message's prompt, trimmed to a short single-line
 *             headline (the workflow script's opts.label isn't recorded in
 *             the transcript, so the prompt's opening is the best we have).
 *   - model:  most recent assistant turn's model id.
 *   - tokens: summed usage across all assistant turns.
 * Any field is undefined when the transcript is absent or unparseable.
 */
export interface WorkflowAgentMeta {
  label?: string;
  /** First ~500 chars of the agent prompt (the full first user message). */
  promptPreview?: string;
  model?: string;
  tokens?: WorkflowAgentTokenStats;
}

export interface WorkflowAgentEventCallbacks {
  onAgentStart: (
    taskId: string,
    runId: string,
    agentId: string,
    startedAt: number,
    label?: string,
    promptPreview?: string,
  ) => void;
  onAgentEnd: (
    taskId: string,
    runId: string,
    agentId: string,
    outputPreview: string | undefined,
    durationMs: number,
    endedAt: number,
    model?: string,
    tokens?: WorkflowAgentTokenStats,
  ) => void;
}

interface AgentTracker {
  startedAt: number;
}

interface ActiveRun {
  taskId: string;
  runId: string;
  runDir: string;
  journalPath: string;
  processedLines: number;
  agents: Map<string, AgentTracker>;
}

const POLL_INTERVAL_MS = 600;
const OUTPUT_PREVIEW_LIMIT = 500;
const LABEL_LIMIT = 60;
const PROMPT_PREVIEW_LIMIT = 500;

/**
 * Extract a short single-line label from an agent prompt: collapse
 * whitespace, take the opening up to the first sentence boundary, and cap
 * at LABEL_LIMIT chars.
 */
function deriveLabel(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  // First sentence boundary (Latin or CJK punctuation), if it lands early.
  const sentence = collapsed.split(/(?<=[.!?。！？])/)[0] ?? collapsed;
  const head = sentence.length <= LABEL_LIMIT ? sentence : collapsed;
  return head.length > LABEL_LIMIT ? head.slice(0, LABEL_LIMIT) : head;
}

/**
 * Read an agent's SDK transcript (`agent-<agentId>.jsonl` in the run dir) and
 * derive label / model / token usage. Reads synchronously to match the
 * journal reader; the poll already runs on a timer. Returns an empty object
 * when the file is missing or every line fails to parse — never throws.
 */
export function readAgentMeta(runDir: string, agentId: string): WorkflowAgentMeta {
  let content: string;
  try {
    content = fs.readFileSync(path.join(runDir, `agent-${agentId}.jsonl`), "utf8");
  } catch {
    return {};
  }
  const meta: WorkflowAgentMeta = {};
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let sawUsage = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object") continue;
      obj = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (obj.type === "user" && meta.label === undefined) {
      const message = obj.message as { content?: unknown } | undefined;
      if (typeof message?.content === "string") {
        const label = deriveLabel(message.content);
        if (label) meta.label = label;
        meta.promptPreview = message.content.slice(0, PROMPT_PREVIEW_LIMIT);
      }
    }
    if (obj.type === "assistant") {
      const message = obj.message as
        | { model?: unknown; usage?: Record<string, unknown> }
        | undefined;
      if (typeof message?.model === "string") meta.model = message.model;
      const usage = message?.usage;
      if (usage && typeof usage === "object") {
        sawUsage = true;
        input += numField(usage.input_tokens);
        output += numField(usage.output_tokens);
        cacheRead += numField(usage.cache_read_input_tokens);
        cacheWrite += numField(usage.cache_creation_input_tokens);
      }
    }
  }
  if (sawUsage) {
    meta.tokens = { input, output };
    if (cacheRead > 0) meta.tokens.cacheRead = cacheRead;
    if (cacheWrite > 0) meta.tokens.cacheWrite = cacheWrite;
  }
  return meta;
}

function numField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

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
      runDir,
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
      // The agent transcript is created as the agent dispatches; its first
      // (prompt) line is usually present by the time "started" lands, so we
      // can source label/promptPreview here. model/tokens come later (on end).
      const meta = readAgentMeta(run.runDir, entry.agentId);
      // Guard the consumer: a throwing callback must not abort the poll
      // loop, which would drop every later entry and wedge the watcher.
      try {
        this.callbacks.onAgentStart(
          run.taskId,
          run.runId,
          entry.agentId,
          startedAt,
          meta.label,
          meta.promptPreview,
        );
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
      // By now the transcript carries the full assistant turns — model and
      // usage are complete.
      const meta = readAgentMeta(run.runDir, entry.agentId);
      try {
        this.callbacks.onAgentEnd(
          run.taskId,
          run.runId,
          entry.agentId,
          outputPreview,
          durationMs,
          endedAt,
          meta.model,
          meta.tokens,
        );
      } catch {
        // Swallow; the next entry/poll continues unaffected.
      }
    }
    // Future types (errored / skipped / phase-*) flow through here once
    // the runtime starts writing them; for now they're silently ignored.
  }
}
