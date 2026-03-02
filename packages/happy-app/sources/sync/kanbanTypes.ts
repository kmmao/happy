/**
 * Kanban Board type definitions and constants
 *
 * Kanban tasks are stored in UserKVStore with E2E encryption.
 * Each task is an independent KV entry: kanban/task/{taskId}
 */

//
// Column definitions
//

export const KANBAN_COLUMNS = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
] as const;

export type KanbanColumnId = (typeof KANBAN_COLUMNS)[number];

export const KANBAN_COLUMN_LABELS = {
  backlog: "kanban.columns.backlog",
  todo: "kanban.columns.todo",
  in_progress: "kanban.columns.inProgress",
  review: "kanban.columns.review",
  done: "kanban.columns.done",
} as const;

/** Ionicons icon names per column, used in action sheets and board empty states */
export const KANBAN_COLUMN_ICONS = {
  backlog: "file-tray-outline",
  todo: "list-outline",
  in_progress: "play-circle-outline",
  review: "eye-outline",
  done: "checkmark-circle-outline",
} as const;

/** Per-column empty state i18n title keys */
export const KANBAN_COLUMN_EMPTY_TITLES = {
  backlog: "kanban.columnEmpty.backlog.title",
  todo: "kanban.columnEmpty.todo.title",
  in_progress: "kanban.columnEmpty.inProgress.title",
  review: "kanban.columnEmpty.review.title",
  done: "kanban.columnEmpty.done.title",
} as const;

/** Per-column empty state i18n subtitle keys */
export const KANBAN_COLUMN_EMPTY_SUBTITLES = {
  backlog: "kanban.columnEmpty.backlog.subtitle",
  todo: "kanban.columnEmpty.todo.subtitle",
  in_progress: "kanban.columnEmpty.inProgress.subtitle",
  review: "kanban.columnEmpty.review.subtitle",
  done: "kanban.columnEmpty.done.subtitle",
} as const;

//
// Priority definitions
//

export const KANBAN_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export type KanbanPriority = (typeof KANBAN_PRIORITIES)[number];

export const KANBAN_PRIORITY_LABELS = {
  low: "kanban.priority.low",
  medium: "kanban.priority.medium",
  high: "kanban.priority.high",
  urgent: "kanban.priority.urgent",
} as const;

//
// Source type (v2 extensibility for Ideation/Roadmap)
//

export type KanbanSourceType = "manual" | "ideation" | "roadmap";

//
// Task data model
//

/**
 * Task data stored encrypted in KV value.
 * This is the shape that gets JSON.stringify'd → encrypted → stored as KV value.
 */
export interface KanbanTaskData {
  readonly title: string;
  readonly description: string;
  readonly columnId: KanbanColumnId;
  readonly priority: KanbanPriority;
  /** Sort weight within column, lower = higher position */
  readonly sortOrder: number;
  /** Linked session IDs */
  readonly sessionIds: readonly string[];
  /** Pre-filled prompt when creating a session from this task */
  readonly sessionPrompt: string | null;
  /** Target machine ID */
  readonly machineId: string | null;
  /** Target repo/working directory */
  readonly directory: string | null;
  /** User-defined tags */
  readonly tags: readonly string[];
  /** Source type for Ideation/Roadmap integration (v2) */
  readonly sourceType: KanbanSourceType;
  /** Source ID pointing to ideation/roadmap item (v2) */
  readonly sourceId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * In-memory task with id and KV version for optimistic locking.
 * Used by UI components and the kanban store.
 */
export interface KanbanTask extends KanbanTaskData {
  readonly id: string;
  /** KV optimistic lock version (-1 = new, 0+ = existing) */
  readonly kvVersion: number;
}

//
// KV key helpers
//

const KANBAN_TASK_PREFIX = "kanban/task/";

export function kanbanTaskKey(taskId: string): string {
  return `${KANBAN_TASK_PREFIX}${taskId}`;
}

export function parseKanbanTaskKey(key: string): string | null {
  if (!key.startsWith(KANBAN_TASK_PREFIX)) {
    return null;
  }
  return key.slice(KANBAN_TASK_PREFIX.length);
}

export function isKanbanKey(key: string): boolean {
  return key.startsWith("kanban/");
}

//
// Factory helpers
//

export function createDefaultTaskData(
  overrides: Partial<KanbanTaskData> & Pick<KanbanTaskData, "title">,
): KanbanTaskData {
  const now = Date.now();
  return {
    title: overrides.title,
    description: overrides.description ?? "",
    columnId: overrides.columnId ?? "todo",
    priority: overrides.priority ?? "medium",
    sortOrder: overrides.sortOrder ?? now,
    sessionIds: overrides.sessionIds ?? [],
    sessionPrompt: overrides.sessionPrompt ?? null,
    machineId: overrides.machineId ?? null,
    directory: overrides.directory ?? null,
    tags: overrides.tags ?? [],
    sourceType: overrides.sourceType ?? "manual",
    sourceId: overrides.sourceId ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

//
// Utility
//

export function tasksForColumn(
  tasks: ReadonlyArray<KanbanTask>,
  columnId: KanbanColumnId,
): ReadonlyArray<KanbanTask> {
  return tasks
    .filter((t) => t.columnId === columnId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function taskCountByColumn(
  tasks: ReadonlyArray<KanbanTask>,
): Record<KanbanColumnId, number> {
  const counts: Record<KanbanColumnId, number> = {
    backlog: 0,
    todo: 0,
    in_progress: 0,
    review: 0,
    done: 0,
  };
  for (const task of tasks) {
    counts[task.columnId]++;
  }
  return counts;
}
