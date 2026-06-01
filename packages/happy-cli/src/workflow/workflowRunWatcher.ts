/**
 * Polls each active workflow run's progress JSON snapshot and emits
 * structured phase- and agent-level events as the runtime rewrites it.
 *
 * Primary data source — the runtime's incrementally-rewritten snapshot:
 *   <session>/workflows/wf_<id>.json
 * (read via readWorkflowProgress). It carries the real opts.label, phase
 * grouping, model, token totals, and per-agent state — so labels/phases are
 * exact rather than guessed from transcripts.
 *
 * Fallback data source — the append-only journal (and per-agent jsonl
 * transcripts) used by older Claude Code versions that don't write the
 * snapshot. When the snapshot file is absent, poll() degrades to the journal
 * reader + readAgentMeta so we still surface (lower-fidelity) labels.
 *
 * State machine, per run:
 *   start(taskId, runId, runDir)
 *     ↓
 *   poll loop (POLL_INTERVAL_MS) reads the snapshot (or journal fallback) and
 *   diffs against what we've already emitted:
 *       new workflow_phase → onPhaseStart(...)
 *       agent first seen   → onAgentStart(...)
 *       agent reached a terminal state → onAgentEnd(...)
 *     ↓
 *   stop(taskId) — final synchronous poll to flush any pending entries, then
 *                  drops the run. Caller (claudeRemoteLauncherCore) then
 *                  emits workflow-run-end with the agent count we return.
 *     ↓
 *   shutdown() — clear all runs, stop timer (called when launcher exits).
 *
 * Phase grouping is now sourced directly from the snapshot (phaseTitle per
 * agent + workflow_phase entries); the App reducer attaches each agent to its
 * phase on receipt of the `phase` field.
 */

import * as fs from "fs";
import * as path from "path";

import { readJournalEntries, type WorkflowJournalEntry } from "./workflowJournal";
import {
  readWorkflowProgress,
  type WorkflowProgressSnapshot,
} from "./workflowProgressReader";

export interface WorkflowAgentTokenStats {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * Metadata extracted from an agent's `agent-<id>.jsonl` transcript. Used ONLY
 * by the journal fallback path (when the progress snapshot is unavailable):
 *   - label:  first user message's prompt, trimmed to a short headline.
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
  onPhaseStart: (
    taskId: string,
    runId: string,
    index: number,
    title: string,
    startedAt: number,
  ) => void;
  onAgentStart: (
    taskId: string,
    runId: string,
    agentId: string,
    startedAt: number,
    label?: string,
    promptPreview?: string,
    phase?: string,
    agentType?: string,
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
    status?: "completed" | "errored" | "skipped",
  ) => void;
}

interface AgentEmitState {
  started: boolean;
  ended: boolean;
  /** Wall-clock time we first saw this agent (for journal duration fallback). */
  startedAt?: number;
}

interface ActiveRun {
  taskId: string;
  runId: string;
  runDir: string;
  /** Sibling progress snapshot: <session>/workflows/wf_<id>.json. */
  progressPath: string;
  journalPath: string;
  /** Journal-fallback cursor. */
  processedLines: number;
  /** Phase titles already emitted via onPhaseStart. */
  emittedPhases: Set<string>;
  /** Per-agent start/end emission tracking, shared by both data sources. */
  agentStates: Map<string, AgentEmitState>;
  /** Most recent observed agent count (snapshot length or fallback size). */
  agentCount: number;
}

const POLL_INTERVAL_MS = 600;
const OUTPUT_PREVIEW_LIMIT = 500;
const LABEL_LIMIT = 60;
const PROMPT_PREVIEW_LIMIT = 500;

const TERMINAL_STATES = new Set([
  "done",
  "error",
  "errored",
  "failed",
  "cancelled",
  "canceled",
]);

function mapEndStatus(state: string): "completed" | "errored" | "skipped" {
  if (state === "done") return "completed";
  if (state === "cancelled" || state === "canceled") return "skipped";
  return "errored";
}

/**
 * Extract a short single-line label from an agent prompt: collapse
 * whitespace, take the opening up to the first sentence boundary, and cap
 * at LABEL_LIMIT chars. Journal fallback only — the snapshot carries the real
 * opts.label.
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
 * derive label / model / token usage. Used by the journal fallback path only.
 * Returns an empty object when the file is missing or unparseable — never
 * throws.
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

/**
 * Derive the sibling progress snapshot path from the journal run dir:
 *   <session>/subagents/workflows/wf_<id>  →  <session>/workflows/wf_<id>.json
 */
function deriveProgressPath(runDir: string): string {
  return path.resolve(
    runDir,
    "../../../workflows",
    `${path.basename(runDir)}.json`,
  );
}

export class WorkflowRunWatcher {
  private readonly runs = new Map<string, ActiveRun>();
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(private readonly callbacks: WorkflowAgentEventCallbacks) {}

