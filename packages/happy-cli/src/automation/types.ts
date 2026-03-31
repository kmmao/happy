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

export type AutomationJobKind = "supervisor" | "webhook";

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

export type AutomationJob = SupervisorAutomationJob | WebhookAutomationJob;

export interface AutomationStoreFile {
  version: 1;
  jobs: AutomationJob[];
}

export interface AutomationEnqueueResult {
  job: AutomationJob;
  deduped: boolean;
}

export interface AutomationRecoveryResult {
  requeued: number;
  retainedTerminal: number;
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
  | "guardian_reused"
  | "guardian_remembered"
  | "guardian_cleared"
  | "watchdog_stopped"
  | "session_stop_requested";

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
  watchdogStopCount: number;
  stopRequestCount: number;
  guardianEligibleRunCount: number;
  guardianReuseRate: number;
  activeGuardianCount: number;
}
