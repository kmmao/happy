import * as z from "zod";
import { isCuid } from "@paralleldrive/cuid2";
import { MessageMetaSchema, MessageMeta } from "./typesMessageMeta";
import { log } from '@/log';

//
// Raw types
//

// Usage data type from Claude API
const usageDataSchema = z.object({
  input_tokens: z.number(),
  cache_creation_input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  output_tokens: z.number(),
  service_tier: z.string().optional(),
});

export type UsageData = z.infer<typeof usageDataSchema>;

function isSessionProtocolSendEnabled(): boolean {
  const raw = (
    process.env.EXPO_PUBLIC_ENABLE_SESSION_PROTOCOL_SEND ??
    process.env.ENABLE_SESSION_PROTOCOL_SEND ??
    ""
  ).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

const agentEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("switch"),
    mode: z.enum(["local", "remote"]),
  }),
  z.object({
    type: z.literal("message"),
    message: z.string(),
  }),
  z.object({
    type: z.literal("limit-reached"),
    endsAt: z.number().optional(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("ready"),
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
    modelUsage: z
      .record(
        z.string(),
        z.object({
          inputTokens: z.number(),
          outputTokens: z.number(),
          cacheReadInputTokens: z.number(),
          cacheCreationInputTokens: z.number(),
          costUSD: z.number(),
          contextWindow: z.number(),
          maxOutputTokens: z.number(),
        }),
      )
      .optional(),
  }),
  z.object({
    type: z.literal("usage-stats"),
    model: z.string().optional(),
    usage: z.object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_creation_input_tokens: z.number().optional(),
      cache_read_input_tokens: z.number().optional(),
    }),
    durationMs: z.number().optional(),
  }),
  z.object({
    type: z.literal("context-usage"),
    totalTokens: z.number(),
    maxTokens: z.number(),
    percentage: z.number(),
    model: z.string().optional(),
    categories: z.array(z.object({
      name: z.string(),
      tokens: z.number(),
      color: z.string().optional(),
    })).optional(),
    isAutoCompactEnabled: z.boolean().optional(),
    autoCompactThreshold: z.number().optional(),
    messageBreakdown: z.object({
      toolCallTokens: z.number(),
      toolResultTokens: z.number(),
      attachmentTokens: z.number(),
      assistantMessageTokens: z.number(),
      userMessageTokens: z.number(),
    }).optional(),
  }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;

const sessionTextEventSchema = z.object({
  t: z.literal("text"),
  text: z.string(),
  thinking: z.boolean().optional(),
});

const sessionServiceMessageEventSchema = z.object({
  t: z.literal("service"),
  text: z.string(),
});

const sessionToolCallStartEventSchema = z.object({
  t: z.literal("tool-call-start"),
  call: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string(),
  args: z.record(z.string(), z.unknown()),
});

const sessionToolCallEndEventSchema = z.object({
  t: z.literal("tool-call-end"),
  call: z.string(),
  /** Background task ID when Bash command runs with run_in_background */
  backgroundTaskId: z.string().optional(),
  /** Path to the task output file on the CLI machine */
  outputFile: z.string().optional(),
});

const sessionFileEventSchema = z.object({
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

const sessionTurnStartEventSchema = z.object({
  t: z.literal("turn-start"),
});

const sessionStartEventSchema = z.object({
  t: z.literal("start"),
  title: z.string().optional(),
});

const sessionModelUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadInputTokens: z.number(),
  cacheCreationInputTokens: z.number(),
  costUSD: z.number(),
  contextWindow: z.number(),
  maxOutputTokens: z.number(),
});

const sessionTurnEndEventSchema = z.object({
  t: z.literal("turn-end"),
  status: z.enum(["completed", "failed", "cancelled"]),
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

const sessionStopEventSchema = z.object({
  t: z.literal("stop"),
});

const sessionUsageUpdateEventSchema = z.object({
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

// Task lifecycle events (Phase 2 wire protocol)
const sessionTaskStartEventSchema = z.object({
  t: z.literal("task-start"),
  taskId: z.string(),
  toolUseId: z.string().optional(),
  description: z.string(),
  taskType: z.string().optional(),
  workflowName: z.string().optional(),
});

const sessionTaskProgressEventSchema = z.object({
  t: z.literal("task-progress"),
  taskId: z.string(),
  description: z.string(),
  usage: z.object({
    totalTokens: z.number(),
    toolUses: z.number(),
    durationMs: z.number(),
  }),
  lastToolName: z.string().optional(),
  /** AI-generated progress summary (~30s interval, from agentProgressSummaries) */
  summary: z.string().optional(),
});

const sessionTaskEndEventSchema = z.object({
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

const sessionToolProgressEventSchema = z.object({
  t: z.literal("tool-progress"),
  toolUseId: z.string(),
  toolName: z.string(),
  elapsedSeconds: z.number(),
  taskId: z.string().optional(),
});

const sessionPromptSuggestionEventSchema = z.object({
  t: z.literal("prompt-suggestion"),
  suggestion: z.string(),
});

const sessionNeedsContinueEventSchema = z.object({
  t: z.literal("needs-continue"),
});

const sessionStateChangedEventSchema = z.object({
  t: z.literal("session-state-changed"),
  state: z.enum(["idle", "running", "requires_action"]),
});

const sessionContextUsageEventSchema = z.object({
  t: z.literal("context-usage"),
  totalTokens: z.number(),
  maxTokens: z.number(),
  percentage: z.number(),
  model: z.string().optional(),
  categories: z.array(z.object({
    name: z.string(),
    tokens: z.number(),
    color: z.string().optional(),
  })).optional(),
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

const sessionEventSchema = z.discriminatedUnion("t", [
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
]);

const sessionEnvelopeSchema = z
  .object({
    id: z.string(),
    time: z.number(),
    role: z.enum(["user", "agent"]),
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
        envelope.ev.t === "session-state-changed" ||
        envelope.ev.t === "context-usage") &&
      envelope.role !== "agent"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${envelope.ev.t} events must use role "agent"`,
        path: ["role"],
      });
    }
  });
type SessionEnvelope = z.infer<typeof sessionEnvelopeSchema>;

const rawTextContentSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .passthrough(); // ROBUST: Accept unknown fields for future API compatibility
export type RawTextContent = z.infer<typeof rawTextContentSchema>;

const rawToolUseContentSchema = z
  .object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.any(),
  })
  .passthrough(); // ROBUST: Accept unknown fields preserved by transform
export type RawToolUseContent = z.infer<typeof rawToolUseContentSchema>;

const rawToolResultContentSchema = z
  .object({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    content: z.union([
      z.array(
        z.object({ type: z.string() }).passthrough(), // ROBUST: Accept any content type (text, image, audio, etc.)
      ),
      z.string(),
    ]),
    is_error: z.boolean().optional(),
    permissions: z
      .object({
        date: z.number(),
        result: z.enum(["approved", "denied"]),
        mode: z
          .enum([
            "default",
            "acceptEdits",
            "bypassPermissions",
            "plan",
            "read-only",
            "safe-yolo",
            "yolo",
          ])
          .optional(),
        allowedTools: z.array(z.string()).optional(),
        decision: z
          .enum(["approved", "approved_for_session", "denied", "abort"])
          .optional(),
      })
      .optional(),
  })
  .passthrough(); // ROBUST: Accept unknown fields for future API compatibility
export type RawToolResultContent = z.infer<typeof rawToolResultContentSchema>;

/**
 * Extended thinking content from Claude API
 * Contains model's reasoning process before generating the final response
 * Uses .passthrough() to preserve signature and other unknown fields
 */
const rawThinkingContentSchema = z
  .object({
    type: z.literal("thinking"),
    thinking: z.string(),
  })
  .passthrough(); // ROBUST: Accept signature and future fields
export type RawThinkingContent = z.infer<typeof rawThinkingContentSchema>;

// ============================================================================
// WOLOG: Type-Safe Content Normalization via Zod Transform
// ============================================================================
// Accepts both hyphenated (Codex/Gemini) and underscore (Claude) formats
// Transforms all to canonical underscore format during validation
// Full type safety - no `unknown` types
// Source: Part D of the Expo Mobile Testing & Package Manager Agnostic System plan
// ============================================================================

/**
 * Hyphenated tool-call format from Codex/Gemini agents
 * Transforms to canonical tool_use format during validation
 * Uses .passthrough() to preserve unknown fields for future API compatibility
 */
const rawHyphenatedToolCallSchema = z
  .object({
    type: z.literal("tool-call"),
    callId: z.string(),
    id: z.string().optional(), // Some messages have both
    name: z.string(),
    input: z.any(),
  })
  .passthrough(); // ROBUST: Accept and preserve unknown fields
type RawHyphenatedToolCall = z.infer<typeof rawHyphenatedToolCallSchema>;

/**
 * Hyphenated tool-call-result format from Codex/Gemini agents
 * Transforms to canonical tool_result format during validation
 * Uses .passthrough() to preserve unknown fields for future API compatibility
 */
const rawHyphenatedToolResultSchema = z
  .object({
    type: z.literal("tool-call-result"),
    callId: z.string(),
    tool_use_id: z.string().optional(), // Some messages have both
    output: z.any(),
    content: z.any().optional(), // Some messages have both
    is_error: z.boolean().optional(),
  })
  .passthrough(); // ROBUST: Accept and preserve unknown fields
type RawHyphenatedToolResult = z.infer<typeof rawHyphenatedToolResultSchema>;

/**
 * Input schema accepting ALL formats (both hyphenated and canonical)
 * Including Claude's extended thinking content type
 */
const rawAgentContentInputSchema = z.discriminatedUnion("type", [
  rawTextContentSchema, // type: 'text' (canonical)
  rawToolUseContentSchema, // type: 'tool_use' (canonical)
  rawToolResultContentSchema, // type: 'tool_result' (canonical)
  rawThinkingContentSchema, // type: 'thinking' (canonical)
  rawHyphenatedToolCallSchema, // type: 'tool-call' (hyphenated)
  rawHyphenatedToolResultSchema, // type: 'tool-call-result' (hyphenated)
]);
type RawAgentContentInput = z.infer<typeof rawAgentContentInputSchema>;

/**
 * Type-safe transform: Hyphenated tool-call → Canonical tool_use
 * ROBUST: Unknown fields preserved via object spread and .passthrough()
 */
function normalizeToToolUse(input: RawHyphenatedToolCall) {
  // Spread preserves all fields from input (passthrough fields included)
  return {
    ...input,
    type: "tool_use" as const,
    id: input.callId, // Codex uses callId, canonical uses id
  };
}

/**
 * Type-safe transform: Hyphenated tool-call-result → Canonical tool_result
 * ROBUST: Unknown fields preserved via object spread and .passthrough()
 */
function normalizeToToolResult(input: RawHyphenatedToolResult) {
  // Spread preserves all fields from input (passthrough fields included)
  return {
    ...input,
    type: "tool_result" as const,
    tool_use_id: input.callId, // Codex uses callId, canonical uses tool_use_id
    content: input.output ?? input.content ?? "", // Codex uses output, canonical uses content
    is_error: input.is_error ?? false,
  };
}

/**
 * Schema that accepts both hyphenated and canonical formats.
 * Normalization happens via .preprocess() at root level to avoid Zod v4 "unmergable intersection" issue.
 * See: https://github.com/colinhacks/zod/discussions/2100
 *
 * Accepts: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'tool-call' | 'tool-call-result'
 * All types validated by their respective schemas with .passthrough() for unknown fields
 */
const rawAgentContentSchema = z.union([
  rawTextContentSchema,
  rawToolUseContentSchema,
  rawToolResultContentSchema,
  rawThinkingContentSchema,
  rawHyphenatedToolCallSchema,
  rawHyphenatedToolResultSchema,
]);
export type RawAgentContent = z.infer<typeof rawAgentContentSchema>;

const rawAgentRecordSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("output"),
    data: z.intersection(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("system") }),
        z.object({ type: z.literal("result") }),
        z.object({ type: z.literal("summary"), summary: z.string() }),
        z.object({
          type: z.literal("assistant"),
          message: z.object({
            role: z.literal("assistant"),
            model: z.string(),
            content: z.array(rawAgentContentSchema),
            usage: usageDataSchema.optional(),
          }),
          parent_tool_use_id: z.string().nullable().optional(),
        }),
        z.object({
          type: z.literal("user"),
          message: z.object({
            role: z.literal("user"),
            content: z.union([z.string(), z.array(rawAgentContentSchema)]),
          }),
          parent_tool_use_id: z.string().nullable().optional(),
          toolUseResult: z.any().nullable().optional(),
        }),
      ]),
      z
        .object({
          isSidechain: z.boolean().nullish(),
          isCompactSummary: z.boolean().nullish(),
          isMeta: z.boolean().nullish(),
          uuid: z.string().nullish(),
          parentUuid: z.string().nullish(),
        })
        .passthrough(),
    ), // ROBUST: Accept CLI metadata fields (userType, cwd, sessionId, version, gitBranch, slug, requestId, timestamp)
  }),
  z.object({
    type: z.literal("event"),
    id: z.string(),
    data: agentEventSchema,
  }),
  z.object({
    type: z.literal("codex"),
    data: z.discriminatedUnion("type", [
      z.object({ type: z.literal("reasoning"), message: z.string() }),
      z.object({ type: z.literal("message"), message: z.string() }),
      z.object({
        type: z.literal("tool-call"),
        callId: z.string(),
        input: z.any(),
        name: z.string(),
        id: z.string(),
      }),
      z.object({
        type: z.literal("tool-call-result"),
        callId: z.string(),
        output: z.any(),
        id: z.string(),
      }),
    ]),
  }),
  z.object({
    type: z.literal("session"),
    data: sessionEnvelopeSchema,
  }),
  z.object({
    // ACP (Agent Communication Protocol) - unified format for all agent providers
    type: z.literal("acp"),
    provider: z.enum(["gemini", "codex", "claude", "opencode"]),
    data: z.discriminatedUnion("type", [
      // Core message types
      z.object({ type: z.literal("reasoning"), message: z.string() }),
      z.object({ type: z.literal("message"), message: z.string() }),
      z.object({ type: z.literal("thinking"), text: z.string() }),
      // Tool interactions
      z.object({
        type: z.literal("tool-call"),
        callId: z.string(),
        input: z.any(),
        name: z.string(),
        id: z.string(),
      }),
      z.object({
        type: z.literal("tool-result"),
        callId: z.string(),
        output: z.any(),
        id: z.string(),
        isError: z.boolean().optional(),
      }),
      // Hyphenated tool-call-result (for backwards compatibility with CLI)
      z.object({
        type: z.literal("tool-call-result"),
        callId: z.string(),
        output: z.any(),
        id: z.string(),
      }),
      // File operations
      z.object({
        type: z.literal("file-edit"),
        description: z.string(),
        filePath: z.string(),
        diff: z.string().optional(),
        oldContent: z.string().optional(),
        newContent: z.string().optional(),
        id: z.string(),
      }),
      // Terminal/command output
      z.object({
        type: z.literal("terminal-output"),
        data: z.string(),
        callId: z.string(),
      }),
      // Task lifecycle events
      z.object({ type: z.literal("task_started"), id: z.string() }),
      z.object({ type: z.literal("task_complete"), id: z.string() }),
      z.object({ type: z.literal("turn_aborted"), id: z.string() }),
      // Permissions
      z.object({
        type: z.literal("permission-request"),
        permissionId: z.string(),
        toolName: z.string(),
        description: z.string(),
        options: z.any().optional(),
      }),
      // Usage/metrics
      z.object({ type: z.literal("token_count") }).passthrough(),
    ]),
  }),
]);

/**
 * Preprocessor: Normalizes hyphenated content types to canonical before validation
 * This avoids Zod v4's "unmergable intersection" issue with transforms inside complex schemas
 * See: https://github.com/colinhacks/zod/discussions/2100
 */
function preprocessMessageContent(data: any): any {
  if (!data || typeof data !== "object") return data;

  // Helper: normalize a single content item
  const normalizeContent = (item: any): any => {
    if (!item || typeof item !== "object") return item;

    if (item.type === "tool-call") {
      return normalizeToToolUse(item);
    }
    if (item.type === "tool-call-result") {
      return normalizeToToolResult(item);
    }
    return item;
  };

  // Normalize assistant message content
  if (
    data.role === "agent" &&
    data.content?.type === "output" &&
    data.content?.data?.message?.content
  ) {
    if (Array.isArray(data.content.data.message.content)) {
      data.content.data.message.content =
        data.content.data.message.content.map(normalizeContent);
    }
  }

  // Normalize user message content
  if (
    data.role === "agent" &&
    data.content?.type === "output" &&
    data.content?.data?.type === "user" &&
    Array.isArray(data.content.data.message?.content)
  ) {
    data.content.data.message.content =
      data.content.data.message.content.map(normalizeContent);
  }

  // Accept new session wrapper shape and normalize to canonical wrapped shape.
  // New shape:
  // { role: 'session', content: { id, role, turn?, subagent?, ev }, meta? }
  if (
    data.role === "session" &&
    data.content &&
    typeof data.content === "object"
  ) {
    const content = data.content as Record<string, unknown>;
    const looksLikeEnvelope =
      content.type !== "session" &&
      typeof content.id === "string" &&
      typeof content.role === "string" &&
      content.ev !== undefined;
    if (looksLikeEnvelope) {
      data.content = {
        type: "session",
        data: content,
      };
    }
  }

  return data;
}

const rawRecordSchema = z.preprocess(
  preprocessMessageContent,
  z.discriminatedUnion("role", [
    z.object({
      role: z.literal("agent"),
      content: rawAgentRecordSchema,
      meta: MessageMetaSchema.optional(),
    }),
    z.object({
      role: z.literal("user"),
      content: z.object({
        type: z.literal("text"),
        text: z.string(),
      }),
      meta: MessageMetaSchema.optional(),
    }),
    z.object({
      role: z.literal("session"),
      content: z.object({
        type: z.literal("session"),
        data: sessionEnvelopeSchema,
      }),
      meta: MessageMetaSchema.optional(),
    }),
  ]),
);

export type RawRecord = z.infer<typeof rawRecordSchema>;

// Export schemas for validation
export const RawRecordSchema = rawRecordSchema;

//
// Normalized types
//

type NormalizedAgentContent =
  | {
      type: "text";
      text: string;
      uuid: string;
      parentUUID: string | null;
    }
  | {
      type: "thinking";
      thinking: string;
      uuid: string;
      parentUUID: string | null;
    }
  | {
      type: "tool-call";
      id: string;
      name: string;
      input: any;
      description: string | null;
      uuid: string;
      parentUUID: string | null;
    }
  | {
      type: "tool-result";
      tool_use_id: string;
      content: any;
      is_error: boolean;
      uuid: string;
      parentUUID: string | null;
      permissions?: {
        date: number;
        result: "approved" | "denied";
        mode?: string;
        allowedTools?: string[];
        decision?: "approved" | "approved_for_session" | "denied" | "abort";
      };
      backgroundTaskId?: string;
      outputFile?: string;
    }
  | {
      type: "summary";
      summary: string;
    }
  | {
      type: "sidechain";
      uuid: string;
      prompt: string;
    };

export type NormalizedMessage = (
  | {
      role: "user";
      content: {
        type: "text";
        text: string;
      };
    }
  | {
      role: "agent";
      content: NormalizedAgentContent[];
    }
  | {
      role: "event";
      content: AgentEvent;
    }
) & {
  id: string;
  localId: string | null;
  createdAt: number;
  isSidechain: boolean;
  parentRef?: string | null; // Subagent/parent reference for sidechain linking (event messages)
  meta?: MessageMeta;
  usage?: UsageData;
  /** Present on task-start messages to register a new background task */
  taskStartInfo?: {
    taskId: string;
    toolUseId: string | null;
    description: string;
    taskType: string | null;
  };
  /** Present on task-progress messages to update background task status.
   *  Only emitted when envelope.ev.summary is non-empty (guard in normalizer). */
  taskProgressInfo?: {
    taskId: string;
    description: string;
    summary: string;
  };
  /** Present on task-end messages to link back to background tasks */
  taskEndInfo?: {
    taskId: string;
    status: "completed" | "failed" | "stopped";
  };
};

function normalizeSessionEnvelope(
  envelope: SessionEnvelope,
  localId: string | null,
  createdAt: number,
  meta: MessageMeta | undefined,
): NormalizedMessage | null {
  // Session protocol requires turn id on most agent-originated envelopes.
  // Drop malformed agent events without turn to avoid attaching stray messages.
  // Exception: task lifecycle events (task-start/progress/end) may arrive without
  // a turn (e.g. manual task-end from idle stopTask fallback).
  const isTaskLifecycleEvent =
    envelope.ev.t === "task-start" ||
    envelope.ev.t === "task-progress" ||
    envelope.ev.t === "task-end";
  if (envelope.role === "agent" && !envelope.turn && !isTaskLifecycleEvent) {
    return null;
  }

  const messageId = envelope.id;
  const messageCreatedAt = envelope.time;
  const parentUUID = envelope.subagent ?? null;
  const isSidechain = parentUUID !== null;
  const contentUUID = envelope.id;

  if (envelope.ev.t === "turn-start") {
    return null;
  }

  if (envelope.ev.t === "start" || envelope.ev.t === "stop") {
    // Lifecycle marker for subagent boundaries; currently not rendered as chat content.
    return null;
  }

  // Task lifecycle events — rendered as service messages for visibility
  // Also carry structured info for the reducer's backgroundTasks registry
  if (envelope.ev.t === "task-start") {
    return {
      id: messageId,
      localId,
      createdAt: messageCreatedAt,
      role: "agent",
      isSidechain,
      content: [
        {
          type: "text",
          text: `**Task:** ${envelope.ev.description}${envelope.ev.taskType ? ` (${envelope.ev.taskType})` : ""}${envelope.ev.workflowName ? ` — ${envelope.ev.workflowName}` : ""}`,
          uuid: contentUUID,
          parentUUID,
        },
      ],
      meta,
      taskStartInfo: {
        taskId: envelope.ev.taskId,
        toolUseId: envelope.ev.toolUseId ?? null,
        description: envelope.ev.description,
        taskType: envelope.ev.taskType ?? null,
      },
    } satisfies NormalizedMessage;
  }

  if (envelope.ev.t === "task-progress") {
    // Only emit when there's an AI summary (~30s interval).
    // Progress events without summary carry only a description update,
    // which is redundant with task-start — skip them entirely.
    if (!envelope.ev.summary) return null;
    const usage = envelope.ev.usage;
    const metricsParts: string[] = [];
    if (usage) {
      const durationStr = usage.durationMs >= 60000
        ? `${Math.floor(usage.durationMs / 60000)}m ${Math.round((usage.durationMs % 60000) / 1000)}s`
        : `${Math.round(usage.durationMs / 1000)}s`;
      const tokenStr = usage.totalTokens >= 1000
        ? `${(usage.totalTokens / 1000).toFixed(1)}K`
        : String(usage.totalTokens);
      metricsParts.push(durationStr, `${tokenStr} tokens`);
      if (usage.toolUses > 0) {
        metricsParts.push(`${usage.toolUses} tools`);
      }
    }
    const metricsLine = metricsParts.length > 0 ? `\n_${metricsParts.join(" · ")}_` : "";
    return {
      id: messageId,
      localId,
      createdAt: messageCreatedAt,
      role: "agent",
      isSidechain,
      content: [
        {
          type: "text",
          text: `⏳ ${envelope.ev.summary}${metricsLine}`,
          uuid: contentUUID,
          parentUUID,
        },
      ],
      meta,
      taskProgressInfo: {
        taskId: envelope.ev.taskId,
        description: envelope.ev.description,
        summary: envelope.ev.summary!,
      },
    } satisfies NormalizedMessage;
  }

  if (envelope.ev.t === "task-end") {
    const statusIcon =
      envelope.ev.status === "completed"
        ? "✓"
        : envelope.ev.status === "failed"
          ? "✗"
          : "■";
    return {
      id: messageId,
      localId,
      createdAt: messageCreatedAt,
      role: "agent",
      isSidechain,
      content: [
        {
          type: "text",
          text: `${statusIcon} **Task ${envelope.ev.status}:** ${envelope.ev.summary}`,
          uuid: contentUUID,
          parentUUID,
        },
      ],
      meta,
      taskEndInfo: {
        taskId: envelope.ev.taskId,
        status: envelope.ev.status,
      },
    } satisfies NormalizedMessage;
  }

  if (envelope.ev.t === "tool-progress") {
    // Tool progress updates — skip to avoid flooding chat
    return null;
  }

  if (envelope.ev.t === "turn-end") {
    return {
      id: messageId,
      localId,
      createdAt: messageCreatedAt,
      role: "event",
      isSidechain,
      ...(isSidechain ? { parentRef: parentUUID } : {}),
      content: {
        type: "ready",
        ...(envelope.ev.model !== undefined
          ? { model: envelope.ev.model }
          : {}),
        ...(envelope.ev.usage !== undefined
          ? { usage: envelope.ev.usage }
          : {}),
        ...(envelope.ev.durationMs !== undefined
          ? { durationMs: envelope.ev.durationMs }
          : {}),
        ...(envelope.ev.totalCostUsd !== undefined
          ? { totalCostUsd: envelope.ev.totalCostUsd }
          : {}),
        ...(envelope.ev.modelUsage !== undefined
          ? { modelUsage: envelope.ev.modelUsage }
          : {}),
      },
      meta,
    } satisfies NormalizedMessage;
  }

  if (envelope.ev.t === "usage-update") {
    return {
      id: messageId,
      localId,
      createdAt: messageCreatedAt,
      role: "event",
      isSidechain,
      ...(isSidechain ? { parentRef: parentUUID } : {}),
      content: {
        type: "usage-stats",
        ...(envelope.ev.model !== undefined
          ? { model: envelope.ev.model }
          : {}),
        usage: envelope.ev.usage,
        ...(envelope.ev.durationMs !== undefined
          ? { durationMs: envelope.ev.durationMs }
          : {}),
      },
      meta,
    } satisfies NormalizedMessage;
  }

  if (envelope.ev.t === "context-usage") {
    return {
      id: messageId,
      localId,
      createdAt: messageCreatedAt,
      role: "event",
      isSidechain,
      content: {
        type: "context-usage",
        totalTokens: envelope.ev.totalTokens,
        maxTokens: envelope.ev.maxTokens,
        percentage: envelope.ev.percentage,
        ...(envelope.ev.model !== undefined ? { model: envelope.ev.model } : {}),
        ...(envelope.ev.categories !== undefined ? { categories: envelope.ev.categories } : {}),
        ...(envelope.ev.isAutoCompactEnabled !== undefined ? { isAutoCompactEnabled: envelope.ev.isAutoCompactEnabled } : {}),
        ...(envelope.ev.autoCompactThreshold !== undefined ? { autoCompactThreshold: envelope.ev.autoCompactThreshold } : {}),
        ...(envelope.ev.messageBreakdown !== undefined ? { messageBreakdown: envelope.ev.messageBreakdown } : {}),
      },
      meta,
    } satisfies NormalizedMessage;
  }

  if (envelope.ev.t === "service") {
    if (envelope.role !== "agent") {
      return null;
    }

    return {
      id: messageId,
      localId,
      createdAt: messageCreatedAt,
      role: "agent",
      isSidechain,
      content: [
        {
          type: "text",
          text: envelope.ev.text,
          uuid: contentUUID,
          parentUUID,
        },
      ],
      meta,
    } satisfies NormalizedMessage;
  }

  if (envelope.ev.t === "text") {
    if (envelope.role === "user") {
      if (!isSessionProtocolSendEnabled()) {
        return null;
      }

      return {
        id: messageId,
        localId,
        createdAt: messageCreatedAt,
        role: "user",
        isSidechain: false,
        content: {
          type: "text",
          text: envelope.ev.text,
        },
        meta,
      } satisfies NormalizedMessage;
    }

    return {
      id: messageId,
      localId,
      createdAt: messageCreatedAt,
      role: "agent",
      isSidechain,
      content: [
        envelope.ev.thinking
          ? {
              type: "thinking",
              thinking: envelope.ev.text,
              uuid: contentUUID,
              parentUUID,
            }
          : {
              type: "text",
              text: envelope.ev.text,
              uuid: contentUUID,
              parentUUID,
            },
      ],
      meta,
    } satisfies NormalizedMessage;
  }

  if (envelope.ev.t === "tool-call-start") {
    return {
      id: messageId,
      localId,
      createdAt: messageCreatedAt,
      role: "agent",
      isSidechain,
      content: [
        {
          type: "tool-call",
          id: envelope.ev.call,
          name: envelope.ev.name || "unknown",
          input: envelope.ev.args,
          description: envelope.ev.description,
          uuid: contentUUID,
          parentUUID,
        },
      ],
      meta,
    } satisfies NormalizedMessage;
  }

  if (envelope.ev.t === "tool-call-end") {
    return {
      id: messageId,
      localId,
      createdAt: messageCreatedAt,
      role: "agent",
      isSidechain,
      content: [
        {
          type: "tool-result",
          tool_use_id: envelope.ev.call,
          content: null,
          is_error: false,
          uuid: contentUUID,
          parentUUID,
          backgroundTaskId: envelope.ev.backgroundTaskId,
          outputFile: envelope.ev.outputFile,
        },
      ],
      meta,
    } satisfies NormalizedMessage;
  }

  if (envelope.ev.t === "file") {
    const maybeImageMetadata = envelope.ev.image
      ? {
          image: {
            width: envelope.ev.image.width,
            height: envelope.ev.image.height,
            thumbhash: envelope.ev.image.thumbhash,
          },
        }
      : {};

    return {
      id: messageId,
      localId,
      createdAt: messageCreatedAt,
      role: "agent",
      isSidechain,
      content: [
        {
          type: "tool-call",
          id: messageId,
          name: "file",
          input: {
            ref: envelope.ev.ref,
            name: envelope.ev.name,
            size: envelope.ev.size,
            ...maybeImageMetadata,
          },
          description: envelope.ev.image
            ? `Attached image: ${envelope.ev.name} (${envelope.ev.image.width}x${envelope.ev.image.height})`
            : `Attached file: ${envelope.ev.name}`,
          uuid: contentUUID,
          parentUUID,
        },
      ],
      meta,
    } satisfies NormalizedMessage;
  }

  if (envelope.ev.t === "session-state-changed") {
    // Session state changes are lifecycle signals, not chat messages.
    // They are extracted separately via extractSessionStateFromRaw().
    return null;
  }

  if (envelope.ev.t === "prompt-suggestion") {
    // Prompt suggestions are side-channel signals, not chat messages.
    // They are extracted separately via extractPromptSuggestionFromRaw().
    return null;
  }

  return null;
}

/**
 * Extract a prompt suggestion from a raw record, if present.
 * Returns the suggestion text or null if the record is not a prompt-suggestion event.
 */
export function extractPromptSuggestionFromRaw(
  raw: RawRecord | null | undefined,
): string | null {
  if (!raw) return null;
  // Session protocol envelope can arrive via two paths:
  // 1. raw.role === "session" → raw.content.data is the envelope
  // 2. raw.role === "agent" && raw.content.type === "session" → raw.content.data is the envelope
  let envelope: any = null;
  if (raw.role === "session" && raw.content?.data) {
    envelope = raw.content.data;
  } else if (
    raw.role === "agent" &&
    raw.content?.type === "session" &&
    raw.content?.data
  ) {
    envelope = raw.content.data;
  }
  if (
    envelope?.ev?.t === "prompt-suggestion" &&
    typeof envelope.ev.suggestion === "string"
  ) {
    return envelope.ev.suggestion;
  }
  return null;
}

/**
 * Extract a needs-continue signal from a raw record.
 * Returns true when the agent signals that max turns was reached
 * and the user can choose to continue.
 */
export function extractNeedsContinueFromRaw(
  raw: RawRecord | null | undefined,
): boolean {
  if (!raw) return false;
  let envelope: any = null;
  if (raw.role === "session" && raw.content?.data) {
    envelope = raw.content.data;
  } else if (
    raw.role === "agent" &&
    raw.content?.type === "session" &&
    raw.content?.data
  ) {
    envelope = raw.content.data;
  }
  return envelope?.ev?.t === "needs-continue";
}

/**
 * Extract SDK session state from a raw record.
 * Returns the authoritative session lifecycle state (idle/running/requires_action)
 * or null if the record is not a session-state-changed event.
 */
export function extractSessionStateFromRaw(
  raw: RawRecord | null | undefined,
): "idle" | "running" | "requires_action" | null {
  if (!raw) return null;
  let envelope: any = null;
  if (raw.role === "session" && raw.content?.data) {
    envelope = raw.content.data;
  } else if (
    raw.role === "agent" &&
    raw.content?.type === "session" &&
    raw.content?.data
  ) {
    envelope = raw.content.data;
  }
  if (
    envelope?.ev?.t === "session-state-changed" &&
    typeof envelope.ev.state === "string"
  ) {
    return envelope.ev.state as "idle" | "running" | "requires_action";
  }
  return null;
}

/**
 * Extract displayable text from tool result content blocks.
 * Handles text, image, and unknown block types gracefully.
 */
function extractToolResultText(
  contentBlocks: Array<Record<string, unknown>>,
): string {
  const parts: string[] = [];
  for (const block of contentBlocks) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block.type === "image") {
      parts.push("[image]");
    }
  }
  return parts.join("\n") || "[tool result]";
}

export function normalizeRawMessage(
  id: string,
  localId: string | null,
  createdAt: number,
  raw: RawRecord,
): NormalizedMessage | null {
  // Zod transform handles normalization during validation
  let parsed = rawRecordSchema.safeParse(raw);
  if (!parsed.success) {
    log.error("=== VALIDATION ERROR ===");
    log.error("Zod issues:", JSON.stringify(parsed.error.issues, null, 2));
    log.error("Raw message:", JSON.stringify(raw, null, 2));
    log.error("=== END ERROR ===");
    return null;
  }
  raw = parsed.data;
  if (raw.role === "user") {
    if (isSessionProtocolSendEnabled()) {
      return null;
    }

    return {
      id,
      localId,
      createdAt,
      role: "user",
      content: raw.content,
      isSidechain: false,
      meta: raw.meta,
    };
  }
  if (raw.role === "session") {
    return normalizeSessionEnvelope(
      raw.content.data,
      localId,
      createdAt,
      raw.meta,
    );
  }
  if (raw.role === "agent") {
    if (raw.content.type === "output") {
      // Skip Meta messages
      if (raw.content.data.isMeta) {
        return null;
      }

      // Skip compact summary messages
      if (raw.content.data.isCompactSummary) {
        return null;
      }

      // Handle Assistant messages (including sidechains)
      if (raw.content.data.type === "assistant") {
        if (!raw.content.data.uuid) {
          return null;
        }
        let content: NormalizedAgentContent[] = [];
        for (let c of raw.content.data.message.content) {
          if (c.type === "text") {
            content.push({
              ...c, // WOLOG: Preserve all fields including unknown ones
              uuid: raw.content.data.uuid,
              parentUUID: raw.content.data.parentUuid ?? null,
            } as NormalizedAgentContent);
          } else if (c.type === "thinking") {
            content.push({
              ...c, // WOLOG: Preserve all fields including unknown ones (signature, etc.)
              uuid: raw.content.data.uuid,
              parentUUID: raw.content.data.parentUuid ?? null,
            } as NormalizedAgentContent);
          } else if (c.type === "tool_use") {
            let description: string | null = null;
            if (
              typeof c.input === "object" &&
              c.input !== null &&
              "description" in c.input &&
              typeof c.input.description === "string"
            ) {
              description = c.input.description;
            }
            content.push({
              ...c, // WOLOG: Preserve all fields including unknown ones
              type: "tool-call",
              description,
              uuid: raw.content.data.uuid,
              parentUUID: raw.content.data.parentUuid ?? null,
            } as NormalizedAgentContent);
          }
        }
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: raw.content.data.isSidechain ?? false,
          content,
          meta: raw.meta,
          usage: raw.content.data.message.usage,
        };
      } else if (raw.content.data.type === "user") {
        if (!raw.content.data.uuid) {
          return null;
        }

        // Handle sidechain user messages
        if (
          raw.content.data.isSidechain &&
          raw.content.data.message &&
          typeof raw.content.data.message.content === "string"
        ) {
          // Return as a special agent message with sidechain content
          return {
            id,
            localId,
            createdAt,
            role: "agent",
            isSidechain: true,
            content: [
              {
                type: "sidechain",
                uuid: raw.content.data.uuid,
                prompt: raw.content.data.message.content,
              },
            ],
          };
        }

        // Handle regular user messages
        if (
          raw.content.data.message &&
          typeof raw.content.data.message.content === "string"
        ) {
          return {
            id,
            localId,
            createdAt,
            role: "user",
            isSidechain: false,
            content: {
              type: "text",
              text: raw.content.data.message.content,
            },
          };
        }

        // Handle tool results
        let content: NormalizedAgentContent[] = [];
        if (typeof raw.content.data.message.content === "string") {
          content.push({
            type: "text",
            text: raw.content.data.message.content,
            uuid: raw.content.data.uuid,
            parentUUID: raw.content.data.parentUuid ?? null,
          });
        } else {
          for (let c of raw.content.data.message.content) {
            if (c.type === "tool_result") {
              content.push({
                ...c, // WOLOG: Preserve all fields including unknown ones
                type: "tool-result",
                content: raw.content.data.toolUseResult
                  ? raw.content.data.toolUseResult
                  : typeof c.content === "string"
                    ? c.content
                    : extractToolResultText(c.content),
                is_error: c.is_error || false,
                uuid: raw.content.data.uuid,
                parentUUID: raw.content.data.parentUuid ?? null,
                permissions: c.permissions
                  ? {
                      date: c.permissions.date,
                      result: c.permissions.result,
                      mode: c.permissions.mode,
                      allowedTools: c.permissions.allowedTools,
                      decision: c.permissions.decision,
                    }
                  : undefined,
              } as NormalizedAgentContent);
            }
          }
        }
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: raw.content.data.isSidechain ?? false,
          content,
          meta: raw.meta,
        };
      }
    }
    if (raw.content.type === "event") {
      return {
        id,
        localId,
        createdAt,
        role: "event",
        content: raw.content.data,
        isSidechain: false,
      };
    }
    if (raw.content.type === "codex") {
      if (raw.content.data.type === "message") {
        // Cast codex messages to agent text messages
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: false,
          content: [
            {
              type: "text",
              text: raw.content.data.message,
              uuid: id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        };
      }
      if (raw.content.data.type === "reasoning") {
        // Cast codex messages to agent text messages
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: false,
          content: [
            {
              type: "text",
              text: raw.content.data.message,
              uuid: id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === "tool-call") {
        // Cast tool calls to agent tool-call messages
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: false,
          content: [
            {
              type: "tool-call",
              id: raw.content.data.callId,
              name: raw.content.data.name || "unknown",
              input: raw.content.data.input,
              description: null,
              uuid: raw.content.data.id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === "tool-call-result") {
        // Cast tool call results to agent tool-result messages
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: false,
          content: [
            {
              type: "tool-result",
              tool_use_id: raw.content.data.callId,
              content: raw.content.data.output,
              is_error: false,
              uuid: raw.content.data.id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
    }
    if (raw.content.type === "session") {
      return normalizeSessionEnvelope(
        raw.content.data,
        localId,
        createdAt,
        raw.meta,
      );
    }
    // ACP (Agent Communication Protocol) - unified format for all agent providers
    if (raw.content.type === "acp") {
      if (raw.content.data.type === "message") {
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: false,
          content: [
            {
              type: "text",
              text: raw.content.data.message,
              uuid: id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === "reasoning") {
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: false,
          content: [
            {
              type: "text",
              text: raw.content.data.message,
              uuid: id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === "tool-call") {
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: false,
          content: [
            {
              type: "tool-call",
              id: raw.content.data.callId,
              name: raw.content.data.name || "unknown",
              input: raw.content.data.input,
              description: null,
              uuid: raw.content.data.id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === "tool-result") {
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: false,
          content: [
            {
              type: "tool-result",
              tool_use_id: raw.content.data.callId,
              content: raw.content.data.output,
              is_error: raw.content.data.isError ?? false,
              uuid: raw.content.data.id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      // Handle hyphenated tool-call-result (backwards compatibility)
      if (raw.content.data.type === "tool-call-result") {
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: false,
          content: [
            {
              type: "tool-result",
              tool_use_id: raw.content.data.callId,
              content: raw.content.data.output,
              is_error: false,
              uuid: raw.content.data.id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === "thinking") {
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: false,
          content: [
            {
              type: "thinking",
              thinking: raw.content.data.text,
              uuid: id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === "file-edit") {
        // Map file-edit to tool-call for UI rendering
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: false,
          content: [
            {
              type: "tool-call",
              id: raw.content.data.id,
              name: "file-edit",
              input: {
                filePath: raw.content.data.filePath,
                description: raw.content.data.description,
                diff: raw.content.data.diff,
                oldContent: raw.content.data.oldContent,
                newContent: raw.content.data.newContent,
              },
              description: raw.content.data.description,
              uuid: raw.content.data.id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === "terminal-output") {
        // Map terminal-output to tool-result
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: false,
          content: [
            {
              type: "tool-result",
              tool_use_id: raw.content.data.callId,
              content: raw.content.data.data,
              is_error: false,
              uuid: id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      if (raw.content.data.type === "permission-request") {
        // Map permission-request to tool-call for UI to show permission dialog
        return {
          id,
          localId,
          createdAt,
          role: "agent",
          isSidechain: false,
          content: [
            {
              type: "tool-call",
              id: raw.content.data.permissionId,
              name: raw.content.data.toolName,
              input: raw.content.data.options ?? {},
              description: raw.content.data.description,
              uuid: id,
              parentUUID: null,
            },
          ],
          meta: raw.meta,
        } satisfies NormalizedMessage;
      }
      // Task lifecycle events (task_started, task_complete, turn_aborted) and token_count
      // are status/metrics - skip normalization, they don't need UI rendering
    }
  }
  return null;
}
