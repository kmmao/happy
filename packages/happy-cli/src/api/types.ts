import { z } from "zod";
import type { Update, UpdateMachineBody } from "@kmmao/happy-wire";
import { UsageSchema } from "@/claude/types";
import type { SandboxConfig } from "@/persistence";

export {
  SessionMessageContentSchema,
  SessionMessageSchema,
  UpdateBodySchema,
  UpdateMachineBodySchema,
  UpdateSchema,
  UpdateSessionBodySchema,
} from "@kmmao/happy-wire";
export type {
  SessionMessage,
  SessionMessageContent,
  Update,
  UpdateBody,
  UpdateMachineBody,
  UpdateSessionBody,
} from "@kmmao/happy-wire";

/**
 * Permission mode type - includes both Claude and Codex modes
 * Must match MessageMetaSchema.permissionMode enum values
 *
 * Claude modes: default, acceptEdits, bypassPermissions, plan
 * Codex modes: read-only, safe-yolo, yolo
 *
 * When calling Claude SDK, Codex modes are mapped at the SDK boundary:
 * - yolo → bypassPermissions
 * - safe-yolo → default
 * - read-only → default
 */
export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk"
  | "auto"
  | "read-only"
  | "safe-yolo"
  | "yolo";

/**
 * Usage data type from Claude
 */
export type Usage = z.infer<typeof UsageSchema>;

/**
 * Socket events from server to client
 */
export interface ServerToClientEvents {
  update: (data: Update) => void;
  "rpc-request": (
    data: { method: string; params: string },
    callback: (response: string) => void,
  ) => void;
  "rpc-registered": (data: { method: string }) => void;
  "rpc-unregistered": (data: { method: string }) => void;
  "rpc-error": (data: { type: string; error: string }) => void;
  ephemeral: (
    data:
      | {
          type: "activity";
          id: string;
          active: boolean;
          activeAt: number;
          thinking: boolean;
        }
      | {
          type: "webhook-trigger";
          webhookEventId: string;
          issueNumber: number;
          issueTitle: string;
          issueBody: string;
          issueAuthor: string;
          issueLabels: string[];
          issueUrl: string;
          repoUrl: string;
          repoPath: string;
          provider: string;
        }
      | {
          type: "supervisor-trigger";
          projectId: string;
          runId: string;
          trigger: string;
          machineId: string;
          repoPath: string;
        },
  ) => void;
  auth: (data: { success: boolean; user: string }) => void;
  error: (data: { message: string }) => void;
}

/**
 * Socket events from client to server
 */
export interface ClientToServerEvents {
  message: (data: { sid: string; message: any }) => void;
  "session-alive": (data: {
    sid: string;
    time: number;
    thinking: boolean;
    mode?: "local" | "remote";
    apiRetry?: {
      attempt: number;
      maxRetries: number;
      retryDelayMs: number;
      errorStatus: number | null;
    };
  }) => void;
  "session-end": (data: { sid: string; time: number }) => void;
  "session-event": (data: {
    sessionId: string;
    eventType: string;
    summary: string;
    detail?: Record<string, unknown>;
  }) => void;
  "update-metadata": (
    data: { sid: string; expectedVersion: number; metadata: string },
    cb: (
      answer:
        | {
            result: "error";
          }
        | {
            result: "version-mismatch";
            version: number;
            metadata: string;
          }
        | {
            result: "success";
            version: number;
            metadata: string;
          },
    ) => void,
  ) => void;
  "update-state": (
    data: { sid: string; expectedVersion: number; agentState: string | null },
    cb: (
      answer:
        | {
            result: "error";
          }
        | {
            result: "version-mismatch";
            version: number;
            agentState: string | null;
          }
        | {
            result: "success";
            version: number;
            agentState: string | null;
          },
    ) => void,
  ) => void;
  ping: (callback: () => void) => void;
  "rpc-register": (data: { method: string }) => void;
  "rpc-unregister": (data: { method: string }) => void;
  "rpc-call": (
    data: { method: string; params: string },
    callback: (response: {
      ok: boolean;
      result?: string;
      error?: string;
    }) => void,
  ) => void;
  "usage-report": (data: {
    key: string;
    sessionId: string;
    tokens: {
      total: number;
      [key: string]: number;
    };
    cost: {
      total: number;
      [key: string]: number;
    };
  }) => void;
  "webhook-status": (data: {
    webhookEventId: string;
    status: "dispatched" | "completed" | "failed";
    sessionId?: string;
    errorMessage?: string;
  }) => void;
  "supervisor-run-status": (data: {
    runId: string;
    projectId: string;
    status: "running" | "completed" | "failed";
    sessionId?: string;
    actionsCount?: number;
    issuesCreated?: number;
    errorMessage?: string;
    actions?: readonly {
      severity: "critical" | "high" | "medium" | "low";
      category: string;
      title: string;
      description: string;
      suggestedFix?: string;
    }[];
  }) => void;
  "submit-knowledge": (data: {
    sid: string;
    entry: {
      entryType: string;
      contributorType: string;
      action: string;
      title: string;
      content: string;
      request?: string;
      outcome?: string;
      tags: string[];
      confidence: string;
      model?: string;
      affectedFiles: string[];
    };
  }) => void;
  "fetch-knowledge": (
    data: {
      sid: string;
      mode: "auto" | "full" | "minimal";
      contextHints?: string[];
    },
    callback: (response: {
      profile: {
        techStack: string[];
        architectureType?: string;
        knownPitfalls: string[];
        coreConventions: string[];
        lastUpdatedAt: number;
      } | null;
      entries: {
        id: string;
        entryType: string;
        title: string;
        content: string;
        tags: string[];
        confidence: string;
        createdAt: string;
      }[];
    }) => void,
  ) => void;
  "task-log": (data: {
    sid: string;
    taskId: string;
    outputFile: string;
    chunk: string;
    offset: number;
  }) => void;
}

