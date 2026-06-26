import { randomUUID } from "node:crypto";
import { CronExpressionParser } from "cron-parser";
import { logger } from "@/ui/logger";
import { jitteredDelay } from "@/utils/jitter";

/**
 * Compute the next run timestamp from a cron expression.
 * Returns null if the expression is invalid or has no future match.
 */
function nextRunFromCron(cronExpression: string, fromMs: number = Date.now()): number | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression, { currentDate: new Date(fromMs) });
    return interval.next().getTime();
  } catch {
    return null;
  }
}

/**
 * Compute the effective next run time for a loop, preferring cron expression over interval.
 */
function computeNextRunAt(loop: { cronExpression?: string; intervalMs: number; id: string }, now: number): number {
  if (loop.cronExpression) {
    const next = nextRunFromCron(loop.cronExpression, now);
    if (next != null) return next;
  }
  return now + loop.intervalMs + jitteredDelay(loop.id, loop.intervalMs);
}
import type { AutomationAuditEvent } from "./types";
import type { AutomationScheduler } from "./AutomationScheduler";
import {
  persistAgentLoopMemorySnapshot,
  readAgentLoopMemorySnapshot,
} from "./AgentLoopMemory";
import {
  buildAgentLoopBrief,
  persistAgentLoopBrief,
  type AgentLoopBriefSnapshot,
} from "./AgentLoopBrief";
import {
  AgentLoopStore,
  type AgentLoopDefinition,
  type AgentLoopDownstreamTrigger,
  type AgentLoopEvent,
  type AgentLoopNotificationChannel,
  type AgentLoopNotificationEvent,
  type AgentLoopRuntimePhase,
  type AgentLoopRuntimeState,
  type AgentLoopTriggerSource,
} from "./AgentLoopStore";
import {
  canAutoRun,
  evaluateAutoRunPolicy,
  localDayStartAt,
  normalizeAutoRunCounter,
} from "./agentLoopAutoRunPolicy";
import { evaluateLoopEventFilters } from "./agentLoopEventMatch";
import { computeAgentLoopTerminalOutcome } from "./agentLoopTerminalOutcome";

export interface AgentLoopCreateInput {
  name?: string;
  prompt: string;
  directory: string;
  intervalMs: number;
  cronExpression?: string;
  agent?: "claude" | "codex" | "gemini";
  /** App model-mode KEY forwarded to the iteration's first-turn EnhancedMode. */
  modelMode?: string;
  /** Reasoning effort (low|medium|high|xhigh|max) for the iteration's first turn. */
  effort?: string;
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
  downstreamTriggerOn?: AgentLoopDownstreamTrigger[];
  notifyEvents?: AgentLoopNotificationEvent[];
  notificationChannels?: AgentLoopNotificationChannel[];
  notificationWebhookUrl?: string;
  roleId?: string;
  roleName?: string;
  roleType?: string;
  maxUsdPerRun?: number;
  maxUsdPerDay?: number;
  runNow?: boolean;
}

export interface AgentLoopUpdateInput {
  name?: string | null;
  prompt?: string;
  directory?: string;
  intervalMs?: number;
  cronExpression?: string | null;
  agent?: "claude" | "codex" | "gemini";
  /** App model-mode KEY; `null` clears the override and reverts to CLI default. */
  modelMode?: string | null;
  /** Reasoning effort; `null` clears and reverts to medium default. */
  effort?: string | null;
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
  downstreamTriggerOn?: AgentLoopDownstreamTrigger[] | null;
  notifyEvents?: AgentLoopNotificationEvent[] | null;
  notificationChannels?: AgentLoopNotificationChannel[] | null;
  notificationWebhookUrl?: string | null;
  roleId?: string | null;
  roleName?: string | null;
  roleType?: string | null;
  maxUsdPerRun?: number | null;
  maxUsdPerDay?: number | null;
}

export interface AgentLoopEventInput {
  source?: string;
  title: string;
  details?: string;
  autoRun?: boolean;
}

export interface AgentLoopMutationResult {
  success: boolean;
  errorMessage?: string;
  loop?: AgentLoopDefinition;
}

export interface AgentLoopRunnerStatus {
  loops: AgentLoopDefinition[];
}

export interface AgentLoopCoordinatorOptions {
  store: AgentLoopStore;
  scheduler: AutomationScheduler;
  pollIntervalMs?: number;
  onChange?: (loops: AgentLoopDefinition[]) => void;
  recordAuditEvent?: (event: Omit<AutomationAuditEvent, "id" | "occurredAt"> & { occurredAt?: number }) => Promise<void> | void;
  sendPushNotification?: (payload: { title: string; body: string; data?: Record<string, unknown> }) => Promise<void> | void;
  onBriefGenerated?: (brief: AgentLoopBriefSnapshot) => void;
  /**
   * Detach this loop from its guardian Session binding so the next iteration
   * spawns a fresh `happySessionId`. Called by the self-heal path when a
   * loop has accumulated `GUARDIAN_FORGET_THRESHOLD` consecutive zero-cost
   * iterations — the classic "Session resumes into the same 429 wall every
   * time" symptom from the field. Wired in `startDaemon.ts` to
   * `guardianSessionRegistry.forgetKey('agent-loop:<loopId>')`.
   *
   * Best-effort: any error is logged at debug. Missing callback = no
   * self-heal, which is the legacy behaviour.
   */
  forgetGuardian?: (loopId: string) => Promise<void> | void;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}


