/**
 * Session operations for remote procedure calls
 * Provides strictly typed functions for all session-related RPC operations
 */

import { apiSocket } from "./apiSocket";
import { sync } from "./sync";
import { storage } from "./storage";
import type { MachineMetadata } from "./storageTypes";
import { getErrorMessage } from "@/utils/errors";
import { getServerUrl } from "./serverConfig";
import type { SpawnSessionResult } from "@kmmao/happy-wire";
export type { SpawnSessionResult };

/**
 * Run a machine RPC and convert a thrown transport/timeout error into the
 * operation's own result-object failure value. The single home for the
 * "fallible, UI-surfaced op reports failure as a value (not a throw)"
 * convention — see ADR-0034. `onError` builds the failure object so each op
 * keeps its own result contract while the try/catch + getErrorMessage skeleton
 * lives in one place.
 */
async function tryMachineOp<R>(
  op: () => Promise<R>,
  onError: (message: string) => R,
): Promise<R> {
  try {
    return await op();
  } catch (error) {
    return onError(getErrorMessage(error));
  }
}
type ResolvedRuntimeProfile = {
  profileId?: string;
  profileName?: string;
  source?: "built-in-profile" | "account-profile" | "local-profile" | "ad-hoc";
  trust?: "trusted" | "untrusted";
  environmentVariables?: Record<string, string>;
  defaultModelMode?: string;
  [key: string]: unknown;
};

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
  /**
   * ExitPlanMode "Clear context & execute" opt-in. When true, the CLI runs
   * `/clear` (context → 0, no model call) then injects the approved plan body
   * as the first instruction of a fresh session, sidestepping Anthropic's
   * 200K long-context billing line that otherwise 429s on the full --resume
   * replay. See docs/investigations/plan-mode-429.md (Layer 0).
   */
  clearContext?: boolean;
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
interface SessionKillResponse {
  success: boolean;
  message: string;
}

