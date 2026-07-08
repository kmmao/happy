/**
 * inFlightTaskRegistry — pure policy for reaping stranded sub-agent tasks.
 *
 * Why this seam exists: the App surfaces every Agent/Task sub-agent as a
 * "running" chip until the outer tool-call's state flips, and the ONLY signal
 * that flips it is a `task-end` envelope (forwarded from Claude's
 * `task_notification` system message). If the sub-agent crashes inside the
 * runtime, the parent turn is Esc-interrupted, or the happy process is killed
 * before that notification is emitted, the chip is stranded "running" forever —
 * the CLI never re-emits it and the App's Phase 6 stale-completion deliberately
 * skips Task/Agent tools.
 *
 * The launcher tracks each task it saw start (`task_started`) but never saw
 * finish (`task_notification`), and this module answers two pure questions
 * about that set: "which of these have gone silent long enough to be
 * considered dead?" (`selectStaleTasks`) and "what task-end envelope reaps
 * one?" (`buildReapEnvelopePayload`).
 *
 * Staleness — not a foreground/background flag — is the reaping gate on
 * purpose. Background sub-agents (`run_in_background`) legitimately outlive the
 * turn that spawned them, so a turn-boundary sweep would kill live ones. A
 * genuinely-running background agent keeps emitting `task_progress` heartbeats
 * (which refresh `lastActivityAt`); a dead one goes silent. So "silent past the
 * threshold" cleanly separates the two without ever inspecting `backgrounded`.
 *
 * The mutable Map, the timers, and the Socket send stay in
 * claudeRemoteLauncherCore — this module only decides, so every threshold
 * boundary is directly unit-testable without a live PTY.
 */

/** Terminal status the App renders for a reaped task (never `completed`). */
export type ReapedTaskStatus = "stopped";

/** One sub-agent task the launcher saw start but not finish. */
export interface InFlightTask {
  /** Claude's task_id — the reap envelope's routing key. */
  readonly taskId: string;
  /** Spawning Agent/Task tool_use id, when known — lets the App route the
   * task-end to the exact tool-call card even if no launch ack registered it. */
  readonly toolUseId?: string;
  /** Human label from task_started, for reap-log readability. */
  readonly description: string;
  /** Epoch ms of the task_started that created this entry. */
  readonly startedAt: number;
  /** Epoch ms of the most recent heartbeat (task_started / progress / updated).
   * The staleness clock reads this, NOT startedAt — a long-but-live agent
   * refreshes it every progress tick. */
  readonly lastActivityAt: number;
  /** Whether Claude reported this task backgrounded. Diagnostic only — NOT a
   * reaping gate (see module doc). */
  readonly backgrounded: boolean;
}

/** Default: no heartbeat for 4 minutes ⇒ treat as dead. Conservative so a
 * slow-starting sub-agent isn't reaped mid-spin-up. */
export const DEFAULT_STALE_THRESHOLD_MS = 4 * 60_000;

/** Default sweep cadence. Coarse — a stranded chip clearing within a minute of
 * the threshold is fine, and a tight interval would burn wakeups for nothing. */
export const DEFAULT_SWEEP_TICK_MS = 60_000;

/**
 * Return the tasks whose last heartbeat is strictly older than the threshold.
 *
 * Boundary: a task exactly at `now - thresholdMs` is NOT stale (still within
 * the grace window) — only strictly-older entries are reaped. Pure; the caller
 * pins `now` so tests can hit the boundary exactly.
 */
export function selectStaleTasks(
  tasks: Iterable<InFlightTask>,
  now: number,
  thresholdMs: number,
): InFlightTask[] {
  const cutoff = now - thresholdMs;
  const stale: InFlightTask[] = [];
  for (const task of tasks) {
    if (task.lastActivityAt < cutoff) {
      stale.push(task);
    }
  }
  return stale;
}

/** Fixed summary stamped onto a reaped task so the App card doesn't read as a
 * result-less "zombie". */
export const REAPED_TASK_SUMMARY =
  "Subagent did not report completion (reaped by happy-cli)";

/**
 * Build the `task-end` protocol payload that reaps one stranded task. Shape
 * matches what the `task_notification` forwarder emits, minus usage — the App's
 * Phase 3.5 flips the tool-call to error and stamps `summary` as the result.
 *
 * `toolUseId` is omitted from the payload when unknown rather than sent as
 * `undefined`, keeping the envelope clean for the App's `toolUseId ?? taskId`
 * routing fallback.
 */
export function buildReapEnvelopePayload(
  task: InFlightTask,
  status: ReapedTaskStatus,
): {
  t: "task-end";
  taskId: string;
  status: ReapedTaskStatus;
  summary: string;
  toolUseId?: string;
} {
  return {
    t: "task-end",
    taskId: task.taskId,
    status,
    summary: REAPED_TASK_SUMMARY,
    ...(task.toolUseId ? { toolUseId: task.toolUseId } : {}),
  };
}
