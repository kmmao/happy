/**
 * Session operations for remote procedure calls
 * Provides strictly typed functions for all session-related RPC operations
 */

import { apiSocket } from "./apiSocket";
import { sync } from "./sync";
import { storage } from "./storage";
import type { MachineMetadata } from "./storageTypes";
import { getErrorMessage } from "@/utils/errors";

// Strict type definitions for all operations

// Permission operation types
interface SessionPermissionRequest {
  id: string;
  approved: boolean;
  reason?: string;
  mode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  allowTools?: string[];
  decision?: "approved" | "approved_for_session" | "denied" | "abort";
  /** User answers for AskUserQuestion — keyed by question text */
  answers?: Record<string, string>;
}

// Mode change operation types
interface SessionModeChangeRequest {
  to: "remote" | "local";
}

// Bash operation types
interface SessionBashRequest {
  command: string;
  cwd?: string;
  timeout?: number;
}

export interface SessionBashResponse {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}

// Read file operation types
interface SessionReadFileRequest {
  path: string;
}

interface SessionReadFileResponse {
  success: boolean;
  content?: string; // base64 encoded
  error?: string;
}

// Write file operation types
interface SessionWriteFileRequest {
  path: string;
  content: string; // base64 encoded
  expectedHash?: string | null;
}

interface SessionWriteFileResponse {
  success: boolean;
  hash?: string;
  error?: string;
}

// List directory operation types
interface SessionListDirectoryRequest {
  path: string;
}

export interface DirectoryEntry {
  name: string;
  type: "file" | "directory" | "other";
  size?: number;
  modified?: number;
}

interface SessionListDirectoryResponse {
  success: boolean;
  entries?: DirectoryEntry[];
  error?: string;
}

// Directory tree operation types
interface SessionGetDirectoryTreeRequest {
  path: string;
  maxDepth: number;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: number;
  children?: TreeNode[];
}

interface SessionGetDirectoryTreeResponse {
  success: boolean;
  tree?: TreeNode;
  error?: string;
}

// Ripgrep operation types
interface SessionRipgrepRequest {
  args: string[];
  cwd?: string;
}

