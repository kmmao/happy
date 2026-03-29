import { createId, isCuid } from "@paralleldrive/cuid2";
import * as z from "zod";

export const sessionRoleSchema = z.enum(["user", "agent"]);
export type SessionRole = z.infer<typeof sessionRoleSchema>;

export const sessionTextEventSchema = z.object({
  t: z.literal("text"),
  text: z.string(),
  thinking: z.boolean().optional(),
});

export const sessionServiceMessageEventSchema = z.object({
  t: z.literal("service"),
  text: z.string(),
});

export const sessionToolCallStartEventSchema = z.object({
  t: z.literal("tool-call-start"),
  call: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string(),
  args: z.record(z.string(), z.unknown()),
});

export const sessionToolCallEndEventSchema = z.object({
  t: z.literal("tool-call-end"),
  call: z.string(),
  /** Background task ID when Bash command runs with run_in_background */
  backgroundTaskId: z.string().optional(),
  /** Path to the task output file on the CLI machine */
  outputFile: z.string().optional(),
});

export const sessionFileEventSchema = z.object({
  t: z.literal("file"),
  ref: z.string(),
  name: z.string(),
  size: z.number(),
  image: z
    .object({
      width: z.number(),
      height: z.number(),
      thumbhash: z.string(),
    })
    .optional(),
});

export const sessionTurnStartEventSchema = z.object({
  t: z.literal("turn-start"),
});

export const sessionStartEventSchema = z.object({
  t: z.literal("start"),
  title: z.string().optional(),
});

export const sessionTurnEndStatusSchema = z.enum([
  "completed",
  "failed",
  "cancelled",
]);
export type SessionTurnEndStatus = z.infer<typeof sessionTurnEndStatusSchema>;

export const sessionModelUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadInputTokens: z.number(),
  cacheCreationInputTokens: z.number(),
  costUSD: z.number(),
  contextWindow: z.number(),
  maxOutputTokens: z.number(),
});
export type SessionModelUsage = z.infer<typeof sessionModelUsageSchema>;

export const sessionTurnEndEventSchema = z.object({
  t: z.literal("turn-end"),
  status: sessionTurnEndStatusSchema,
  model: z.string().optional(),
  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_creation_input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
    })
    .optional(),
  durationMs: z.number().optional(),
  totalCostUsd: z.number().optional(),
  numTurns: z.number().optional(),
  modelUsage: z.record(z.string(), sessionModelUsageSchema).optional(),
});

export const sessionStopEventSchema = z.object({
  t: z.literal("stop"),
});

export const sessionUsageUpdateEventSchema = z.object({
  t: z.literal("usage-update"),
  model: z.string().optional(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cache_creation_input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
  }),
  durationMs: z.number().optional(),
});

export const sessionTaskStartEventSchema = z.object({
  t: z.literal("task-start"),
  taskId: z.string(),
  toolUseId: z.string().optional(),
  description: z.string(),
  taskType: z.string().optional(),
  /** meta.name from the workflow script (e.g. 'spec'). Only set when taskType is 'local_workflow'. */
  workflowName: z.string().optional(),
});

export const sessionTaskProgressEventSchema = z.object({
  t: z.literal("task-progress"),
  taskId: z.string(),
  description: z.string(),
  usage: z.object({
    totalTokens: z.number(),
    toolUses: z.number(),
    durationMs: z.number(),
  }).optional(),
  lastToolName: z.string().optional(),
  /** AI-generated progress summary (~30s interval, from agentProgressSummaries) */
  summary: z.string().optional(),
});

export const sessionTaskEndEventSchema = z.object({
  t: z.literal("task-end"),
  taskId: z.string(),
  status: z.enum(["completed", "failed", "stopped"]),
  summary: z.string(),
  usage: z
    .object({
      totalTokens: z.number(),
      toolUses: z.number(),
      durationMs: z.number(),
    })
    .optional(),
});

export const sessionToolProgressEventSchema = z.object({
  t: z.literal("tool-progress"),
  toolUseId: z.string(),
  toolName: z.string(),
  elapsedSeconds: z.number(),
  taskId: z.string().optional(),
});

export const sessionPromptSuggestionEventSchema = z.object({
  t: z.literal("prompt-suggestion"),
  suggestion: z.string(),
});

export const sessionNeedsContinueEventSchema = z.object({
  t: z.literal("needs-continue"),
});

