/**
 * Tracks TaskCreate / TaskUpdate / TaskGet / TaskList tool calls from
 * Claude Code runtime and converts the accumulated state into the
 * TodoWrite-compatible progress mirror format that the App expects.
 *
 * Claude Code (Opus 4.6+) replaced the SDK-native TodoWrite tool with
 * finer-grained TaskCreate/TaskUpdate/TaskGet/TaskList tools. These are
 * runtime-only tools that don't produce the `oldTodos`/`newTodos` shaped
 * `tool_use_result` the CLI's existing TodoWrite mirror relies on.
 * This module bridges the gap.
 *
 * Batch freeze: the Claude runtime keeps completed tasks alive across
 * conversational turns. Without intervention, the mirror would emit the
 * union of every task ever created, and `applyHappyProgressUpdate`'s
 * Jaccard overlap check would never see a topic boundary — every new
 * `TaskCreate` would be appended to the existing progress list. The
 * `freezeCompletedBatch()` hook lets the launcher mark the current set
 * as belonging to a closed batch at a turn boundary; subsequent emits
 * exclude frozen tasks, so the next `TaskCreate` looks like a fresh
 * list to the boundary detector and a new progress list is started.
 */

export interface TaskMirrorTodo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
  description?: string;
}

interface TaskEntry {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
  description?: string;
}

interface PendingCreate {
  subject: string;
  activeForm?: string;
}

const VALID_STATUSES = new Set(["pending", "in_progress", "completed"]);

const STATUS_MAP: Record<string, TaskEntry["status"]> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
};

// Matches "#N [status] subject" from TaskList output
const TASK_LIST_LINE_RE = /^#(\d+)\s*\[([^\]]+)\]\s*(.+)$/;

// Matches "Task #N created successfully" from TaskCreate result
const TASK_CREATED_RE = /Task #(\d+) created/;

export class TaskMirrorState {
  private readonly tasks = new Map<string, TaskEntry>();
  private nextId = 1;

  // tool_use_id → pending create data (awaiting result with real ID)
  private readonly pendingCreates = new Map<string, PendingCreate>();
  // tool_use_ids for TaskList calls awaiting results
  private readonly pendingTaskLists = new Set<string>();

  // Task IDs that belong to a previously-archived progress batch. Frozen
  // tasks are still tracked in `tasks` (so the runtime's ID space stays
  // consistent), but they are excluded from `getTodos()` / `hasTasks()` and
  // `handleUpdate()` no-ops on them. This is what prevents accumulated
  // completed history from masking a new-topic boundary in the consumer.
  private readonly frozenTaskIds = new Set<string>();

  /**
   * Process an assistant tool_use block. Returns true if the internal
   * state changed (caller should push to metadata.progress).
   */
  processToolUse(
    toolName: string,
    input: Record<string, unknown>,
    toolUseId?: string,
  ): boolean {
    switch (toolName) {
      case "TaskCreate":
        return this.handleCreate(input, toolUseId);
      case "TaskUpdate":
        return this.handleUpdate(input);
      case "TaskList":
        if (toolUseId) this.pendingTaskLists.add(toolUseId);
        return false;
      default:
        return false;
    }
  }

  /**
   * Process a user tool_result block. Returns true if state changed
   * (TaskCreate ID confirmation or TaskList reconciliation).
   */
  processToolResult(toolUseId: string, resultText: string): boolean {
    // TaskCreate result: confirm real ID
    const pending = this.pendingCreates.get(toolUseId);
    if (pending) {
      this.pendingCreates.delete(toolUseId);
      const match = TASK_CREATED_RE.exec(resultText);
      if (match) {
        const realId = match[1]!;
        // Find the task we optimistically created and fix its ID
        const tempId = this.findTempIdForPending(pending.subject);
        if (tempId && tempId !== realId) {
          const entry = this.tasks.get(tempId);
          if (entry) {
            this.tasks.delete(tempId);
            entry.id = realId;
            this.tasks.set(realId, entry);
          }
        }
        this.nextId = Math.max(this.nextId, Number(realId) + 1);
      }
      return false; // state content unchanged, only ID fixed
    }

    // TaskList result: reconcile full state
    if (this.pendingTaskLists.has(toolUseId)) {
      this.pendingTaskLists.delete(toolUseId);
      return this.reconcileFromTaskList(resultText);
    }

    return false;
  }

  getTodos(): TaskMirrorTodo[] {
    const out: TaskMirrorTodo[] = [];
    for (const [id, t] of this.tasks) {
      if (this.frozenTaskIds.has(id)) continue;
      out.push({
        content: t.content,
        status: t.status,
        activeForm: t.activeForm,
        description: t.description,
      });
    }
    return out;
  }

  hasTasks(): boolean {
    for (const id of this.tasks.keys()) {
      if (!this.frozenTaskIds.has(id)) return true;
    }
    return false;
  }

  /**
   * Freeze the current live batch if all of its tasks are completed.
   * Called at a fresh user-turn boundary so the next TaskCreate looks
   * like a new list to the consumer rather than an append to the prior
   * batch. Returns true when at least one task was frozen.
   */
  freezeCompletedBatch(): boolean {
    const liveIds: string[] = [];
    for (const [id, entry] of this.tasks) {
      if (this.frozenTaskIds.has(id)) continue;
      if (entry.status !== "completed") return false;
      liveIds.push(id);
    }
    if (liveIds.length === 0) return false;
    for (const id of liveIds) this.frozenTaskIds.add(id);
    return true;
  }