/**
 * Session information
 */
export type Session = {
  id: string;
  seq: number;
  encryptionKey: Uint8Array;
  encryptionVariant: "legacy" | "dataKey";
  metadata: Metadata;
  metadataVersion: number;
  agentState: AgentState | null;
  agentStateVersion: number;
};

// Machine types — shared via @kmmao/happy-wire
import {
  MachineMetadataSchema as _MachineMetadataSchema,
  TailscaleInfoSchema as _TailscaleInfoSchema,
  DaemonStateSchema as _DaemonStateSchema,
} from "@kmmao/happy-wire";
import type {
  MachineMetadata,
  TailscaleInfo,
  DaemonState,
} from "@kmmao/happy-wire";

export const MachineMetadataSchema = _MachineMetadataSchema;
export const TailscaleInfoSchema = _TailscaleInfoSchema;
export const DaemonStateSchema = _DaemonStateSchema;
export type { MachineMetadata, TailscaleInfo, DaemonState };

export type Machine = {
  id: string;
  encryptionKey: Uint8Array;
  encryptionVariant: "legacy" | "dataKey";
  metadata: MachineMetadata;
  metadataVersion: number;
  daemonState: DaemonState | null;
  daemonStateVersion: number;
};

/**
 * Message metadata schema
 */
export const MessageMetaSchema = z.object({
  sentFrom: z.string().optional(), // Source identifier
  permissionMode: z
    .enum([
      "default",
      "acceptEdits",
      "bypassPermissions",
      "plan",
      "dontAsk",
      "auto",
      "read-only",
      "safe-yolo",
      "yolo",
    ])
    .optional(), // Permission mode for this message
  model: z.string().nullable().optional(), // Model name for this message (null = reset)
  fallbackModel: z.string().nullable().optional(), // Fallback model for this message (null = reset)
  customSystemPrompt: z.string().nullable().optional(), // Custom system prompt for this message (null = reset)
  appendSystemPrompt: z.string().nullable().optional(), // Append to system prompt for this message (null = reset)
  allowedTools: z.array(z.string()).nullable().optional(), // Allowed tools for this message (null = reset)
  disallowedTools: z.array(z.string()).nullable().optional(), // Disallowed tools for this message (null = reset)
  maxBudgetUsd: z.number().nullable().optional(), // Maximum USD budget for this session (null = reset)
  taskBudget: z.object({ total: z.number() }).nullable().optional(), // Task token budget (alpha)
  thinking: z
    .object({
      type: z.enum(["adaptive", "enabled", "disabled"]),
      budgetTokens: z.number().optional(),
    })
    .nullable()
    .optional(), // Thinking/reasoning behavior (null = reset)
  effort: z.enum(["low", "medium", "high", "max"]).nullable().optional(), // Effort level (null = reset)
  continue: z.boolean().optional(), // Continue from last conversation without new prompt (one-time flag)
  locale: z.string().optional(), // User's preferred UI language (e.g. 'en', 'zh-Hans', 'ja')
});

export type MessageMeta = z.infer<typeof MessageMetaSchema>;

/**
 * API response types
 */
export const CreateSessionResponseSchema = z.object({
  session: z.object({
    id: z.string(),
    tag: z.string(),
    seq: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
    metadata: z.string(),
    metadataVersion: z.number(),
    agentState: z.string().nullable(),
    agentStateVersion: z.number(),
  }),
});

export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

