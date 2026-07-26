import { randomUUID, createHash } from "node:crypto";
import { logger } from "@/ui/logger";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { parseAgentLoopMemory } from "./AgentLoopMemory";
import { AutoDreamStore, type AutoDreamProfile } from "./AutoDreamStore";
import { scanSessionTranscripts, type TranscriptTurn } from "./SessionTranscriptScanner";

export interface AutoDreamCreateInput {
  name?: string;
  rootDirectory: string;
  intervalMs: number;
  maxDepth?: number;
  limit?: number;
  runNow?: boolean;
}

export interface AutoDreamUpdateInput {
  name?: string | null;
  rootDirectory?: string;
  intervalMs?: number;
  maxDepth?: number | null;
  limit?: number | null;
}

export interface AutoDreamMutationResult {
  success: boolean;
  errorMessage?: string;
  profile?: AutoDreamProfile;
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePositiveInteger(value: number | null | undefined, minimum = 1): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.max(minimum, Math.floor(value));
}

async function walkForMemoryFiles(rootDirectory: string, maxDepth = 6, limit = 100): Promise<string[]> {
  const results: string[] = [];
  const visit = async (current: string, depth: number) => {
    if (results.length >= limit || depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit) break;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "dist", "build"].includes(entry.name)) continue;
        await visit(fullPath, depth + 1);
      } else if (entry.isFile() && entry.name === "memory.md" && fullPath.includes(`${join('.happy', 'agent-loops')}`)) {
        results.push(fullPath);
      }
    }
  };
  await visit(rootDirectory, 0);
  return results;
}

function renderDreamReport(params: {
  rootDirectory: string;
  stage: "starting" | "updating";
  generatedAt: number;
  files: Array<{ path: string; content: ReturnType<typeof parseAgentLoopMemory>; updatedAt: number }>;
}): string {
  return [
    "# Happy Auto-Dream",
    "",
    `- Root: ${params.rootDirectory}`,
    `- Stage: ${params.stage}`,
    `- Generated: ${new Date(params.generatedAt).toISOString()}`,
    `- Memory files: ${params.files.length}`,
    "",
    "## Global Summary",
    params.files.length === 0
      ? "No loop memory files were found yet."
      : params.files.map((file) => {
          const title = basename(relative(params.rootDirectory, file.path)) || file.path;
          const summary = [file.content.goal, file.content.currentFocus, file.content.lastReflectionSummary].filter(Boolean).join(" | ") || "No structured summary yet.";
          return `- ${title}: ${summary}`;
        }).join("\n"),
    "",
    ...params.files.flatMap((file) => [
      `## ${relative(params.rootDirectory, file.path)}`,
      `Updated: ${new Date(file.updatedAt).toISOString()}`,
      "",
      file.content.goal ? `Goal:\n${file.content.goal}` : "Goal: -",
      "",
      file.content.currentFocus ? `Current Focus:\n${file.content.currentFocus}` : "Current Focus: -",
      "",
      file.content.workingMemory ? `Working Memory:\n${file.content.workingMemory}` : "Working Memory: -",
      "",
      file.content.lastReflectionSummary ? `Reflection Summary:\n${file.content.lastReflectionSummary}` : "Reflection Summary: -",
      "",
    ]),
  ].join("\n");
}

export class AutoDreamCoordinator {
  private loaded = false;
  private interval: NodeJS.Timeout | null = null;
  private active = new Set<string>();

  constructor(
    private readonly options: {
      store: AutoDreamStore;
      pollIntervalMs?: number;
      onChange?: (profiles: AutoDreamProfile[]) => void;
      onTranscriptsFound?: (turns: TranscriptTurn[]) => void;
    },
  ) {}

  private get store() {
    return this.options.store;
  }

  private get pollIntervalMs() {
    return this.options.pollIntervalMs ?? 30_000;
  }

