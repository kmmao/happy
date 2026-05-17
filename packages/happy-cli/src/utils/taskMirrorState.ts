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
    return Array.from(this.tasks.values()).map((t) => ({
      content: t.content,
      status: t.status,
      activeForm: t.activeForm,
      description: t.description,
    }));
  }

  hasTasks(): boolean {
    return this.tasks.size > 0;
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

    // Detect change: compare sizes and each entry
    let changed = parsed.size !== this.tasks.size;
    if (!changed) {
      for (const [id, entry] of parsed) {
        const existing = this.tasks.get(id);
        if (
          !existing ||
          existing.content !== entry.content ||
          existing.status !== entry.status
        ) {
          changed = true;
          break;
        }
      }
    }

    if (changed) {
      this.tasks.clear();
      for (const [id, entry] of parsed) {
        this.tasks.set(id, entry);
      }
      this.nextId = maxId + 1;
    }

    return changed;
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
    for (const [id, entry] of this.tasks) {
      if (entry.content === subject) return id;
    }
    return undefined;
  }
}
