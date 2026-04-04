import * as z from "zod";

// ===== Session Event Type =====
export const SessionEventTypeSchema = z.enum([
  "file_edit",       // File created/modified/deleted
  "bash_command",    // Shell command executed
  "tool_call",       // Tool invocation (Read, Grep, etc.)
  "git_operation",   // Git commit, push, branch, etc.
  "error",           // Error occurred during session
  "session_start",   // Session started
  "session_end",     // Session ended
]);
export type SessionEventType = z.infer<typeof SessionEventTypeSchema>;

// ===== Session Event Summary (Server → App) =====
export const SessionEventSummarySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  eventType: SessionEventTypeSchema,
  summary: z.string(),                    // Human-readable one-liner
  detail: z.record(z.string(), z.unknown()).optional(), // Structured metadata (JSON)
  createdAt: z.number(),
});
export type SessionEventSummary = z.infer<typeof SessionEventSummarySchema>;

// ===== Session Event Report (CLI → Server via socket) =====
export const SessionEventReportSchema = z.object({
  sessionId: z.string(),
  eventType: SessionEventTypeSchema,
  summary: z.string().max(500),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type SessionEventReport = z.infer<typeof SessionEventReportSchema>;

// ===== Session Event Created Ephemeral (Server → App) =====
export const SessionEventCreatedSchema = z.object({
  type: z.literal("session-event-created"),
  event: SessionEventSummarySchema,
});
export type SessionEventCreated = z.infer<typeof SessionEventCreatedSchema>;