function normalizeOptionalTimeOfDay(value: string | null | undefined): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized) ? normalized : undefined;
}

function normalizeOptionalStringList(value: readonly string[] | null | undefined): string[] | undefined {
  if (value == null) {
    return undefined;
  }
  const normalized = [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalNumber(value: number | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function normalizePositiveInteger(value: number | null | undefined, minimum = 1): number | undefined {
  const normalized = normalizeOptionalNumber(value);
  if (normalized === undefined) {
    return undefined;
  }
  return Math.max(minimum, Math.floor(normalized));
}

function normalizePositiveDuration(value: number | null | undefined): number | undefined {
  const normalized = normalizeOptionalNumber(value);
  if (normalized === undefined) {
    return undefined;
  }
  return Math.max(1_000, Math.floor(normalized));
}

function normalizeDownstreamTriggers(value: readonly AgentLoopDownstreamTrigger[] | null | undefined): AgentLoopDownstreamTrigger[] | undefined {
  if (value == null) {
    return undefined;
  }
  const normalized = [...new Set(value.filter((entry): entry is AgentLoopDownstreamTrigger => entry === "completed" || entry === "failed"))];
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNotificationEvents(value: readonly AgentLoopNotificationEvent[] | null | undefined): AgentLoopNotificationEvent[] | undefined {
  if (value == null) {
    return undefined;
  }
  const normalized = [...new Set(value.filter((entry): entry is AgentLoopNotificationEvent => entry === "completed" || entry === "failed" || entry === "blocked" || entry === "brief"))];
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNotificationChannels(value: readonly AgentLoopNotificationChannel[] | null | undefined): AgentLoopNotificationChannel[] | undefined {
  if (value == null) {
    return undefined;
  }
  const normalized = [...new Set(value.filter((entry): entry is AgentLoopNotificationChannel => entry === "push" || entry === "webhook"))];
  return normalized.length > 0 ? normalized : undefined;
}


function getLoopMemorySnapshot(loop: Pick<AgentLoopDefinition, "goal" | "currentFocus" | "workingMemory" | "lastReflectionSummary" | "memoryUpdatedAt">) {
  return {
    goal: loop.goal,
    currentFocus: loop.currentFocus,
    workingMemory: loop.workingMemory,
    lastReflectionSummary: loop.lastReflectionSummary,
    memoryUpdatedAt: loop.memoryUpdatedAt,
  };
}

function buildLoopRuntimeState(runtimeState: AgentLoopRuntimeState, phase: AgentLoopRuntimePhase, now: number) {
  return {
    runtimeState,
    phase,
    phaseUpdatedAt: now,
  };
}

function updateRecentEvents(loop: AgentLoopDefinition, updater: (events: AgentLoopEvent[]) => AgentLoopEvent[]): AgentLoopEvent[] {
  return updater([...(loop.recentEvents ?? [])]).sort((a, b) => b.createdAt - a.createdAt);
}

export class AgentLoopCoordinator {
  private readonly store: AgentLoopStore;
  private readonly scheduler: AutomationScheduler;
  private readonly pollIntervalMs: number;
  private readonly onChange?: (loops: AgentLoopDefinition[]) => void;
  private readonly recordAuditEvent?: AgentLoopCoordinatorOptions["recordAuditEvent"];
  private readonly sendPushNotification?: AgentLoopCoordinatorOptions["sendPushNotification"];
  private readonly onBriefGenerated?: AgentLoopCoordinatorOptions["onBriefGenerated"];
  private readonly forgetGuardian?: AgentLoopCoordinatorOptions["forgetGuardian"];
  private interval: NodeJS.Timeout | null = null;
  private loaded = false;
  private _killed = false;

  constructor(options: AgentLoopCoordinatorOptions) {
    this.store = options.store;
    this.scheduler = options.scheduler;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.onChange = options.onChange;
    this.recordAuditEvent = options.recordAuditEvent;
    this.sendPushNotification = options.sendPushNotification;
    this.onBriefGenerated = options.onBriefGenerated;
    this.forgetGuardian = options.forgetGuardian;
  }

  get killed(): boolean {
    return this._killed;
  }

  setKilled(value: boolean): void {
    this._killed = value;
    this.notifyChange();
  }

  async start(): Promise<void> {
    await this.ensureLoaded();
    if (this.interval) {
      clearInterval(this.interval);
    }
    this.interval = setInterval(() => {
      void this.tick().catch((err) => logger.debug("[LOOP-COORDINATOR] tick error:", err));
    }, this.pollIntervalMs);
    if (this.interval) (this.interval as NodeJS.Timeout).unref?.();
    this.notifyChange();
    void this.tick().catch((err) => logger.debug("[LOOP-COORDINATOR] tick error:", err));
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async listLoops(): Promise<AgentLoopDefinition[]> {
    await this.ensureLoaded();
    return this.store.getAll();
  }

  /** Sync version — only safe to call after start() has resolved. */
  listLoopsSync(): AgentLoopDefinition[] {
    return this.store.getAll();
  }

  async getLoop(id: string): Promise<AgentLoopDefinition | undefined> {
    await this.ensureLoaded();
    return this.store.get(id);
  }

  async createLoop(input: AgentLoopCreateInput): Promise<AgentLoopMutationResult> {
    await this.ensureLoaded();
    const now = Date.now();
    const loopId = randomUUID();
    const downstreamLoopIds = normalizeOptionalStringList(input.downstreamLoopIds)?.filter((entry) => entry !== loopId);
    const loop: AgentLoopDefinition = {
      id: loopId,
      name: normalizeOptionalString(input.name),
      prompt: input.prompt.trim(),
      directory: input.directory.trim(),
      intervalMs: input.intervalMs,
      cronExpression: normalizeOptionalString(input.cronExpression),
      enabled: true,
      createdAt: now,
      updatedAt: now,
      nextRunAt: computeNextRunAt({ cronExpression: input.cronExpression, intervalMs: input.intervalMs, id: loopId }, now),
      iteration: 0,
      continuityKey: `agent-loop:${randomUUID()}`,
      agent: input.agent ?? "claude",
      modelMode: normalizeOptionalString(input.modelMode),
      effort: normalizeOptionalString(input.effort),
      profileId: normalizeOptionalString(input.profileId),
      projectId: normalizeOptionalString(input.projectId),
      environmentVariables: input.environmentVariables && Object.keys(input.environmentVariables).length > 0
        ? input.environmentVariables
        : undefined,
      fileWatchEnabled: input.fileWatchEnabled ?? false,
      githubBridgeEnabled: input.githubBridgeEnabled ?? false,
      ciBridgeEnabled: input.ciBridgeEnabled ?? false,
      eventSourceAllowlist: normalizeOptionalStringList(input.eventSourceAllowlist),
      eventKeywordFilters: normalizeOptionalStringList(input.eventKeywordFilters),
      goal: normalizeOptionalString(input.goal),
      currentFocus: normalizeOptionalString(input.currentFocus),
      workingMemory: normalizeOptionalString(input.workingMemory),
      lastReflectionSummary: normalizeOptionalString(input.lastReflectionSummary),
      maxConsecutiveFailures: normalizePositiveInteger(input.maxConsecutiveFailures),
      retryBackoffMs: normalizePositiveDuration(input.retryBackoffMs),
      cooldownMs: normalizePositiveDuration(input.cooldownMs),
      quietHoursStart: normalizeOptionalTimeOfDay(input.quietHoursStart),
      quietHoursEnd: normalizeOptionalTimeOfDay(input.quietHoursEnd),
      maxAutoRunsPerDay: normalizePositiveInteger(input.maxAutoRunsPerDay),
      maxIterations: normalizePositiveInteger(input.maxIterations),
      stopOnSuccess: input.stopOnSuccess ?? false,
      downstreamLoopIds,
      downstreamTriggerOn: normalizeDownstreamTriggers(input.downstreamTriggerOn),
      notifyEvents: normalizeNotificationEvents(input.notifyEvents),
      notificationChannels: normalizeNotificationChannels(input.notificationChannels),
      notificationWebhookUrl: normalizeOptionalString(input.notificationWebhookUrl),
      roleId: normalizeOptionalString(input.roleId),
      roleName: normalizeOptionalString(input.roleName),
      roleType: normalizeOptionalString(input.roleType),
      maxUsdPerRun: normalizeOptionalNumber(input.maxUsdPerRun),
      maxUsdPerDay: normalizeOptionalNumber(input.maxUsdPerDay),
      consecutiveFailures: 0,
      autoRunsToday: 0,
      autoRunWindowStartedAt: localDayStartAt(now),
      todayCostUsd: 0,
      todayCostWindowStartedAt: localDayStartAt(now),
      totalCostUsd: 0,
      memoryUpdatedAt: now,
      recentEvents: [],
      ...buildLoopRuntimeState("idle", "sleeping", now),
    };
    loop.continuityKey = `agent-loop:${loop.id}`;
    await this.store.upsert(loop);
    await persistAgentLoopMemorySnapshot(loop.directory, loop.id, getLoopMemorySnapshot(loop));
    this.notifyChange();

    if (input.runNow !== false) {
      return this.runNow(loop.id);
    }
    return { success: true, loop };
  }

  async updateLoop(id: string, input: AgentLoopUpdateInput): Promise<AgentLoopMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) {
      return { success: false, errorMessage: `Loop ${id} not found` };
    }

    const intervalMs = input.intervalMs ?? existing.intervalMs;
    const cronExpression = input.cronExpression === undefined
      ? existing.cronExpression
      : normalizeOptionalString(input.cronExpression);
    const scheduleChanged = input.intervalMs != null || input.cronExpression !== undefined;
    const nextRunAt = scheduleChanged
      ? computeNextRunAt({ cronExpression, intervalMs, id: existing.id }, Date.now())
      : existing.nextRunAt;
    const updated: AgentLoopDefinition = {
      ...existing,
      name: input.name === undefined ? existing.name : normalizeOptionalString(input.name),
      prompt: input.prompt === undefined ? existing.prompt : input.prompt.trim(),
      directory: input.directory === undefined ? existing.directory : input.directory.trim(),
      intervalMs,
      cronExpression,
      nextRunAt,
      agent: input.agent ?? existing.agent,
      modelMode: input.modelMode === undefined ? existing.modelMode : normalizeOptionalString(input.modelMode),
      effort: input.effort === undefined ? existing.effort : normalizeOptionalString(input.effort),
      profileId: input.profileId === undefined ? existing.profileId : normalizeOptionalString(input.profileId),
      projectId: input.projectId === undefined ? existing.projectId : normalizeOptionalString(input.projectId),
      environmentVariables: input.environmentVariables === undefined
        ? existing.environmentVariables
        : (input.environmentVariables && Object.keys(input.environmentVariables).length > 0
          ? input.environmentVariables
          : undefined),
      fileWatchEnabled: input.fileWatchEnabled === undefined ? existing.fileWatchEnabled : input.fileWatchEnabled,
      githubBridgeEnabled: input.githubBridgeEnabled === undefined ? existing.githubBridgeEnabled : input.githubBridgeEnabled,
      ciBridgeEnabled: input.ciBridgeEnabled === undefined ? existing.ciBridgeEnabled : input.ciBridgeEnabled,
      eventSourceAllowlist: input.eventSourceAllowlist === undefined ? existing.eventSourceAllowlist : normalizeOptionalStringList(input.eventSourceAllowlist),
      eventKeywordFilters: input.eventKeywordFilters === undefined ? existing.eventKeywordFilters : normalizeOptionalStringList(input.eventKeywordFilters),
      goal: input.goal === undefined ? existing.goal : normalizeOptionalString(input.goal),
      currentFocus: input.currentFocus === undefined ? existing.currentFocus : normalizeOptionalString(input.currentFocus),
      workingMemory: input.workingMemory === undefined ? existing.workingMemory : normalizeOptionalString(input.workingMemory),
      lastReflectionSummary: input.lastReflectionSummary === undefined ? existing.lastReflectionSummary : normalizeOptionalString(input.lastReflectionSummary),
      maxConsecutiveFailures: input.maxConsecutiveFailures === undefined ? existing.maxConsecutiveFailures : normalizePositiveInteger(input.maxConsecutiveFailures),
      retryBackoffMs: input.retryBackoffMs === undefined ? existing.retryBackoffMs : normalizePositiveDuration(input.retryBackoffMs),
      cooldownMs: input.cooldownMs === undefined ? existing.cooldownMs : normalizePositiveDuration(input.cooldownMs),
      quietHoursStart: input.quietHoursStart === undefined ? existing.quietHoursStart : normalizeOptionalTimeOfDay(input.quietHoursStart),
      quietHoursEnd: input.quietHoursEnd === undefined ? existing.quietHoursEnd : normalizeOptionalTimeOfDay(input.quietHoursEnd),
      maxAutoRunsPerDay: input.maxAutoRunsPerDay === undefined ? existing.maxAutoRunsPerDay : normalizePositiveInteger(input.maxAutoRunsPerDay),
      maxIterations: input.maxIterations === undefined ? existing.maxIterations : normalizePositiveInteger(input.maxIterations),
      stopOnSuccess: input.stopOnSuccess === undefined ? existing.stopOnSuccess : input.stopOnSuccess,
      downstreamLoopIds: input.downstreamLoopIds === undefined
        ? existing.downstreamLoopIds
        : normalizeOptionalStringList(input.downstreamLoopIds)?.filter((entry) => entry != existing.id),
      downstreamTriggerOn: input.downstreamTriggerOn === undefined ? existing.downstreamTriggerOn : normalizeDownstreamTriggers(input.downstreamTriggerOn),
      notifyEvents: input.notifyEvents === undefined ? existing.notifyEvents : normalizeNotificationEvents(input.notifyEvents),
      notificationChannels: input.notificationChannels === undefined ? existing.notificationChannels : normalizeNotificationChannels(input.notificationChannels),
      notificationWebhookUrl: input.notificationWebhookUrl === undefined ? existing.notificationWebhookUrl : normalizeOptionalString(input.notificationWebhookUrl),
      roleId: input.roleId === undefined ? existing.roleId : normalizeOptionalString(input.roleId),
      roleName: input.roleName === undefined ? existing.roleName : normalizeOptionalString(input.roleName),
      roleType: input.roleType === undefined ? existing.roleType : normalizeOptionalString(input.roleType),
      maxUsdPerRun: input.maxUsdPerRun === undefined ? existing.maxUsdPerRun : normalizeOptionalNumber(input.maxUsdPerRun),
      maxUsdPerDay: input.maxUsdPerDay === undefined ? existing.maxUsdPerDay : normalizeOptionalNumber(input.maxUsdPerDay),
      memoryUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.store.upsert(updated);
    await persistAgentLoopMemorySnapshot(updated.directory, updated.id, getLoopMemorySnapshot(updated));
    this.notifyChange();
    return { success: true, loop: updated };
  }

  async pauseLoop(id: string): Promise<AgentLoopMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) {
      return { success: false, errorMessage: `Loop ${id} not found` };
    }
    const now = Date.now();
    const hasActiveJob = this.hasActiveJob(id);
    const updated: AgentLoopDefinition = {
      ...existing,
      enabled: false,
      updatedAt: now,
      ...(hasActiveJob ? {} : {
        ...buildLoopRuntimeState(existing.runtimeState === "blocked" ? "blocked" : "paused", existing.runtimeState === "blocked" ? "blocked" : "paused", now),
        activeJobId: undefined,
        activeSessionId: undefined,
      }),
    };
    await this.store.upsert(updated);
    this.notifyChange();
    return { success: true, loop: updated };
  }

  async resumeLoop(id: string): Promise<AgentLoopMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) {
      return { success: false, errorMessage: `Loop ${id} not found` };
    }
    const now = Date.now();
    const hasActiveJob = this.hasActiveJob(id);
    const updated: AgentLoopDefinition = {
      ...existing,
      enabled: true,
      updatedAt: now,
      nextRunAt: existing.nextRunAt < now ? now : existing.nextRunAt,
      blockedReason: undefined,
      stopReason: undefined,
      consecutiveFailures: 0,
      ...(hasActiveJob ? {} : {
        ...buildLoopRuntimeState("idle", "sleeping", now),
        activeJobId: undefined,
        activeSessionId: undefined,
      }),
    };
    await this.store.upsert(updated);
    this.notifyChange();
    void this.tick();
    return { success: true, loop: updated };
  }

  async removeLoop(id: string): Promise<AgentLoopMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) {
      return { success: false, errorMessage: `Loop ${id} not found` };
    }
    await this.store.remove(id);
    this.notifyChange();
    return { success: true, loop: existing };
  }

  async runNow(id: string): Promise<AgentLoopMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) {
      return { success: false, errorMessage: `Loop ${id} not found` };
    }
    if (this.hasActiveJob(id)) {
      return { success: false, errorMessage: `Loop ${id} already has an active automation job`, loop: existing };
    }
    return this.enqueueLoop(existing, "manual");
  }

  private async markPolicyGated(loop: AgentLoopDefinition, reason: string, now = Date.now(), trigger = "event"): Promise<AgentLoopDefinition> {
    if (loop.lastPolicyGateReason === reason && loop.lastPolicyGateAt && now - loop.lastPolicyGateAt < 60_000) {
      return loop;
    }
    const updated: AgentLoopDefinition = {
      ...loop,
      updatedAt: now,
      lastPolicyGateAt: now,
      lastPolicyGateReason: reason,
    };
    await this.store.upsert(updated);
    this.notifyChange();
    await this.recordAuditEvent?.({
      kind: "loop_policy_gated",
      loopId: loop.id,
      projectId: loop.projectId,
      trigger: `agent_loop:${trigger}`,
      status: reason,
      message: `Auto-run deferred by policy: ${reason}`,
    });
    return updated;
  }

  private async stopLoopByCondition(loop: AgentLoopDefinition, reason: string, now = Date.now()): Promise<AgentLoopDefinition> {
    if (!loop.enabled && loop.stopReason === reason) {
      return loop;
    }
    const updated: AgentLoopDefinition = {
      ...loop,
      enabled: false,
      updatedAt: now,
      stopReason: reason,
      blockedReason: undefined,
      lastPolicyGateAt: now,
      lastPolicyGateReason: reason,
      activeJobId: undefined,
      activeSessionId: undefined,
      ...buildLoopRuntimeState("paused", "paused", now),
    };
    await this.store.upsert(updated);
    this.notifyChange();
    await this.recordAuditEvent?.({
      kind: "loop_policy_gated",
      loopId: loop.id,
      projectId: loop.projectId,
      trigger: "agent_loop:stop-condition",
      status: reason,
      message: `Loop paused by stop condition: ${reason}`,
    });
    return updated;
  }

  async emitEvent(id: string, input: AgentLoopEventInput): Promise<AgentLoopMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) {
      return { success: false, errorMessage: `Loop ${id} not found` };
    }

    const now = Date.now();
    const seedEvent: AgentLoopEvent = {
      id: randomUUID(),
      source: normalizeOptionalString(input.source) ?? "manual",
      title: input.title.trim(),
      details: normalizeOptionalString(input.details),
      status: "pending",
      createdAt: now,
    };
    const filterResult = evaluateLoopEventFilters(existing, seedEvent);
    const event: AgentLoopEvent = filterResult.accepted
      ? seedEvent
      : {
          ...seedEvent,
          status: "ignored",
          completedAt: now,
          errorMessage: filterResult.reason,
        };

    const updated: AgentLoopDefinition = {
      ...existing,
      updatedAt: now,
      recentEvents: updateRecentEvents(existing, (events) => [event, ...events]),
    };
    await this.store.upsert(updated);
    this.notifyChange();
    await this.recordAuditEvent?.({
      kind: "job_enqueued",
      loopId: id,
      trigger: `agent_loop:event:${event.source}`,
      status: filterResult.accepted ? "queued" : "ignored",
      message: filterResult.accepted ? `Queued loop event: ${event.title}` : `Ignored loop event: ${event.title} (${filterResult.reason})`,
    });

    if (!filterResult.accepted) {
      return { success: true, loop: updated };
    }

    if (input.autoRun !== false && updated.enabled && updated.runtimeState !== "blocked" && !this.hasActiveJob(id)) {
      const policy = evaluateAutoRunPolicy(updated, now);
      if (policy.allowed) {
        return this.enqueuePendingEvent(updated);
      }
      if (policy.reason === "max-iterations") {
        const stopped = await this.stopLoopByCondition(updated, policy.reason, now);
        return { success: true, loop: stopped };
      }
      const gated = await this.markPolicyGated(updated, policy.reason ?? "policy", now, "event");
      return { success: true, loop: gated };
    }

    return { success: true, loop: updated };
  }

  async onJobSessionStarted(loopId: string, sessionId: string): Promise<void> {
    await this.ensureLoaded();
    const existing = this.store.get(loopId);
    if (!existing) {
      return;
    }
    const now = Date.now();
    const updated: AgentLoopDefinition = {
      ...existing,
      updatedAt: now,
      lastStartedAt: now,
      lastSessionId: sessionId,
      activeSessionId: sessionId,
      recentEvents: existing.activeJobId
        ? updateRecentEvents(existing, (events) => events.map((event) => event.jobId === existing.activeJobId ? { ...event, sessionId } : event))
        : existing.recentEvents,
      blockedReason: undefined,
      ...buildLoopRuntimeState("active", "acting", now),
      lastError: undefined,
    };
    await this.store.upsert(updated);
    this.notifyChange();
  }

  async onJobTerminal(params: {
    loopId?: string;
    status: "completed" | "failed" | "cancelled";
    sessionId?: string;
    errorMessage?: string;
    sessionCostUsd?: number;
    /**
     * Claude SDK fault category surfaced via the StopFailure hook (e.g.
     * `"rate_limit"`, `"overloaded"`, `"server_error"`, `"billing_error"`).
     * The coordinator uses this to classify the failure — transient
     * categories skip the consecutive-failure budget so a single rate-limit
     * burst can't tip the loop into `blocked`.
     */
    errorType?: string;
    /**
     * Upstream rate-limit reset timestamp (epoch ms) reported by
     * `rate_limit_event.resetsAt`. When present, the next iteration is
     * scheduled at or after this time (plus jitter) rather than blindly at
     * `now + retryBackoffMs`.
     */
    rateLimitResetsAt?: number;
  }): Promise<void> {
    if (!params.loopId) {
      return;
    }
    await this.ensureLoaded();
    const existing = this.store.get(params.loopId);
    if (!existing) {
      return;
    }
    const now = Date.now();
    const failed = params.status === "failed";
    // Failure classification, backoff, daily-cost rollup, stop-reason
    // precedence, and the guardian self-heal threshold are one pure decision —
    // see agentLoopTerminalOutcome. This method only applies the result.
    const outcome = computeAgentLoopTerminalOutcome(existing, params, now);
    const {
      shouldBlock,
      blockedReason,
      stopReason,
      runCost,
      newTodayCostUsd,
      newTotalCostUsd,
      effectiveBackoffMs,
      nextConsecutiveFailures,
      nextConsecutiveZeroCost,
      shouldForgetGuardian,
    } = outcome;
    if (shouldForgetGuardian && this.forgetGuardian) {
      try {
        await this.forgetGuardian(existing.id);
        logger.debug(
          `[AGENT LOOP] Guardian forgotten after ${nextConsecutiveZeroCost} zero-cost iterations: ${existing.id}`,
        );
      } catch (err) {
        logger.debug(`[AGENT LOOP] forgetGuardian threw: ${err}`);
      }
    }
    const completedJobId = existing.activeJobId;
    const persistedMemory = await readAgentLoopMemorySnapshot(existing.directory, existing.id);
    const draftLoop: AgentLoopDefinition = {
      ...existing,
      ...(persistedMemory ?? {}),
      enabled: shouldBlock || Boolean(stopReason) ? false : existing.enabled,
      updatedAt: now,
      lastCompletedAt: now,
      lastSuccessfulAt: params.status === "completed" ? now : existing.lastSuccessfulAt,
      lastSessionId: params.sessionId ?? existing.lastSessionId,
      activeJobId: undefined,
      activeSessionId: undefined,
      lastReflectionAt: now,
      nextRunAt: failed && !shouldBlock ? now + effectiveBackoffMs : existing.nextRunAt,
      consecutiveFailures: nextConsecutiveFailures,
      // Reset the zero-cost counter at the moment we forget the guardian —
      // the next iteration starts fresh, so the budget for "stuck Session"
      // tolerance resets too. Otherwise we'd self-heal once and then need
      // another N iterations of stale state before checking again.
      consecutiveZeroCostIterations: shouldForgetGuardian ? 0 : nextConsecutiveZeroCost,
      memoryUpdatedAt: persistedMemory ? now : existing.memoryUpdatedAt,
      todayCostUsd: newTodayCostUsd,
      todayCostWindowStartedAt: outcome.todayCostWindowStartedAt,
      totalCostUsd: newTotalCostUsd,
      lastRunCostUsd: runCost > 0 ? runCost : existing.lastRunCostUsd,
      recentEvents: completedJobId
        ? updateRecentEvents(existing, (events) => events.map((event) => event.jobId === completedJobId
          ? {
              ...event,
              status: params.status,
              completedAt: now,
              sessionId: params.sessionId ?? event.sessionId,
              errorMessage: params.errorMessage,
            }
          : event))
        : existing.recentEvents,
      lastError: params.status === "completed" ? undefined : (params.errorMessage ?? params.status),
      blockedReason,
      stopReason,
      lastPolicyGateAt: stopReason ? now : existing.lastPolicyGateAt,
      lastPolicyGateReason: stopReason ?? existing.lastPolicyGateReason,
      ...buildLoopRuntimeState(
        shouldBlock ? "blocked" : (stopReason ? "paused" : "idle"),
        shouldBlock ? "blocked" : (stopReason ? "paused" : "reflecting"),
        now,
      ),
    };
    const brief = buildAgentLoopBrief(draftLoop, {
      status: params.status,
      sessionId: params.sessionId,
      errorMessage: params.errorMessage,
    });
    const briefFilePath = await persistAgentLoopBrief(draftLoop.directory, draftLoop.id, brief);
    try { this.onBriefGenerated?.(brief); } catch { /* best-effort */ }
    const updated: AgentLoopDefinition = {
      ...draftLoop,
      lastBriefAt: brief.generatedAt,
      lastBriefSummary: brief.summary,
    };
    await this.store.upsert(updated);
    this.notifyChange();
    if (shouldForgetGuardian) {
      // Surface the self-heal in the audit timeline so operators can correlate
      // the next iteration's fresh sessionId with the auto-forget event.
      await this.recordAuditEvent?.({
        kind: "guardian_cleared",
        loopId: updated.id,
        projectId: updated.projectId,
        guardianKey: `agent-loop:${updated.id}`,
        guardianSessionId: existing.lastSessionId,
        trigger: `agent_loop:self-heal`,
        message: `Self-heal: forgot guardian after ${nextConsecutiveZeroCost} zero-cost iterations`,
      });
    }
    await this.sendLoopNotifications(updated, {
      status: params.status,
      blocked: shouldBlock,
      briefSummary: brief.summary,
      briefFilePath,
    });
    await this.triggerDownstreamLoops(updated, params.status, params.sessionId, params.errorMessage);
  }

  private async sendLoopNotifications(
    loop: AgentLoopDefinition,
    params: { status: "completed" | "failed" | "cancelled"; blocked: boolean; briefSummary?: string; briefFilePath?: string },
  ): Promise<void> {
    const notifyEvents = loop.notifyEvents ?? [];
    const notificationChannels = loop.notificationChannels ?? [];
    if (notifyEvents.length === 0 || notificationChannels.length === 0) {
      return;
    }

    const terminalStatus = params.status === "cancelled" ? undefined : params.status;
    const shouldNotify = (terminalStatus ? notifyEvents.includes(terminalStatus) : false)
      || (params.blocked && notifyEvents.includes("blocked"))
      || (params.briefSummary && notifyEvents.includes("brief"));
    if (!shouldNotify) {
      return;
    }

    const title = params.blocked
      ? `Happy Loop blocked: ${loop.name ?? loop.id}`
      : params.status === "failed"
        ? `Happy Loop failed: ${loop.name ?? loop.id}`
        : params.status === "cancelled"
          ? `Happy Loop cancelled: ${loop.name ?? loop.id}`
          : `Happy Loop brief: ${loop.name ?? loop.id}`;
    const body = params.briefSummary ?? loop.lastReflectionSummary ?? loop.currentFocus ?? `${loop.name ?? loop.id} ${params.status}`;
    const data = {
      type: "agent-loop",
      loopId: loop.id,
      status: params.status,
      blocked: params.blocked,
      briefFilePath: params.briefFilePath,
    } satisfies Record<string, unknown>;

    if (notificationChannels.includes("push")) {
      await this.sendPushNotification?.({ title, body, data });
    }
    if (notificationChannels.includes("webhook") && loop.notificationWebhookUrl) {
      try {
        await fetch(loop.notificationWebhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, body, data, loopId: loop.id, status: params.status }),
        });
      } catch {
      }
    }
  }

  private async triggerDownstreamLoops(
    loop: AgentLoopDefinition,
    status: "completed" | "failed" | "cancelled",
    sessionId?: string,
    errorMessage?: string,
  ): Promise<void> {
    if (status !== "completed" && status !== "failed") {
      return;
    }
    const downstreamLoopIds = loop.downstreamLoopIds?.filter((entry) => entry !== loop.id) ?? [];
    if (downstreamLoopIds.length === 0) {
      return;
    }
    const triggerOn = loop.downstreamTriggerOn ?? ["completed"];
    if (!triggerOn.includes(status)) {
      return;
    }
    const source = status === "completed" ? "loop-completed" : "loop-failed";
    const title = status === "completed"
      ? `Upstream loop completed: ${loop.name ?? loop.id}`
      : `Upstream loop failed: ${loop.name ?? loop.id}`;
    const details = [
      `loopId=${loop.id}`,
      `name=${loop.name ?? loop.id}`,
      `path=${loop.directory}`,
      `status=${status}`,
      sessionId ? `sessionId=${sessionId}` : undefined,
      errorMessage ? `error=${errorMessage}` : undefined,
    ].filter(Boolean).join('\n');

    for (const downstreamLoopId of downstreamLoopIds) {
      await this.emitEvent(downstreamLoopId, {
        source,
        title,
        details,
        autoRun: true,
      });
      await this.recordAuditEvent?.({
        kind: "loop_downstream_emitted",
        loopId: downstreamLoopId,
        projectId: loop.projectId,
        trigger: `agent_loop:${source}`,
        status,
        message: `Downstream event from ${loop.id} -> ${downstreamLoopId}`,
      });
    }
  }

  private async tick(): Promise<void> {
    if (this._killed) return;
    await this.ensureLoaded();
    const now = Date.now();
    for (const loop of this.store.getAll()) {
      try {
        if (!loop.enabled || loop.runtimeState === "blocked") {
          continue;
        }
        if (this.hasActiveJob(loop.id)) {
          continue;
        }
        if ((loop.recentEvents ?? []).some((event) => event.status === "pending")) {
          const policy = evaluateAutoRunPolicy(loop, now);
          if (policy.allowed) {
            await this.enqueuePendingEvent(loop, now);
          } else if (policy.reason === "max-iterations") {
            await this.stopLoopByCondition(loop, policy.reason, now);
          } else {
            await this.markPolicyGated(loop, policy.reason ?? "policy", now, "event");
          }
          continue;
        }
        if (loop.nextRunAt > now) {
          continue;
        }
        const policy = evaluateAutoRunPolicy(loop, now);
        if (!policy.allowed) {
          if (policy.reason === "max-iterations") {
            await this.stopLoopByCondition(loop, policy.reason, now);
          } else {
            await this.markPolicyGated(loop, policy.reason ?? "policy", now, "schedule");
          }
          continue;
        }
        await this.enqueueLoop(loop, "schedule", now);
      } catch (err) {
        logger.debug(`[LOOP-COORDINATOR] tick error for loop ${loop.id}:`, err);
      }
    }
  }

  private async enqueuePendingEvent(loop: AgentLoopDefinition, now = Date.now()): Promise<AgentLoopMutationResult> {
    const pendingEvent = [...(loop.recentEvents ?? [])]
      .filter((event) => event.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!pendingEvent) {
      return { success: true, loop };
    }
    return this.enqueueLoop(loop, "event", now, pendingEvent);
  }

  private async enqueueLoop(loop: AgentLoopDefinition, triggerSource: AgentLoopTriggerSource, now = Date.now(), event?: AgentLoopEvent): Promise<AgentLoopMutationResult> {
    const iteration = loop.iteration + 1;
    if (triggerSource !== "manual" && !canAutoRun(loop, now)) {
      return { success: true, loop };
    }
    const autoRunCounter = normalizeAutoRunCounter(loop, now);
    const result = await this.scheduler.enqueueAgentLoop({
      type: "agent-loop-trigger",
      loopId: loop.id,
      loopName: loop.name,
      prompt: loop.prompt,
      directory: loop.directory,
      intervalMs: loop.intervalMs,
      trigger: triggerSource,
      iteration,
      agent: loop.agent,
      // Carry the per-loop model + effort overrides through the trigger
      // payload so AgentLoopRunner can inject them into the spawned child's
      // env (HAPPY_INITIAL_MODEL_MODE / HAPPY_INITIAL_EFFORT). Without this
      // hop, every CLI-local iteration silently dropped the picks set on
      // the loop definition — symmetric with the server-side path which
      // had the same gap until wire 0.35.0.
      modelMode: loop.modelMode,
      effort: loop.effort,
      profileId: loop.profileId,
      projectId: loop.projectId,
      environmentVariables: loop.environmentVariables,
      goal: loop.goal,
      currentFocus: event ? `${event.title}${event.details ? ` — ${event.details}` : ""}` : loop.currentFocus,
      workingMemory: loop.workingMemory,
      lastReflectionSummary: loop.lastReflectionSummary,
      memoryUpdatedAt: loop.memoryUpdatedAt,
      consecutiveFailures: triggerSource === "manual" ? 0 : (loop.consecutiveFailures ?? 0),
      maxConsecutiveFailures: loop.maxConsecutiveFailures,
      retryBackoffMs: loop.retryBackoffMs,
      cooldownMs: loop.cooldownMs,
      quietHoursStart: loop.quietHoursStart,
      quietHoursEnd: loop.quietHoursEnd,
      maxAutoRunsPerDay: loop.maxAutoRunsPerDay,
      eventId: event?.id,
      eventSource: event?.source,
      eventTitle: event?.title,
      eventDetails: event?.details,
      roleId: loop.roleId,
      roleName: loop.roleName,
      roleType: loop.roleType,
      maxUsdPerRun: loop.maxUsdPerRun,
    });

    if (result.deduped) {
      return { success: true, loop };
    }

    const updated: AgentLoopDefinition = {
      ...loop,
      enabled: true,
      iteration,
      updatedAt: now,
      lastEnqueuedAt: now,
      nextRunAt: computeNextRunAt(loop, now),
      activeJobId: result.job.id,
      activeSessionId: undefined,
      lastTriggerSource: triggerSource,
      lastTriggerAt: now,
      currentFocus: event ? `${event.title}${event.details ? ` — ${event.details}` : ""}` : loop.currentFocus,
      blockedReason: undefined,
      stopReason: undefined,
      lastPolicyGateAt: undefined,
      lastPolicyGateReason: undefined,
      autoRunsToday: triggerSource === "manual" ? autoRunCounter.autoRunsToday : autoRunCounter.autoRunsToday + 1,
      autoRunWindowStartedAt: autoRunCounter.autoRunWindowStartedAt,
      recentEvents: event
        ? updateRecentEvents(loop, (events) => events.map((entry) => entry.id === event.id
          ? { ...entry, status: "dispatched", dispatchedAt: now, jobId: result.job.id }
          : entry))
        : loop.recentEvents,
      ...buildLoopRuntimeState("active", "planning", now),
      lastError: undefined,
    };
    await this.store.upsert(updated);
    this.notifyChange();
    await this.recordAuditEvent?.({
      kind: "job_enqueued",
      jobId: result.job.id,
      dedupeKey: result.job.dedupeKey,
      projectId: result.job.projectId,
      loopId: result.job.loopId,
      trigger: `agent_loop:${triggerSource}`,
      status: result.job.status,
      message: event ? `Event: ${event.title}` : result.job.label,
    });
    return { success: true, loop: updated };
  }

  private hasActiveJob(loopId: string): boolean {
    // The scheduler owns the "active job per loop" invariant — delegate rather
    // than re-derive it from a job snapshot here.
    return this.scheduler.getActiveJobByLoopId(loopId) !== undefined;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await this.store.load();
    this.loaded = true;
  }

  private notifyChange(): void {
    this.onChange?.(this.store.getAll());
  }
}
