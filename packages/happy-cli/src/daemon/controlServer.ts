import fastify from "fastify";
import { z } from "zod";
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod";
import { logger } from "@/ui/logger";
import { Metadata } from "@/api/types";
import { TrackedSession } from "./types";
import {
  SpawnSessionOptions,
  SpawnSessionResult,
} from "@/modules/common/registerCommonHandlers";
import type { AutomationJob, AutomationMutationResult } from "@/automation/types";
import type { AgentLoopDefinition } from "@/automation/AgentLoopStore";
import type { AgentLoopCreateInput, AgentLoopMutationResult, AgentLoopUpdateInput } from "@/automation/AgentLoopCoordinator";
import type { AgentLoopBootstrapCreateInput, AgentLoopBootstrapMutationResult, AgentLoopBootstrapUpdateInput } from "@/automation/AgentLoopBootstrapCoordinator";
import type { AgentLoopBootstrapProfile } from "@/automation/AgentLoopBootstrapStore";
import type { AutoDreamCreateInput, AutoDreamMutationResult, AutoDreamUpdateInput } from "@/automation/AutoDreamCoordinator";
import type { AutoDreamProfile } from "@/automation/AutoDreamStore";

const automationJobSchema = z.object({
  id: z.string(),
  kind: z.enum(["supervisor", "webhook", "agent_loop", "task"]),
  status: z.enum(["queued", "dispatching", "running", "completed", "failed", "cancelled"]),
  priority: z.enum(["urgent", "user", "background"]),
  dedupeKey: z.string(),
  attempt: z.number(),
  maxAttempts: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  nextRunAt: z.number().optional(),
  dispatchedAt: z.number().optional(),
  completedAt: z.number().optional(),
  sessionId: z.string().optional(),
  completionMode: z.enum(["immediate", "session"]).optional(),
  label: z.string().optional(),
  projectId: z.string().optional(),
  runId: z.string().optional(),
  loopId: z.string().optional(),
  loopIteration: z.number().optional(),
  continuityKey: z.string().optional(),
  errorMessage: z.string().optional(),
  recovered: z.boolean().optional(),
  payload: z.any(),
});

const automationGuardianSchema = z.object({
  key: z.string(),
  projectId: z.string(),
  loopId: z.string().optional(),
  sessionId: z.string(),
  updatedAt: z.number(),
  lastRunId: z.string().optional(),
  attached: z.boolean().optional(),
  recovered: z.boolean().optional(),
});

const automationGuardianUsageSchema = z.object({
  key: z.string(),
  projectId: z.string().optional(),
  loopId: z.string().optional(),
  reuseCount: z.number(),
  rememberCount: z.number(),
  resetCount: z.number(),
  lastUsedAt: z.number(),
  currentSessionId: z.string().optional(),
});

const automationAuditEventSchema = z.object({
  id: z.string(),
  occurredAt: z.number(),
  kind: z.string(),
  jobId: z.string().optional(),
  dedupeKey: z.string().optional(),
  sessionId: z.string().optional(),
  projectId: z.string().optional(),
  runId: z.string().optional(),
  loopId: z.string().optional(),
  trigger: z.string().optional(),
  status: z.string().optional(),
  guardianKey: z.string().optional(),
  guardianSessionId: z.string().optional(),
  message: z.string().optional(),
});

const automationAuditStatsSchema = z.object({
  totalEvents: z.number(),
  lastEventAt: z.number().optional(),
  queuedCount: z.number(),
  sessionStartedCount: z.number(),
  terminalCompletedCount: z.number(),
  terminalFailedCount: z.number(),
  terminalCancelledCount: z.number(),
  guardianReuseCount: z.number(),
  guardianRememberCount: z.number(),
  guardianResetCount: z.number(),
  sessionReattachedCount: z.number(),
  watchdogStopCount: z.number(),
  stopRequestCount: z.number(),
  policyGatedCount: z.number(),
  downstreamEmitCount: z.number(),
  guardianEligibleRunCount: z.number(),
  guardianReuseRate: z.number(),
  activeGuardianCount: z.number(),
});

const automationMutationSchema = z.object({
  success: z.boolean(),
  errorMessage: z.string().optional(),
  job: automationJobSchema.optional(),
});

const automationGuardianMutationSchema = z.object({
  success: z.boolean(),
  errorMessage: z.string().optional(),
});

const agentLoopEventSchema = z.object({
  id: z.string(),
  source: z.string(),
  title: z.string(),
  details: z.string().optional(),
  status: z.enum(["pending", "dispatched", "completed", "failed", "cancelled", "ignored"]),
  createdAt: z.number(),
  dispatchedAt: z.number().optional(),
  completedAt: z.number().optional(),
  jobId: z.string().optional(),
  sessionId: z.string().optional(),
  errorMessage: z.string().optional(),
});

const agentLoopSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  prompt: z.string(),
  directory: z.string(),
  intervalMs: z.number(),
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  nextRunAt: z.number(),
  iteration: z.number(),
  continuityKey: z.string(),
  agent: z.enum(["claude", "codex", "gemini"]),
  profileId: z.string().optional(),
  projectId: z.string().optional(),
  environmentVariables: z.record(z.string(), z.string()).optional(),
  fileWatchEnabled: z.boolean().optional(),
  githubBridgeEnabled: z.boolean().optional(),
  ciBridgeEnabled: z.boolean().optional(),
  eventSourceAllowlist: z.array(z.string()).optional(),
  eventKeywordFilters: z.array(z.string()).optional(),
  goal: z.string().optional(),
  currentFocus: z.string().optional(),
  workingMemory: z.string().optional(),
  lastReflectionSummary: z.string().optional(),
  memoryUpdatedAt: z.number().optional(),
  consecutiveFailures: z.number().int().nonnegative().optional(),
  maxConsecutiveFailures: z.number().int().positive().optional(),
  retryBackoffMs: z.number().int().positive().optional(),
  cooldownMs: z.number().int().positive().optional(),
  quietHoursStart: z.string().optional(),
  quietHoursEnd: z.string().optional(),
  maxAutoRunsPerDay: z.number().int().positive().optional(),
  downstreamLoopIds: z.array(z.string()).optional(),
  downstreamTriggerOn: z.array(z.enum(["completed", "failed"])).optional(),
  notifyEvents: z.array(z.enum(["completed", "failed", "blocked", "brief"])).optional(),
  notificationChannels: z.array(z.enum(["push", "webhook"])).optional(),
  notificationWebhookUrl: z.string().optional(),
  lastBriefAt: z.number().optional(),
  lastBriefSummary: z.string().optional(),
  lastSuccessfulAt: z.number().optional(),
  autoRunsToday: z.number().int().nonnegative().optional(),
  autoRunWindowStartedAt: z.number().optional(),
  lastPolicyGateAt: z.number().optional(),
  lastPolicyGateReason: z.string().optional(),
  runtimeState: z.enum(["idle", "active", "blocked", "paused"]),
  phase: z.enum(["sleeping", "planning", "acting", "reflecting", "blocked", "paused"]),
  phaseUpdatedAt: z.number(),
  activeJobId: z.string().optional(),
  activeSessionId: z.string().optional(),
  lastTriggerSource: z.enum(["manual", "schedule", "event"]).optional(),
  lastTriggerAt: z.number().optional(),
  blockedReason: z.string().optional(),
  lastReflectionAt: z.number().optional(),
  recentEvents: z.array(agentLoopEventSchema).optional(),
  lastEnqueuedAt: z.number().optional(),
  lastStartedAt: z.number().optional(),
  lastCompletedAt: z.number().optional(),
  lastSessionId: z.string().optional(),
  lastError: z.string().optional(),
});

const agentLoopMutationSchema = z.object({
  success: z.boolean(),
  errorMessage: z.string().optional(),
  loop: agentLoopSchema.optional(),
});

const agentLoopEventEmitSchema = z.object({
  loopId: z.string(),
  source: z.string().optional(),
  title: z.string(),
  details: z.string().optional(),
  autoRun: z.boolean().optional(),
});

const agentLoopSuggestionSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  rationale: z.string(),
  directory: z.string(),
  intervalMs: z.number(),
  agent: z.enum(["claude", "codex", "gemini"]),
  fileWatchEnabled: z.boolean().optional(),
  githubBridgeEnabled: z.boolean().optional(),
  ciBridgeEnabled: z.boolean().optional(),
  eventSourceAllowlist: z.array(z.string()).optional(),
  eventKeywordFilters: z.array(z.string()).optional(),
  goal: z.string().optional(),
  currentFocus: z.string().optional(),
  workingMemory: z.string().optional(),
  lastReflectionSummary: z.string().optional(),
  maxConsecutiveFailures: z.number().int().positive().optional(),
  retryBackoffMs: z.number().int().positive().optional(),
  prompt: z.string(),
  tags: z.array(z.string()),
  confidence: z.enum(["high", "medium"]),
  alreadyConfigured: z.boolean(),
  existingLoopId: z.string().optional(),
});

const agentLoopSuggestInputSchema = z.object({
  directory: z.string(),
  agent: z.enum(["claude", "codex", "gemini"]).optional(),
  projectId: z.string().optional(),
  profileId: z.string().optional(),
});

const githubActionsWebhookSchema = z.object({
  eventName: z.enum(["workflow_run", "check_run", "check_suite"]),
  payload: z.any(),
  repoPath: z.string().optional(),
  targetLoopId: z.string().optional(),
});

const ciTriggerSchema = z.object({
  eventId: z.string().optional(),
  provider: z.string(),
  repoPath: z.string(),
  repoUrl: z.string(),
  kind: z.enum(["workflow_run", "check_run", "check_suite", "generic"]),
  status: z.string(),
  conclusion: z.string().optional(),
  workflowName: z.string().optional(),
  checkName: z.string().optional(),
  branch: z.string().optional(),
  sha: z.string().optional(),
  title: z.string().optional(),
  details: z.string().optional(),
  targetLoopId: z.string().optional(),
});

