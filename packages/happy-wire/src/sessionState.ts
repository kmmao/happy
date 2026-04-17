import * as z from "zod";

/**
 * Shared schemas for live session state surfaced to the App's Progress tab.
 *
 * These live inside the encrypted `Session.metadata` blob — no new server
 * storage or migration needed. Two sources feed this state:
 *   1. CLI auto-mirror hook: captures SDK's TodoWrite tool_result and
 *      writes todos directly (no Agent prompting required).
 *   2. MCP tools update_progress / update_session_summary: optional
 *      Agent-driven paths for richer fields the SDK doesn't expose.
 *
 * Keep fields small: they ride inside the metadata envelope on every
 * socket update, so avoid attaching large structured content here.
 */

export const sessionProgressTodoStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
]);
export type SessionProgressTodoStatus = z.infer<
  typeof sessionProgressTodoStatusSchema
>;

/**
 * One checklist item. Mirrors the shape of Claude Code SDK's TodoWriteInput
 * items, with Happy extensions (`stage`, `verificationNudgeNeeded`).
 */
export const sessionProgressTodoSchema = z.object({
  content: z.string(),
  status: sessionProgressTodoStatusSchema,
  /** SDK-native: imperative-present form shown when status is in_progress. */
  activeForm: z.string().optional(),
  /** Optional phase/stage label a step belongs to, e.g. "Phase 2". */
  stage: z.string().optional(),
  /**
   * Carried over from SDK's `TodoWriteOutput.verificationNudgeNeeded` — SDK
   * flags items it suspects were marked completed without verification.
   */
  verificationNudgeNeeded: z.boolean().optional(),
});
export type SessionProgressTodo = z.infer<typeof sessionProgressTodoSchema>;

/**
 * One task list = one "generation" of the checklist. A session can contain
 * multiple generations across time; the auto-mirror hook partitions them
 * by a boundary heuristic (prior list fully completed + low overlap).
 */
export const sessionProgressListSchema = z.object({
  /** Stable UUID for tab switching / explicit Agent addressing. */
  id: z.string(),
  /** Short human-readable label; auto-derived from first todo if absent. */
  label: z.string().optional(),
  todos: z.array(sessionProgressTodoSchema),
  /** Optional overall stage for this list (set via MCP). */
  currentStage: z.string().optional(),
  /** Optional blocker list (set via MCP). */
  blockers: z.array(z.string()).optional(),
  startedAt: z.number(),
  updatedAt: z.number(),
  /** When this list stopped being active (got pushed to history). */
  archivedAt: z.number().optional(),
  /**
   * Tool-call message IDs for file-editing tools (Edit/Write/MultiEdit/
   * NotebookEdit) that ran while this list was the active one. Consumers
   * resolve these against the session message stream to render per-list
   * file change summaries without duplicating diff content into metadata.
   */
  toolCallIds: z.array(z.string()).optional(),
});
export type SessionProgressList = z.infer<typeof sessionProgressListSchema>;

/**
 * Live progress state. Holds a list-of-lists plus a pointer to the active
 * one.
 *
 * Backward compatibility: older CLI / App versions wrote flat `todos` at
 * the top level. Readers should prefer `lists[currentListId]` when present
 * and fall back to the legacy `todos` otherwise.
 */
export const sessionProgressStateSchema = z.object({
  /** Ordered by startedAt asc; last item is typically the active one. */
  lists: z.array(sessionProgressListSchema).optional(),
  /** Points at the active list within `lists`. */
  currentListId: z.string().optional(),
  /**
   * Legacy flat fields. Still written for backward compat with older
   * readers — kept in sync with `lists[currentListId]` on each update.
   */
  todos: z.array(sessionProgressTodoSchema).optional(),
  currentStage: z.string().optional(),
  blockers: z.array(z.string()).optional(),
  updatedAt: z.number(),
});
export type SessionProgressState = z.infer<typeof sessionProgressStateSchema>;

/**
 * Live narrative summary updated at milestones, not per tool call. Arrays
 * are full-rewrite for simplicity (no append/remove deltas).
 */
export const sessionSummaryStateSchema = z.object({
  goal: z.string(),
  currentFocus: z.string().optional(),
  keyDecisions: z.array(z.string()).optional(),
  openQuestions: z.array(z.string()).optional(),
  impactScope: z.array(z.string()).optional(),
  updatedAt: z.number(),
});
export type SessionSummaryState = z.infer<typeof sessionSummaryStateSchema>;
