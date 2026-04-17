import * as z from "zod";

/**
 * Shared schemas for live session state surfaced to the App's Progress tab.
 *
 * These are written by the Agent via MCP tools (update_progress /
 * update_session_summary) and read by the App through the encrypted
 * `Session.metadata` blob — no new server storage or migration needed.
 *
 * Keep these fields small: they ride inside the metadata envelope on every
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

export const sessionProgressTodoSchema = z.object({
  content: z.string(),
  status: sessionProgressTodoStatusSchema,
  stage: z.string().optional(),
});
export type SessionProgressTodo = z.infer<typeof sessionProgressTodoSchema>;

/**
 * Live progress state. Full rewrite each update — the Agent sends the
 * complete checklist, never a delta.
 */
export const sessionProgressStateSchema = z.object({
  todos: z.array(sessionProgressTodoSchema),
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
