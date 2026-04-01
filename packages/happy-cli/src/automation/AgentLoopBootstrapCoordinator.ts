import { randomUUID } from "node:crypto";
import {
  buildAgentLoopBootstrapPlan,
} from "./AgentLoopBootstrap";
import {
  AgentLoopBootstrapStore,
  type AgentLoopBootstrapProfile,
} from "./AgentLoopBootstrapStore";
import type {
  AgentLoopCoordinator,
  AgentLoopCreateInput,
} from "./AgentLoopCoordinator";
import { suggestionToCreateInput } from "./AgentLoopSuggestion";

export interface AgentLoopBootstrapCreateInput {
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

export interface AgentLoopBootstrapUpdateInput {
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

export interface AgentLoopBootstrapMutationResult {
  success: boolean;
  errorMessage?: string;
  profile?: AgentLoopBootstrapProfile;
}

export interface AgentLoopBootstrapCoordinatorOptions {
  store: AgentLoopBootstrapStore;
  agentLoopCoordinator: AgentLoopCoordinator;
  pollIntervalMs?: number;
  onChange?: (profiles: AgentLoopBootstrapProfile[]) => void;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePositiveInteger(value: number | null | undefined, minimum = 1): number | undefined {
  if (value == null || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(minimum, Math.floor(value));
}

export class AgentLoopBootstrapCoordinator {
  private readonly store: AgentLoopBootstrapStore;
  private readonly agentLoopCoordinator: AgentLoopCoordinator;
  private readonly pollIntervalMs: number;
  private readonly onChange?: (profiles: AgentLoopBootstrapProfile[]) => void;
  private readonly active = new Set<string>();
  private interval: NodeJS.Timeout | null = null;
  private loaded = false;

  constructor(options: AgentLoopBootstrapCoordinatorOptions) {
    this.store = options.store;
    this.agentLoopCoordinator = options.agentLoopCoordinator;
    this.pollIntervalMs = options.pollIntervalMs ?? 60_000;
    this.onChange = options.onChange;
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

  async listProfiles(): Promise<AgentLoopBootstrapProfile[]> {
    await this.ensureLoaded();
    return this.store.getAll();
  }

  async getProfile(id: string): Promise<AgentLoopBootstrapProfile | undefined> {
    await this.ensureLoaded();
    return this.store.get(id);
  }

  async createProfile(input: AgentLoopBootstrapCreateInput): Promise<AgentLoopBootstrapMutationResult> {
    await this.ensureLoaded();
    const now = Date.now();
    const profile: AgentLoopBootstrapProfile = {
      id: randomUUID(),
      name: normalizeOptionalString(input.name),
      rootDirectory: input.rootDirectory.trim(),
      intervalMs: input.intervalMs,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      nextRunAt: now + input.intervalMs,
      maxDepth: normalizePositiveInteger(input.maxDepth, 0),
      limit: normalizePositiveInteger(input.limit),
      agent: input.agent ?? undefined,
      profileId: normalizeOptionalString(input.profileId),
      projectId: normalizeOptionalString(input.projectId),
      autoRunCreatedLoops: input.autoRunCreatedLoops ?? false,
      status: "idle",
      statusUpdatedAt: now,
    };
    await this.store.upsert(profile);
    this.notifyChange();
    if (input.runNow) {
      return this.runNow(profile.id);
    }
    return { success: true, profile };
  }

  async updateProfile(id: string, input: AgentLoopBootstrapUpdateInput): Promise<AgentLoopBootstrapMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) {
      return { success: false, errorMessage: `Bootstrap profile ${id} not found` };
    }
    const updated: AgentLoopBootstrapProfile = {
      ...existing,
      name: input.name === undefined ? existing.name : normalizeOptionalString(input.name),
      rootDirectory: input.rootDirectory === undefined ? existing.rootDirectory : input.rootDirectory.trim(),
      intervalMs: input.intervalMs ?? existing.intervalMs,
      nextRunAt: input.intervalMs == null ? existing.nextRunAt : Date.now() + input.intervalMs,
      maxDepth: input.maxDepth === undefined ? existing.maxDepth : normalizePositiveInteger(input.maxDepth, 0),
      limit: input.limit === undefined ? existing.limit : normalizePositiveInteger(input.limit),
      agent: input.agent === undefined ? existing.agent : input.agent ?? undefined,
      profileId: input.profileId === undefined ? existing.profileId : normalizeOptionalString(input.profileId),
      projectId: input.projectId === undefined ? existing.projectId : normalizeOptionalString(input.projectId),
      autoRunCreatedLoops: input.autoRunCreatedLoops === undefined ? existing.autoRunCreatedLoops : input.autoRunCreatedLoops,
      updatedAt: Date.now(),
    };
    await this.store.upsert(updated);
    this.notifyChange();
    return { success: true, profile: updated };
  }

  async pauseProfile(id: string): Promise<AgentLoopBootstrapMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) {
      return { success: false, errorMessage: `Bootstrap profile ${id} not found` };
    }
    const updated: AgentLoopBootstrapProfile = {
      ...existing,
      enabled: false,
      updatedAt: Date.now(),
      status: "paused",
      statusUpdatedAt: Date.now(),
    };
    await this.store.upsert(updated);
    this.notifyChange();
    return { success: true, profile: updated };
  }

