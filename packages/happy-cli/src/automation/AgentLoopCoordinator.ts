import { randomUUID } from "node:crypto";
import type { AutomationAuditEvent } from "./types";
import type { AutomationScheduler } from "./AutomationScheduler";
import { AgentLoopStore, type AgentLoopDefinition } from "./AgentLoopStore";

export interface AgentLoopCreateInput {
  name?: string;
  prompt: string;
  directory: string;
  intervalMs: number;
  agent?: "claude" | "codex" | "gemini";
  profileId?: string;
  projectId?: string;
  environmentVariables?: Record<string, string>;
  runNow?: boolean;
}

export interface AgentLoopUpdateInput {
  name?: string | null;
  prompt?: string;
  directory?: string;
  intervalMs?: number;
  agent?: "claude" | "codex" | "gemini";
  profileId?: string | null;
  projectId?: string | null;
  environmentVariables?: Record<string, string> | null;
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
}

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class AgentLoopCoordinator {
  private readonly store: AgentLoopStore;
  private readonly scheduler: AutomationScheduler;
  private readonly pollIntervalMs: number;
  private readonly onChange?: (loops: AgentLoopDefinition[]) => void;
  private readonly recordAuditEvent?: AgentLoopCoordinatorOptions["recordAuditEvent"];
  private interval: NodeJS.Timeout | null = null;
  private loaded = false;

  constructor(options: AgentLoopCoordinatorOptions) {
    this.store = options.store;
    this.scheduler = options.scheduler;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.onChange = options.onChange;
    this.recordAuditEvent = options.recordAuditEvent;
  }

  async start(): Promise<void> {
    await this.ensureLoaded();
    if (this.interval) {
      clearInterval(this.interval);
    }
    this.interval = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    this.notifyChange();
    void this.tick();
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

  async getLoop(id: string): Promise<AgentLoopDefinition | undefined> {
    await this.ensureLoaded();
    return this.store.get(id);
  }

  async createLoop(input: AgentLoopCreateInput): Promise<AgentLoopMutationResult> {
    await this.ensureLoaded();
    const now = Date.now();
    const loop: AgentLoopDefinition = {
      id: randomUUID(),
      name: normalizeOptionalString(input.name),
      prompt: input.prompt.trim(),
      directory: input.directory.trim(),
      intervalMs: input.intervalMs,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      nextRunAt: now + input.intervalMs,
      iteration: 0,
      continuityKey: `agent-loop:${randomUUID()}`,
      agent: input.agent ?? "claude",
      profileId: normalizeOptionalString(input.profileId),
      projectId: normalizeOptionalString(input.projectId),
      environmentVariables: input.environmentVariables && Object.keys(input.environmentVariables).length > 0
        ? input.environmentVariables
        : undefined,
    };
    loop.continuityKey = `agent-loop:${loop.id}`;
    await this.store.upsert(loop);
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
    const nextRunAt = input.intervalMs != null ? Date.now() + intervalMs : existing.nextRunAt;
    const updated: AgentLoopDefinition = {
      ...existing,
      name: input.name === undefined ? existing.name : normalizeOptionalString(input.name),
      prompt: input.prompt === undefined ? existing.prompt : input.prompt.trim(),
      directory: input.directory === undefined ? existing.directory : input.directory.trim(),
      intervalMs,
      nextRunAt,
      agent: input.agent ?? existing.agent,
      profileId: input.profileId === undefined ? existing.profileId : normalizeOptionalString(input.profileId),
      projectId: input.projectId === undefined ? existing.projectId : normalizeOptionalString(input.projectId),
      environmentVariables: input.environmentVariables === undefined
        ? existing.environmentVariables
        : (input.environmentVariables && Object.keys(input.environmentVariables).length > 0
          ? input.environmentVariables
          : undefined),
      updatedAt: Date.now(),
    };

    await this.store.upsert(updated);
    this.notifyChange();
    return { success: true, loop: updated };
  }

  async pauseLoop(id: string): Promise<AgentLoopMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) {
      return { success: false, errorMessage: `Loop ${id} not found` };
    }
    const updated: AgentLoopDefinition = {
      ...existing,
      enabled: false,
      updatedAt: Date.now(),
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
    const updated: AgentLoopDefinition = {
      ...existing,
      enabled: true,
      updatedAt: now,
      nextRunAt: existing.nextRunAt < now ? now : existing.nextRunAt,
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
    const iteration = existing.iteration + 1;
    const result = await this.scheduler.enqueueAgentLoop({
      type: "agent-loop-trigger",
      loopId: existing.id,
      loopName: existing.name,
      prompt: existing.prompt,
      directory: existing.directory,
      intervalMs: existing.intervalMs,
      trigger: "manual",
      iteration,
      agent: existing.agent,
      profileId: existing.profileId,
      projectId: existing.projectId,
      environmentVariables: existing.environmentVariables,
    });

    const now = Date.now();
    const updated: AgentLoopDefinition = {
      ...existing,
      iteration,
      updatedAt: now,
      lastEnqueuedAt: now,
      nextRunAt: now + existing.intervalMs,
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
      trigger: "agent_loop:manual",
      status: result.job.status,
      message: result.job.label,
    });
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
    const updated: AgentLoopDefinition = {
      ...existing,
      updatedAt: now,
      lastCompletedAt: now,
      lastSessionId: params.sessionId ?? existing.lastSessionId,
      lastError: params.status === "completed" ? undefined : (params.errorMessage ?? params.status),
    };
    await this.store.upsert(updated);
    this.notifyChange();
  }

  private async tick(): Promise<void> {
    await this.ensureLoaded();
    const now = Date.now();
    for (const loop of this.store.getAll()) {
      if (!loop.enabled || loop.nextRunAt > now) {
        continue;
      }
      if (this.hasActiveJob(loop.id)) {
        continue;
      }

      const iteration = loop.iteration + 1;
      const result = await this.scheduler.enqueueAgentLoop({
        type: "agent-loop-trigger",
        loopId: loop.id,
        loopName: loop.name,
        prompt: loop.prompt,
        directory: loop.directory,
        intervalMs: loop.intervalMs,
        trigger: "schedule",
        iteration,
        agent: loop.agent,
        profileId: loop.profileId,
        projectId: loop.projectId,
        environmentVariables: loop.environmentVariables,
      });
      if (result.deduped) {
        continue;
      }
      const updated: AgentLoopDefinition = {
        ...loop,
        iteration,
        updatedAt: now,
        lastEnqueuedAt: now,
        nextRunAt: now + loop.intervalMs,
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
        trigger: "agent_loop:schedule",
        status: result.job.status,
        message: result.job.label,
      });
    }
  }

  private hasActiveJob(loopId: string): boolean {
    return this.scheduler.getJobsSnapshot().some((job) => job.loopId === loopId && !TERMINAL_STATUSES.has(job.status));
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await this.store.load();
    this.loaded = true;
  }

  private notifyChange(): void {
    if (!this.onChange) {
      return;
    }
    try {
      this.onChange(this.store.getAll());
    } catch {
      // noop
    }
  }
}
