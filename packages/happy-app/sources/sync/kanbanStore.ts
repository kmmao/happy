/**
 * Kanban Board Zustand Store
 *
 * Independent store (NOT in storage.ts) for kanban task management.
 * Tasks are persisted in UserKVStore with E2E encryption.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { sync } from "./sync";
import { kvList, kvMutate, type KvMutation, type KvItem } from "./apiKv";
import {
  type KanbanTask,
  type KanbanTaskData,
  type KanbanColumnId,
  kanbanTaskKey,
  parseKanbanTaskKey,
  createDefaultTaskData,
} from "./kanbanTypes";
import { randomUUID } from "expo-crypto";

//
// State
//

interface KanbanState {
  readonly tasks: Readonly<Record<string, KanbanTask>>;
  readonly isLoading: boolean;
  readonly isLoaded: boolean;
  readonly activeColumnId: KanbanColumnId;
}

interface KanbanActions {
  loadTasks: () => Promise<void>;
  saveTask: (task: KanbanTask) => Promise<KanbanTask>;
  createTask: (
    data: Partial<KanbanTaskData> & Pick<KanbanTaskData, "title">,
  ) => Promise<KanbanTask>;
  deleteTask: (taskId: string) => Promise<void>;
  moveTask: (taskId: string, toColumn: KanbanColumnId) => Promise<void>;
  reorderTasks: (
    columnId: KanbanColumnId,
    fromIndex: number,
    toIndex: number,
  ) => Promise<void>;
  linkSession: (taskId: string, sessionId: string) => Promise<void>;
  unlinkSession: (taskId: string, sessionId: string) => Promise<void>;
  handleKvUpdate: (
    changes: ReadonlyArray<{
      readonly key: string;
      readonly value: string | null;
      readonly version: number;
    }>,
  ) => void;
  setActiveColumn: (columnId: KanbanColumnId) => void;
  reset: () => void;
}

type KanbanStore = KanbanState & KanbanActions;

//
// Encryption helpers
//

async function encryptTaskData(data: KanbanTaskData): Promise<string> {
  const encryption = sync.encryption;
  return await encryption.encryptRaw(data);
}

async function decryptTaskData(
  encrypted: string,
): Promise<KanbanTaskData | null> {
  const encryption = sync.encryption;
  return await encryption.decryptRaw(encrypted);
}

async function decryptKvItem(item: KvItem): Promise<KanbanTask | null> {
  const taskId = parseKanbanTaskKey(item.key);
  if (!taskId) {
    return null;
  }

  const data = await decryptTaskData(item.value);
  if (!data) {
    return null;
  }

  return {
    ...data,
    id: taskId,
    kvVersion: item.version,
  };
}

//
// Store
//

const initialState: KanbanState = {
  tasks: {},
  isLoading: false,
  isLoaded: false,
  activeColumnId: "todo",
};

export const kanbanStore = create<KanbanStore>()((set, get) => ({
  ...initialState,

  loadTasks: async () => {
    if (get().isLoading) {
      return;
    }

    set({ isLoading: true });

    try {
      const credentials = sync.getCredentials();
      if (!credentials) {
        set({ isLoading: false });
        return;
      }

      const response = await kvList(credentials, {
        prefix: "kanban/task/",
        limit: 500,
      });

      // Decrypt all tasks in parallel
      const decrypted = await Promise.all(response.items.map(decryptKvItem));

      const tasks: Record<string, KanbanTask> = {};
      for (const task of decrypted) {
        if (task) {
          tasks[task.id] = task;
        }
      }

      set({ tasks, isLoading: false, isLoaded: true });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  saveTask: async (task: KanbanTask) => {
    const credentials = sync.getCredentials();
    if (!credentials) {
      throw new Error("Not authenticated");
    }

    const updatedData: KanbanTaskData = {
      title: task.title,
      description: task.description,
      columnId: task.columnId,
      priority: task.priority,
      sortOrder: task.sortOrder,
      sessionIds: task.sessionIds,
      sessionPrompt: task.sessionPrompt,
      machineId: task.machineId,
      directory: task.directory,
      tags: task.tags,
      sourceType: task.sourceType,
      sourceId: task.sourceId,
      createdAt: task.createdAt,
      updatedAt: Date.now(),
    };

    const encrypted = await encryptTaskData(updatedData);
    const key = kanbanTaskKey(task.id);

    const result = await kvMutate(credentials, [
      { key, value: encrypted, version: task.kvVersion },
    ]);

    if (!result.success) {
      // Version conflict — reload from server
      await get().loadTasks();
      throw new Error("Task was updated on another device");
    }

    const newVersion = result.results[0].version;
    const updatedTask: KanbanTask = {
      ...updatedData,
      id: task.id,
      kvVersion: newVersion,
    };

    set((prev) => ({
      tasks: { ...prev.tasks, [task.id]: updatedTask },
    }));

    return updatedTask;
  },

  createTask: async (data) => {
    const credentials = sync.getCredentials();
    if (!credentials) {
      throw new Error("Not authenticated");
    }

    const taskId = randomUUID();
    const taskData = createDefaultTaskData(data);
    const encrypted = await encryptTaskData(taskData);
    const key = kanbanTaskKey(taskId);

    const result = await kvMutate(credentials, [
      { key, value: encrypted, version: -1 },
    ]);

    if (!result.success) {
      throw new Error("Failed to create task");
    }

    const newTask: KanbanTask = {
      ...taskData,
      id: taskId,
      kvVersion: result.results[0].version,
    };

    set((prev) => ({
      tasks: { ...prev.tasks, [taskId]: newTask },
    }));

    return newTask;
  },

  deleteTask: async (taskId: string) => {
    const task = get().tasks[taskId];
    if (!task) {
      return;
    }

    const credentials = sync.getCredentials();
    if (!credentials) {
      throw new Error("Not authenticated");
    }

    const key = kanbanTaskKey(taskId);
    const result = await kvMutate(credentials, [
      { key, value: null, version: task.kvVersion },
    ]);

    if (!result.success) {
      await get().loadTasks();
      throw new Error("Task was updated on another device");
    }

    set((prev) => {
      const { [taskId]: _, ...rest } = prev.tasks;
      return { tasks: rest };
    });
  },

  moveTask: async (taskId: string, toColumn: KanbanColumnId) => {
    const task = get().tasks[taskId];
    if (!task || task.columnId === toColumn) {
      return;
    }

    const updatedTask: KanbanTask = {
      ...task,
      columnId: toColumn,
      updatedAt: Date.now(),
    };

    // Optimistic update
    set((prev) => ({
      tasks: { ...prev.tasks, [taskId]: updatedTask },
    }));

    try {
      await get().saveTask(updatedTask);
    } catch {
      // Revert on failure (loadTasks already called in saveTask on conflict)
    }
  },

  reorderTasks: async (
    columnId: KanbanColumnId,
    fromIndex: number,
    toIndex: number,
  ) => {
    if (fromIndex === toIndex) return;

    const allTasks = Object.values(get().tasks);
    const columnTasks = allTasks
      .filter((t) => t.columnId === columnId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    if (
      fromIndex < 0 ||
      fromIndex >= columnTasks.length ||
      toIndex < 0 ||
      toIndex >= columnTasks.length
    ) {
      return;
    }

    const reordered = [...columnTasks];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    // Only update tasks whose sortOrder actually changed
    const updates: Record<string, KanbanTask> = {};
    const now = Date.now();
    for (let i = 0; i < reordered.length; i++) {
      const newOrder = i * 1000;
      if (reordered[i].sortOrder !== newOrder) {
        updates[reordered[i].id] = {
          ...reordered[i],
          sortOrder: newOrder,
          updatedAt: now,
        };
      }
    }

    if (Object.keys(updates).length === 0) return;

    // Optimistic update
    set((prev) => ({
      tasks: { ...prev.tasks, ...updates },
    }));

    // Batch persist all changed tasks in a single kvMutate call
    try {
      const credentials = sync.getCredentials();
      if (!credentials) return;

      const mutations: KvMutation[] = [];
      for (const task of Object.values(updates)) {
        const taskData: KanbanTaskData = {
          title: task.title,
          description: task.description,
          columnId: task.columnId,
          priority: task.priority,
          sortOrder: task.sortOrder,
          sessionIds: task.sessionIds,
          sessionPrompt: task.sessionPrompt,
          machineId: task.machineId,
          directory: task.directory,
          tags: task.tags,
          sourceType: task.sourceType,
          sourceId: task.sourceId,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        };
        const encrypted = await encryptTaskData(taskData);
        mutations.push({
          key: kanbanTaskKey(task.id),
          value: encrypted,
          version: task.kvVersion,
        });
      }

      const result = await kvMutate(credentials, mutations);
      if (!result.success) {
        await get().loadTasks();
        return;
      }

      // Update kvVersions from server response
      const taskIds = Object.keys(updates);
      const versionUpdates: Record<string, KanbanTask> = {};
      for (let i = 0; i < taskIds.length; i++) {
        const id = taskIds[i];
        versionUpdates[id] = {
          ...get().tasks[id],
          kvVersion: result.results[i].version,
        };
      }
      set((prev) => ({
        tasks: { ...prev.tasks, ...versionUpdates },
      }));
    } catch {
      await get().loadTasks();
    }
  },

  linkSession: async (taskId: string, sessionId: string) => {
    const task = get().tasks[taskId];
    if (!task || task.sessionIds.includes(sessionId)) {
      return;
    }

    const updatedTask: KanbanTask = {
      ...task,
      sessionIds: [...task.sessionIds, sessionId],
      updatedAt: Date.now(),
    };

    set((prev) => ({
      tasks: { ...prev.tasks, [taskId]: updatedTask },
    }));

    try {
      await get().saveTask(updatedTask);
    } catch {
      // Revert handled by loadTasks
    }
  },

  unlinkSession: async (taskId: string, sessionId: string) => {
    const task = get().tasks[taskId];
    if (!task) {
      return;
    }

    const updatedTask: KanbanTask = {
      ...task,
      sessionIds: task.sessionIds.filter((id) => id !== sessionId),
      updatedAt: Date.now(),
    };

    set((prev) => ({
      tasks: { ...prev.tasks, [taskId]: updatedTask },
    }));

    try {
      await get().saveTask(updatedTask);
    } catch {
      // Revert handled by loadTasks
    }
  },

  handleKvUpdate: (changes) => {
    const tasks = { ...get().tasks };
    let changed = false;

    for (const change of changes) {
      const taskId = parseKanbanTaskKey(change.key);
      if (!taskId) {
        continue;
      }

      if (change.value === null) {
        // Deleted
        if (tasks[taskId]) {
          delete tasks[taskId];
          changed = true;
        }
      } else {
        // Created or updated — decrypt async
        decryptTaskData(change.value).then((data) => {
          if (!data) {
            return;
          }
          const updatedTask: KanbanTask = {
            ...data,
            id: taskId,
            kvVersion: change.version,
          };
          set((prev) => ({
            tasks: { ...prev.tasks, [taskId]: updatedTask },
          }));
        });
      }
    }

    if (changed) {
      set({ tasks });
    }
  },

  setActiveColumn: (columnId: KanbanColumnId) => {
    set({ activeColumnId: columnId });
  },

  reset: () => {
    set(initialState);
  },
}));

//
// Selector hooks
//

export function useKanbanTasks(): ReadonlyArray<KanbanTask> {
  return kanbanStore(useShallow((s) => Object.values(s.tasks)));
}

export function useKanbanTask(taskId: string): KanbanTask | null {
  return kanbanStore((s) => s.tasks[taskId] ?? null);
}

export function useKanbanLoading(): boolean {
  return kanbanStore((s) => s.isLoading);
}

export function useKanbanLoaded(): boolean {
  return kanbanStore((s) => s.isLoaded);
}

export function useKanbanActiveColumn(): KanbanColumnId {
  return kanbanStore((s) => s.activeColumnId);
}