  /**
   * Start watching a workflow run. `runDir` is the journal/transcript dir;
   * the progress snapshot path is derived as its sibling. If the caller
   * couldn't resolve a runDir it should NOT call start() — agent events
   * simply don't fire, and workflow-run-end still emits via the outer hook.
   */
  start(taskId: string, runId: string, runDir: string): void {
    this.runs.set(taskId, {
      taskId,
      runId,
      runDir,
      progressPath: deriveProgressPath(runDir),
      journalPath: path.join(runDir, "journal.jsonl"),
      processedLines: 0,
      emittedPhases: new Set(),
      agentStates: new Map(),
      agentCount: 0,
    });
    this.ensurePolling();
  }

  /**
   * Stop tracking. Runs one final synchronous poll so any entries written
   * between the last poll and the workflow's task_notification land before
   * the caller emits workflow-run-end.
   *
   * Returns the observed agent count so the caller can populate
   * workflow-run-end.agentCount.
   */
  stop(taskId: string): { agentCount: number } {
    const run = this.runs.get(taskId);
    if (!run) return { agentCount: 0 };
    this.poll(run);
    const result = { agentCount: run.agentCount };
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
    const snapshot = readWorkflowProgress(run.progressPath);
    if (snapshot) {
      this.pollProgress(run, snapshot);
    } else {
      // Fallback: older Claude Code that only writes journal.jsonl.
      this.pollJournal(run);
    }
  }

  /** Diff the progress snapshot against emitted state and fire events. */
  private pollProgress(run: ActiveRun, snapshot: WorkflowProgressSnapshot): void {
    run.agentCount = snapshot.agentCount ?? snapshot.agents.length;

    for (const phase of snapshot.phases) {
      if (run.emittedPhases.has(phase.title)) continue;
      run.emittedPhases.add(phase.title);
      try {
        this.callbacks.onPhaseStart(
          run.taskId,
          run.runId,
          phase.index,
          phase.title,
          Date.now(),
        );
      } catch {
        // Swallow; a throwing consumer must not wedge the poll loop.
      }
    }

    for (const agent of snapshot.agents) {
      let state = run.agentStates.get(agent.agentId);
      if (!state) {
        state = { started: false, ended: false };
        run.agentStates.set(agent.agentId, state);
      }
      if (!state.started) {
        state.started = true;
        const startedAt = agent.startedAt ?? Date.now();
        state.startedAt = startedAt;
        try {
          this.callbacks.onAgentStart(
            run.taskId,
            run.runId,
            agent.agentId,
            startedAt,
            agent.label,
            agent.promptPreview ?? "",
            agent.phaseTitle,
            agent.agentType,
          );
        } catch {
          // Swallow.
        }
      }
      if (!state.ended && TERMINAL_STATES.has(agent.state)) {
        state.ended = true;
        const endedAt = Date.now();
        const durationMs =
          agent.durationMs ??
          Math.max(0, endedAt - (state.startedAt ?? endedAt));
        const outputPreview =
          agent.resultPreview && agent.resultPreview.length > 0
            ? agent.resultPreview.slice(0, OUTPUT_PREVIEW_LIMIT)
            : undefined;
        // The snapshot's `tokens` is a single integer total; surface it as
        // input so the App's input+output display shows the total.
        const tokens =
          agent.tokens !== undefined
            ? { input: agent.tokens, output: 0 }
            : undefined;
        try {
          this.callbacks.onAgentEnd(
            run.taskId,
            run.runId,
            agent.agentId,
            outputPreview,
            durationMs,
            endedAt,
            agent.model,
            tokens,
            mapEndStatus(agent.state),
          );
        } catch {
          // Swallow.
        }
      }
    }
  }

  /** Legacy journal.jsonl reader (used only when no progress snapshot). */
  private pollJournal(run: ActiveRun): void {
    const entries = readJournalEntries(run.journalPath);
    if (entries.length <= run.processedLines) return;
    const fresh = entries.slice(run.processedLines);
    run.processedLines = entries.length;
    for (const entry of fresh) {
      this.handleJournalEntry(run, entry);
    }
    run.agentCount = run.agentStates.size;
  }

  private handleJournalEntry(run: ActiveRun, entry: WorkflowJournalEntry): void {
    let state = run.agentStates.get(entry.agentId);
    if (!state) {
      state = { started: false, ended: false };
      run.agentStates.set(entry.agentId, state);
    }
    if (entry.type === "started") {
      if (state.started) return;
      state.started = true;
      const startedAt = Date.now();
      state.startedAt = startedAt;
      const meta = readAgentMeta(run.runDir, entry.agentId);
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
        // Swallow.
      }
      return;
    }
    if (entry.type === "result") {
      if (state.ended) return;
      state.ended = true;
      const endedAt = Date.now();
      const startedAt = state.startedAt ?? endedAt;
      const durationMs = Math.max(0, endedAt - startedAt);
      const outputPreview =
        typeof entry.result === "string" && entry.result.length > 0
          ? entry.result.slice(0, OUTPUT_PREVIEW_LIMIT)
          : undefined;
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
          "completed",
        );
      } catch {
        // Swallow.
      }
    }
  }
}
