import { createId, isCuid } from "@paralleldrive/cuid2";
import * as z from "zod";

export const sessionRoleSchema = z.enum(["user", "agent"]);
export type SessionRole = z.infer<typeof sessionRoleSchema>;

export const sessionTextEventSchema = z.object({
  t: z.literal("text"),
  text: z.string(),
  thinking: z.boolean().optional(),
});

export const sessionTextDeltaEventSchema = z.object({
  t: z.literal("text-delta"),
  stream: z.string(),
  delta: z.string(),
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

export const sessionTaskUpdatedEventSchema = z.object({
  t: z.literal("task-updated"),
  taskId: z.string(),
  patch: z.object({
    status: z.enum(["pending", "running", "completed", "failed", "killed", "paused"]).optional(),
    description: z.string().optional(),
    endTime: z.number().optional(),
    error: z.string().optional(),
    isBackgrounded: z.boolean().optional(),
  }),
});

export const sessionRateLimitEventSchema = z.object({
  t: z.literal("rate-limit"),
  status: z.enum(["allowed", "allowed_warning", "rejected"]),
  resetsAt: z.number().optional(),
  rateLimitType: z.string().optional(),
  utilization: z.number().optional(),
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
  sessionTextDeltaEventSchema,
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
  sessionTaskUpdatedEventSchema,
  sessionRateLimitEventSchema,
  sessionToolProgressEventSchema,
  sessionPromptSuggestionEventSchema,
  sessionNeedsContinueEventSchema,
  sessionStateChangedEventSchema,
  sessionContextUsageEventSchema,
  sessionTaskLogEventSchema,
]);

export type SessionEvent = z.infer<typeof sessionEventSchema>;

/**
 * Forward-compatible variant of sessionEventSchema.
 *
 * Old consumers that still use sessionEventSchema directly will reject
 * unknown discriminator values — meaning when newer CLIs emit a new event
 * type, the entire envelope is silently dropped by the App's safeParse
 * (see typesRaw.ts:normalizeRawMessage).
 *
 * Consumers that want to be tolerant of future protocol additions should
 * parse against THIS schema instead. Unknown event types fall into the
 * `{ t: string }` passthrough bucket and the consumer can choose to skip
 * rendering rather than drop the envelope. The known event variants are
 * tried first, so already-known types still resolve to their typed shapes.
 */
export const sessionEventSchemaPermissive = z.union([
  sessionEventSchema,
  z.object({ t: z.string() }).passthrough(),
]);

export type SessionEventPermissive = z.infer<typeof sessionEventSchemaPermissive>;

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
    /**
     * Optional Claude-side message UUID for this envelope. Populated by the
     * CLI when an envelope mirrors a specific JSONL record, so the App can
     * use it as a precise rewind/fork anchor (the CLI's `forkSession` RPC
     * accepts this value as `upToMessageId`).
     *
     * Backward-compatible: older CLIs / non-Claude agents simply omit it.
     * App code MUST treat absence as "no fork anchor available" rather than
     * an error.
     */
    claudeUuid: z.string().min(1).optional(),
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
        envelope.ev.t === "task-updated" ||
        envelope.ev.t === "rate-limit" ||
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

/**
 * Forward-compatible variant of sessionEnvelopeSchema. Same envelope shape,
 * but the inner `ev` field is parsed with sessionEventSchemaPermissive — so
 * envelopes carrying unknown `ev.t` values are accepted into the passthrough
 * bucket rather than dropping the entire envelope at parse time.
 *
 * Use this on the receiving side (e.g. App's normalizeRawMessage) so a newer
 * CLI emitting a not-yet-known event type doesn't cause downstream message
 * loss. The strict sessionEnvelopeSchema remains the contract for senders
 * (createEnvelope still rejects unknown types).
 *
 * The role/event compatibility superRefine only fires for known event types;
 * unknown events skip those checks (we cannot encode constraints we don't
 * know about). Receivers should still gate behavior on a known `t` value.
 */
export const sessionEnvelopeSchemaPermissive = z
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
    claudeUuid: z.string().min(1).optional(),
    ev: sessionEventSchemaPermissive,
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
        envelope.ev.t === "task-updated" ||
        envelope.ev.t === "rate-limit" ||
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

export type SessionEnvelopePermissive = z.infer<typeof sessionEnvelopeSchemaPermissive>;

export type CreateEnvelopeOptions = {
  id?: string;
  time?: number;
  turn?: string;
  subagent?: string;
  /** Optional Claude-side message UUID; see sessionEnvelopeSchema.claudeUuid. */
  claudeUuid?: string;
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
    ...(opts.claudeUuid ? { claudeUuid: opts.claudeUuid } : {}),
    ev,
  });
}