const agentLoopCreateSchema = z.object({
  name: z.string().optional(),
  prompt: z.string(),
  directory: z.string(),
  intervalMs: z.number().positive(),
  agent: z.enum(["claude", "codex", "gemini"]).optional(),
  profileId: z.string().optional(),
  projectId: z.string().optional(),
  environmentVariables: z.record(z.string(), z.string()).optional(),
  fileWatchEnabled: z.boolean().optional(),
  githubBridgeEnabled: z.boolean().optional(),
  ciBridgeEnabled: z.boolean().optional(),
  eventSourceAllowlist: z.array(z.string()).optional(),
  eventKeywordFilters: z.array(z.string()).optional(),
  goal: z.string().optional(),
  currentFocus: z.string().optional(),
  workingMemory: z.string().optional(),
  lastReflectionSummary: z.string().optional(),
  maxConsecutiveFailures: z.number().int().positive().optional(),
  retryBackoffMs: z.number().int().positive().optional(),
  cooldownMs: z.number().int().positive().optional(),
  quietHoursStart: z.string().optional(),
  quietHoursEnd: z.string().optional(),
  maxAutoRunsPerDay: z.number().int().positive().optional(),
  downstreamLoopIds: z.array(z.string()).optional(),
  downstreamTriggerOn: z.array(z.enum(["completed", "failed"])).optional(),
  notifyEvents: z.array(z.enum(["completed", "failed", "blocked", "brief"])).optional(),
  notificationChannels: z.array(z.enum(["push", "webhook"])).optional(),
  notificationWebhookUrl: z.string().optional(),
  runNow: z.boolean().optional(),
});

const agentLoopUpdateSchema = z.object({
  loopId: z.string(),
  name: z.string().nullable().optional(),
  prompt: z.string().optional(),
  directory: z.string().optional(),
  intervalMs: z.number().positive().optional(),
  agent: z.enum(["claude", "codex", "gemini"]).optional(),
  profileId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  environmentVariables: z.record(z.string(), z.string()).nullable().optional(),
  fileWatchEnabled: z.boolean().optional(),
  githubBridgeEnabled: z.boolean().optional(),
  ciBridgeEnabled: z.boolean().optional(),
  eventSourceAllowlist: z.array(z.string()).nullable().optional(),
  eventKeywordFilters: z.array(z.string()).nullable().optional(),
  goal: z.string().nullable().optional(),
  currentFocus: z.string().nullable().optional(),
  workingMemory: z.string().nullable().optional(),
  lastReflectionSummary: z.string().nullable().optional(),
  maxConsecutiveFailures: z.number().int().positive().nullable().optional(),
  retryBackoffMs: z.number().int().positive().nullable().optional(),
  cooldownMs: z.number().int().positive().nullable().optional(),
  quietHoursStart: z.string().nullable().optional(),
  quietHoursEnd: z.string().nullable().optional(),
  maxAutoRunsPerDay: z.number().int().positive().nullable().optional(),
  downstreamLoopIds: z.array(z.string()).nullable().optional(),
  downstreamTriggerOn: z.array(z.enum(["completed", "failed"])).nullable().optional(),
  notifyEvents: z.array(z.enum(["completed", "failed", "blocked", "brief"])).nullable().optional(),
  notificationChannels: z.array(z.enum(["push", "webhook"])).nullable().optional(),
  notificationWebhookUrl: z.string().nullable().optional(),
});

const agentLoopBootstrapProfileSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  rootDirectory: z.string(),
  intervalMs: z.number(),
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  nextRunAt: z.number(),
  maxDepth: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  agent: z.enum(["claude", "codex", "gemini"]).optional(),
  profileId: z.string().optional(),
  projectId: z.string().optional(),
  autoRunCreatedLoops: z.boolean().optional(),
  status: z.enum(["idle", "running", "paused", "failed"]),
  statusUpdatedAt: z.number(),
  lastRunAt: z.number().optional(),
  lastRepoCount: z.number().optional(),
  lastSuggestionCount: z.number().optional(),
  lastCreatedCount: z.number().optional(),
  lastError: z.string().optional(),
});

const agentLoopBootstrapMutationSchema = z.object({
  success: z.boolean(),
  errorMessage: z.string().optional(),
  profile: agentLoopBootstrapProfileSchema.optional(),
});

const agentLoopBootstrapCreateSchema = z.object({
  name: z.string().optional(),
  rootDirectory: z.string(),
  intervalMs: z.number().positive(),
  maxDepth: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  agent: z.enum(["claude", "codex", "gemini"]).optional(),
  profileId: z.string().optional(),
  projectId: z.string().optional(),
  autoRunCreatedLoops: z.boolean().optional(),
  runNow: z.boolean().optional(),
});

const agentLoopBootstrapUpdateSchema = z.object({
  profileIdValue: z.string(),
  name: z.string().nullable().optional(),
  rootDirectory: z.string().optional(),
  intervalMs: z.number().positive().optional(),
  maxDepth: z.number().int().nonnegative().nullable().optional(),
  limit: z.number().int().positive().nullable().optional(),
  agent: z.enum(["claude", "codex", "gemini"]).nullable().optional(),
  profileId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  autoRunCreatedLoops: z.boolean().optional(),
});

const autoDreamProfileSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  rootDirectory: z.string(),
  intervalMs: z.number(),
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  nextRunAt: z.number(),
  status: z.enum(["idle", "running", "paused", "failed"]),
  stage: z.enum(["starting", "scanning", "analyzing", "writing", "updating"]),
  statusUpdatedAt: z.number(),
  maxDepth: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  lastRunAt: z.number().optional(),
  lastError: z.string().optional(),
  lastMemoryFiles: z.number().optional(),
  lastUpdatedFiles: z.number().optional(),
  latestDreamFilePath: z.string().optional(),
});

const autoDreamMutationSchema = z.object({
  success: z.boolean(),
  errorMessage: z.string().optional(),
  profile: autoDreamProfileSchema.optional(),
});

const autoDreamCreateSchema = z.object({
  name: z.string().optional(),
  rootDirectory: z.string(),
  intervalMs: z.number().positive(),
  maxDepth: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  runNow: z.boolean().optional(),
});

const autoDreamUpdateSchema = z.object({
  profileIdValue: z.string(),
  name: z.string().nullable().optional(),
  rootDirectory: z.string().optional(),
  intervalMs: z.number().positive().optional(),
  maxDepth: z.number().int().nonnegative().nullable().optional(),
  limit: z.number().int().positive().nullable().optional(),
});

