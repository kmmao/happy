import { watch, type FSWatcher } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { AgentLoopDefinition } from "./AgentLoopStore";

const DEFAULT_IGNORED_SEGMENTS = new Set([
  ".git",
  ".happy",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
]);

export interface AgentLoopFileWatcherDeps {
  emitEvent: (loopId: string, input: { source?: string; title: string; details?: string; autoRun?: boolean }) => Promise<void> | void;
  logger?: (message: string) => void;
  debounceMs?: number;
}

interface WatchState {
  watcher: FSWatcher;
  directory: string;
  changedPaths: Set<string>;
  flushTimer: NodeJS.Timeout | null;
}

function normalizeRelativePath(baseDirectory: string, candidatePath: string): string | undefined {
  const absolute = resolve(baseDirectory, candidatePath);
  const relativePath = relative(baseDirectory, absolute).split(sep).join("/");
  if (!relativePath || relativePath.startsWith("../") || relativePath === "..") {
    return undefined;
  }
  return relativePath;
}

export function shouldIgnoreWatchedPath(relativePath: string | undefined): boolean {
  if (!relativePath) {
    return true;
  }
  return relativePath.split("/").some((segment) => DEFAULT_IGNORED_SEGMENTS.has(segment));
}

export function summarizeFileChanges(paths: Iterable<string>): string | undefined {
  const unique = [...new Set([...paths].filter(Boolean))].sort();
  if (unique.length === 0) {
    return undefined;
  }
  const preview = unique.slice(0, 10);
  const suffix = unique.length > preview.length ? ` (+${unique.length - preview.length} more)` : "";
  return `${preview.join(", ")}${suffix}`;
}

export class AgentLoopFileWatcher {
  private readonly emitEvent: AgentLoopFileWatcherDeps["emitEvent"];
  private readonly logger?: AgentLoopFileWatcherDeps["logger"];
  private readonly debounceMs: number;
  private readonly watchers = new Map<string, WatchState>();

  constructor(deps: AgentLoopFileWatcherDeps) {
    this.emitEvent = deps.emitEvent;
    this.logger = deps.logger;
    this.debounceMs = deps.debounceMs ?? 5_000;
  }

  sync(loops: AgentLoopDefinition[]): void {
    const desired = new Map(
      loops
        .filter((loop) => loop.enabled && loop.fileWatchEnabled)
        .map((loop) => [loop.id, loop]),
    );

    for (const loopId of this.watchers.keys()) {
      if (!desired.has(loopId)) {
        this.stopWatching(loopId);
      }
    }

    for (const loop of desired.values()) {
      const existing = this.watchers.get(loop.id);
      if (existing && existing.directory === loop.directory) {
        continue;
      }
      if (existing) {
        this.stopWatching(loop.id);
      }
      this.startWatching(loop);
    }
  }

  async stop(): Promise<void> {
    for (const loopId of [...this.watchers.keys()]) {
      this.stopWatching(loopId);
    }
  }

  private startWatching(loop: AgentLoopDefinition): void {
    try {
      const watcher = watch(loop.directory, { recursive: true }, (_eventType, filename) => {
        const relativePath = normalizeRelativePath(loop.directory, String(filename ?? ""));
        if (shouldIgnoreWatchedPath(relativePath)) {
          return;
        }
        const state = this.watchers.get(loop.id);
        if (!state || !relativePath) {
          return;
        }
        state.changedPaths.add(relativePath);
        if (state.flushTimer) {
          clearTimeout(state.flushTimer);
        }
        state.flushTimer = setTimeout(() => {
          void this.flush(loop.id);
        }, this.debounceMs);
      });

      this.watchers.set(loop.id, {
        watcher,
        directory: loop.directory,
        changedPaths: new Set(),
        flushTimer: null,
      });
      this.logger?.(`[AGENT LOOP WATCH] watching ${loop.id} at ${loop.directory}`);
    } catch (error) {
      this.logger?.(`[AGENT LOOP WATCH] failed to watch ${loop.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private stopWatching(loopId: string): void {
    const existing = this.watchers.get(loopId);
    if (!existing) {
      return;
    }
    if (existing.flushTimer) {
      clearTimeout(existing.flushTimer);
    }
    existing.watcher.close();
    this.watchers.delete(loopId);
    this.logger?.(`[AGENT LOOP WATCH] stopped ${loopId}`);
  }

  private async flush(loopId: string): Promise<void> {
    const state = this.watchers.get(loopId);
    if (!state) {
      return;
    }
    state.flushTimer = null;
    const details = summarizeFileChanges(state.changedPaths);
    state.changedPaths.clear();
    if (!details) {
      return;
    }
    await this.emitEvent(loopId, {
      source: "file-watch",
      title: "Repository files changed",
      details,
      autoRun: true,
    });
  }
}
