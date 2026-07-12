import { z } from "zod";
import {
  ClaudeSlashCommandSchema,
  CodexMetadataSchema,
  MachineMetadataSchema as WireMachineMetadataSchema,
  sessionProgressStateSchema,
  sessionSummaryRefreshStateSchema,
  sessionSummaryStateSchema,
} from "@kmmao/happy-wire";

//
// Agent states
//

export const MetadataSchema = z.object({
  models: z
    .array(
      z.object({
        code: z.string(),
        value: z.string(),
        description: z.string().nullish(),
        supportsEffort: z.boolean().nullish(),
        supportedEffortLevels: z.array(z.string()).nullish(),
        supportsAdaptiveThinking: z.boolean().nullish(),
      }),
    )
    .optional(),
  currentModelCode: z.string().optional(),
  operatingModes: z
    .array(
      z.object({
        code: z.string(),
        value: z.string(),
        description: z.string().nullish(),
      }),
    )
    .optional(),
  currentOperatingModeCode: z.string().optional(),
  thoughtLevels: z
    .array(
      z.object({
        code: z.string(),
        value: z.string(),
        description: z.string().nullish(),
      }),
    )
    .optional(),
  currentThoughtLevelCode: z.string().optional(),
  path: z.string(),
  host: z.string(),
  version: z.string().optional(),
  name: z.string().optional(),
  os: z.string().optional(),
  summary: z
    .object({
      text: z.string(),
      updatedAt: z.number(),
    })
    .optional(),
  progress: sessionProgressStateSchema.optional(),
  sessionSummary: sessionSummaryStateSchema.optional(),
  sessionSummaryRefresh: sessionSummaryRefreshStateSchema.optional(),
  machineId: z.string().optional(),
  /**
   * Automation provenance stamped by the CLI daemon when this Session
   * was spawned as part of a Loop / Supervisor / Webhook / Task run.
   * Source of truth lives in happy-cli's Metadata type (api/types.ts);
   * mirrored here so safeParse keeps the field instead of stripping it.
   *
   * Consumed by `useWorkflows()` to group the Session under its owning
   * Workflow row (loop → loopId; scheduled/event → triggerRef).
   *
   * Absent for manually-started Sessions (startedBy === "terminal").
   */
  automationContext: z
    .object({
      kind: z.enum(["supervisor", "webhook", "agent_loop", "task"]),
      trigger: z.string().optional(),
      projectId: z.string().optional(),
      runId: z.string().optional(),
      loopId: z.string().optional(),
      triggerType: z.enum(["manual", "cron", "webhook"]).optional(),
      triggerRef: z.string().optional(),
      dedupeKey: z.string().optional(),
      adoptedAt: z.number().optional(),
    })
    .optional(),
  claudeSessionId: z.string().optional(),
  tools: z.array(z.string()).optional(),
  slashCommands: z.array(z.string()).optional(),
  slashCommandDescriptions: z.record(z.string(), z.string()).optional(),
  // Rich slash-command list with origin/source per entry. Newer CLIs emit
  // this alongside the flat `slashCommands` for back-compat with older Apps.
  // See `suggestionCommands.ts` for consumption.
  slashCommandsRich: z.array(ClaudeSlashCommandSchema).optional(),
  homeDir: z.string().optional(),
  happyHomeDir: z.string().optional(),
  hostPid: z.number().optional(),
  startedBy: z.enum(["daemon", "terminal"]).optional(),
  flavor: z.string().nullish(),
  codex: CodexMetadataSchema.optional(),
  sandbox: z.any().nullish(),
  dangerouslySkipPermissions: z.boolean().nullish(),
  packageScripts: z.record(z.string(), z.string()).optional(),
  displayName: z.string().optional(),
  tags: z.array(z.string()).optional(),
  worktree: z
    .object({
      isWorktree: z.boolean(),
      name: z.string(),
      branchName: z.string(),
      worktreePath: z.string(),
      parentRepoPath: z.string(),
      parentBranch: z.string(),
      state: z.enum([
        "creating",
        "active",
        "merging",
        "merged",
        "cleaning",
        "cleaned",
        "error",
      ]),
      stateChangedAt: z.number(),
      mergeStrategy: z.enum(["pr", "direct-merge"]).optional(),
      prUrl: z.string().optional(),
      error: z.string().optional(),
    })
    .optional(),
  // ── Live session-state hooks (Claude Code 2.1.121+ / 2.1.157+) ──────────
  // Written by happy-cli when Claude emits CwdChanged / Worktree* /
  // FileChanged hooks. Mirrors the CLI's Metadata schema in
  // packages/happy-cli/src/api/types.ts. All optional — sessions started
  // on older Claude CLIs simply won't carry them.
  activeCwd: z.string().optional(),
  lastWorktreeEvent: z
    .object({
      kind: z.enum(["create", "remove"]),
      name: z.string().optional(),
      path: z.string().optional(),
      at: z.number(),
    })
    .optional(),
  recentFileChanges: z
    .array(
      z.object({
        filePath: z.string(),
        event: z.enum(["change", "add", "unlink"]),
        at: z.number(),
      }),
    )
    .optional(),
  // Tool calls denied by Claude Code's permission system (PermissionDenied
  // hook, 2.1.157+). Mirrors the CLI Metadata schema. Capped at 10 by the CLI.
  // Distinct from AgentState permission requests (Happy's own MCP prompts).
  recentPermissionDenials: z
    .array(
      z.object({
        toolName: z.string(),
        reason: z.string(),
        at: z.number(),
      }),
    )
    .optional(),
});