  async resumeProfile(id: string): Promise<AgentLoopBootstrapMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) {
      return { success: false, errorMessage: `Bootstrap profile ${id} not found` };
    }
    const now = Date.now();
    const updated: AgentLoopBootstrapProfile = {
      ...existing,
      enabled: true,
      updatedAt: now,
      nextRunAt: existing.nextRunAt < now ? now : existing.nextRunAt,
      status: "idle",
      statusUpdatedAt: now,
      lastError: undefined,
    };
    await this.store.upsert(updated);
    this.notifyChange();
    void this.tick();
    return { success: true, profile: updated };
  }

  async removeProfile(id: string): Promise<AgentLoopBootstrapMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) {
      return { success: false, errorMessage: `Bootstrap profile ${id} not found` };
    }
    await this.store.remove(id);
    this.notifyChange();
    return { success: true, profile: existing };
  }

  async runNow(id: string): Promise<AgentLoopBootstrapMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) {
      return { success: false, errorMessage: `Bootstrap profile ${id} not found` };
    }
    if (this.active.has(id)) {
      return { success: false, errorMessage: `Bootstrap profile ${id} is already running`, profile: existing };
    }
    return this.executeProfile(existing);
  }

  private async tick(): Promise<void> {
    await this.ensureLoaded();
    const now = Date.now();
    for (const profile of this.store.getAll()) {
      if (!profile.enabled || this.active.has(profile.id)) {
        continue;
      }
      if (profile.nextRunAt > now) {
        continue;
      }
      await this.executeProfile(profile);
    }
  }

  private async executeProfile(profile: AgentLoopBootstrapProfile): Promise<AgentLoopBootstrapMutationResult> {
    const startedAt = Date.now();
    this.active.add(profile.id);
    const running: AgentLoopBootstrapProfile = {
      ...profile,
      updatedAt: startedAt,
      status: "running",
      statusUpdatedAt: startedAt,
      lastError: undefined,
    };
    await this.store.upsert(running);
    this.notifyChange();

    try {
      const existingLoops = await this.agentLoopCoordinator.listLoops();
      const plans = await buildAgentLoopBootstrapPlan({
        root: running.rootDirectory,
        maxDepth: running.maxDepth,
        limit: running.limit,
        suggestInput: {
          agent: running.agent,
          projectId: running.projectId,
          profileId: running.profileId,
        },
        existingLoops,
      });

      let createdCount = 0;
      let suggestionCount = 0;
      for (const plan of plans) {
        suggestionCount += plan.suggestions.length;
        for (const suggestion of plan.suggestions) {
          if (suggestion.alreadyConfigured) {
            continue;
          }
          const createInput: AgentLoopCreateInput = suggestionToCreateInput(suggestion, {
            projectId: running.projectId,
            profileId: running.profileId,
            runNow: running.autoRunCreatedLoops,
          });
          const result = await this.agentLoopCoordinator.createLoop(createInput);
          if (!result.success) {
            throw new Error(result.errorMessage ?? `Failed to create loop ${suggestion.name}`);
          }
          createdCount += 1;
        }
      }

      const completedAt = Date.now();
      const updated: AgentLoopBootstrapProfile = {
        ...running,
        enabled: running.enabled,
        updatedAt: completedAt,
        nextRunAt: completedAt + running.intervalMs,
        status: running.enabled ? "idle" : "paused",
        statusUpdatedAt: completedAt,
        lastRunAt: completedAt,
        lastRepoCount: plans.length,
        lastSuggestionCount: suggestionCount,
        lastCreatedCount: createdCount,
        lastError: undefined,
      };
      await this.store.upsert(updated);
      this.notifyChange();
      return { success: true, profile: updated };
    } catch (error) {
      const failedAt = Date.now();
      const failed: AgentLoopBootstrapProfile = {
        ...running,
        updatedAt: failedAt,
        nextRunAt: failedAt + running.intervalMs,
        status: "failed",
        statusUpdatedAt: failedAt,
        lastRunAt: failedAt,
        lastError: error instanceof Error ? error.message : String(error),
      };
      await this.store.upsert(failed);
      this.notifyChange();
      return { success: false, errorMessage: failed.lastError, profile: failed };
    } finally {
      this.active.delete(profile.id);
    }
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