  /**
   * Rebuild state from TaskList output text. Each line matches
   * `#N [status] subject`. Returns true if state actually changed.
   */
  reconcileFromTaskList(text: string): boolean {
    const parsed = new Map<string, TaskEntry>();
    let maxId = 0;

    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = TASK_LIST_LINE_RE.exec(trimmed);
      if (!match) continue;

      const id = match[1]!;
      const rawStatus = match[2]!.trim();
      const subject = match[3]!.trim();
      const numId = Number(id);
      if (numId > maxId) maxId = numId;

      const status = STATUS_MAP[rawStatus] ?? "pending";
      const existing = this.tasks.get(id);

      parsed.set(id, {
        id,
        content: subject,
        status,
        activeForm: existing?.activeForm,
        description: existing?.description,
      });
    }

    if (parsed.size === 0) return false;

    // Detect change ignoring frozen entries: the frozen batch's view is
    // already locked into an archived progress list, so flip-flopping its
    // statuses shouldn't surface as a state change to the consumer.
    const liveBefore = this.collectLiveSnapshot(this.tasks);
    const liveAfter = this.collectLiveSnapshot(parsed);
    let changed = liveBefore.size !== liveAfter.size;
    if (!changed) {
      for (const [id, after] of liveAfter) {
        const before = liveBefore.get(id);
        if (
          !before ||
          before.content !== after.content ||
          before.status !== after.status
        ) {
          changed = true;
          break;
        }
      }
    }

    // Rebuild tasks; preserve frozen markers for IDs that still exist.
    this.tasks.clear();
    for (const [id, entry] of parsed) this.tasks.set(id, entry);
    for (const id of [...this.frozenTaskIds]) {
      if (!parsed.has(id)) this.frozenTaskIds.delete(id);
    }
    this.nextId = maxId + 1;

    return changed;
  }

  private collectLiveSnapshot(
    source: ReadonlyMap<string, TaskEntry>,
  ): Map<string, TaskEntry> {
    const out = new Map<string, TaskEntry>();
    for (const [id, entry] of source) {
      if (this.frozenTaskIds.has(id)) continue;
      out.set(id, entry);
    }
    return out;
  }

  private handleCreate(
    input: Record<string, unknown>,
    toolUseId?: string,
  ): boolean {
    const subject =
      typeof input.subject === "string" ? input.subject.trim() : "";
    if (!subject) return false;

    const activeForm =
      typeof input.activeForm === "string" && input.activeForm.length > 0
        ? input.activeForm
        : undefined;
    const description =
      typeof input.description === "string" && input.description.length > 0
        ? input.description
        : undefined;

    // Optimistically assign sequential ID; will be corrected from result
    const id = String(this.nextId);
    this.nextId += 1;

    this.tasks.set(id, {
      id,
      content: subject,
      status: "pending",
      activeForm,
      description,
    });

    if (toolUseId) {
      this.pendingCreates.set(toolUseId, { subject, activeForm });
    }

    return true;
  }

  private handleUpdate(input: Record<string, unknown>): boolean {
    const taskId =
      typeof input.taskId === "string" ? input.taskId : "";
    if (!taskId) return false;

    const entry = this.tasks.get(taskId);
    if (!entry) return false;

    // Frozen tasks belong to an already-archived progress list. Deletions
    // are still honoured (they keep the ID space clean) but they should
    // not show up as a visible state change. Other mutations are dropped
    // entirely so a stale post-archive TaskUpdate cannot reanimate the
    // closed list.
    if (this.frozenTaskIds.has(taskId)) {
      if (input.status === "deleted") {
        this.tasks.delete(taskId);
        this.frozenTaskIds.delete(taskId);
      }
      return false;
    }

    let changed = false;

    const status = input.status;
    if (typeof status === "string") {
      if (status === "deleted") {
        this.tasks.delete(taskId);
        return true;
      }
      if (VALID_STATUSES.has(status) && entry.status !== status) {
        entry.status = status as TaskEntry["status"];
        changed = true;
      }
    }

    if (typeof input.subject === "string" && input.subject !== entry.content) {
      entry.content = input.subject;
      changed = true;
    }

    if (typeof input.activeForm === "string" && input.activeForm !== entry.activeForm) {
      entry.activeForm = input.activeForm.length > 0 ? input.activeForm : undefined;
      changed = true;
    }

    if (typeof input.description === "string" && input.description !== entry.description) {
      entry.description = input.description.length > 0 ? input.description : undefined;
      changed = true;
    }

    return changed;
  }

  private findTempIdForPending(subject: string): string | undefined {
    // Walk in reverse insertion order so we match the most recently
    // created live entry, never a frozen one that happens to share the
    // subject (e.g. when the agent recreates a task with the same name).
    const ids = [...this.tasks.keys()];
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i]!;
      if (this.frozenTaskIds.has(id)) continue;
      const entry = this.tasks.get(id);
      if (entry && entry.content === subject) return id;
    }
    return undefined;
  }
}