export type Metadata = z.infer<typeof MetadataSchema>;

export const AgentGoalSourceSchema = z.enum(["claude", "codex"]);

export const AgentGoalProgressStepSchema = z
  .object({
    text: z.string().trim().min(1),
    status: z.enum(["pending", "in_progress", "completed"]),
  })
  .strict();

export const AgentGoalProgressSchema = z
  .object({
    currentStep: z.number().int().positive().optional(),
    totalSteps: z.number().int().positive().optional(),
    steps: z.array(AgentGoalProgressStepSchema).optional(),
  })
  .strict();

export const AgentGoalCapabilitiesSchema = z
  .object({
    clear: z.boolean().optional(),
    stop: z.boolean().optional(),
    edit: z.boolean().optional(),
  })
  .strict();

const AgentGoalStatusBaseSchema = z.object({
  source: AgentGoalSourceSchema,
  observedAt: z.number().int().nonnegative(),
  sourceSessionId: z.string().trim().min(1).optional(),
  sourceRevision: z.union([z.string().trim().min(1), z.number()]).optional(),
});

export const AgentGoalStatusSchema = z.discriminatedUnion("status", [
  AgentGoalStatusBaseSchema.extend({
    status: z.literal("unavailable"),
    reason: z
      .enum(["unsupported", "not_loaded", "stale", "malformed", "error", "unknown"])
      .optional(),
  }).strict(),
  AgentGoalStatusBaseSchema.extend({
    status: z.literal("inactive"),
    reason: z.enum(["none", "cleared", "completed", "unknown"]).optional(),
  }).strict(),
  AgentGoalStatusBaseSchema.extend({
    status: z.literal("active"),
    sourceSessionId: z.string().trim().min(1),
    text: z.string().trim().min(1),
    capabilities: AgentGoalCapabilitiesSchema.optional(),
    progress: AgentGoalProgressSchema.optional(),
  }).strict(),
]);

export type AgentGoalStatus = z.infer<typeof AgentGoalStatusSchema>;

export const AgentStateSchema = z.object({
  controlledByUser: z.boolean().nullish(),
  agentGoalStatus: AgentGoalStatusSchema.optional(),
  requests: z
    .record(
      z.string(),
      z.object({
        tool: z.string(),
        arguments: z.any(),
        createdAt: z.number().nullish(),
        // Auto Mode safety classification (Phase 1).
        riskLevel: z.enum(["safe", "dangerous", "neutral"]).nullish(),
        classifierReason: z.string().nullish(),
      }),
    )
    .nullish(),
  completedRequests: z
    .record(
      z.string(),
      z.object({
        tool: z.string(),
        arguments: z.any(),
        createdAt: z.number().nullish(),
        completedAt: z.number().nullish(),
        status: z.enum(["canceled", "denied", "approved"]),
        reason: z.string().nullish(),
        mode: z.string().nullish(),
        allowedTools: z.array(z.string()).nullish(),
        decision: z
          .enum(["approved", "approved_for_session", "denied", "abort"])
          .nullish(),
        answers: z.record(z.string(), z.string()).nullish(),
      }),
    )
    .nullish(),
  elicitation: z
    .object({
      id: z.string(),
      serverName: z.string(),
      message: z.string(),
      mode: z.enum(["form", "url"]).default("form"),
      url: z.string().nullish(),
      requestedSchema: z.record(z.string(), z.unknown()).nullish(),
    })
    .nullish(),
  stopFailure: z
    .object({
      error: z.string(),
      errorType: z.string().nullish(),
      lastAssistantMessage: z.string().nullish(),
    })
    .nullish(),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

export const SessionPreferencesSchema = z.object({
  permissionMode: z.string().nullish(),
  modelMode: z.string().nullish(),
  pinnedModelId: z.string().nullish(),
  customModels: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().nullish(),
      }),
    )
    .nullish(),
  modelMappings: z.record(z.string(), z.string()).nullish(),
  profileId: z.string().nullish(),
  profileName: z.string().nullish(),
  thinkingMode: z.string().nullish(),
  thinkingBudget: z.number().nullish(),
  effortLevel: z.string().nullish(),
  maxBudgetUsd: z.number().nullish(),
  taskBudgetTokens: z.number().nullish(),
  starred: z.boolean().nullish(),
});

export type SessionPreferences = z.infer<typeof SessionPreferencesSchema>;

