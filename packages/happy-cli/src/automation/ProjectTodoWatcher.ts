import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { parseTodoMd, type TodoMdEntry } from "./AgentLoopMemory";
import { readFile } from "node:fs/promises";

const TODO_MD_RELATIVE = join(".happy", "todo.md");

export interface ProjectTodoWatcherDeps {
  onChanged: (projectId: string, directory: string, machineId: string, entries: TodoMdEntry[]) => Promise<void> | void;
  logger?: (message: string) => void;
  debounceMs?: number;
}

interface WatchedProject {
  directory: string;
  machineId: string;
  watcher: FSWatcher;
  timer: NodeJS.Timeout | null;
}

export class ProjectTodoWatcher {
  private readonly onChanged: ProjectTodoWatcherDeps["onChanged"];
  private readonly logger?: ProjectTodoWatcherDeps["logger"];
  private readonly debounceMs: number;
  private readonly watched = new Map<string, WatchedProject>();

  constructor(deps: ProjectTodoWatcherDeps) {
    this.onChanged = deps.onChanged;
    this.logger = deps.logger;
    this.debounceMs = deps.debounceMs ?? 2_000;
  }

  register(projectId: string, directory: string, machineId: string): void {
    const existing = this.watched.get(projectId);
    if (existing && existing.directory === directory) {
      return;
    }
    if (existing) {
      this.unregister(projectId);
    }

    const todoPath = join(directory, TODO_MD_RELATIVE);
    try {
      const watcher = watch(todoPath, () => {
        const state = this.watched.get(projectId);
        if (!state) return;
        if (state.timer) clearTimeout(state.timer);
        state.timer = setTimeout(() => void this.flush(projectId), this.debounceMs);
      });

      this.watched.set(projectId, { directory, machineId, watcher, timer: null });
      this.logger?.(`[TODO WATCH] watching ${todoPath} for project ${projectId}`);
    } catch {
      // todo.md may not exist yet; skip silently
      this.logger?.(`[TODO WATCH] todo.md not found for project ${projectId}, skipping watch`);
    }
  }

  unregister(projectId: string): void {
    const state = this.watched.get(projectId);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.watcher.close();
    this.watched.delete(projectId);
    this.logger?.(`[TODO WATCH] stopped watching project ${projectId}`);
  }

  stop(): void {
    for (const projectId of [...this.watched.keys()]) {
      this.unregister(projectId);
    }
  }

  private async flush(projectId: string): Promise<void> {
    const state = this.watched.get(projectId);
    if (!state) return;
    state.timer = null;

    const todoPath = join(state.directory, TODO_MD_RELATIVE);
    let entries: TodoMdEntry[];
    try {
      const content = await readFile(todoPath, "utf-8");
      entries = parseTodoMd(content);
    } catch {
      return;
    }

    if (entries.length === 0) return;

    try {
      await this.onChanged(projectId, state.directory, state.machineId, entries);
    } catch (err) {
      this.logger?.(`[TODO WATCH] sync failed for project ${projectId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