interface SessionRipgrepResponse {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

// Kill session operation types
interface SessionKillRequest {
  // No parameters needed
}

interface SessionKillResponse {
  success: boolean;
  message: string;
}

// Response types for spawn session
export type SpawnSessionResult =
  | { type: "success"; sessionId: string }
  | { type: "requestToApproveDirectoryCreation"; directory: string }
  | { type: "error"; errorMessage: string };

// Options for spawning a session
export interface SpawnSessionOptions {
  machineId: string;
  directory: string;
  approvedNewDirectoryCreation?: boolean;
  token?: string;
  agent?: "codex" | "claude" | "gemini";
  // Claude Code session ID for --resume (resumes an existing session with full context)
  claudeSessionId?: string;
  // Happy session ID for reconnecting to the same Happy session (preserves message history)
  happySessionId?: string;
  // Profile ID — sent to daemon so it can verify trust (profile exists in local settings)
  // Trusted profiles are allowed to override operator-only env vars (ANTHROPIC_BASE_URL, etc.)
  profileId?: string;
  // Environment variables from AI backend profile
  // Accepts any environment variables - daemon will pass them to the agent process
  // Common variables include:
  // - ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL, ANTHROPIC_SMALL_FAST_MODEL
  // - OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_API_TIMEOUT_MS
  // - AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_VERSION, AZURE_OPENAI_DEPLOYMENT_NAME
  // - TOGETHER_API_KEY, TOGETHER_MODEL
  // - TMUX_SESSION_NAME, TMUX_TMPDIR, TMUX_UPDATE_ENVIRONMENT
  // - API_TIMEOUT_MS, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
  // - Custom variables (DEEPSEEK_*, Z_AI_*, etc.)
  environmentVariables?: Record<string, string>;
}

// Exported session operation functions

/**
 * Spawn a new remote session on a specific machine
 */
export async function machineSpawnNewSession(
  options: SpawnSessionOptions,
): Promise<SpawnSessionResult> {
  const {
    machineId,
    directory,
    approvedNewDirectoryCreation = false,
    token,
    agent,
    claudeSessionId,
    happySessionId,
    profileId,
    environmentVariables,
  } = options;

  try {
    // Inject knowledge base settings as environment variables
    const settings = storage.getState().settings;
    const knowledgeEnvVars: Record<string, string> = {};
    knowledgeEnvVars.HAPPY_KNOWLEDGE_BASE = settings.knowledgeBase ? "true" : "false";
    knowledgeEnvVars.HAPPY_KNOWLEDGE_MODE = settings.knowledgeBaseMode;
    knowledgeEnvVars.HAPPY_KNOWLEDGE_SENSITIVITY = settings.knowledgeBaseSensitivity;
    knowledgeEnvVars.HAPPY_KNOWLEDGE_TRACK_FILE_EDITS = String(settings.knowledgeBaseTrackFileEdits);
    knowledgeEnvVars.HAPPY_KNOWLEDGE_TRACK_TOOL_CALLS = String(settings.knowledgeBaseTrackToolCalls);
    knowledgeEnvVars.HAPPY_KNOWLEDGE_TRACK_TOKENS = String(settings.knowledgeBaseTrackTokens);

    // Caller env vars (e.g. from profile) take precedence over knowledge settings
    const mergedEnvironmentVariables = { ...knowledgeEnvVars, ...environmentVariables };

    const result = await apiSocket.machineRPC<
      SpawnSessionResult,
      {
        type: "spawn-in-directory";
        directory: string;
        approvedNewDirectoryCreation?: boolean;
        token?: string;
        agent?: "codex" | "claude" | "gemini";
        sessionId?: string;
        happySessionId?: string;
        profileId?: string;
        environmentVariables?: Record<string, string>;
      }
    >(machineId, "spawn-happy-session", {
      type: "spawn-in-directory",
      directory,
      approvedNewDirectoryCreation,
      token,
      agent,
      sessionId: claudeSessionId,
      happySessionId,
      profileId,
      environmentVariables: mergedEnvironmentVariables,
    });
    return result;
  } catch (error) {
    // Handle RPC errors
    return {
      type: "error",
      errorMessage:
        getErrorMessage(error, "Failed to spawn session"),
    };
  }
}

/**
 * Stop the daemon on a specific machine
 */
export async function machineStopDaemon(
  machineId: string,
): Promise<{ message: string }> {
  const result = await apiSocket.machineRPC<{ message: string }, {}>(
    machineId,
    "stop-daemon",
    {},
  );
  return result;
}


export async function machineStopSession(
  machineId: string,
  sessionId: string,
): Promise<{ message: string }> {
  return apiSocket.machineRPC<{ message: string }, { sessionId: string }>(
    machineId,
    "stop-session",
    { sessionId },
  );
}



export interface MachineAutomationGuardian {
  key: string;
  projectId: string;
  loopId?: string;
  sessionId: string;
  updatedAt: number;
  lastRunId?: string;
  attached?: boolean;
  recovered?: boolean;
}

export interface MachineAutomationGuardianUsage {
  key: string;
  projectId?: string;
  loopId?: string;
  reuseCount: number;
  rememberCount: number;
  resetCount: number;
  lastUsedAt: number;
  currentSessionId?: string;
}

export interface MachineAutomationAuditEvent {
  id: string;
  occurredAt: number;
  kind: string;
  jobId?: string;
  dedupeKey?: string;
  sessionId?: string;
  projectId?: string;
  runId?: string;
  loopId?: string;
  trigger?: string;
  status?: string;
  guardianKey?: string;
  guardianSessionId?: string;
  message?: string;
}

export interface MachineAutomationAuditStats {
  totalEvents: number;
  lastEventAt?: number;
  queuedCount: number;
  sessionStartedCount: number;
  terminalCompletedCount: number;
  terminalFailedCount: number;
  terminalCancelledCount: number;
  guardianReuseCount: number;
  guardianRememberCount: number;
  guardianResetCount: number;
  sessionReattachedCount: number;
  watchdogStopCount: number;
  stopRequestCount: number;
  policyGatedCount: number;
  downstreamEmitCount: number;
  guardianEligibleRunCount: number;
  guardianReuseRate: number;
  activeGuardianCount: number;
}

export interface MachineAutomationJob {
  id: string;
  kind: "supervisor" | "webhook" | "agent_loop";
  status: "queued" | "dispatching" | "running" | "completed" | "failed" | "cancelled";
  priority: "urgent" | "user" | "background";
  dedupeKey: string;
  attempt: number;
  maxAttempts: number;
  createdAt: number;
  updatedAt: number;
  nextRunAt?: number;
  dispatchedAt?: number;
  completedAt?: number;
  sessionId?: string;
  label?: string;
  projectId?: string;
  runId?: string;
  loopId?: string;
  loopIteration?: number;
  continuityKey?: string;
  errorMessage?: string;
  recovered?: boolean;
}

export interface MachineAutomationStatus {
  counts: Record<string, number>;
  jobs: MachineAutomationJob[];
  guardians?: MachineAutomationGuardian[];
  guardianUsage?: MachineAutomationGuardianUsage[];
  auditStats?: MachineAutomationAuditStats;
  recentAuditEvents?: MachineAutomationAuditEvent[];
}

export async function machineAutomationStatus(
  machineId: string,
): Promise<MachineAutomationStatus> {
  return apiSocket.machineRPC<MachineAutomationStatus, {}>(
    machineId,
    "automation-status",
    {},
  );
}

export async function machineRetryAutomationJob(
  machineId: string,
  jobId: string,
): Promise<{ success: boolean; errorMessage?: string; job?: MachineAutomationJob }> {
  return apiSocket.machineRPC(
    machineId,
    "automation-retry",
    { jobId },
  );
}

export async function machineCancelAutomationJob(
  machineId: string,
  jobId: string,
): Promise<{ success: boolean; errorMessage?: string; job?: MachineAutomationJob }> {
  return apiSocket.machineRPC(
    machineId,
    "automation-cancel",
    { jobId },
  );
}

export async function machineClearAutomationJobs(
  machineId: string,
): Promise<{ success: boolean; errorMessage?: string }> {
  return apiSocket.machineRPC(
    machineId,
    "automation-clear",
    {},
  );
}

export async function machineClearAutomationGuardians(
  machineId: string,
  params: { key?: string; sessionId?: string; clearAll?: boolean },
): Promise<{ success: boolean; errorMessage?: string }> {
  return apiSocket.machineRPC(
    machineId,
    "automation-guardian-clear",
    params,
  );
}

export async function machineClearAutomationAudit(
  machineId: string,
): Promise<{ success: boolean; errorMessage?: string }> {
  return apiSocket.machineRPC(
    machineId,
    "automation-audit-clear",
    {},
  );
}


export async function machineSetKillswitch(
  machineId: string,
  enabled: boolean,
): Promise<{ success: boolean; killed: boolean }> {
  return apiSocket.machineRPC(
    machineId,
    "killswitch-set",
    { enabled },
  );
}

export async function machineGetKillswitch(
  machineId: string,
): Promise<{ killed: boolean }> {
  return apiSocket.machineRPC(
    machineId,
    "killswitch-get",
    {},
  );
}

export type MachineAgentLoopRuntimeState = "idle" | "active" | "blocked" | "paused";
export type MachineAgentLoopPhase = "sleeping" | "planning" | "acting" | "reflecting" | "blocked" | "paused";
export type MachineAgentLoopTriggerSource = "manual" | "schedule" | "event";
export type MachineAgentLoopEventStatus = "pending" | "dispatched" | "completed" | "failed" | "cancelled" | "ignored";

export interface MachineAgentLoopEvent {
  id: string;
  source: string;
  title: string;
  details?: string;
  status: MachineAgentLoopEventStatus;
  createdAt: number;
  dispatchedAt?: number;
  completedAt?: number;
  jobId?: string;
  sessionId?: string;
  errorMessage?: string;
}

export interface MachineAgentLoop {
  id: string;
  name?: string;
  prompt: string;
  directory: string;
  intervalMs: number;
  cronExpression?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  iteration: number;
  continuityKey: string;
  agent: "claude" | "codex" | "gemini";
  profileId?: string;
  projectId?: string;
  environmentVariables?: Record<string, string>;
  fileWatchEnabled?: boolean;
  githubBridgeEnabled?: boolean;
  ciBridgeEnabled?: boolean;
  eventSourceAllowlist?: string[];
  eventKeywordFilters?: string[];
  goal?: string;
  currentFocus?: string;
  workingMemory?: string;
  lastReflectionSummary?: string;
  memoryUpdatedAt?: number;
  consecutiveFailures?: number;
  maxConsecutiveFailures?: number;
  retryBackoffMs?: number;
  cooldownMs?: number;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  maxAutoRunsPerDay?: number;
  maxIterations?: number;
  stopOnSuccess?: boolean;
  downstreamLoopIds?: string[];
  downstreamTriggerOn?: Array<"completed" | "failed">;
  notifyEvents?: Array<"completed" | "failed" | "blocked" | "brief">;
  notificationChannels?: Array<"push" | "webhook">;
  notificationWebhookUrl?: string;
  lastBriefAt?: number;
  lastBriefSummary?: string;
  lastSuccessfulAt?: number;
  autoRunsToday?: number;
  autoRunWindowStartedAt?: number;
  lastPolicyGateAt?: number;
  lastPolicyGateReason?: string;
  runtimeState: MachineAgentLoopRuntimeState;
  phase: MachineAgentLoopPhase;
  phaseUpdatedAt: number;
  activeJobId?: string;
  activeSessionId?: string;
  lastTriggerSource?: MachineAgentLoopTriggerSource;
  lastTriggerAt?: number;
  blockedReason?: string;
  stopReason?: string;
  lastReflectionAt?: number;
  recentEvents?: MachineAgentLoopEvent[];
  lastEnqueuedAt?: number;
  lastStartedAt?: number;
  lastCompletedAt?: number;
  lastSessionId?: string;
  lastError?: string;
}

export interface MachineAgentLoopSuggestion {
  key: string;
  name: string;
  description: string;
  rationale: string;
  directory: string;
  intervalMs: number;
  agent: "claude" | "codex" | "gemini";
  fileWatchEnabled?: boolean;
  githubBridgeEnabled?: boolean;
  ciBridgeEnabled?: boolean;
  eventSourceAllowlist?: string[];
  eventKeywordFilters?: string[];
  goal?: string;
  currentFocus?: string;
  workingMemory?: string;
  lastReflectionSummary?: string;
  maxConsecutiveFailures?: number;
  retryBackoffMs?: number;
  cooldownMs?: number;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  maxAutoRunsPerDay?: number;
  prompt: string;
  tags: string[];
  confidence: "high" | "medium";
  alreadyConfigured: boolean;
  existingLoopId?: string;
}

export interface MachineAgentLoopSuggestInput {
  directory: string;
  agent?: "claude" | "codex" | "gemini";
  projectId?: string;
  profileId?: string;
}

export interface MachineAgentLoopCreateInput {
  name?: string;
  prompt: string;
  directory: string;
  intervalMs: number;
  cronExpression?: string;
  agent?: "claude" | "codex" | "gemini";
  profileId?: string;
  projectId?: string;
  environmentVariables?: Record<string, string>;
  fileWatchEnabled?: boolean;
  githubBridgeEnabled?: boolean;
  ciBridgeEnabled?: boolean;
  eventSourceAllowlist?: string[];
  eventKeywordFilters?: string[];
  goal?: string;
  currentFocus?: string;
  workingMemory?: string;
  lastReflectionSummary?: string;
  maxConsecutiveFailures?: number;
  retryBackoffMs?: number;
  cooldownMs?: number;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  maxAutoRunsPerDay?: number;
  maxIterations?: number;
  stopOnSuccess?: boolean;
  downstreamLoopIds?: string[];
  downstreamTriggerOn?: Array<"completed" | "failed">;
  notifyEvents?: Array<"completed" | "failed" | "blocked" | "brief">;
  notificationChannels?: Array<"push" | "webhook">;
  notificationWebhookUrl?: string;
  runNow?: boolean;
}

export interface MachineAgentLoopUpdateInput {
  name?: string | null;
  prompt?: string;
  directory?: string;
  intervalMs?: number;
  cronExpression?: string | null;
  agent?: "claude" | "codex" | "gemini";
  profileId?: string | null;
  projectId?: string | null;
  environmentVariables?: Record<string, string> | null;
  fileWatchEnabled?: boolean;
  githubBridgeEnabled?: boolean;
  ciBridgeEnabled?: boolean;
  eventSourceAllowlist?: string[] | null;
  eventKeywordFilters?: string[] | null;
  goal?: string | null;
  currentFocus?: string | null;
  workingMemory?: string | null;
  lastReflectionSummary?: string | null;
  maxConsecutiveFailures?: number | null;
  retryBackoffMs?: number | null;
  cooldownMs?: number | null;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  maxAutoRunsPerDay?: number | null;
  maxIterations?: number | null;
  stopOnSuccess?: boolean;
  downstreamLoopIds?: string[] | null;
  downstreamTriggerOn?: Array<"completed" | "failed"> | null;
  notifyEvents?: Array<"completed" | "failed" | "blocked" | "brief"> | null;
  notificationChannels?: Array<"push" | "webhook"> | null;
  notificationWebhookUrl?: string | null;
}

export interface MachineAgentLoopBootstrapProfile {
  id: string;
  name?: string;
  rootDirectory: string;
  intervalMs: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  maxDepth?: number;
  limit?: number;
  agent?: "claude" | "codex" | "gemini";
  profileId?: string;
  projectId?: string;
  autoRunCreatedLoops?: boolean;
  status: "idle" | "running" | "paused" | "failed";
  statusUpdatedAt: number;
  lastRunAt?: number;
  lastRepoCount?: number;
  lastSuggestionCount?: number;
  lastCreatedCount?: number;
  lastError?: string;
}

export interface MachineAgentLoopBootstrapCreateInput {
  name?: string;
  rootDirectory: string;
  intervalMs: number;
  maxDepth?: number;
  limit?: number;
  agent?: "claude" | "codex" | "gemini";
  profileId?: string;
  projectId?: string;
  autoRunCreatedLoops?: boolean;
  runNow?: boolean;
}

export interface MachineAgentLoopBootstrapUpdateInput {
  name?: string | null;
  rootDirectory?: string;
  intervalMs?: number;
  maxDepth?: number | null;
  limit?: number | null;
  agent?: "claude" | "codex" | "gemini" | null;
  profileId?: string | null;
  projectId?: string | null;
  autoRunCreatedLoops?: boolean;
}

export interface MachineAutoDreamProfile {
  id: string;
  name?: string;
  rootDirectory: string;
  intervalMs: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  status: "idle" | "running" | "paused" | "failed";
  stage: "starting" | "scanning" | "analyzing" | "writing" | "updating";
  statusUpdatedAt: number;
  maxDepth?: number;
  limit?: number;
  lastRunAt?: number;
  lastError?: string;
  lastMemoryFiles?: number;
  lastUpdatedFiles?: number;
  latestDreamFilePath?: string;
}

export interface MachineAutoDreamCreateInput {
  name?: string;
  rootDirectory: string;
  intervalMs: number;
  maxDepth?: number;
  limit?: number;
  runNow?: boolean;
}

export interface MachineAutoDreamUpdateInput {
  name?: string | null;
  rootDirectory?: string;
  intervalMs?: number;
  maxDepth?: number | null;
  limit?: number | null;
}

export async function machineListAgentLoops(
  machineId: string,
): Promise<{ loops: MachineAgentLoop[] }> {
  return apiSocket.machineRPC(
    machineId,
    "loop-list",
    {},
  );
}

export async function machineGetAgentLoop(
  machineId: string,
  loopId: string,
): Promise<{ success: boolean; errorMessage?: string; loop?: MachineAgentLoop }> {
  return apiSocket.machineRPC(
    machineId,
    "loop-get",
    { loopId },
  );
}

export async function machineCreateAgentLoop(
  machineId: string,
  input: MachineAgentLoopCreateInput,
): Promise<{ success: boolean; errorMessage?: string; loop?: MachineAgentLoop }> {
  return apiSocket.machineRPC(
    machineId,
    "loop-create",
    input,
  );
}

export async function machineUpdateAgentLoop(
  machineId: string,
  loopId: string,
  input: MachineAgentLoopUpdateInput,
): Promise<{ success: boolean; errorMessage?: string; loop?: MachineAgentLoop }> {
  return apiSocket.machineRPC(
    machineId,
    "loop-update",
    { loopId, ...input },
  );
}

export async function machinePauseAgentLoop(
  machineId: string,
  loopId: string,
): Promise<{ success: boolean; errorMessage?: string; loop?: MachineAgentLoop }> {
  return apiSocket.machineRPC(
    machineId,
    "loop-pause",
    { loopId },
  );
}

export async function machineResumeAgentLoop(
  machineId: string,
  loopId: string,
): Promise<{ success: boolean; errorMessage?: string; loop?: MachineAgentLoop }> {
  return apiSocket.machineRPC(
    machineId,
    "loop-resume",
    { loopId },
  );
}

export async function machineRunAgentLoopNow(
  machineId: string,
  loopId: string,
): Promise<{ success: boolean; errorMessage?: string; loop?: MachineAgentLoop }> {
  return apiSocket.machineRPC(
    machineId,
    "loop-run-now",
    { loopId },
  );
}

export async function machineEmitAgentLoopEvent(
  machineId: string,
  loopId: string,
  input: { source?: string; title: string; details?: string; autoRun?: boolean },
): Promise<{ success: boolean; errorMessage?: string; loop?: MachineAgentLoop }> {
  return apiSocket.machineRPC(
    machineId,
    "loop-event",
    { loopId, ...input },
  );
}

export async function machineRemoveAgentLoop(
  machineId: string,
  loopId: string,
): Promise<{ success: boolean; errorMessage?: string; loop?: MachineAgentLoop }> {
  return apiSocket.machineRPC(
    machineId,
    "loop-remove",
    { loopId },
  );
}

export async function machineSuggestAgentLoops(
  machineId: string,
  input: MachineAgentLoopSuggestInput,
): Promise<{ suggestions: MachineAgentLoopSuggestion[] }> {
  return apiSocket.machineRPC(
    machineId,
    "loop-suggest",
    input,
  );
}


export async function machineListAgentLoopBootstrapProfiles(
  machineId: string,
): Promise<{ profiles: MachineAgentLoopBootstrapProfile[] }> {
  return apiSocket.machineRPC(
    machineId,
    "bootstrap-profile-list",
    {},
  );
}

export async function machineCreateAgentLoopBootstrapProfile(
  machineId: string,
  input: MachineAgentLoopBootstrapCreateInput,
): Promise<{ success: boolean; errorMessage?: string; profile?: MachineAgentLoopBootstrapProfile }> {
  return apiSocket.machineRPC(
    machineId,
    "bootstrap-profile-create",
    input,
  );
}

export async function machineUpdateAgentLoopBootstrapProfile(
  machineId: string,
  profileIdValue: string,
  input: MachineAgentLoopBootstrapUpdateInput,
): Promise<{ success: boolean; errorMessage?: string; profile?: MachineAgentLoopBootstrapProfile }> {
  return apiSocket.machineRPC(
    machineId,
    "bootstrap-profile-update",
    { profileIdValue, ...input },
  );
}

export async function machinePauseAgentLoopBootstrapProfile(
  machineId: string,
  profileIdValue: string,
): Promise<{ success: boolean; errorMessage?: string; profile?: MachineAgentLoopBootstrapProfile }> {
  return apiSocket.machineRPC(
    machineId,
    "bootstrap-profile-pause",
    { profileIdValue },
  );
}

export async function machineResumeAgentLoopBootstrapProfile(
  machineId: string,
  profileIdValue: string,
): Promise<{ success: boolean; errorMessage?: string; profile?: MachineAgentLoopBootstrapProfile }> {
  return apiSocket.machineRPC(
    machineId,
    "bootstrap-profile-resume",
    { profileIdValue },
  );
}

export async function machineRunNowAgentLoopBootstrapProfile(
  machineId: string,
  profileIdValue: string,
): Promise<{ success: boolean; errorMessage?: string; profile?: MachineAgentLoopBootstrapProfile }> {
  return apiSocket.machineRPC(
    machineId,
    "bootstrap-profile-run-now",
    { profileIdValue },
  );
}

export async function machineRemoveAgentLoopBootstrapProfile(
  machineId: string,
  profileIdValue: string,
): Promise<{ success: boolean; errorMessage?: string; profile?: MachineAgentLoopBootstrapProfile }> {
  return apiSocket.machineRPC(
    machineId,
    "bootstrap-profile-remove",
    { profileIdValue },
  );
}

export async function machineListAutoDreamProfiles(
  machineId: string,
): Promise<{ profiles: MachineAutoDreamProfile[] }> {
  return apiSocket.machineRPC(
    machineId,
    "dream-profile-list",
    {},
  );
}

export async function machineCreateAutoDreamProfile(
  machineId: string,
  input: MachineAutoDreamCreateInput,
): Promise<{ success: boolean; errorMessage?: string; profile?: MachineAutoDreamProfile }> {
  return apiSocket.machineRPC(
    machineId,
    "dream-profile-create",
    input,
  );
}

export async function machineUpdateAutoDreamProfile(
  machineId: string,
  profileIdValue: string,
  input: MachineAutoDreamUpdateInput,
): Promise<{ success: boolean; errorMessage?: string; profile?: MachineAutoDreamProfile }> {
  return apiSocket.machineRPC(
    machineId,
    "dream-profile-update",
    { profileIdValue, ...input },
  );
}

export async function machinePauseAutoDreamProfile(
  machineId: string,
  profileIdValue: string,
): Promise<{ success: boolean; errorMessage?: string; profile?: MachineAutoDreamProfile }> {
  return apiSocket.machineRPC(
    machineId,
    "dream-profile-pause",
    { profileIdValue },
  );
}

export async function machineResumeAutoDreamProfile(
  machineId: string,
  profileIdValue: string,
): Promise<{ success: boolean; errorMessage?: string; profile?: MachineAutoDreamProfile }> {
  return apiSocket.machineRPC(
    machineId,
    "dream-profile-resume",
    { profileIdValue },
  );
}

export async function machineRunNowAutoDreamProfile(
  machineId: string,
  profileIdValue: string,
): Promise<{ success: boolean; errorMessage?: string; profile?: MachineAutoDreamProfile }> {
  return apiSocket.machineRPC(
    machineId,
    "dream-profile-run-now",
    { profileIdValue },
  );
}

export async function machineRemoveAutoDreamProfile(
  machineId: string,
  profileIdValue: string,
): Promise<{ success: boolean; errorMessage?: string; profile?: MachineAutoDreamProfile }> {
  return apiSocket.machineRPC(
    machineId,
    "dream-profile-remove",
    { profileIdValue },
  );
}

/**
 * Upgrade the CLI on a specific machine by running npm install -g.
 * Uses the bash RPC with a 3-minute timeout since npm install can be slow.
 * After success the daemon's heartbeat will detect the version mismatch
 * and auto-restart within ~60 seconds.
 */
const VERSION_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

export async function machineUpgradeCli(
  machineId: string,
  targetVersion: string,
): Promise<MachineBashResult> {
  if (!VERSION_RE.test(targetVersion)) {
    return { success: false, error: `Invalid version format: ${targetVersion}` };
  }
  return machineBash(
    machineId,
    `npm install -g @kmmao/happy-coder@${targetVersion}`,
    "/",
    180_000, // 3 minutes — npm install can be slow
  );
}

/**
 * Scan a machine for git repositories and return their paths + remote URLs.
 */
export interface GitRepoEntry {
  readonly repoPath: string;
  readonly remoteUrl: string;
  readonly name: string;
}

export interface CloneGitRepoOptions {
  readonly machineId: string;
  readonly repoUrl: string;
  readonly targetDirectory: string;
  readonly provider?: "github" | "gitea";
  readonly apiToken?: string;
  readonly host?: string;
}

export interface CloneGitRepoResult {
  readonly success: boolean;
  readonly repoPath?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly error?: string;
}

export interface RemoteGitRepoEntry {
  readonly name: string;
  readonly fullName: string;
  readonly cloneUrl: string;
  readonly htmlUrl: string;
  readonly private: boolean;
  readonly updatedAt?: number | null;
}

export interface ListRemoteGitReposOptions {
  readonly machineId: string;
  readonly provider: "github" | "gitea";
  readonly apiToken: string;
  readonly host: string;
  readonly page?: number;
  readonly perPage?: number;
  readonly query?: string;
}

export interface ListRemoteGitReposResult {
  readonly success: boolean;
  readonly repos?: readonly RemoteGitRepoEntry[];
  readonly hasMore?: boolean;
  readonly totalCount?: number;
  readonly error?: string;
}

export async function machineListGitRepos(
  machineId: string,
  scanPaths?: readonly string[],
): Promise<readonly GitRepoEntry[]> {
  const result = await apiSocket.machineRPC<
    { success: boolean; repos?: GitRepoEntry[]; error?: string },
    { scanPaths?: readonly string[] }
  >(machineId, "listGitRepos", { scanPaths });

  if (!result.success) {
    throw new Error(result.error ?? "Failed to scan git repos");
  }
  return result.repos ?? [];
}

export async function machineCloneGitRepo(
  options: CloneGitRepoOptions,
): Promise<CloneGitRepoResult> {
  try {
    const result = await apiSocket.machineRPC<
      CloneGitRepoResult,
      Omit<CloneGitRepoOptions, "machineId">
    >(options.machineId, "cloneGitRepo", {
      repoUrl: options.repoUrl,
      targetDirectory: options.targetDirectory,
      provider: options.provider,
      apiToken: options.apiToken,
      host: options.host,
    });

    return result;
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "Failed to clone repository"),
    };
  }
}