export type SessionLatestUserRequestPreview = {
  text: string;
  isAutoOptionSend: boolean;
};

export interface Session {
  id: string;
  seq: number;
  createdAt: number;
  updatedAt: number;
  active: boolean;
  activeAt: number;
  forkedFromSessionId?: string | null;
  parentSessionId?: string | null;
  rpcReady: boolean;
  metadata: Metadata | null;
  metadataVersion: number;
  agentState: AgentState | null;
  agentStateVersion: number;
  preferencesVersion: number;
  thinking: boolean;
  thinkingAt: number;
  presence: "online" | number;
  todos?: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    priority: "high" | "medium" | "low";
    id: string;
  }>;
  draft?: string | null;
  permissionMode?: string | null;
  modelMode?: string | null;
  pinnedModelId?: string | null;
  customModels?: Array<{
    id: string;
    name: string;
    description?: string | null;
  }> | null;
  modelMappings?: Record<string, string> | null;
  profileId?: string | null;
  profileName?: string | null;
  thinkingMode?: string | null;
  thinkingBudget?: number | null;
  effortLevel?: string | null;
  maxBudgetUsd?: number | null;
  taskBudgetTokens?: number | null;
  resolvedModelId?: string | null;
  needsAttention?: boolean;
  starred?: boolean | null;
  autoCompact?: boolean | null;
  latestUserRequestPreview?: SessionLatestUserRequestPreview | null;
  sdkSessionState?: "idle" | "running" | "requires_action" | null;
  latestUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreation: number;
    cacheRead: number;
    contextSize: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    timestamp: number;
    totalCostUsd?: number;
    contextWindow?: number;
    totalDurationMs?: number;
    completedTurnsDurationMs?: number;
    currentTurnStartedAt?: number;
    modelUsage?: Record<
      string,
      {
        inputTokens: number;
        outputTokens: number;
        cacheReadInputTokens: number;
        cacheCreationInputTokens: number;
        costUSD: number;
        contextWindow: number;
      }
    >;
  } | null;
  apiRetry?: {
    attempt: number;
    maxRetries: number;
    retryDelayMs: number;
    errorStatus: number | null;
    timestamp: number;
  } | null;
}

export interface DecryptedMessage {
  id: string;
  seq: number | null;
  localId: string | null;
  content: any;
  createdAt: number;
}

/**
 * MachineMetadata = the wire base (single source of truth in
 * @kmmao/happy-wire — what the CLI daemon actually sends) + explicit
 * App-side extensions. Previously this was a hand-copied mirror that had
 * drifted both ways: it silently STRIPPED `happyLibDir` (Zod drops unknown
 * keys) and carried fields the CLI never sends. Extending the wire schema
 * means new wire fields flow in automatically and the App's own additions
 * stay visible in one place.
 */
export const MachineMetadataSchema = WireMachineMetadataSchema.extend({
  // Present from every current CLI, but absent in metadata ciphertexts
  // written before the field existed — the App must keep decrypting those,
  // so the wire-required field is relaxed to optional here.
  happyLibDir: z.string().optional(),
  // App-side extension: the user-editable machine name, written by the
  // machine settings screen and round-tripped through encryptMetadata.
  displayName: z.string().optional(),
  // Legacy/optional fields other writers have historically included.
  // daemonStatus is NOT DaemonState.status (["running","shutting-down"]) —
  // it is an old metadata-level field kept for old ciphertexts.
  username: z.string().optional(),
  arch: z.string().optional(),
  daemonVersion: z.string().optional(),
  daemonStatus: z.enum(["running", "stopped", "error"]).optional(),
  daemonStartedAt: z.number().optional(),
  daemonError: z.string().optional(),
});

export type MachineMetadata = z.infer<typeof MachineMetadataSchema>;

export interface Machine {
  id: string;
  accountId?: string;
  seq?: number;
  host?: string;
  platform?: string;
  homeDir?: string;
  happyHomeDir?: string;
  metadata?: MachineMetadata | null;
  connected?: boolean;
  connectedAt?: number;
  lastSeenAt?: number;
  metadataVersion: number;
  createdAt?: number;
  updatedAt?: number;
  active?: boolean;
  activeAt?: number;
  rpcReady?: boolean;
  daemonState?: any | null;
  daemonStateVersion?: number;
}

export interface GitStatus {
  branch: string | null;
  ahead?: number;
  behind?: number;
  hasUncommittedChanges?: boolean;
  lastCheckedAt?: number;
  remoteUrl?: string | null;
  upstreamBranch?: string | null;
  aheadCount: number;
  behindCount: number;
  lastUpdatedAt: number;
  isDirty: boolean;
  stagedCount: number;
  modifiedCount: number;
  untrackedCount: number;
  stashCount: number;
  stagedLinesAdded: number;
  stagedLinesRemoved: number;
  unstagedLinesAdded: number;
  unstagedLinesRemoved: number;
  linesAdded: number;
  linesRemoved: number;
  linesChanged: number;
}