export const sessionStateChangedEventSchema = z.object({
  t: z.literal("session-state-changed"),
  /** Authoritative session lifecycle state from the SDK */
  state: z.enum(["idle", "running", "requires_action"]),
});

export const sessionContextUsageCategorySchema = z.object({
  name: z.string(),
  tokens: z.number(),
  color: z.string().optional(),
});

export const sessionTaskLogEventSchema = z.object({
  t: z.literal("task-log"),
  /** Background task ID or tool call ID that owns this log stream */
  taskId: z.string(),
  /** Path to the output file on the CLI machine */
  outputFile: z.string(),
  /** Incremental log content (new lines since last push) */
  chunk: z.string(),
  /** Byte offset in the output file where this chunk starts */
  offset: z.number(),
});

export const sessionContextUsageEventSchema = z.object({
  t: z.literal("context-usage"),
  totalTokens: z.number(),
  maxTokens: z.number(),
  percentage: z.number(),
  model: z.string().optional(),
  categories: z.array(sessionContextUsageCategorySchema).optional(),
  isAutoCompactEnabled: z.boolean().optional(),
  autoCompactThreshold: z.number().optional(),
  messageBreakdown: z.object({
    toolCallTokens: z.number(),
    toolResultTokens: z.number(),
    attachmentTokens: z.number(),
    assistantMessageTokens: z.number(),
    userMessageTokens: z.number(),
  }).optional(),
});
export type SessionContextUsageEvent = z.infer<typeof sessionContextUsageEventSchema>;

export const sessionEventSchema = z.discriminatedUnion("t", [
  sessionTextEventSchema,
  sessionServiceMessageEventSchema,
  sessionToolCallStartEventSchema,
  sessionToolCallEndEventSchema,
  sessionFileEventSchema,
  sessionTurnStartEventSchema,
  sessionStartEventSchema,
  sessionTurnEndEventSchema,
  sessionStopEventSchema,
  sessionUsageUpdateEventSchema,
  sessionTaskStartEventSchema,
  sessionTaskProgressEventSchema,
  sessionTaskEndEventSchema,
  sessionToolProgressEventSchema,
  sessionPromptSuggestionEventSchema,
  sessionNeedsContinueEventSchema,
  sessionStateChangedEventSchema,
  sessionContextUsageEventSchema,
  sessionTaskLogEventSchema,
]);

export type SessionEvent = z.infer<typeof sessionEventSchema>;

export const sessionEnvelopeSchema = z
  .object({
    id: z.string(),
    time: z.number(),
    role: sessionRoleSchema,
    turn: z.string().optional(),
    subagent: z
      .string()
      .refine((value) => isCuid(value), {
        message: "subagent must be a cuid2 value",
      })
      .optional(),
    ev: sessionEventSchema,
  })
  .superRefine((envelope, ctx) => {
    if (envelope.ev.t === "service" && envelope.role !== "agent") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'service events must use role "agent"',
        path: ["role"],
      });
    }
    if (
      (envelope.ev.t === "start" ||
        envelope.ev.t === "stop" ||
        envelope.ev.t === "usage-update" ||
        envelope.ev.t === "task-start" ||
        envelope.ev.t === "task-progress" ||
        envelope.ev.t === "task-end" ||
        envelope.ev.t === "tool-progress" ||
        envelope.ev.t === "prompt-suggestion" ||
        envelope.ev.t === "needs-continue" ||
        envelope.ev.t === "session-state-changed" ||
        envelope.ev.t === "context-usage" ||
        envelope.ev.t === "task-log") &&
      envelope.role !== "agent"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${envelope.ev.t} events must use role "agent"`,
        path: ["role"],
      });
    }
  });

export type SessionEnvelope = z.infer<typeof sessionEnvelopeSchema>;

export type CreateEnvelopeOptions = {
  id?: string;
  time?: number;
  turn?: string;
  subagent?: string;
};

export function createEnvelope(
  role: SessionRole,
  ev: SessionEvent,
  opts: CreateEnvelopeOptions = {},
): SessionEnvelope {
  return sessionEnvelopeSchema.parse({
    id: opts.id ?? createId(),
    time: opts.time ?? Date.now(),
    role,
    ...(opts.turn ? { turn: opts.turn } : {}),
    ...(opts.subagent ? { subagent: opts.subagent } : {}),
    ev,
  });
}