export async function machineListRemoteGitRepos(
  options: ListRemoteGitReposOptions,
): Promise<ListRemoteGitReposResult> {
  try {
    const result = await apiSocket.machineRPC<
      ListRemoteGitReposResult,
      Omit<ListRemoteGitReposOptions, "machineId">
    >(options.machineId, "listRemoteGitRepos", {
      provider: options.provider,
      apiToken: options.apiToken,
      host: options.host,
      page: options.page,
      perPage: options.perPage,
      query: options.query,
    });

    return result;
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error, "Failed to load remote repositories"),
    };
  }
}

export interface CreateRemoteWebhookParams {
  readonly provider: string;
  readonly apiToken: string;
  readonly repoUrl: string;
  readonly webhookUrl: string;
  readonly webhookSecret: string;
  readonly events: readonly string[];
}

export interface CreateRemoteWebhookResult {
  readonly created: boolean;
  readonly webhookId?: number;
}

export async function machineCreateRemoteWebhook(
  machineId: string,
  params: CreateRemoteWebhookParams,
): Promise<CreateRemoteWebhookResult> {
  const result = await apiSocket.machineRPC<
    { success: boolean; created?: boolean; webhookId?: number; error?: string },
    CreateRemoteWebhookParams
  >(machineId, "createRemoteWebhook", params);

  if (!result.success) {
    throw new Error(result.error ?? "Failed to create remote webhook");
  }
  return { created: result.created ?? true, webhookId: result.webhookId };
}

