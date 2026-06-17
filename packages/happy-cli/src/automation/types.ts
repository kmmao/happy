import type { ResolvedRuntimeProfile } from "@kmmao/happy-wire";
import type {
  SupervisorTriggerData,
  WebhookTriggerData,
} from "@/api/apiMachine";

export type ExecutionState =
  | "idle"
  | "dispatching"
  | "running"
  | "interrupting"
  | "restarting"
  | "aborting"
  | "closed";

export type ExecutionTransitionReason =
  | "user_message"
  | "background_job"
  | "continue"
  | "isolated_command"
  | "mode_change"
  | "abort"
  | "switch_transport"
  | "process_exit";

export interface ExecutionGuardSnapshot {
  state: ExecutionState;
  generation: number;
  activeReason?: ExecutionTransitionReason;
  updatedAt: number;
}

export interface ExecutionGuardTransition {
  from: ExecutionGuardSnapshot;
  to: ExecutionGuardSnapshot;
}

export type AutomationPriority = "urgent" | "user" | "background";

export type AgentLoopTriggerSource = "manual" | "schedule" | "event";

export interface AgentLoopTriggerData {
  type: "agent-loop-trigger";
  loopId: string;
  loopName?: string;
  prompt: string;
  directory: string;
  intervalMs: number;
  trigger: AgentLoopTriggerSource;
  iteration: number;
  agent?: "claude" | "codex" | "gemini";
  profileId?: string;
  projectId?: string;
  environmentVariables?: Record<string, string>;
  fileWatchEnabled?: boolean;
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
  eventId?: string;
  eventSource?: string;
  eventTitle?: string;
  eventDetails?: string;
  roleId?: string;
  roleName?: string;
  roleType?: string;
  maxUsdPerRun?: number;
  /**
   * Optional slash command (e.g. "/caveman") pushed into the spawned
   * session as the first user message — runs through the same PTY-input
   * pipeline as keyboard input, so Claude Code's slash parser triggers
   * the skill before the iteration's main prompt is delivered.
   */
  bootstrapSlashCommand?: string;
}

export interface TaskTriggerData {
  type: "task-trigger";
  taskId: string;
  prompt: string;
  directory: string;
  priority: AutomationPriority;
  projectId?: string;
  resultToken?: string;
  skillContents?: Array<{ name: string; content: string }>;
  agentType?: string | null;    // "claude" | "codex" | "gemini" — null = inherit CLI default
  modelOverride?: string | null; // e.g. "claude-sonnet-4-20250514" — null = agent default
  // Profile binding resolved server-side. `profileId` references the
  // AiBackendProfile (or built-in id); `runtimeProfile` carries the resolved
  // env vars + metadata that should govern the spawned session. See
  // packages/happy-wire/src/tasks.ts (wire 0.14.0+).
  profileId?: string;
  runtimeProfile?: ResolvedRuntimeProfile;
  // When true, the CLI creates a dedicated git worktree from `directory` at
  // execution time rather than running directly in `directory` (wire 0.17.0+).
  worktreeIsolation?: boolean;
}

export type AutomationJobKind = "supervisor" | "webhook" | "agent_loop" | "task";

export type AutomationJobStatus =
  | "queued"
  | "dispatching"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AutomationCompletionMode = "immediate" | "session";

export interface AutomationJobBase<TKind extends AutomationJobKind, TPayload> {
  id: string;
  kind: TKind;
  status: AutomationJobStatus;
  priority: AutomationPriority;
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
  recovered?: boolean;
  continuityKey?: string;
  completionMode?: AutomationCompletionMode;
  errorMessage?: string;
  payload: TPayload;
}

export type SupervisorAutomationJob = AutomationJobBase<
  "supervisor",
  SupervisorTriggerData
>;

export type WebhookAutomationJob = AutomationJobBase<"webhook", WebhookTriggerData>;

export type AgentLoopAutomationJob = AutomationJobBase<"agent_loop", AgentLoopTriggerData>;

export type TaskAutomationJob = AutomationJobBase<"task", TaskTriggerData>;

export type AutomationJob = SupervisorAutomationJob | WebhookAutomationJob | AgentLoopAutomationJob | TaskAutomationJob;

export interface AutomationStoreFile {
  version: 1;
  jobs: AutomationJob[];
}

export interface AutomationEnqueueResult {
  job: AutomationJob;
  deduped: boolean;
}

export interface AutomationRecoveryResult {
  /**
   * Jobs still found in the persisted queue at daemon restart that
   * were re-queued for immediate dispatch. As of 0.98.2 the recover
   * path no longer "resurrects" automation jobs on restart, so this
   * counter is permanently 0 — preserved here for callers (and the
   * status doctor) that read the field by name. The work is now
   * tracked by `cancelledOnRestart` instead.
   */
  requeued: number;
  retainedTerminal: number;
  reattachedRunning: number;
  /**
   * Jobs whose `sessionId` could not be reattached to a live session
   * at daemon restart and were therefore marked `cancelled`. The next
   * natural scheduler tick (cron) will re-trigger them, avoiding the
   * "5 ghost sessions appear at once" effect when daemon restarts.
   */
  cancelledOnRestart: number;
}

export interface AutomationMutationResult {
  success: boolean;
  errorMessage?: string;
  job?: AutomationJob;
}

export interface AutomationRunResult {
  completion: AutomationCompletionMode;
  sessionId?: string;
}

export type AutomationAuditKind =
  | "job_enqueued"
  | "job_session_started"
  | "job_terminal"
  /** Task spawn: local session webhook did not arrive before timeout; job kept in session mode. */
  | "task_session_webhook_timeout"
  /** Task exit: happySessionId was missing; terminal state applied via dedupeKey fallback. */
  | "task_terminal_dedupe_fallback"
  | "guardian_reused"
  | "guardian_remembered"
  | "guardian_cleared"
  | "session_reattached"
  | "watchdog_stopped"
  | "session_stop_requested"
  | "loop_policy_gated"
  | "loop_downstream_emitted";

export interface AutomationAuditEvent {
  id: string;
  occurredAt: number;
  kind: AutomationAuditKind;
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

export interface AutomationAuditStoreFile {
  version: 1;
  events: AutomationAuditEvent[];
}

export interface AutomationGuardianUsageSummary {
  key: string;
  projectId?: string;
  loopId?: string;
  reuseCount: number;
  rememberCount: number;
  resetCount: number;
  lastUsedAt: number;
  currentSessionId?: string;
}

export interface AutomationAuditStats {
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
