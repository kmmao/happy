import { z } from "zod";
import type {
  ClaudeSlashCommand,
  CodexMetadata,
  SessionProgressState,
  SessionSummaryRefreshState,
  SessionSummaryState,
  Update,
} from "@kmmao/happy-wire";
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
  "knowledge-turn-end": (data: {
    sid: string;
    hitIds: string[];
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
  "fetch-world-config": (
    data: { sid: string },
    callback: (response: { narrative: string; laws: string; policy: string } | null) => void,
  ) => void;
  "task-log": (data: {
    sid: string;
    taskId: string;
    outputFile: string;
    chunk: string;
    offset: number;
  }) => void;
  "session:message": (data: {
    fromSessionId: string;
    toSessionId: string;
    message: string;
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
  DaemonState,
} from "@kmmao/happy-wire";

export const MachineMetadataSchema = _MachineMetadataSchema;
export const TailscaleInfoSchema = _TailscaleInfoSchema;
export const DaemonStateSchema = _DaemonStateSchema;
export type { MachineMetadata, TailscaleInfo, DaemonState } from "@kmmao/happy-wire";

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
  effort: z.enum(["low", "medium", "high", "max", "xhigh"]).nullable().optional(), // Effort level (null = reset)
  continue: z.boolean().optional(), // Continue from last conversation without new prompt (one-time flag)
  locale: z.string().optional(), // User's preferred UI language (e.g. 'en', 'zh-Hans', 'ja')
  shouldQuery: z.boolean().optional(), // When false, append message without triggering assistant turn (SDK 0.2.110+)
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
  /**
   * Live progress state surfaced in the App's Progress tab.
   *
   * Two write paths:
   *   1. CLI auto-mirror hook (claudeRemoteLauncher onMessage) — watches
   *      SDK's TodoWrite tool_result and writes to the current list.
   *   2. MCP `update_progress` tool — optional Agent-driven writes for
   *      richer fields (stage, blockers, explicit listId).
   *
   * Legacy top-level `todos` is kept in sync with `lists[currentListId]`
   * so older readers still see a flat checklist.
   */
  progress?: SessionProgressState;
  /**
   * Narrative session summary written by the Agent via the MCP
   * `update_session_summary` tool at milestones.
   */
  sessionSummary?: SessionSummaryState;
  /**
   * Request-level state for narrative summary refresh confirmation.
   */
  sessionSummaryRefresh?: SessionSummaryRefreshState;
  machineId?: string;
  /**
   * Automation provenance written when the daemon spawned this Session as
   * part of an automation (loop / supervisor / webhook / task). Mirrors
   * the `SpawnSessionOptions.automationContext` field — the daemon
   * serializes it into the `HAPPY_AUTOMATION_CONTEXT_JSON` env var so the
   * child happy process can reconstruct it here verbatim without each
   * runner having to inject its own env vars.
   *
   * Consumed by the Workflow IA in happy-app to group these Sessions
   * under their owning Loop / Schedule / Webhook row (see
   * `useWorkflows`). Absent on manually-started Sessions
   * (`startedBy === "terminal"`).
   */
  automationContext?: {
    kind: "supervisor" | "webhook" | "agent_loop" | "task";
    trigger?: string;
    projectId?: string;
    runId?: string;
    loopId?: string;
    dedupeKey?: string;
  };
  claudeSessionId?: string; // Claude Code session ID
  tools?: string[];
  slashCommands?: string[];
  slashCommandDescriptions?: Record<string, string>;
  /**
   * Slash commands with origin/source info — supersedes `slashCommands` +
   * `slashCommandDescriptions`. Older Apps fall back to the flat fields above;
   * newer Apps consume this list and group the popover by source.
   * See `claudeLocalCommands.ts` for collection logic.
   */
  slashCommandsRich?: ClaudeSlashCommand[];
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
  codex?: CodexMetadata;
  sandbox?: SandboxConfig | null;
  dangerouslySkipPermissions?: boolean | null;
  packageScripts?: Record<string, string>;
  displayName?: string;
  tags?: string[];
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
  /**
   * Live working directory reported by Claude's CwdChanged hook (Claude Code
   * 2.1.121+). Differs from `path`, which is the cwd Claude was launched in
   * and never changes. Absent when no CwdChanged event has fired —
   * consumers should fall back to `path` in that case.
   */
  activeCwd?: string;
  /**
   * Latest WorktreeCreate / WorktreeRemove event from Claude Code 2.1.157+.
   *
   * The two hook inputs are asymmetric — Create only carries `name`
   * (the worktree path is in the SDK's hookSpecificOutput which command
   * hooks don't see), Remove only carries `worktree_path`. We surface
   * whichever fields the event provided and let the App render. Absent
   * until the first event fires. Distinct from `worktree` above, which
   * describes a Happy-managed worktree created via `happy worktree create`.
   */
  lastWorktreeEvent?: {
    kind: "create" | "remove";
    name?: string;
    path?: string;
    at: number;
  };
  /**
   * Ring buffer of the most recent FileChanged events from Claude Code
   * 2.1.121+. Capped at 20 entries to keep the encrypted-metadata payload
   * bounded — FileChanged can fire on every editor save. Most recent first.
   */
  recentFileChanges?: Array<{
    filePath: string;
    event: "change" | "add" | "unlink";
    at: number;
  }>;
  /**
   * Ring buffer of tool calls denied by Claude Code's permission system
   * (PermissionDenied hook, claude-code 2.1.157+). Capped at 10 — denials are
   * sparser than file changes. Most recent first. Distinct from AgentState's
   * permission *requests*, which are Happy's own MCP-driven approval prompts;
   * these are denials Claude made internally (deny rules, plan mode, etc.).
   */
  recentPermissionDenials?: Array<{
    toolName: string;
    reason: string;
    at: number;
  }>;
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