export interface DeleteRemoteWebhookParams {
  readonly provider: string;
  readonly apiToken: string;
  readonly repoUrl: string;
  readonly webhookUrl: string;
}

export async function machineDeleteRemoteWebhook(
  machineId: string,
  params: DeleteRemoteWebhookParams,
): Promise<{ deleted: boolean }> {
  const result = await apiSocket.machineRPC<
    { success: boolean; deleted?: boolean; error?: string },
    DeleteRemoteWebhookParams
  >(machineId, "deleteRemoteWebhook", params);

  if (!result.success) {
    throw new Error(result.error ?? "Failed to delete remote webhook");
  }
  return { deleted: result.deleted ?? false };
}

/**
 * Execute a bash command on a specific machine
 */
export interface MachineBashResult {
  readonly success: boolean;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly error?: string;
}

export async function machineBash(
  machineId: string,
  command: string,
  cwd: string,
  timeout?: number,
): Promise<MachineBashResult> {
  try {
    const result = await apiSocket.machineRPC<
      MachineBashResult,
      {
        command: string;
        cwd: string;
        timeout?: number;
      }
    >(machineId, "bash", { command, cwd, ...(timeout != null && { timeout }) });
    return result;
  } catch (error) {
    return {
      success: false,
      stdout: "",
      stderr: getErrorMessage(error),
      exitCode: -1,
      error: getErrorMessage(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Tailscale Serve / Funnel management
// ---------------------------------------------------------------------------

function validatePort(port: number): void {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid port: ${port}`);
    }
}

export async function machineTailscaleServeAdd(
    machineId: string,
    localPort: number,
    httpsPort: number,
    path: string,
    funnel: boolean,
): Promise<MachineBashResult> {
    validatePort(localPort);
    validatePort(httpsPort);
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const pathFlag = normalizedPath === "/" ? "" : ` --set-path=${normalizedPath}`;
    const target = `http://localhost:${localPort}`;
    const cmd = funnel
        ? `tailscale funnel --bg --https=${httpsPort}${pathFlag} ${target}`
        : `tailscale serve --bg --https=${httpsPort}${pathFlag} ${target}`;
    return machineBash(machineId, cmd, "/");
}

export async function machineTailscaleServeRemove(
    machineId: string,
    port: number,
    path?: string,
): Promise<MachineBashResult> {
    validatePort(port);
    const pathFlag = path && path !== "/" ? ` --set-path=${path}` : "";
    return machineBash(machineId, `tailscale serve --https=${port}${pathFlag} off`, "/");
}

export async function machineTailscaleFunnelToggle(
    machineId: string,
    httpsPort: number,
    enable: boolean,
    target: string,
    path?: string,
): Promise<MachineBashResult> {
    validatePort(httpsPort);
    const pathFlag = path && path !== "/" ? ` --set-path=${path}` : "";
    // Enable: re-create via `tailscale funnel` (adds funnel flag)
    // Disable: re-create via `tailscale serve` (removes funnel flag, keeps serve)
    const base = enable ? "tailscale funnel" : "tailscale serve";
    const cmd = `${base} --bg --https=${httpsPort}${pathFlag} ${target}`;
    return machineBash(machineId, cmd, "/");
}

export async function machineTailscaleServeStatus(
    machineId: string,
): Promise<MachineBashResult> {
    return machineBash(machineId, "tailscale serve status --json", "/");
}

// ---------------------------------------------------------------------------
// UPnP port mapping management
// ---------------------------------------------------------------------------

export async function machineUpnpAdd(
    machineId: string,
    localPort: number,
    externalPort: number,
    protocol: "TCP" | "UDP" = "TCP",
): Promise<MachineBashResult> {
    validatePort(localPort);
    validatePort(externalPort);
    // upnpc needs the local LAN IP — get it dynamically
    const cmd = `LOCAL_IP=$(python3 -c "import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.connect(('8.8.8.8',80)); print(s.getsockname()[0]); s.close()") && upnpc -a $LOCAL_IP ${localPort} ${externalPort} ${protocol} 7200`;
    return machineBash(machineId, cmd, "/");
}

export async function machineUpnpRemove(
    machineId: string,
    externalPort: number,
    protocol: "TCP" | "UDP" = "TCP",
): Promise<MachineBashResult> {
    validatePort(externalPort);
    return machineBash(machineId, `upnpc -d ${externalPort} ${protocol}`, "/");
}

export async function machineUpnpStatus(
    machineId: string,
): Promise<MachineBashResult> {
    return machineBash(machineId, "upnpc -l", "/");
}

// ---------------------------------------------------------------------------
// Tunnel RPC (provider-agnostic, used by Caddy/UPnP/etc)
// ---------------------------------------------------------------------------

export interface TunnelRpcResult {
    success: boolean;
    error?: string;
    state?: any;
}

export async function machineTunnelAdd(
    machineId: string,
    provider: string,
    params: { localPort: number; path?: string; hostname?: string; remotePort?: number; protocol?: string; publicAccess?: boolean },
): Promise<TunnelRpcResult> {
    try {
        return await apiSocket.machineRPC<TunnelRpcResult, any>(
            machineId, "tunnel-add", { provider, ...params },
        );
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function machineTunnelRemove(
    machineId: string,
    provider: string,
    params: { path?: string; hostname?: string; remotePort?: number; removeEntireSite?: boolean },
): Promise<TunnelRpcResult> {
    try {
        return await apiSocket.machineRPC<TunnelRpcResult, any>(
            machineId, "tunnel-remove", { provider, ...params },
        );
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function machineTunnelDetect(
    machineId: string,
): Promise<TunnelRpcResult> {
    try {
        return await apiSocket.machineRPC<TunnelRpcResult, any>(
            machineId, "tunnel-detect", {},
        );
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}

/** Allowed signals for machineKillProcess — whitelist to prevent abuse. */
const KILL_SIGNALS = new Set(["SIGTERM", "SIGKILL", "SIGINT"]);

/**
 * Kill a process on a machine by PID.
 * Safety: PID must be > 1, signal must be in whitelist.
 */
export async function machineKillProcess(
    machineId: string,
    pid: number,
    signal: string = "SIGTERM",
): Promise<MachineBashResult> {
    if (!Number.isInteger(pid) || pid <= 1) {
        return { success: false, error: `Invalid PID: ${pid}` };
    }
    if (!KILL_SIGNALS.has(signal)) {
        return { success: false, error: `Invalid signal: ${signal}` };
    }
    return machineBash(machineId, `kill -s ${signal} ${pid}`, "/");
}

/**
 * Update machine metadata with optimistic concurrency control and automatic retry
 */
export async function machineUpdateMetadata(
  machineId: string,
  metadata: MachineMetadata,
  expectedVersion: number,
  maxRetries: number = 3,
): Promise<{ version: number; metadata: string }> {
  let currentVersion = expectedVersion;
  let currentMetadata = { ...metadata };
  let retryCount = 0;

  const machineEncryption = sync.encryption.getMachineEncryption(machineId);
  if (!machineEncryption) {
    throw new Error(`Machine encryption not found for ${machineId}`);
  }

  while (retryCount < maxRetries) {
    const encryptedMetadata =
      await machineEncryption.encryptRaw(currentMetadata);

    const result = await apiSocket.emitWithAck<{
      result: "success" | "version-mismatch" | "error";
      version?: number;
      metadata?: string;
      message?: string;
    }>("machine-update-metadata", {
      machineId,
      metadata: encryptedMetadata,
      expectedVersion: currentVersion,
    });

    if (result.result === "success") {
      return {
        version: result.version!,
        metadata: result.metadata!,
      };
    } else if (result.result === "version-mismatch") {
      // Get the latest version and metadata from the response
      currentVersion = result.version!;
      const latestMetadata = (await machineEncryption.decryptRaw(
        result.metadata!,
      )) as MachineMetadata;

      // Merge our changes with the latest metadata
      // Preserve the displayName we're trying to set, but use latest values for other fields
      currentMetadata = {
        ...latestMetadata,
        displayName: metadata.displayName, // Keep our intended displayName change
      };

      retryCount++;

      // If we've exhausted retries, throw error
      if (retryCount >= maxRetries) {
        throw new Error(
          `Failed to update after ${maxRetries} retries due to version conflicts`,
        );
      }

      // Otherwise, loop will retry with updated version and merged metadata
    } else {
      throw new Error(result.message || "Failed to update machine metadata");
    }
  }

  throw new Error("Unexpected error in machineUpdateMetadata");
}

/**
 * Abort the current session operation (kills the process)
 */
export async function sessionAbort(sessionId: string): Promise<void> {
  await apiSocket.sessionRPC(sessionId, "abort", {
    reason: `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.`,
  });
}

/**
 * Discover installed Claude Code plugins on the target machine (legacy session-based)
 */
export async function sessionDiscoverPlugins(
    sessionId: string,
): Promise<{ plugins: Array<{ name: string; path: string }> }> {
    try {
        return await apiSocket.sessionRPC<
            { plugins: Array<{ name: string; path: string }> },
            Record<string, never>
        >(sessionId, "discoverPlugins", {});
    } catch {
        return { plugins: [] };
    }
}

/** Plugin metadata returned by the enriched discoverPlugins RPC. */
export interface PluginMeta {
    readonly name: string;
    readonly path: string;
    readonly version?: string;
    readonly description?: string;
    readonly author?: string;
    readonly homepage?: string;
    readonly license?: string;
    readonly keywords?: readonly string[];
    readonly counts: { readonly commands: number; readonly skills: number; readonly agents: number };
    readonly subPlugins?: ReadonlyArray<{
        readonly name: string;
        readonly description?: string;
        readonly category?: string;
    }>;
}

/** Extended detail returned by inspectPlugin RPC. */
export interface PluginDetail extends PluginMeta {
    readonly commandList?: readonly string[];
    readonly skillList?: readonly string[];
    readonly agentList?: readonly string[];
}

/**
 * Discover installed Claude Code plugins via machine RPC (no active session required).
 */
export async function machineDiscoverPlugins(
    machineId: string,
): Promise<{ plugins: readonly PluginMeta[] }> {
    try {
        return await apiSocket.machineRPC<
            { plugins: readonly PluginMeta[] },
            Record<string, never>
        >(machineId, "discoverPlugins", {});
    } catch {
        return { plugins: [] };
    }
}

/**
 * Inspect a single plugin for full detail (commands/skills/agents lists).
 */
export async function machineInspectPlugin(
    machineId: string,
    pluginPath: string,
): Promise<PluginDetail | null> {
    try {
        return await apiSocket.machineRPC<PluginDetail, { path: string }>(
            machineId,
            "inspectPlugin",
            { path: pluginPath },
        );
    } catch {
        return null;
    }
}

/** An individual installed plugin (from installed_plugins.json + enabledPlugins). */
export interface InstalledPlugin {
    readonly key: string; // e.g. "frontend-design@claude-plugins-official"
    readonly name: string;
    readonly marketplace: string;
    readonly version: string;
    readonly enabled: boolean;
    readonly scope: string;
    readonly installPath: string;
    readonly installedAt: string;
    readonly lastUpdated: string;
    readonly installs?: number;
    readonly description?: string;
}

/** A marketplace source (from known_marketplaces.json). */
export interface MarketplaceInfo {
    readonly name: string;
    readonly repo: string;
    readonly installLocation: string;
    readonly lastUpdated: string;
    readonly autoUpdate: boolean;
    readonly availableCount: number;
    readonly installedCount: number;
}

/**
 * List truly installed plugins with enabled state and descriptions.
 */
export async function machineListInstalledPlugins(
    machineId: string,
): Promise<{ plugins: readonly InstalledPlugin[] }> {
    try {
        return await apiSocket.machineRPC<
            { plugins: readonly InstalledPlugin[] },
            Record<string, never>
        >(machineId, "listInstalledPlugins", {});
    } catch {
        return { plugins: [] };
    }
}

/**
 * List marketplace sources with available/installed counts.
 */
export async function machineListMarketplaces(
    machineId: string,
): Promise<{ marketplaces: readonly MarketplaceInfo[] }> {
    try {
        return await apiSocket.machineRPC<
            { marketplaces: readonly MarketplaceInfo[] },
            Record<string, never>
        >(machineId, "listMarketplaces", {});
    } catch {
        return { marketplaces: [] };
    }
}

/** An available plugin from a marketplace (for Discover UI). */
export interface AvailablePlugin {
    readonly name: string;
    readonly key: string; // "plugin-name@marketplace"
    readonly marketplace: string;
    readonly description?: string;
    readonly category?: string;
    readonly homepage?: string;
    readonly installed: boolean;
    readonly enabled: boolean;
    readonly installs?: number;
}

/**
 * List all available plugins from all marketplaces (for Discover UI).
 */
export async function machineListAvailablePlugins(
    machineId: string,
): Promise<{ plugins: readonly AvailablePlugin[] }> {
    try {
        return await apiSocket.machineRPC<
            { plugins: readonly AvailablePlugin[] },
            Record<string, never>
        >(machineId, "listAvailablePlugins", {});
    } catch {
        return { plugins: [] };
    }
}

/**
 * Execute a plugin action via `claude plugin <action> <key>`.
 */
export async function machinePluginAction(
    machineId: string,
    action: "install" | "uninstall" | "enable" | "disable" | "update" | "marketplace-update" | "marketplace-add",
    pluginKey: string,
): Promise<MachineBashResult> {
    // Use "/" as cwd — bash handler treats it as "use shell default" (respects user's PATH)
    if (action === "marketplace-update") {
        return machineBash(machineId, `claude plugin marketplace update "${pluginKey}"`, "/");
    }
    if (action === "marketplace-add") {
        return machineBash(machineId, `claude plugin marketplace add "${pluginKey}"`, "/");
    }
    return machineBash(machineId, `claude plugin ${action} "${pluginKey}"`, "/");
}

// ── MCP Server Management ──

/** A configured MCP server. */
export interface McpServerInfo {
    readonly name: string;
    readonly command: string;
    readonly status: "connected" | "disconnected" | "error";
}

/**
 * List all configured MCP servers with connection status.
 */
export async function machineListMcpServers(
    machineId: string,
): Promise<{ servers: readonly McpServerInfo[] }> {
    try {
        return await apiSocket.machineRPC<
            { servers: readonly McpServerInfo[] },
            Record<string, never>
        >(machineId, "listMcpServers", {});
    } catch {
        return { servers: [] };
    }
}

/**
 * Add an MCP server via `claude mcp add`.
 */
export async function machineMcpAdd(
    machineId: string,
    name: string,
    command: string,
): Promise<MachineBashResult> {
    return machineBash(machineId, `claude mcp add -s user ${name} -- ${command}`, "/");
}

/**
 * Remove an MCP server via `claude mcp remove`.
 */
export async function machineMcpRemove(
    machineId: string,
    name: string,
): Promise<MachineBashResult> {
    return machineBash(machineId, `claude mcp remove "${name}" -s user`, "/");
}

/** A curated MCP server from the catalog. */
export interface AvailableMcpServer {
    readonly name: string;
    readonly pkg: string;
    readonly description: string;
    readonly category: string;
    readonly envHint?: string;
    readonly installed: boolean;
}

/**
 * List curated MCP servers with install status.
 */
export async function machineListAvailableMcpServers(
    machineId: string,
): Promise<{ servers: readonly AvailableMcpServer[] }> {
    try {
        return await apiSocket.machineRPC<
            { servers: readonly AvailableMcpServer[] },
            Record<string, never>
        >(machineId, "listAvailableMcpServers", {});
    } catch {
        return { servers: [] };
    }
}

/**
 * Interrupt the current session operation (graceful, keeps process alive)
 */
export async function sessionInterrupt(sessionId: string): Promise<void> {
  await apiSocket.sessionRPC(sessionId, "interrupt", {});
}

/**
 * Stop a specific background task
 */
export async function sessionStopTask(
  sessionId: string,
  taskId: string,
): Promise<void> {
  await apiSocket.sessionRPC(sessionId, "stopTask", { taskId });
}

/**
 * Allow a permission request
 */
export async function sessionAllow(
  sessionId: string,
  id: string,
  mode?: "default" | "acceptEdits" | "bypassPermissions" | "plan",
  allowedTools?: string[],
  decision?: "approved" | "approved_for_session",
  answers?: Record<string, string>,
): Promise<void> {
  // Clear needsAttention when user handles a permission request
  const session = storage.getState().sessions[sessionId];
  if (session?.needsAttention) {
    storage.getState().applySessions([{ ...session, needsAttention: false }]);
  }

  const request: SessionPermissionRequest = {
    id,
    approved: true,
    mode,
    allowTools: allowedTools,
    decision,
    ...(answers && { answers }),
  };
  await apiSocket.sessionRPC(sessionId, "permission", request);
}

/**
 * Deny a permission request
 */
export async function sessionDeny(
  sessionId: string,
  id: string,
  mode?: "default" | "acceptEdits" | "bypassPermissions" | "plan",
  allowedTools?: string[],
  decision?: "denied" | "abort",
  reason?: string,
): Promise<void> {
  // Clear needsAttention when user handles a permission request
  const session = storage.getState().sessions[sessionId];
  if (session?.needsAttention) {
    storage.getState().applySessions([{ ...session, needsAttention: false }]);
  }

  const request: SessionPermissionRequest = {
    id,
    approved: false,
    mode,
    allowTools: allowedTools,
    decision,
    reason,
  };
  await apiSocket.sessionRPC(sessionId, "permission", request);
}

/**
 * Request mode change for a session
 */
export async function sessionSwitch(
  sessionId: string,
  to: "remote" | "local",
): Promise<boolean> {
  const request: SessionModeChangeRequest = { to };
  const response = await apiSocket.sessionRPC<
    boolean,
    SessionModeChangeRequest
  >(sessionId, "switch", request);
  return response;
}

/**
 * Execute a bash command in the session
 */
export async function sessionBash(
  sessionId: string,
  request: SessionBashRequest,
): Promise<SessionBashResponse> {
  try {
    const response = await apiSocket.sessionRPC<
      SessionBashResponse,
      SessionBashRequest
    >(sessionId, "bash", request);
    return response;
  } catch (error) {
    return {
      success: false,
      stdout: "",
      stderr: getErrorMessage(error),
      exitCode: -1,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Subscribe to real-time log streaming for a background task.
 * CLI will start watching the output file and push incremental chunks.
 */
export async function subscribeTaskLog(
    sessionId: string,
    taskId: string,
    outputFile: string,
): Promise<{ ok: boolean; already?: boolean }> {
    try {
        return await apiSocket.sessionRPC<
            { ok: boolean; already?: boolean },
            { taskId: string; outputFile: string }
        >(sessionId, "subscribeTaskLog", { taskId, outputFile });
    } catch {
        return { ok: false };
    }
}

/**
 * Unsubscribe from real-time log streaming for a background task.
 */
export async function unsubscribeTaskLog(
    sessionId: string,
    taskId: string,
): Promise<{ ok: boolean }> {
    try {
        return await apiSocket.sessionRPC<
            { ok: boolean },
            { taskId: string }
        >(sessionId, "unsubscribeTaskLog", { taskId });
    } catch {
        return { ok: false };
    }
}

/**
 * Read a file from the session
 */
export async function sessionReadFile(
  sessionId: string,
  path: string,
): Promise<SessionReadFileResponse> {
  try {
    const request: SessionReadFileRequest = { path };
    const response = await apiSocket.sessionRPC<
      SessionReadFileResponse,
      SessionReadFileRequest
    >(sessionId, "readFile", request);
    return response;
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Write a file to the session
 */
export async function sessionWriteFile(
  sessionId: string,
  path: string,
  content: string,
  expectedHash?: string | null,
): Promise<SessionWriteFileResponse> {
  try {
    const request: SessionWriteFileRequest = { path, content, expectedHash };
    const response = await apiSocket.sessionRPC<
      SessionWriteFileResponse,
      SessionWriteFileRequest
    >(sessionId, "writeFile", request);
    return response;
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * List directory contents in the session
 */
export async function sessionListDirectory(
  sessionId: string,
  path: string,
): Promise<SessionListDirectoryResponse> {
  try {
    const request: SessionListDirectoryRequest = { path };
    const response = await apiSocket.sessionRPC<
      SessionListDirectoryResponse,
      SessionListDirectoryRequest
    >(sessionId, "listDirectory", request);
    return response;
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Get directory tree from the session
 */
export async function sessionGetDirectoryTree(
  sessionId: string,
  path: string,
  maxDepth: number,
): Promise<SessionGetDirectoryTreeResponse> {
  try {
    const request: SessionGetDirectoryTreeRequest = { path, maxDepth };
    const response = await apiSocket.sessionRPC<
      SessionGetDirectoryTreeResponse,
      SessionGetDirectoryTreeRequest
    >(sessionId, "getDirectoryTree", request);
    return response;
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Run ripgrep in the session
 */
export async function sessionRipgrep(
  sessionId: string,
  args: string[],
  cwd?: string,
): Promise<SessionRipgrepResponse> {
  try {
    const request: SessionRipgrepRequest = { args, cwd };
    const response = await apiSocket.sessionRPC<
      SessionRipgrepResponse,
      SessionRipgrepRequest
    >(sessionId, "ripgrep", request);
    return response;
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

/**
 * Kill the session process immediately
 */
export async function sessionKill(
  sessionId: string,
): Promise<SessionKillResponse> {
  try {
    const response = await apiSocket.sessionRPC<SessionKillResponse, {}>(
      sessionId,
      "killSession",
      {},
    );
    return response;
  } catch (error) {
    return {
      success: false,
      message: getErrorMessage(error),
    };
  }
}

/**
 * Permanently delete a session from the server
 * This will remove the session and all its associated data (messages, usage reports, access keys)
 * The session should be inactive/archived before deletion
 */
export async function sessionDelete(
  sessionId: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await apiSocket.request(`/v1/sessions/${sessionId}`, {
      method: "DELETE",
    });

    if (response.ok) {
      const result = await response.json();
      return { success: true };
    } else {
      const error = await response.text();
      return {
        success: false,
        message: error || "Failed to delete session",
      };
    }
  } catch (error) {
    return {
      success: false,
      message: getErrorMessage(error),
    };
  }
}

/**
 * Restore an archived session back to active state
 */
export async function sessionRestore(
  sessionId: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await apiSocket.request(`/v1/sessions/${sessionId}/restore`, {
      method: "PATCH",
    });

    if (response.ok) {
      return { success: true };
    } else {
      const error = await response.text();
      return {
        success: false,
        message: error || "Failed to restore session",
      };
    }
  } catch (error) {
    return {
      success: false,
      message: getErrorMessage(error),
    };
  }
}

// Export types for external use
export type {
  SessionBashRequest,
  SessionReadFileResponse,
  SessionWriteFileResponse,
  SessionListDirectoryResponse,
  SessionGetDirectoryTreeResponse,
  TreeNode,
  SessionRipgrepResponse,
  SessionKillResponse,
  PlanFileContentResponse,
};

/**
 * Response type for getPlanFileContent RPC
 */
interface PlanFileContentResponse {
    content: string | null;
    filePath: string | null;
}

/**
 * Fetch the saved plan file content from the CLI
 */
export async function sessionGetPlanFileContent(
    sessionId: string,
): Promise<PlanFileContentResponse> {
    try {
        const response = await apiSocket.sessionRPC<
            PlanFileContentResponse,
            Record<string, never>
        >(sessionId, "getPlanFileContent", {});
        return response;
    } catch {
        return { content: null, filePath: null };
    }
}

interface CancelQueuedMessageResponse {
    cancelled: boolean;
}

/**
 * Cancel a queued message that hasn't been processed yet
 */
export async function sessionCancelQueuedMessage(
    sessionId: string,
    localKey: string,
): Promise<boolean> {
    try {
        const response = await apiSocket.sessionRPC<
            CancelQueuedMessageResponse,
            { localKey: string }
        >(sessionId, "cancelQueuedMessage", { localKey });
        return response.cancelled;
    } catch {
        return false;
    }
}

/**
 * Fork a session from a specific point, creating a new session with context up to that message
 */
export async function sessionForkSession(
    sessionId: string,
    opts: { upToMessageId?: string; title?: string },
): Promise<{ claudeSessionId: string; path: string } | { error: string }> {
    try {
        const response = await apiSocket.sessionRPC<
            { claudeSessionId?: string; path?: string; error?: string },
            { upToMessageId?: string; title?: string }
        >(sessionId, "forkSession", opts);
        if (response.error || !response.claudeSessionId || !response.path) {
            return { error: response.error ?? "Fork failed" };
        }
        return { claudeSessionId: response.claudeSessionId, path: response.path };
    } catch (err) {
        return { error: err instanceof Error ? err.message : "Fork failed" };
    }
}

/**
 * Rewind files to their state at a specific user message.
 * Call with dryRun=true first to preview changes, then dryRun=false to execute.
 */
export async function sessionRewindFiles(
    sessionId: string,
    userMessageId: string,
    dryRun: boolean,
): Promise<{
    canRewind: boolean;
    error?: string;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
}> {
    try {
        return await apiSocket.sessionRPC<
            { canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number },
            { userMessageId: string; dryRun: boolean }
        >(sessionId, "rewindFiles", { userMessageId, dryRun });
    } catch (err) {
        return { canRewind: false, error: err instanceof Error ? err.message : "Rewind failed" };
    }
}

/**
 * Respond to an MCP elicitation request
 */
export async function sessionElicitationResponse(
    sessionId: string,
    elicitationId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
): Promise<void> {
    try {
        await apiSocket.sessionRPC<void, { id: string; action: string; content?: Record<string, unknown> }>(
            sessionId,
            "elicitationResponse",
            { id: elicitationId, action, content },
        );
    } catch {
        // Best-effort — elicitation may have already been cancelled
    }
}