export const UserMessageSchema = z.object({
  role: z.literal("user"),
  content: z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  localKey: z.string().optional(), // Mobile messages include this
  meta: MessageMetaSchema.optional(),
});

export type UserMessage = z.infer<typeof UserMessageSchema>;

export const AgentMessageSchema = z.object({
  role: z.literal("agent"),
  content: z.object({
    type: z.literal("output"),
    data: z.any(),
  }),
  meta: MessageMetaSchema.optional(),
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const MessageContentSchema = z.union([
  UserMessageSchema,
  AgentMessageSchema,
]);

export type MessageContent = z.infer<typeof MessageContentSchema>;

export type Metadata = {
  /**
   * ACP session config option value (normalized for UI metadata consumers).
   */
  // `code` = protocol value ID, `value` = human label
  models?: Array<{
    code: string;
    value: string;
    description?: string | null;
    supportsEffort?: boolean | null;
    supportedEffortLevels?: string[] | null;
    supportsAdaptiveThinking?: boolean | null;
  }>;
  currentModelCode?: string;
  operatingModes?: Array<{
    code: string;
    value: string;
    description?: string | null;
  }>;
  currentOperatingModeCode?: string;
  thoughtLevels?: Array<{
    code: string;
    value: string;
    description?: string | null;
  }>;
  currentThoughtLevelCode?: string;
  path: string;
  host: string;
  version?: string;
  name?: string;
  os?: string;
  summary?: {
    text: string;
    updatedAt: number;
  };
  machineId?: string;
  claudeSessionId?: string; // Claude Code session ID
  tools?: string[];
  slashCommands?: string[];
  slashCommandDescriptions?: Record<string, string>;
  homeDir: string;
  happyHomeDir: string;
  happyLibDir: string;
  happyToolsDir: string;
  startedFromDaemon?: boolean;
  hostPid?: number;
  startedBy?: "daemon" | "terminal";
  // Lifecycle state management
  lifecycleState?: "running" | "archiveRequested" | "archived" | string;
  lifecycleStateSince?: number;
  archivedBy?: string;
  archiveReason?: string;
  flavor?: string;
  codex?: {
    requestedBackend?: "auto" | "codex-app-server" | "codex-mcp-legacy";
    resolvedBackend?: "codex-app-server" | "codex-mcp-legacy";
    configMode?: "inherit" | "managed-profile" | "managed-overrides";
    fallbackReason?: string;
    backendVersion?: string;
    threadId?: string;
    config?: {
      model?: string | null;
      profile?: string | null;
      approvalPolicy?: string | null;
      sandboxMode?: string | null;
      serviceTier?: string | null;
      reasoningEffort?: string | null;
      reasoningSummary?: string | null;
      verbosity?: string | null;
      webSearch?: string | null;
    };
    account?: {
      type?: "apiKey" | "chatgpt" | null;
      email?: string | null;
      planType?: string | null;
      requiresOpenaiAuth?: boolean;
    };
    rateLimits?: {
      limitId?: string | null;
      limitName?: string | null;
      planType?: string | null;
      hasCredits?: boolean;
    };
    experimentalFeatures?: Array<{
      name: string;
      stage: string;
      enabled: boolean;
      defaultEnabled: boolean;
    }>;
    skills?: Array<{
      name: string;
      description: string;
      path: string;
      enabled: boolean;
    }>;
    prompts?: Array<{
      name: string;
      path: string;
      description?: string | null;
    }>;
    agents?: Array<{
      name: string;
      path: string;
    }>;
    mcpServers?: Array<{
      name: string;
      authStatus: string;
      toolCount: number;
    }>;
  };
  sandbox?: SandboxConfig | null;
  dangerouslySkipPermissions?: boolean | null;
  packageScripts?: Record<string, string>;
  worktree?: {
    isWorktree: boolean;
    name: string;
    branchName: string;
    worktreePath: string;
    parentRepoPath: string;
    parentBranch: string;
    state:
      | "creating"
      | "active"
      | "merging"
      | "merged"
      | "cleaning"
      | "cleaned"
      | "error";
    stateChangedAt: number;
    mergeStrategy?: "pr" | "direct-merge";
    prUrl?: string;
    error?: string;
  };
};

export type AgentState = {
  controlledByUser?: boolean | null | undefined;
  requests?: {
    [id: string]: {
      tool: string;
      arguments: any;
      createdAt: number;
    };
  };
  completedRequests?: {
    [id: string]: {
      tool: string;
      arguments: any;
      createdAt: number;
      completedAt: number;
      status: "canceled" | "denied" | "approved";
      reason?: string;
      mode?: PermissionMode;
      decision?: "approved" | "approved_for_session" | "denied" | "abort";
      allowTools?: string[];
      answers?: Record<string, string>;
    };
  };
};