export function startDaemonControlServer({
  getChildren,
  stopSession,
  spawnSession,
  requestShutdown,
  onHappySessionWebhook,
  onSessionHeartbeat,
  getAutomationStatus,
  cancelAutomationJob,
  retryAutomationJob,
  removeAutomationJob,
  clearAutomationJobs,
  clearAutomationGuardians,
  clearAutomationAudit,
  setKillswitch,
  getKillswitch,
  listAgentLoops,
  suggestAgentLoops,
  suggestAgentLoopsWithAI,
  listAgentLoopBootstrapProfiles,
  getAgentLoopBootstrapProfile,
  createAgentLoopBootstrapProfile,
  updateAgentLoopBootstrapProfile,
  pauseAgentLoopBootstrapProfile,
  resumeAgentLoopBootstrapProfile,
  runAgentLoopBootstrapProfileNow,
  removeAgentLoopBootstrapProfile,
  listAutoDreamProfiles,
  getAutoDreamProfile,
  createAutoDreamProfile,
  updateAutoDreamProfile,
  pauseAutoDreamProfile,
  resumeAutoDreamProfile,
  runAutoDreamProfileNow,
  removeAutoDreamProfile,
  getAgentLoop,
  createAgentLoop,
  updateAgentLoop,
  pauseAgentLoop,
  resumeAgentLoop,
  runAgentLoopNow,
  removeAgentLoop,
  emitAgentLoopEvent,
  emitCiTrigger,
  emitGitHubActionsWebhook,
}: {
  getChildren: () => TrackedSession[];
  stopSession: (sessionId: string) => boolean;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  requestShutdown: () => void;
  onHappySessionWebhook: (
    sessionId: string,
    metadata: Metadata,
    spawnId?: string,
  ) => void;
  /**
   * Invoked when a tracked child posts to /session-heartbeat. Handler updates
   * in-memory `lastHeartbeatAt` / `activity` and persists to the registry.
   * Returns `{ known: true }` when daemon recognizes the pid/spawn pair and
   * wants the child to keep running; `{ known: false }` signals the child to
   * optionally re-handshake via /session-started.
   */
  onSessionHeartbeat: (params: {
    pid: number;
    happySessionId?: string;
    spawnId?: string;
    activity?: "idle" | "thinking" | "executing" | "blocked";
  }) => { known: boolean; keepAlive: boolean };
  getAutomationStatus: () => {
    jobs: AutomationJob[];
    counts: Record<string, number>;
    guardians?: Array<{
      key: string;
      projectId: string;
      loopId?: string;
      sessionId: string;
      updatedAt: number;
      lastRunId?: string;
      attached?: boolean;
      recovered?: boolean;
    }>;
    guardianUsage?: Array<{
      key: string;
      projectId?: string;
      loopId?: string;
      reuseCount: number;
      rememberCount: number;
      resetCount: number;
      lastUsedAt: number;
      currentSessionId?: string;
    }>;
    auditStats?: {
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
    };
    recentAuditEvents?: Array<{
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
    }>;
  };
  cancelAutomationJob: (jobId: string) => Promise<AutomationMutationResult>;
  retryAutomationJob: (jobId: string) => Promise<AutomationMutationResult>;
  removeAutomationJob: (jobId: string) => Promise<AutomationMutationResult>;
  clearAutomationJobs: () => Promise<AutomationMutationResult>;
  clearAutomationGuardians: (params?: { key?: string; sessionId?: string; clearAll?: boolean }) => Promise<{ success: boolean; errorMessage?: string }>;
  clearAutomationAudit: () => Promise<{ success: boolean; errorMessage?: string }>;
  setKillswitch: (enabled: boolean) => Promise<{ success: boolean; killed: boolean }>;
  getKillswitch: () => { killed: boolean };
  listAgentLoops: () => Promise<AgentLoopDefinition[]>;
  getAgentLoop: (loopId: string) => Promise<AgentLoopDefinition | undefined>;
  createAgentLoop: (input: AgentLoopCreateInput) => Promise<AgentLoopMutationResult>;
  updateAgentLoop: (loopId: string, input: AgentLoopUpdateInput) => Promise<AgentLoopMutationResult>;
  pauseAgentLoop: (loopId: string) => Promise<AgentLoopMutationResult>;
  resumeAgentLoop: (loopId: string) => Promise<AgentLoopMutationResult>;
  runAgentLoopNow: (loopId: string) => Promise<AgentLoopMutationResult>;
  removeAgentLoop: (loopId: string) => Promise<AgentLoopMutationResult>;
  emitAgentLoopEvent: (loopId: string, input: { source?: string; title: string; details?: string; autoRun?: boolean }) => Promise<AgentLoopMutationResult>;
  emitCiTrigger: (input: { eventId?: string; provider: string; repoPath: string; repoUrl: string; kind: "workflow_run" | "check_run" | "check_suite" | "generic"; status: string; conclusion?: string; workflowName?: string; checkName?: string; branch?: string; sha?: string; title?: string; details?: string; targetLoopId?: string }) => Promise<{ success: boolean; errorMessage?: string }>;
  emitGitHubActionsWebhook: (input: { eventName: "workflow_run" | "check_run" | "check_suite"; payload: unknown; repoPath?: string; targetLoopId?: string }) => Promise<{ success: boolean; errorMessage?: string }>;
  suggestAgentLoops: (input: { directory: string; agent?: "claude" | "codex" | "gemini"; projectId?: string; profileId?: string }) => Promise<Array<{ key: string; name: string; description: string; rationale: string; directory: string; intervalMs: number; agent: "claude" | "codex" | "gemini"; fileWatchEnabled?: boolean; githubBridgeEnabled?: boolean; ciBridgeEnabled?: boolean; eventSourceAllowlist?: string[]; eventKeywordFilters?: string[]; goal?: string; currentFocus?: string; workingMemory?: string; lastReflectionSummary?: string; maxConsecutiveFailures?: number; retryBackoffMs?: number; prompt: string; tags: string[]; confidence: "high" | "medium"; alreadyConfigured: boolean; existingLoopId?: string }>>;
  suggestAgentLoopsWithAI: (input: { directory: string; agent?: "claude" | "codex" | "gemini"; projectId?: string; profileId?: string }) => Promise<Array<{ key: string; name: string; description: string; rationale: string; directory: string; intervalMs: number; agent: "claude" | "codex" | "gemini"; fileWatchEnabled?: boolean; githubBridgeEnabled?: boolean; ciBridgeEnabled?: boolean; eventSourceAllowlist?: string[]; eventKeywordFilters?: string[]; goal?: string; currentFocus?: string; workingMemory?: string; lastReflectionSummary?: string; maxConsecutiveFailures?: number; retryBackoffMs?: number; prompt: string; tags: string[]; confidence: "high" | "medium"; alreadyConfigured: boolean; existingLoopId?: string }>>;
  listAgentLoopBootstrapProfiles: () => Promise<AgentLoopBootstrapProfile[]>;
  getAgentLoopBootstrapProfile: (profileIdValue: string) => Promise<AgentLoopBootstrapProfile | undefined>;
  createAgentLoopBootstrapProfile: (input: AgentLoopBootstrapCreateInput) => Promise<AgentLoopBootstrapMutationResult>;
  updateAgentLoopBootstrapProfile: (profileIdValue: string, input: AgentLoopBootstrapUpdateInput) => Promise<AgentLoopBootstrapMutationResult>;
  pauseAgentLoopBootstrapProfile: (profileIdValue: string) => Promise<AgentLoopBootstrapMutationResult>;
  resumeAgentLoopBootstrapProfile: (profileIdValue: string) => Promise<AgentLoopBootstrapMutationResult>;
  runAgentLoopBootstrapProfileNow: (profileIdValue: string) => Promise<AgentLoopBootstrapMutationResult>;
  removeAgentLoopBootstrapProfile: (profileIdValue: string) => Promise<AgentLoopBootstrapMutationResult>;
  listAutoDreamProfiles: () => Promise<AutoDreamProfile[]>;
  getAutoDreamProfile: (profileIdValue: string) => Promise<AutoDreamProfile | undefined>;
  createAutoDreamProfile: (input: AutoDreamCreateInput) => Promise<AutoDreamMutationResult>;
  updateAutoDreamProfile: (profileIdValue: string, input: AutoDreamUpdateInput) => Promise<AutoDreamMutationResult>;
  pauseAutoDreamProfile: (profileIdValue: string) => Promise<AutoDreamMutationResult>;
  resumeAutoDreamProfile: (profileIdValue: string) => Promise<AutoDreamMutationResult>;
  runAutoDreamProfileNow: (profileIdValue: string) => Promise<AutoDreamMutationResult>;
  removeAutoDreamProfile: (profileIdValue: string) => Promise<AutoDreamMutationResult>;
}): Promise<{ port: number; stop: () => Promise<void> }> {
  return new Promise((resolve) => {
    const app = fastify({ logger: false });

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>();

    typed.post(
      "/session-started",
      {
        schema: {
          body: z.object({
            sessionId: z.string(),
            metadata: z.any(),
            // New-daemon + new-child pair echoes back the spawnId that was
            // injected via HAPPY_SPAWN_ID. Old children omit it and daemon
            // falls back to pid-keyed matching in the webhook handler.
            spawnId: z.string().optional(),
          }),
          response: {
            200: z.object({
              status: z.literal("ok"),
            }),
          },
        },
      },
      async (request) => {
        const { sessionId, metadata, spawnId } = request.body;
        logger.debug(
          `[CONTROL SERVER] Session started: ${sessionId}${spawnId ? ` (spawnId=${spawnId})` : ""}`,
        );
        onHappySessionWebhook(sessionId, metadata, spawnId);
        return { status: "ok" as const };
      },
    );

    // Periodic heartbeat from daemon-tracked children. Replaces kill(pid, 0)
    // polling with explicit liveness signal — a wedged child whose process is
    // alive but whose event loop is blocked will still fail to send heartbeats.
    typed.post(
      "/session-heartbeat",
      {
        schema: {
          body: z.object({
            pid: z.number().int().positive(),
            happySessionId: z.string().optional(),
            spawnId: z.string().optional(),
            activity: z
              .enum(["idle", "thinking", "executing", "blocked"])
              .optional(),
          }),
          response: {
            200: z.object({
              status: z.literal("ok"),
              // `known: false` — daemon has no matching trackedSession; child
              // may re-handshake by re-posting /session-started.
              known: z.boolean(),
              // `keepAlive: false` — daemon wants the child to exit gracefully
              // (e.g. diagnostics "kill" was requested via terminationRequestedAt).
              keepAlive: z.boolean(),
            }),
          },
        },
      },
      async (request) => {
        const { pid, happySessionId, spawnId, activity } = request.body;
        const result = onSessionHeartbeat({
          pid,
          happySessionId,
          spawnId,
          activity,
        });
        return { status: "ok" as const, ...result };
      },
    );

    typed.post(
      "/list",
      {
        schema: {
          response: {
            200: z.object({
              children: z.array(
                z.object({
                  startedBy: z.string(),
                  happySessionId: z.string(),
                  pid: z.number(),
                }),
              ),
            }),
          },
        },
      },
      async () => {
        const children = getChildren();
        logger.debug(`[CONTROL SERVER] Listing ${children.length} sessions`);
        return {
          children: children
            .filter((child) => child.happySessionId !== undefined)
            .map((child) => ({
              startedBy: child.startedBy,
              happySessionId: child.happySessionId!,
              pid: child.pid,
            })),
        };
      },
    );

    typed.post(
      "/stop-session",
      {
        schema: {
          body: z.object({
            sessionId: z.string(),
          }),
          response: {
            200: z.object({
              success: z.boolean(),
            }),
          },
        },
      },
      async (request) => {
        const { sessionId } = request.body;
        logger.debug(`[CONTROL SERVER] Stop session request: ${sessionId}`);
        return { success: stopSession(sessionId) };
      },
    );

    typed.post(
      "/spawn-session",
      {
        schema: {
          body: z.object({
            directory: z.string(),
            sessionId: z.string().optional(),
          }),
          response: {
            200: z.object({
              success: z.boolean(),
              sessionId: z.string().optional(),
              approvedNewDirectoryCreation: z.boolean().optional(),
            }),
            409: z.object({
              success: z.boolean(),
              requiresUserApproval: z.boolean().optional(),
              actionRequired: z.string().optional(),
              directory: z.string().optional(),
            }),
            500: z.object({
              success: z.boolean(),
              error: z.string().optional(),
            }),
          },
        },
      },
      async (request, reply) => {
        const { directory, sessionId } = request.body;
        logger.debug(
          `[CONTROL SERVER] Spawn session request: dir=${directory}, sessionId=${sessionId || "new"}`,
        );
        const result = await spawnSession({ directory, sessionId });

        switch (result.type) {
          case "success":
            if (!result.sessionId) {
              reply.code(500);
              return {
                success: false,
                error: "Failed to spawn session: no session ID returned",
              };
            }
            return {
              success: true,
              sessionId: result.sessionId,
              approvedNewDirectoryCreation: true,
            };
          case "requestToApproveDirectoryCreation":
            reply.code(409);
            return {
              success: false,
              requiresUserApproval: true,
              actionRequired: "CREATE_DIRECTORY",
              directory: result.directory,
            };
          case "error":
            reply.code(500);
            return {
              success: false,
              error: result.errorMessage,
            };
        }
      },
    );

    typed.post(
      "/automation-status",
      {
        schema: {
          response: {
            200: z.object({
              counts: z.record(z.string(), z.number()),
              jobs: z.array(automationJobSchema),
              guardians: z.array(automationGuardianSchema).optional(),
              guardianUsage: z.array(automationGuardianUsageSchema).optional(),
              auditStats: automationAuditStatsSchema.optional(),
              recentAuditEvents: z.array(automationAuditEventSchema).optional(),
            }),
          },
        },
      },
      async () => getAutomationStatus(),
    );

    typed.post(
      "/automation-cancel",
      {
        schema: {
          body: z.object({
            jobId: z.string(),
          }),
          response: {
            200: automationMutationSchema,
          },
        },
      },
      async (request) => cancelAutomationJob(request.body.jobId),
    );

    typed.post(
      "/automation-retry",
      {
        schema: {
          body: z.object({
            jobId: z.string(),
          }),
          response: {
            200: automationMutationSchema,
          },
        },
      },
      async (request) => retryAutomationJob(request.body.jobId),
    );

    typed.post(
      "/automation-remove",
      {
        schema: {
          body: z.object({
            jobId: z.string(),
          }),
          response: {
            200: automationMutationSchema,
          },
        },
      },
      async (request) => removeAutomationJob(request.body.jobId),
    );

    typed.post(
      "/automation-clear",
      {
        schema: {
          response: {
            200: automationMutationSchema,
          },
        },
      },
      async () => clearAutomationJobs(),
    );

    typed.post(
      "/automation-guardian-clear",
      {
        schema: {
          body: z.object({
            key: z.string().optional(),
            sessionId: z.string().optional(),
            clearAll: z.boolean().optional(),
          }).optional(),
          response: {
            200: automationGuardianMutationSchema,
          },
        },
      },
      async (request) => clearAutomationGuardians(request.body ?? {}),
    );

    typed.post(
      "/automation-audit-clear",
      {
        schema: {
          response: {
            200: automationGuardianMutationSchema,
          },
        },
      },
      async () => clearAutomationAudit(),
    );

    typed.post(
      "/killswitch",
      {
        schema: {
          body: z.object({
            enabled: z.boolean(),
          }),
          response: {
            200: z.object({
              success: z.boolean(),
              killed: z.boolean(),
            }),
          },
        },
      },
      async (request) => setKillswitch(request.body.enabled),
    );

    typed.get(
      "/killswitch",
      {
        schema: {
          response: {
            200: z.object({
              killed: z.boolean(),
            }),
          },
        },
      },
      async () => getKillswitch(),
    );

    typed.post(
      "/loops",
      {
        schema: {
          response: {
            200: z.object({
              loops: z.array(agentLoopSchema),
            }),
          },
        },
      },
      async () => ({ loops: await listAgentLoops() }),
    );

    typed.post(
      "/loop-get",
      {
        schema: {
          body: z.object({
            loopId: z.string(),
          }),
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => ({ success: true, loop: await getAgentLoop(request.body.loopId) }),
    );

    typed.post(
      "/loop-create",
      {
        schema: {
          body: agentLoopCreateSchema,
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => createAgentLoop(request.body),
    );

    typed.post(
      "/loop-update",
      {
        schema: {
          body: agentLoopUpdateSchema,
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => {
        const { loopId, ...input } = request.body;
        return updateAgentLoop(loopId, input);
      },
    );

    typed.post(
      "/loop-pause",
      {
        schema: {
          body: z.object({ loopId: z.string() }),
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => pauseAgentLoop(request.body.loopId),
    );

    typed.post(
      "/loop-resume",
      {
        schema: {
          body: z.object({ loopId: z.string() }),
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => resumeAgentLoop(request.body.loopId),
    );

    typed.post(
      "/loop-run-now",
      {
        schema: {
          body: z.object({ loopId: z.string() }),
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => runAgentLoopNow(request.body.loopId),
    );

    typed.post(
      "/loop-remove",
      {
        schema: {
          body: z.object({ loopId: z.string() }),
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => removeAgentLoop(request.body.loopId),
    );

    typed.post(
      "/loop-event",
      {
        schema: {
          body: agentLoopEventEmitSchema,
          response: {
            200: agentLoopMutationSchema,
          },
        },
      },
      async (request) => emitAgentLoopEvent(request.body.loopId, request.body),
    );

    typed.post(
      "/github-actions-webhook",
      {
        schema: {
          body: githubActionsWebhookSchema,
          response: {
            200: z.object({ success: z.boolean(), errorMessage: z.string().optional() }),
          },
        },
      },
      async (request) => emitGitHubActionsWebhook(request.body),
    );

    typed.post(
      "/ci-trigger",
      {
        schema: {
          body: ciTriggerSchema,
          response: {
            200: z.object({ success: z.boolean(), errorMessage: z.string().optional() }),
          },
        },
      },
      async (request) => emitCiTrigger(request.body),
    );

    typed.post(
      "/bootstrap-profiles",
      {
        schema: {
          response: {
            200: z.object({
              profiles: z.array(agentLoopBootstrapProfileSchema),
            }),
          },
        },
      },
      async () => ({ profiles: await listAgentLoopBootstrapProfiles() }),
    );

    typed.post(
      "/bootstrap-profile-get",
      {
        schema: {
          body: z.object({ profileIdValue: z.string() }),
          response: { 200: agentLoopBootstrapMutationSchema },
        },
      },
      async (request) => ({ success: true, profile: await getAgentLoopBootstrapProfile(request.body.profileIdValue) }),
    );

    typed.post(
      "/bootstrap-profile-create",
      {
        schema: {
          body: agentLoopBootstrapCreateSchema,
          response: { 200: agentLoopBootstrapMutationSchema },
        },
      },
      async (request) => createAgentLoopBootstrapProfile(request.body),
    );

    typed.post(
      "/bootstrap-profile-update",
      {
        schema: {
          body: agentLoopBootstrapUpdateSchema,
          response: { 200: agentLoopBootstrapMutationSchema },
        },
      },
      async (request) => {
        const { profileIdValue, ...input } = request.body;
        return updateAgentLoopBootstrapProfile(profileIdValue, input);
      },
    );

    typed.post(
      "/bootstrap-profile-pause",
      {
        schema: {
          body: z.object({ profileIdValue: z.string() }),
          response: { 200: agentLoopBootstrapMutationSchema },
        },
      },
      async (request) => pauseAgentLoopBootstrapProfile(request.body.profileIdValue),
    );

    typed.post(
      "/bootstrap-profile-resume",
      {
        schema: {
          body: z.object({ profileIdValue: z.string() }),
          response: { 200: agentLoopBootstrapMutationSchema },
        },
      },
      async (request) => resumeAgentLoopBootstrapProfile(request.body.profileIdValue),
    );

    typed.post(
      "/bootstrap-profile-run-now",
      {
        schema: {
          body: z.object({ profileIdValue: z.string() }),
          response: { 200: agentLoopBootstrapMutationSchema },
        },
      },
      async (request) => runAgentLoopBootstrapProfileNow(request.body.profileIdValue),
    );

    typed.post(
      "/bootstrap-profile-remove",
      {
        schema: {
          body: z.object({ profileIdValue: z.string() }),
          response: { 200: agentLoopBootstrapMutationSchema },
        },
      },
      async (request) => removeAgentLoopBootstrapProfile(request.body.profileIdValue),
    );

    typed.post(
      "/dream-profiles",
      {
        schema: {
          response: { 200: z.object({ profiles: z.array(autoDreamProfileSchema) }) },
        },
      },
      async () => ({ profiles: await listAutoDreamProfiles() }),
    );

    typed.post(
      "/dream-profile-get",
      {
        schema: {
          body: z.object({ profileIdValue: z.string() }),
          response: { 200: autoDreamMutationSchema },
        },
      },
      async (request) => ({ success: true, profile: await getAutoDreamProfile(request.body.profileIdValue) }),
    );

    typed.post(
      "/dream-profile-create",
      {
        schema: {
          body: autoDreamCreateSchema,
          response: { 200: autoDreamMutationSchema },
        },
      },
      async (request) => createAutoDreamProfile(request.body),
    );

    typed.post(
      "/dream-profile-update",
      {
        schema: {
          body: autoDreamUpdateSchema,
          response: { 200: autoDreamMutationSchema },
        },
      },
      async (request) => {
        const { profileIdValue, ...input } = request.body;
        return updateAutoDreamProfile(profileIdValue, input);
      },
    );

    typed.post(
      "/dream-profile-pause",
      {
        schema: {
          body: z.object({ profileIdValue: z.string() }),
          response: { 200: autoDreamMutationSchema },
        },
      },
      async (request) => pauseAutoDreamProfile(request.body.profileIdValue),
    );

    typed.post(
      "/dream-profile-resume",
      {
        schema: {
          body: z.object({ profileIdValue: z.string() }),
          response: { 200: autoDreamMutationSchema },
        },
      },
      async (request) => resumeAutoDreamProfile(request.body.profileIdValue),
    );

    typed.post(
      "/dream-profile-run-now",
      {
        schema: {
          body: z.object({ profileIdValue: z.string() }),
          response: { 200: autoDreamMutationSchema },
        },
      },
      async (request) => runAutoDreamProfileNow(request.body.profileIdValue),
    );

    typed.post(
      "/dream-profile-remove",
      {
        schema: {
          body: z.object({ profileIdValue: z.string() }),
          response: { 200: autoDreamMutationSchema },
        },
      },
      async (request) => removeAutoDreamProfile(request.body.profileIdValue),
    );

    typed.post(
      "/loop-suggest",
      {
        schema: {
          body: agentLoopSuggestInputSchema,
          response: {
            200: z.object({ suggestions: z.array(agentLoopSuggestionSchema) }),
          },
        },
      },
      async (request) => ({ suggestions: await suggestAgentLoops(request.body) }),
    );

    typed.post(
      "/loop-suggest-ai",
      {
        schema: {
          body: agentLoopSuggestInputSchema,
          response: {
            200: z.object({ suggestions: z.array(agentLoopSuggestionSchema) }),
          },
        },
      },
      async (request) => ({ suggestions: await suggestAgentLoopsWithAI(request.body) }),
    );

    typed.post(
      "/stop",
      {
        schema: {
          response: {
            200: z.object({
              status: z.string(),
            }),
          },
        },
      },
      async () => {
        logger.debug("[CONTROL SERVER] Stop daemon request received");
        setTimeout(() => {
          logger.debug("[CONTROL SERVER] Triggering daemon shutdown");
          requestShutdown();
        }, 50);
        return { status: "stopping" };
      },
    );

    app.listen({ port: 0, host: "127.0.0.1" }, (err, address) => {
      if (err) {
        logger.debug("[CONTROL SERVER] Failed to start:", err);
        throw err;
      }

      const port = parseInt(address.split(":").pop()!, 10);
      logger.debug(`[CONTROL SERVER] Started on port ${port}`);

      resolve({
        port,
        stop: async () => {
          logger.debug("[CONTROL SERVER] Stopping server");
          await app.close();
          logger.debug("[CONTROL SERVER] Server stopped");
        },
      });
    });
  });
}
