import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { atomicFileWrite } from "@/utils/fileAtomic";

export type AgentLoopRuntimeState = "idle" | "active" | "blocked" | "paused";
export type AgentLoopRuntimePhase = "sleeping" | "planning" | "acting" | "reflecting" | "blocked" | "paused";
export type AgentLoopTriggerSource = "manual" | "schedule" | "event";
export type AgentLoopDownstreamTrigger = "completed" | "failed";
export type AgentLoopNotificationEvent = "completed" | "failed" | "blocked" | "brief";
export type AgentLoopNotificationChannel = "push" | "webhook";
export type AgentLoopEventStatus = "pending" | "dispatched" | "completed" | "failed" | "cancelled" | "ignored";

export interface AgentLoopEvent {
  id: string;
  source: string;
  title: string;
  details?: string;
  status: AgentLoopEventStatus;
  createdAt: number;
  dispatchedAt?: number;
  completedAt?: number;
  jobId?: string;
  sessionId?: string;
  errorMessage?: string;
}

export interface AgentLoopDefinition {
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
  downstreamTriggerOn?: AgentLoopDownstreamTrigger[];
  notifyEvents?: AgentLoopNotificationEvent[];
  notificationChannels?: AgentLoopNotificationChannel[];
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
  runtimeState: AgentLoopRuntimeState;
  phase: AgentLoopRuntimePhase;
  phaseUpdatedAt: number;
  activeJobId?: string;
  activeSessionId?: string;
  lastTriggerSource?: AgentLoopTriggerSource;
  lastTriggerAt?: number;
  blockedReason?: string;
  stopReason?: string;
  lastReflectionAt?: number;
  recentEvents?: AgentLoopEvent[];
  lastEnqueuedAt?: number;
  lastStartedAt?: number;
  lastCompletedAt?: number;
  lastSessionId?: string;
  lastError?: string;
  roleId?: string;
  roleName?: string;
  roleType?: string;
  /**
   * ADR-0022 Phase 3b — when the one-shot migration has uploaded this
   * loop to the server-side AgentLoop table, the returned server loop id
   * is recorded here. Presence acts as the idempotency marker for
   * re-runs of the migration; absence means "still CLI-local-only".
   */
  migratedToServerLoopId?: string;
}

interface AgentLoopStoreFile {
  version: 1;
  loops: AgentLoopDefinition[];
}

const EMPTY_STORE: AgentLoopStoreFile = {
  version: 1,
  loops: [],
};

function normalizeRuntimeState(loop: Partial<AgentLoopDefinition>): AgentLoopRuntimeState {
  if (loop.runtimeState) {
    return loop.runtimeState;
  }
  if (loop.enabled === false) {
    return loop.blockedReason ? "blocked" : "paused";
  }
  return loop.activeJobId || loop.activeSessionId ? "active" : "idle";
}

function normalizePhase(loop: Partial<AgentLoopDefinition>, runtimeState: AgentLoopRuntimeState): AgentLoopRuntimePhase {
  if (loop.phase) {
    return loop.phase;
  }
  if (runtimeState === "blocked") {
    return "blocked";
  }
  if (runtimeState === "paused") {
    return "paused";
  }
  if (runtimeState === "active") {
    return loop.activeSessionId ? "acting" : "planning";
  }
  return "sleeping";
}

function trimRecentEvents(events: AgentLoopEvent[] | undefined): AgentLoopEvent[] {
  const source = [...(events ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  if (source.length <= 25) {
    return source;
  }
  const keep = source.filter((event) => event.status === "pending" || event.status === "dispatched");
  for (const event of source) {
    if (keep.length >= 25) {
      break;
    }
    if (!keep.includes(event)) {
      keep.push(event);
    }
  }
  return keep.sort((a, b) => b.createdAt - a.createdAt).slice(0, 25);
}

function normalizeLoop(loop: AgentLoopDefinition): AgentLoopDefinition {
  const runtimeState = normalizeRuntimeState(loop);
  const phase = normalizePhase(loop, runtimeState);
  const downstreamLoopIds = [...new Set((loop.downstreamLoopIds ?? []).map((entry) => entry.trim()).filter(Boolean))];
  const downstreamTriggerOn = [...new Set((loop.downstreamTriggerOn ?? []).filter((entry): entry is AgentLoopDownstreamTrigger => entry === "completed" || entry === "failed"))];
  const notifyEvents = [...new Set((loop.notifyEvents ?? []).filter((entry): entry is AgentLoopNotificationEvent => entry === "completed" || entry === "failed" || entry === "blocked" || entry === "brief"))];
  const notificationChannels = [...new Set((loop.notificationChannels ?? []).filter((entry): entry is AgentLoopNotificationChannel => entry === "push" || entry === "webhook"))];
  return {
    ...loop,
    runtimeState,
    phase,
    phaseUpdatedAt: loop.phaseUpdatedAt ?? loop.updatedAt ?? loop.createdAt ?? Date.now(),
    consecutiveFailures: loop.consecutiveFailures ?? 0,
    autoRunsToday: loop.autoRunsToday ?? 0,
    downstreamLoopIds: downstreamLoopIds.length > 0 ? downstreamLoopIds : undefined,
    downstreamTriggerOn: downstreamTriggerOn.length > 0 ? downstreamTriggerOn : undefined,
    notifyEvents: notifyEvents.length > 0 ? notifyEvents : undefined,
    notificationChannels: notificationChannels.length > 0 ? notificationChannels : undefined,
    notificationWebhookUrl: loop.notificationWebhookUrl?.trim() || undefined,
    recentEvents: trimRecentEvents(loop.recentEvents),
  };
}

export class AgentLoopStore {
  private loops = new Map<string, AgentLoopDefinition>();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as AgentLoopStoreFile;
      this.loops = new Map(parsed.loops.map((loop) => {
        const normalized = normalizeLoop(loop);
        return [normalized.id, normalized];
      }));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      this.loops = new Map();
      await this.flush();
    }
    this.loaded = true;
  }

  getAll(): AgentLoopDefinition[] {
    return [...this.loops.values()].sort((a, b) => {
      if (a.runtimeState !== b.runtimeState) {
        const priority = { active: 0, blocked: 1, idle: 2, paused: 3 } as const;
        return priority[a.runtimeState] - priority[b.runtimeState];
      }
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      if (a.nextRunAt !== b.nextRunAt) return a.nextRunAt - b.nextRunAt;
      return a.id.localeCompare(b.id);
    });
  }

  get(id: string): AgentLoopDefinition | undefined {
    return this.loops.get(id);
  }

  async upsert(loop: AgentLoopDefinition): Promise<void> {
    this.loops.set(loop.id, normalizeLoop(loop));
    await this.flush();
  }

  async remove(id: string): Promise<void> {
    if (!this.loops.has(id)) {
      return;
    }
    this.loops.delete(id);
    await this.flush();
  }

  private async flush(): Promise<void> {
    const payload: AgentLoopStoreFile = {
      ...EMPTY_STORE,
      loops: this.getAll(),
    };
    await atomicFileWrite(this.filePath, JSON.stringify(payload, null, 2));
  }
}
