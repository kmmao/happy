import { z } from "zod";

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
  machineId: z.string().optional(),
  claudeSessionId: z.string().optional(), // Claude Code session ID
  tools: z.array(z.string()).optional(),
  slashCommands: z.array(z.string()).optional(),
  homeDir: z.string().optional(), // User's home directory on the machine
  happyHomeDir: z.string().optional(), // Happy configuration directory
  hostPid: z.number().optional(), // Process ID of the session
  startedBy: z.enum(["daemon", "terminal"]).optional(), // How the session was started
  flavor: z.string().nullish(), // Session flavor/variant identifier
  sandbox: z.any().nullish(), // Sandbox config metadata from CLI (or null when disabled)
  dangerouslySkipPermissions: z.boolean().nullish(), // Claude --dangerously-skip-permissions mode (or null when unknown)
  packageScripts: z.record(z.string(), z.string()).optional(), // package.json scripts from working directory
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
});

export type Metadata = z.infer<typeof MetadataSchema>;

export const AgentStateSchema = z.object({
  controlledByUser: z.boolean().nullish(),
  requests: z
    .record(
      z.string(),
      z.object({
        tool: z.string(),
        arguments: z.any(),
        createdAt: z.number().nullish(),
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
});

export type SessionPreferences = z.infer<typeof SessionPreferencesSchema>;

export interface Session {
  id: string;
  seq: number;
  createdAt: number;
  updatedAt: number;
  active: boolean;
  activeAt: number;
  metadata: Metadata | null;
  metadataVersion: number;
  agentState: AgentState | null;
  agentStateVersion: number;
  preferencesVersion: number;
  thinking: boolean;
  thinkingAt: number;
  presence: "online" | number; // "online" when active, timestamp when last seen
  todos?: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    priority: "high" | "medium" | "low";
    id: string;
  }>;
  draft?: string | null; // Local draft message, not synced to server
  permissionMode?: string | null; // Local permission mode key, not synced to server
  modelMode?: string | null; // Local model key, not synced to server
  customModels?: Array<{
    id: string;
    name: string;
    description?: string | null;
  }> | null; // Profile custom models, copied at session creation
  modelMappings?: Record<string, string> | null; // Maps UI keys (opus/sonnet/haiku) to real model IDs, copied at session creation
  profileId?: string | null; // AI backend profile ID used when session was created
  profileName?: string | null; // AI backend profile display name, copied at session creation
  // SDK reasoning & budget controls (Phase 3A)
  thinkingMode?: string | null; // "disabled" | "adaptive" | "enabled"
  thinkingBudget?: number | null; // Budget tokens when thinkingMode is "enabled"
  effortLevel?: string | null; // "low" | "medium" | "high" | "max"
  maxBudgetUsd?: number | null; // Max budget in USD
  // IMPORTANT: latestUsage is extracted from reducerState.latestUsage after message processing.
  // We store it directly on Session to ensure it's available immediately on load.
  // Do NOT store reducerState itself on Session - it's mutable and should only exist in SessionMessages.
  needsAttention?: boolean; // true when turn-end received and user hasn't viewed the session
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
  // Transient API retry state — set when SDK is retrying a failed API call, cleared on next success
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

//
// Machine states
//

export const MachineMetadataSchema = z.object({
  host: z.string(),
  platform: z.string(),
  happyCliVersion: z.string(),
  happyHomeDir: z.string(), // Directory for Happy auth, settings, logs (usually .happy/ or .happy-dev/)
  homeDir: z.string(), // User's home directory (matches CLI field name)
  // Optional fields that may be added in future versions
  username: z.string().optional(),
  arch: z.string().optional(),
  displayName: z.string().optional(), // Custom display name for the machine
  // Daemon status fields
  daemonLastKnownStatus: z.enum(["running", "shutting-down"]).optional(),
  daemonLastKnownPid: z.number().optional(),
  shutdownRequestedAt: z.number().optional(),
  shutdownSource: z
    .enum(["happy-app", "happy-cli", "os-signal", "unknown"])
    .optional(),
});

export type MachineMetadata = z.infer<typeof MachineMetadataSchema>;

export interface Machine {
  id: string;
  seq: number;
  createdAt: number;
  updatedAt: number;
  active: boolean;
  activeAt: number; // Changed from lastActiveAt to activeAt for consistency
  metadata: MachineMetadata | null;
  metadataVersion: number;
  daemonState: any | null; // Dynamic daemon state (runtime info)
  daemonStateVersion: number;
}

//
// Git Status
//

export interface GitStatus {
  branch: string | null;
  isDirty: boolean;
  modifiedCount: number;
  untrackedCount: number;
  stagedCount: number;
  lastUpdatedAt: number;
  // Line change statistics - separated by staged vs unstaged
  stagedLinesAdded: number;
  stagedLinesRemoved: number;
  unstagedLinesAdded: number;
  unstagedLinesRemoved: number;
  // Computed totals
  linesAdded: number; // stagedLinesAdded + unstagedLinesAdded
  linesRemoved: number; // stagedLinesRemoved + unstagedLinesRemoved
  linesChanged: number; // Total lines that were modified (added + removed)
  // Branch tracking information (from porcelain v2)
  upstreamBranch?: string | null; // Name of upstream branch
  aheadCount?: number; // Commits ahead of upstream
  behindCount?: number; // Commits behind upstream
  stashCount?: number; // Number of stash entries
  // Remote URL for provider detection (GitHub/Gitea)
  remoteUrl?: string | null;
}