  async start(): Promise<void> {
    await this.ensureLoaded();
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => void this.tick().catch((err) => logger.debug("[AUTO-DREAM] tick error:", err)), this.pollIntervalMs);
    if (this.interval) (this.interval as NodeJS.Timeout).unref?.();
    this.notifyChange();
    void this.tick().catch((err) => logger.debug("[AUTO-DREAM] tick error:", err));
  }

  async stop(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async listProfiles(): Promise<AutoDreamProfile[]> {
    await this.ensureLoaded();
    return this.store.getAll();
  }

  /** Sync version — only safe to call after start() has resolved. */
  listProfilesSync(): AutoDreamProfile[] {
    return this.store.getAll();
  }

  async getProfile(id: string): Promise<AutoDreamProfile | undefined> {
    await this.ensureLoaded();
    return this.store.get(id);
  }

  async createProfile(input: AutoDreamCreateInput): Promise<AutoDreamMutationResult> {
    await this.ensureLoaded();
    const now = Date.now();
    const profile: AutoDreamProfile = {
      id: randomUUID(),
      name: normalizeOptionalString(input.name),
      rootDirectory: input.rootDirectory.trim(),
      intervalMs: input.intervalMs,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      nextRunAt: now + input.intervalMs,
      status: "idle",
      stage: "starting",
      statusUpdatedAt: now,
      maxDepth: normalizePositiveInteger(input.maxDepth, 0),
      limit: normalizePositiveInteger(input.limit),
    };
    await this.store.upsert(profile);
    this.notifyChange();
    if (input.runNow) return this.runNow(profile.id);
    return { success: true, profile };
  }

  async updateProfile(id: string, input: AutoDreamUpdateInput): Promise<AutoDreamMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) return { success: false, errorMessage: `Auto-Dream profile ${id} not found` };
    const updated: AutoDreamProfile = {
      ...existing,
      name: input.name === undefined ? existing.name : normalizeOptionalString(input.name),
      rootDirectory: input.rootDirectory === undefined ? existing.rootDirectory : input.rootDirectory.trim(),
      intervalMs: input.intervalMs ?? existing.intervalMs,
      nextRunAt: input.intervalMs == null ? existing.nextRunAt : Date.now() + input.intervalMs,
      maxDepth: input.maxDepth === undefined ? existing.maxDepth : normalizePositiveInteger(input.maxDepth, 0),
      limit: input.limit === undefined ? existing.limit : normalizePositiveInteger(input.limit),
      updatedAt: Date.now(),
    };
    await this.store.upsert(updated);
    this.notifyChange();
    return { success: true, profile: updated };
  }

  async pauseProfile(id: string): Promise<AutoDreamMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) return { success: false, errorMessage: `Auto-Dream profile ${id} not found` };
    const now = Date.now();
    const updated: AutoDreamProfile = { ...existing, enabled: false, updatedAt: now, status: "paused", statusUpdatedAt: now };
    await this.store.upsert(updated);
    this.notifyChange();
    return { success: true, profile: updated };
  }

  async resumeProfile(id: string): Promise<AutoDreamMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) return { success: false, errorMessage: `Auto-Dream profile ${id} not found` };
    const now = Date.now();
    const updated: AutoDreamProfile = { ...existing, enabled: true, updatedAt: now, nextRunAt: existing.nextRunAt < now ? now : existing.nextRunAt, status: "idle", statusUpdatedAt: now, lastError: undefined };
    await this.store.upsert(updated);
    this.notifyChange();
    void this.tick();
    return { success: true, profile: updated };
  }

  async removeProfile(id: string): Promise<AutoDreamMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) return { success: false, errorMessage: `Auto-Dream profile ${id} not found` };
    await this.store.remove(id);
    this.notifyChange();
    return { success: true, profile: existing };
  }

  async runNow(id: string): Promise<AutoDreamMutationResult> {
    await this.ensureLoaded();
    const existing = this.store.get(id);
    if (!existing) return { success: false, errorMessage: `Auto-Dream profile ${id} not found` };
    if (this.active.has(id)) return { success: false, errorMessage: `Auto-Dream profile ${id} is already running`, profile: existing };
    return this.executeProfile(existing);
  }

  private async tick(): Promise<void> {
    await this.ensureLoaded();
    const now = Date.now();
    for (const profile of this.store.getAll()) {
      if (!profile.enabled || this.active.has(profile.id) || profile.nextRunAt > now) continue;
      await this.executeProfile(profile);
    }
  }

  private async executeProfile(profile: AutoDreamProfile): Promise<AutoDreamMutationResult> {
    this.active.add(profile.id);
    const startedAt = Date.now();
    let current: AutoDreamProfile = { ...profile, updatedAt: startedAt, status: "running", stage: "starting", statusUpdatedAt: startedAt };
    await this.store.upsert(current);
    this.notifyChange();

    const updateStage = async (stage: AutoDreamProfile["stage"]) => {
      const now = Date.now();
      current = { ...current, stage, updatedAt: now, statusUpdatedAt: now };
      await this.store.upsert(current);
      this.notifyChange();
    };

    try {
      // Phase 1: Scanning memory files
      await updateStage("scanning");
      const files = await walkForMemoryFiles(current.rootDirectory, current.maxDepth ?? 6, current.limit ?? 100);
      const entries = await Promise.all(files.map(async (path) => {
        const raw = await readFile(path, "utf-8");
        const info = await stat(path);
        return { path, content: parseAgentLoopMemory(raw), updatedAt: info.mtimeMs };
      }));
      const lastRunAt = current.lastRunAt ?? 0;
      const updatedFiles = entries.filter((entry) => entry.updatedAt > lastRunAt).length;
      const finalStage = current.lastRunAt ? "updating" as const : "starting" as const;

      // Phase 2: Analyzing and scanning transcripts
      await updateStage("analyzing");
      // Scan session transcripts for valuable turns
      try {
        const transcripts = await scanSessionTranscripts({
          sinceMs: current.lastRunAt ?? startedAt - 24 * 60 * 60_000,
          maxSessions: 20,
          maxTurnsPerSession: 10,
        });
        if (transcripts.length > 0) {
          try { this.options.onTranscriptsFound?.(transcripts); } catch { /* best-effort */ }
          logger.debug(`[AUTO-DREAM] Found ${transcripts.length} valuable transcript turns`);
        }
      } catch (err) {
        logger.debug("[AUTO-DREAM] Session transcript scan failed (non-fatal):", err);
      }

      // Phase 3: Writing dream report
      await updateStage("writing");
      const dreamDir = join(current.rootDirectory, ".happy", "auto-dream", current.id);
      await mkdir(dreamDir, { recursive: true });
      const report = renderDreamReport({ rootDirectory: current.rootDirectory, stage: finalStage, generatedAt: startedAt, files: entries });
      const hash = createHash("sha1").update(report).digest("hex").slice(0, 12);
      const dreamFilePath = join(dreamDir, `dream-${hash}.md`);
      await writeFile(join(dreamDir, "dream-latest.md"), report, "utf-8");
      await writeFile(dreamFilePath, report, "utf-8");

      const completedAt = Date.now();
      const completed: AutoDreamProfile = {
        ...current,
        updatedAt: completedAt,
        nextRunAt: completedAt + current.intervalMs,
        status: "idle",
        stage: finalStage,
        statusUpdatedAt: completedAt,
        lastRunAt: completedAt,
        lastError: undefined,
        lastMemoryFiles: entries.length,
        lastUpdatedFiles: updatedFiles,
        latestDreamFilePath: join(dreamDir, "dream-latest.md"),
      };
      await this.store.upsert(completed);
      this.notifyChange();
      return { success: true, profile: completed };
    } catch (error) {
      const failedAt = Date.now();
      const failed: AutoDreamProfile = { ...current, updatedAt: failedAt, status: "failed", statusUpdatedAt: failedAt, nextRunAt: failedAt + current.intervalMs, lastError: error instanceof Error ? error.message : String(error) };
      await this.store.upsert(failed);
      this.notifyChange();
      return { success: false, errorMessage: failed.lastError, profile: failed };
    } finally {
      this.active.delete(profile.id);
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.store.load();
    this.loaded = true;
  }

  private notifyChange(): void {
    this.options.onChange?.(this.store.getAll());
  }
}