// Options for spawning a session
export interface SpawnSessionOptions {
  machineId: string;
  directory: string;
  approvedNewDirectoryCreation?: boolean;
  token?: string;
  agent?: "codex" | "claude" | "gemini";
  // Claude Code session ID for --resume (resumes an existing session with full context)
  claudeSessionId?: string;
  // Happy session ID for reconnecting to the same Happy session (or pre-allocating for fork)
  happySessionId?: string;
  // Source session ID when forking — daemon writes --happy-fork-source so diagnostics can identify & navigate forks
  forkSourceId?: string;
  // Profile ID — sent to daemon so it can verify trust (profile exists in local settings)
  // Trusted profiles are allowed to override operator-only env vars (ANTHROPIC_BASE_URL, etc.)
  profileId?: string;
  // Unified runtime profile resolved before session spawn.
  runtimeProfile?: ResolvedRuntimeProfile;
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
    forkSourceId,
    profileId,
    runtimeProfile,
    environmentVariables,
  } = options;

  try {
    const normalizedRuntimeProfile = runtimeProfile
      ? (await import("@kmmao/happy-wire")).normalizeResolvedRuntimeProfile(runtimeProfile)
      : null;
    if (runtimeProfile && !normalizedRuntimeProfile) {
      return {
        type: "error",
        errorMessage: "Runtime profile payload is invalid or unsupported",
      };
    }

    // Global kill-switch only. Per-project mode/sensitivity/track options are
    // synced from server `knowledgeConfig` at runtime via syncKnowledgeConfig().
    const settings = storage.getState().settings;
    const knowledgeEnvVars: Record<string, string> = {
        HAPPY_KNOWLEDGE_BASE: settings.knowledgeBase ? "true" : "false",
    };

    // Caller env vars (e.g. from profile) take precedence
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
        forkSourceId?: string;
        profileId?: string;
        runtimeProfile?: ResolvedRuntimeProfile;
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
      forkSourceId,
      profileId: profileId ?? normalizedRuntimeProfile?.profileId,
      runtimeProfile: normalizedRuntimeProfile ?? undefined,
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

export async function machineRemoveAutomationJob(
  machineId: string,
  jobId: string,
): Promise<{ success: boolean; errorMessage?: string; job?: MachineAutomationJob }> {
  return apiSocket.machineRPC(
    machineId,
    "automation-remove",
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
  maxUsdPerRun?: number;
  maxUsdPerDay?: number;
  todayCostUsd?: number;
  todayCostWindowStartedAt?: number;
  totalCostUsd?: number;
  lastRunCostUsd?: number;
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
  maxUsdPerRun?: number;
  maxUsdPerDay?: number;
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
  maxUsdPerRun?: number | null;
  maxUsdPerDay?: number | null;
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

/**
 * AI-powered loop suggestion using a two-step approach that mirrors the
 * dimension prompt generation pattern in supervisorDimensionRoutes:
 *
 * 1. CLI RPC "loop-get-context": daemon reads project files (README, package.json,
 *    CLAUDE.md, directory listing) and returns a context string.
 * 2. Server POST /v1/agent-loops/suggest-ai: server uses the user's stored AI
 *    credentials (AiBackendProfile or server env) to call Anthropic/OpenAI and
 *    generate loop suggestions — no API key needed in the daemon environment.
 */
export async function machineAISuggestAgentLoops(
  machineId: string,
  directory: string,
  authToken: string,
  profileId?: string,
): Promise<MachineAgentLoopSuggestion[]> {
  // Step 1: gather project context from CLI daemon
  const { context } = await apiSocket.machineRPC<
    { context: string },
    { directory: string }
  >(machineId, "loop-get-context", { directory });

  // Step 2: server calls AI with user credentials
  const response = await fetch(`${getServerUrl()}/v1/agent-loops/suggest-ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ directory, context, profileId: profileId ?? null }),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `AI loop suggestion failed: ${response.status}`);
  }

  const data = (await response.json()) as { suggestions: MachineAgentLoopSuggestion[] };
  return data.suggestions ?? [];
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
 * Upgrade the CLI on a specific machine via a dedicated daemon RPC.
 * The daemon owns the install + restart flow so App no longer has to
 * assemble shell commands or care about platform-specific behavior.
 */
const VERSION_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

export async function machineUpgradeCli(
  machineId: string,
  targetVersion: string,
): Promise<MachineBashResult> {
  if (!VERSION_RE.test(targetVersion)) {
    return { success: false, error: `Invalid version format: ${targetVersion}` };
  }
  try {
    return await apiSocket.machineRPC<
      MachineBashResult,
      {
        targetVersion: string;
      }
    >(machineId, "upgrade-self", { targetVersion });
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

export async function waitForMachineCliVersion(
  machineId: string,
  targetVersion: string,
  opts?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  },
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 75_000;
  const pollIntervalMs = opts?.pollIntervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  const hasTargetVersion = () =>
    storage.getState().machines[machineId]?.daemonState?.startedWithCliVersion ===
    targetVersion;

  if (hasTargetVersion()) {
    return true;
  }

  while (Date.now() < deadline) {
    try {
      await sync.refreshMachines();
    } catch {
      // Best-effort polling — keep waiting until timeout
    }

    if (hasTargetVersion()) {
      return true;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      break;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollIntervalMs, remainingMs)),
    );
  }

  return hasTargetVersion();
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

export interface MachineDoctorCleanResult {
  readonly success: boolean;
  readonly killed: number;
  readonly errors: readonly { pid: number; error: string }[];
  readonly error?: string;
}

export async function machineBash(
  machineId: string,
  command: string,
  cwd: string,
  timeout?: number,
): Promise<MachineBashResult> {
  return tryMachineOp(
    () =>
      apiSocket.machineRPC<
        MachineBashResult,
        { command: string; cwd: string; timeout?: number }
      >(machineId, "bash", { command, cwd, ...(timeout != null && { timeout }) }),
    (error) => ({ success: false, stdout: "", stderr: error, exitCode: -1, error }),
  );
}

export async function machineCleanRunawayProcesses(
  machineId: string,
): Promise<MachineDoctorCleanResult> {
  return tryMachineOp<MachineDoctorCleanResult>(
    async () => {
      const result = await apiSocket.machineRPC<
        { success: boolean; killed?: number; errors?: readonly { pid: number; error: string }[] },
        Record<string, never>
      >(machineId, "doctor-clean", {});
      return {
        success: Boolean(result.success),
        killed: result.killed ?? 0,
        errors: result.errors ?? [],
      };
    },
    (error) => ({ success: false, killed: 0, errors: [], error }),
  );
}

export interface StaleSessionInfo {
  pid: number;
  happySessionId?: string;
  spawnId?: string;
  startedAt?: number;
  lastHeartbeatAt?: number;
  lastActivityAt?: number;
  tmuxSessionId?: string;
  reason: "dead" | "silent";
  silentMs?: number;
}

export interface MachineStaleSessionsResult {
  success: boolean;
  stale: StaleSessionInfo[];
  checkedAt: number;
  thresholdMs: number;
  error?: string;
}

export interface MachineStaleSessionsCleanResult {
  success: boolean;
  killed: number;
  errors: readonly { pid: number; error: string }[];
  error?: string;
}

export interface TrackedSessionInfo {
  pid: number;
  happySessionId?: string;
  spawnId?: string;
  startedAt?: number;
}

/** List all daemon-tracked sessions (PID → Happy session ID mapping). */
export async function machineListTrackedSessions(
  machineId: string,
): Promise<{ success: boolean; sessions: TrackedSessionInfo[]; error?: string }> {
  try {
    const result = await apiSocket.machineRPC<
      { sessions: TrackedSessionInfo[] },
      Record<string, never>
    >(machineId, "list-tracked-sessions", {});
    return { success: true, sessions: result.sessions ?? [] };
  } catch (error) {
    return { success: false, sessions: [], error: getErrorMessage(error) };
  }
}

/** List daemon-tracked sessions whose heartbeat has gone silent or whose pid is dead. */
export async function machineListStaleSessions(
  machineId: string,
): Promise<MachineStaleSessionsResult> {
  try {
    const result = await apiSocket.machineRPC<
      {
        stale: readonly StaleSessionInfo[];
        checkedAt: number;
        thresholdMs: number;
      },
      Record<string, never>
    >(machineId, "list-stale-sessions", {});
    return {
      success: true,
      stale: [...(result.stale ?? [])],
      checkedAt: result.checkedAt ?? Date.now(),
      thresholdMs: result.thresholdMs ?? 0,
    };
  } catch (error) {
    return {
      success: false,
      stale: [],
      checkedAt: Date.now(),
      thresholdMs: 0,
      error: getErrorMessage(error),
    };
  }
}

/** Kill the given pids via the daemon; daemon validates each pid is tracked first. */
export async function machineCleanStaleSessions(
  machineId: string,
  pids: readonly number[],
): Promise<MachineStaleSessionsCleanResult> {
  try {
    const result = await apiSocket.machineRPC<
      { killed: number; errors: readonly { pid: number; error: string }[] },
      { pids: readonly number[] }
    >(machineId, "clean-stale-sessions", { pids });
    return {
      success: true,
      killed: result.killed ?? 0,
      errors: result.errors ?? [],
    };
  } catch (error) {
    return {
      success: false,
      killed: 0,
      errors: [],
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
    return tryMachineOp(
        () => apiSocket.machineRPC<TunnelRpcResult, any>(
            machineId, "tunnel-add", { provider, ...params },
        ),
        (error) => ({ success: false, error }),
    );
}

export async function machineTunnelRemove(
    machineId: string,
    provider: string,
    params: { path?: string; hostname?: string; remotePort?: number; removeEntireSite?: boolean },
): Promise<TunnelRpcResult> {
    return tryMachineOp(
        () => apiSocket.machineRPC<TunnelRpcResult, any>(
            machineId, "tunnel-remove", { provider, ...params },
        ),
        (error) => ({ success: false, error }),
    );
}

export async function machineTunnelDetect(
    machineId: string,
): Promise<TunnelRpcResult> {
    return tryMachineOp(
        () => apiSocket.machineRPC<TunnelRpcResult, any>(
            machineId, "tunnel-detect", {},
        ),
        (error) => ({ success: false, error }),
    );
}

/** Signal name → number mapping (POSIX portable, works in /bin/sh). */
const KILL_SIGNAL_NUMS: Record<string, number> = {
    SIGTERM: 15,
    SIGKILL: 9,
    SIGINT: 2,
};

/**
 * Kill a process on a machine by PID.
 * Safety: PID must be > 1, signal must be in whitelist.
 * Uses numeric signal (-15 / -9 / -2) for /bin/sh compatibility.
 */
export async function machineKillProcess(
    machineId: string,
    pid: number,
    signal: string = "SIGTERM",
): Promise<MachineBashResult> {
    if (!Number.isInteger(pid) || pid <= 1) {
        return { success: false, error: `Invalid PID: ${pid}` };
    }
    const sigNum = KILL_SIGNAL_NUMS[signal];
    if (sigNum === undefined) {
        return { success: false, error: `Invalid signal: ${signal}` };
    }
    return machineBash(machineId, `kill -${sigNum} ${pid}`, "/");
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
 * Dispatch an authoritative `/goal` action for a session.
 *
 * PTY-mode Claude has no dedicated goal RPC — the TUI drives goal state through
 * the `/goal` slash command, which flows through the normal message queue. So a
 * clear/edit action is sent as a `/goal` message; the CLI's transcript scanner
 * then reports the resulting authoritative state back into agentState. `stop`
 * is a no-op placeholder (Claude has no goal-pause command).
 */
export async function sessionGoalAction(
  sessionId: string,
  action: "clear" | "stop" | "edit",
  objective?: string,
): Promise<void> {
  if (action === "stop") {
    return;
  }
  const command =
    action === "edit" && objective ? `/goal ${objective}` : "/goal clear";
  await sync.sendMessage(sessionId, command);
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
  try {
    await apiSocket.sessionRPC(sessionId, "permission", request);
  } catch (error) {
    // Diagnostic tap: AskUserQuestion's submit button occasionally flashes
    // and silently drops the answer because AskUserQuestionView's own catch
    // swallows this error. Surface the real RPC error in DevTools while we
    // decide whether to add user-facing retry/toast.
    console.error(
      `[sessionAllow] RPC failed (sessionId=${sessionId}, permissionId=${id}):`,
      error,
    );
    throw error;
  }
}

/**
 * Approve an ExitPlanMode plan with "Clear context & execute" (fresh context).
 *
 * Thin wrapper over the `permission` RPC: sends `clearContext: true` and leaves
 * `mode` unset so the CLI keeps the session's current permission mode (matching
 * plain "Approve plan" — see permissionHandler.ts `requestedMode ?? this.permissionMode`).
 * The CLI's `onExitPlanApproval` branches on `clearContext` to run `/clear` then
 * inject the plan body into a new session, instead of the full --resume replay.
 */
export async function sessionAllowPlanFreshContext(
  sessionId: string,
  id: string,
): Promise<void> {
  // Clear needsAttention when user handles a permission request (mirrors sessionAllow)
  const session = storage.getState().sessions[sessionId];
  if (session?.needsAttention) {
    storage.getState().applySessions([{ ...session, needsAttention: false }]);
  }

  const request: SessionPermissionRequest = {
    id,
    approved: true,
    clearContext: true,
  };
  try {
    await apiSocket.sessionRPC(sessionId, "permission", request);
  } catch (error) {
    console.error(
      `[sessionAllowPlanFreshContext] RPC failed (sessionId=${sessionId}, permissionId=${id}):`,
      error,
    );
    throw error;
  }
}

/**
 * Submit answers for an `mcp__happy__ask_user` MCP tool invocation.
 *
 * Separate from `sessionAllow` because the underlying RPC handler is
 * registered by happy-cli's Happy MCP server (not the SDK permission flow),
 * so it speaks a leaner schema with just `{ askId, answers }`. Keeping the
 * two RPC paths apart means native AskUserQuestion (SDK mode) and the MCP
 * variant (PTY mode) can coexist without one tripping over the other.
 */
export async function sessionAskUserResponse(
  sessionId: string,
  askId: string,
  answers: Record<string, string>,
  options?: { canceled?: boolean },
): Promise<void> {
  // Mirror sessionAllow: dismiss needs-attention dot as soon as the user
  // engages, so the App's session-list badge clears even before the RPC
  // completes (which can be slow on flaky links).
  const session = storage.getState().sessions[sessionId];
  if (session?.needsAttention) {
    storage.getState().applySessions([{ ...session, needsAttention: false }]);
  }

  try {
    await apiSocket.sessionRPC(sessionId, "ask_user_response", {
      askId,
      answers,
      // Only include the flag when explicitly set so older CLI builds — whose
      // wire schema is .strict() and rejects unknown fields — keep accepting
      // the call. Once everyone is on @kmmao/happy-wire >= 0.22.4 this guard
      // can go away.
      ...(options?.canceled ? { canceled: true } : {}),
    });
  } catch (error) {
    console.error(
      `[sessionAskUserResponse] RPC failed (sessionId=${sessionId}, askId=${askId}):`,
      error,
    );
    throw error;
  }
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

function getSessionRpcUnavailableError(sessionId: string): string | null {
  const session = storage.getState().sessions[sessionId];
  if (!session) {
    return "Session not found";
  }
  if (!session.rpcReady) {
    return "Session RPC not ready";
  }
  return null;
}

/**
 * Execute a bash command in the session
 */
export async function sessionBash(
  sessionId: string,
  request: SessionBashRequest,
): Promise<SessionBashResponse> {
  const rpcError = getSessionRpcUnavailableError(sessionId);
  if (rpcError) {
    return {
      success: false,
      stdout: "",
      stderr: rpcError,
      exitCode: -1,
      error: rpcError,
    };
  }
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
    if (getSessionRpcUnavailableError(sessionId)) {
        return { ok: false };
    }
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
    if (getSessionRpcUnavailableError(sessionId)) {
        return { ok: false };
    }
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
  const rpcError = getSessionRpcUnavailableError(sessionId);
  if (rpcError) {
    return {
      success: false,
      error: rpcError,
    };
  }
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
  const rpcError = getSessionRpcUnavailableError(sessionId);
  if (rpcError) {
    return {
      success: false,
      error: rpcError,
    };
  }
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
  const rpcError = getSessionRpcUnavailableError(sessionId);
  if (rpcError) {
    return {
      success: false,
      error: rpcError,
    };
  }
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
  const rpcError = getSessionRpcUnavailableError(sessionId);
  if (rpcError) {
    return {
      success: false,
      error: rpcError,
    };
  }
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
  const rpcError = getSessionRpcUnavailableError(sessionId);
  if (rpcError) {
    return {
      success: false,
      stdout: "",
      stderr: rpcError,
      exitCode: -1,
      error: rpcError,
    };
  }
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
  const rpcError = getSessionRpcUnavailableError(sessionId);
  if (rpcError) {
    return {
      success: false,
      message: rpcError,
    };
  }
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
      await response.json();
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
 * Remove an archived session from the archived list without restarting it.
 * This is a state-only unarchive, not a runtime resume.
 */
export async function sessionUnarchive(
  sessionId: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await apiSocket.request(`/v1/sessions/${sessionId}/unarchive`, {
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

/**
 * Server-side fallback to archive a session when the killSession RPC cannot
 * reach the daemon. Sets active=false on the server and signals the daemon
 * to terminate the process if it is still running.
 */
export async function sessionArchive(
  sessionId: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const response = await apiSocket.request(`/v1/sessions/${sessionId}/archive`, {
      method: "PATCH",
    });

    if (response.ok) {
      return { success: true };
    } else {
      const error = await response.text();
      return {
        success: false,
        message: error || "Failed to archive session",
      };
    }
  } catch (error) {
    return {
      success: false,
      message: getErrorMessage(error),
    };
  }
}

export async function archiveSessionWithKill(
  sessionId: string,
): Promise<{ success: boolean; message?: string }> {
  const killResult = await sessionKill(sessionId);
  const archiveResult = await sessionArchive(sessionId);

  if (!archiveResult.success) {
    return {
      success: false,
      message:
        archiveResult.message ||
        killResult.message ||
        "Failed to archive session",
    };
  }

  return { success: true };
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

/**
 * Fetch the compaction summary from the CLI (reads the session JSONL file).
 * Returns null when no summary exists (fresh session or no compaction has occurred).
 */
export async function sessionGetCompactionSummary(
    sessionId: string,
): Promise<string | null> {
    try {
        const response = await apiSocket.sessionRPC<
            { summary: string | null },
            Record<string, never>
        >(sessionId, "getCompactionSummary", {});
        return response.summary ?? null;
    } catch {
        return null;
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

// ---------------------------------------------------------------------------
// Web Terminal
// ---------------------------------------------------------------------------

export interface TerminalSpawnResult {
    success: boolean;
    terminalId?: string;
    recentOutput?: string; // buffered output for reattach replay
    isExisting?: boolean;  // true when reattaching to an existing session terminal
    error?: string;
}

export interface TerminalListItem {
    id: string;
    createdAt: number;
    cols: number;
    rows: number;
    cwd: string;
}

export async function machineTerminalList(
    machineId: string,
    sessionId: string,
): Promise<{ success: boolean; terminals?: TerminalListItem[]; error?: string }> {
    try {
        return await apiSocket.machineRPC(machineId, "terminal-list", { sessionId });
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}

type MachineTerminalSpawnOptions = {
    shell?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
    sessionId?: string;
    terminalId?: string;
};

export async function machineTerminalSpawn(
    machineId: string,
    options?: MachineTerminalSpawnOptions,
): Promise<TerminalSpawnResult> {
    try {
        return await apiSocket.machineRPC<TerminalSpawnResult, MachineTerminalSpawnOptions>(
            machineId,
            "terminal-spawn",
            options ?? {},
        );
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function machineTerminalResize(
    machineId: string,
    terminalId: string,
    cols: number,
    rows: number,
): Promise<{ success: boolean; error?: string }> {
    try {
        return await apiSocket.machineRPC(machineId, "terminal-resize", { terminalId, cols, rows });
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function machineTerminalClose(
    machineId: string,
    terminalId: string,
): Promise<{ success: boolean; error?: string }> {
    try {
        return await apiSocket.machineRPC(machineId, "terminal-close", { terminalId });
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}

export async function machineTerminalCloseAll(
    machineId: string,
): Promise<{ success: boolean; closed?: number; error?: string }> {
    try {
        return await apiSocket.machineRPC(machineId, "terminal-closeAll", {});
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}

/**
 * Send terminal input (keystrokes) via ephemeral socket event.
 * Not using RPC because terminal input needs lowest latency.
 */
export function machineTerminalInput(
    machineId: string,
    terminalId: string,
    data: string,
): void {
    apiSocket.send("terminal-input", { machineId, terminalId, data });
}

// ---------------------------------------------------------------------------
// Claude PTY (dedicated side panel "Claude" tab)
// ---------------------------------------------------------------------------
//
// `terminal-spawn` / `terminal-list` are shells-only now; the Claude TUI PTY
// owned by claudePtyRuntime in the session child is reached through this
// dedicated RPC instead. resize / close / input keep using the shared
// terminal-* paths (they route by terminalId straight to the ManagedPty
// adapter on the daemon side — see TerminalManager).

export interface ClaudePtyAttachResult {
    success: boolean;
    /**
     * `false` means the session is online but no Claude TUI is currently
     * attached. The App should render a "Claude not running" placeholder.
     */
    exists?: boolean;
    terminalId?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    createdAt?: number;
    /** Recent PTY output for replay on first attach. */
    snapshot?: string;
    error?: string;
}

export async function machineClaudePtyAttach(
    machineId: string,
    sessionId: string,
): Promise<ClaudePtyAttachResult> {
    try {
        return await apiSocket.machineRPC(machineId, "claude-pty-attach", { sessionId });
    } catch (error) {
        return { success: false, error: getErrorMessage(error) };
    }
}
