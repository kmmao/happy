import * as z from "zod";
import { ResolvedRuntimeProfileSchema } from "./profile";

// ===== Task Priority =====
export const TaskPrioritySchema = z.enum([
  "urgent",      // User-initiated, needs immediate execution
  "user",        // Normal user-created task (default)
  "background",  // Automated / scheduled tasks
]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

// ===== Task Status =====
export const TaskStatusSchema = z.enum([
  "queued",       // Waiting in queue
  "dispatching",  // Being sent to CLI daemon
  "running",      // Executing on CLI
  "completed",    // Finished successfully
  "failed",       // Execution failed
  "cancelled",    // Cancelled by user
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// ===== Task Trigger Type =====
export const TaskTriggerTypeSchema = z.enum([
  "manual",    // Created from App by user
  "cron",      // Created by TriggerSchedule
  "webhook",   // Created by WebhookTrigger
]);
export type TaskTriggerType = z.infer<typeof TaskTriggerTypeSchema>;

// ===== Task Summary (Server → App) =====
export const TaskSummarySchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  machineId: z.string(),
  priority: TaskPrioritySchema,
  status: TaskStatusSchema,
  triggerType: TaskTriggerTypeSchema,
  triggerRef: z.string().optional(),
  attempt: z.number(),
  maxAttempts: z.number(),
  sessionId: z.string().optional(),
  errorMessage: z.string().optional(),
  dispatchedAt: z.number().optional(),
  completedAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  // Encrypted prompt preview (first 100 chars)
  promptPreview: z.string().optional(),
  // Names of bound skills for display
  skillNames: z.array(z.string()).optional(),
});
export type TaskSummary = z.infer<typeof TaskSummarySchema>;

// ===== Create Task Body (App → Server) =====
export const CreateTaskBodySchema = z.object({
  projectId: z.string().optional(),
  machineId: z.string(),
  prompt: z.string().min(1),      // Encrypted by App
  priority: TaskPrioritySchema.default("user"),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  skillIds: z.array(z.string()).max(10).default([]),
});
export type CreateTaskBody = z.infer<typeof CreateTaskBodySchema>;

// ===== Task Trigger Data (Server → CLI via ephemeral) =====
export const TaskTriggerDataSchema = z.object({
  type: z.literal("task-trigger"),
  taskId: z.string(),
  prompt: z.string(),             // Encrypted prompt
  directory: z.string(),          // Project directory on machine
  priority: TaskPrioritySchema,
  projectId: z.string().optional(),
  resultToken: z.string().optional(),
  skillContents: z.array(z.object({
    name: z.string(),
    content: z.string(),
  })).optional(),
  agentType: z.string().nullable().optional(),    // "claude" | "codex" | "gemini" — null = inherit CLI default
  modelOverride: z.string().nullable().optional(), // e.g. "claude-sonnet-4-20250514" — null = agent default
  // Profile binding for this task. `profileId` references the AIBackendProfile
  // selected when the task was created (Task.profileId column). `runtimeProfile`
  // is the resolved snapshot (env vars, startup script, permission mode, etc.)
  // that the CLI should honor when spawning the session. Both optional for
  // backward compatibility; starting from wire 0.14.0 + server unified resolver
  // these are always populated for scheduled/webhook/manual tasks.
  profileId: z.string().optional(),
  runtimeProfile: ResolvedRuntimeProfileSchema.optional(),
});
export type TaskTriggerData = z.infer<typeof TaskTriggerDataSchema>;

// ===== Task Status Report (CLI → Server) =====
export const TaskOutcomeSchema = z.enum([
  "completed",
  "failed",
  "blocked",
]);
export type TaskOutcome = z.infer<typeof TaskOutcomeSchema>;

export const TaskStatusReportSchema = z.object({
  taskId: z.string(),
  status: TaskStatusSchema,
  outcome: TaskOutcomeSchema.optional(),
  sessionId: z.string().optional(),
  errorMessage: z.string().optional(),
});
export type TaskStatusReport = z.infer<typeof TaskStatusReportSchema>;

// ===== Task Status Changed Ephemeral (Server → App) =====
export const TaskStatusChangedSchema = z.object({
  type: z.literal("task-status-changed"),
  taskId: z.string(),
  machineId: z.string().optional(),
  status: TaskStatusSchema,
  sessionId: z.string().optional(),
  errorMessage: z.string().optional(),
  completedAt: z.number().optional(),
});
export type TaskStatusChanged = z.infer<typeof TaskStatusChangedSchema>;
