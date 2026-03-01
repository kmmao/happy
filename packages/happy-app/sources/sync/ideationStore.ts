/**
 * Ideation Zustand Store
 *
 * Independent store for idea management.
 * Ideas are persisted in UserKVStore with E2E encryption.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { sync } from "./sync";
import { kvList, kvMutate, type KvItem } from "./apiKv";
import {
  type IdeationIdea,
  type IdeationIdeaData,
  type IdeationStatus,
  ideationIdeaKey,
  parseIdeationIdeaKey,
  createDefaultIdeaData,
} from "./ideationTypes";
import { kanbanStore } from "./kanbanStore";
import { randomUUID } from "expo-crypto";

//
// State
//

interface IdeationState {
  readonly ideas: Readonly<Record<string, IdeationIdea>>;
  readonly isLoading: boolean;
  readonly isLoaded: boolean;
  readonly activeFilter: IdeationStatus | "all";
}

interface IdeationActions {
  loadIdeas: () => Promise<void>;
  saveIdea: (idea: IdeationIdea) => Promise<IdeationIdea>;
  createIdea: (
    data: Partial<IdeationIdeaData> & Pick<IdeationIdeaData, "title">,
  ) => Promise<IdeationIdea>;
  deleteIdea: (ideaId: string) => Promise<void>;
  dismissIdea: (ideaId: string) => Promise<void>;
  convertToTask: (ideaId: string) => Promise<string>;
  handleKvUpdate: (
    changes: ReadonlyArray<{
      readonly key: string;
      readonly value: string | null;
      readonly version: number;
    }>,
  ) => void;
  setActiveFilter: (filter: IdeationStatus | "all") => void;
  reset: () => void;
}

type IdeationStore = IdeationState & IdeationActions;

//
// Encryption helpers
//

async function encryptIdeaData(data: IdeationIdeaData): Promise<string> {
  const encryption = sync.encryption;
  return await encryption.encryptRaw(data);
}

async function decryptIdeaData(
  encrypted: string,
): Promise<IdeationIdeaData | null> {
  const encryption = sync.encryption;
  return await encryption.decryptRaw(encrypted);
}

async function decryptKvItem(item: KvItem): Promise<IdeationIdea | null> {
  const ideaId = parseIdeationIdeaKey(item.key);
  if (!ideaId) {
    return null;
  }

  const data = await decryptIdeaData(item.value);
  if (!data) {
    return null;
  }

  return {
    ...data,
    id: ideaId,
    kvVersion: item.version,
  };
}

//
// Store
//

const initialState: IdeationState = {
  ideas: {},
  isLoading: false,
  isLoaded: false,
  activeFilter: "all",
};

export const ideationStore = create<IdeationStore>()((set, get) => ({
  ...initialState,

  loadIdeas: async () => {
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
        prefix: "ideation/idea/",
        limit: 500,
      });

      // Decrypt all ideas in parallel
      const decrypted = await Promise.all(response.items.map(decryptKvItem));

      const loaded: Record<string, IdeationIdea> = {};
      for (const idea of decrypted) {
        if (idea) {
          loaded[idea.id] = idea;
        }
      }

      // Merge: keep any idea that has a newer kvVersion from real-time updates
      set((prev) => {
        const merged = { ...loaded };
        for (const [id, existing] of Object.entries(prev.ideas)) {
          if (existing.kvVersion > (merged[id]?.kvVersion ?? -1)) {
            merged[id] = existing;
          }
        }
        return { ideas: merged, isLoading: false, isLoaded: true };
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  saveIdea: async (idea: IdeationIdea) => {
    const credentials = sync.getCredentials();
    if (!credentials) {
      throw new Error("Not authenticated");
    }

    const updatedData: IdeationIdeaData = {
      title: idea.title,
      description: idea.description,
      category: idea.category,
      status: idea.status,
      priority: idea.priority,
      tags: idea.tags,
      convertedTaskId: idea.convertedTaskId,
      createdAt: idea.createdAt,
      updatedAt: Date.now(),
    };

    const encrypted = await encryptIdeaData(updatedData);
    const key = ideationIdeaKey(idea.id);

    const result = await kvMutate(credentials, [
      { key, value: encrypted, version: idea.kvVersion },
    ]);

    if (!result.success) {
      await get().loadIdeas();
      throw new Error("Idea was updated on another device");
    }

    const newVersion = result.results[0].version;
    const updatedIdea: IdeationIdea = {
      ...updatedData,
      id: idea.id,
      kvVersion: newVersion,
    };

    set((prev) => ({
      ideas: { ...prev.ideas, [idea.id]: updatedIdea },
    }));

    return updatedIdea;
  },

  createIdea: async (data) => {
    const credentials = sync.getCredentials();
    if (!credentials) {
      throw new Error("Not authenticated");
    }

    const ideaId = randomUUID();
    const ideaData = createDefaultIdeaData(data);
    const encrypted = await encryptIdeaData(ideaData);
    const key = ideationIdeaKey(ideaId);

    const result = await kvMutate(credentials, [
      { key, value: encrypted, version: -1 },
    ]);

    if (!result.success) {
      throw new Error("Failed to create idea");
    }

    const newIdea: IdeationIdea = {
      ...ideaData,
      id: ideaId,
      kvVersion: result.results[0].version,
    };

    set((prev) => ({
      ideas: { ...prev.ideas, [ideaId]: newIdea },
    }));

    return newIdea;
  },

  deleteIdea: async (ideaId: string) => {
    const idea = get().ideas[ideaId];
    if (!idea) {
      return;
    }

    const credentials = sync.getCredentials();
    if (!credentials) {
      throw new Error("Not authenticated");
    }

    const key = ideationIdeaKey(ideaId);
    const result = await kvMutate(credentials, [
      { key, value: null, version: idea.kvVersion },
    ]);

    if (!result.success) {
      await get().loadIdeas();
      throw new Error("Idea was updated on another device");
    }

    set((prev) => {
      const { [ideaId]: _, ...rest } = prev.ideas;
      return { ideas: rest };
    });
  },

  dismissIdea: async (ideaId: string) => {
    const idea = get().ideas[ideaId];
    if (!idea || idea.status === "dismissed") {
      return;
    }

    const updatedIdea: IdeationIdea = {
      ...idea,
      status: "dismissed",
      updatedAt: Date.now(),
    };

    // Optimistic update
    set((prev) => ({
      ideas: { ...prev.ideas, [ideaId]: updatedIdea },
    }));

    try {
      await get().saveIdea(updatedIdea);
    } catch {
      // Revert handled by loadIdeas
    }
  },

  convertToTask: async (ideaId: string) => {
    const idea = get().ideas[ideaId];
    if (!idea) {
      throw new Error("Idea not found");
    }

    // Idempotent: if already converted, return existing taskId
    if (idea.convertedTaskId) {
      return idea.convertedTaskId;
    }

    // Step 1: Create kanban task
    const task = await kanbanStore.getState().createTask({
      title: idea.title,
      description: idea.description,
      sourceType: "ideation",
      sourceId: ideaId,
      priority: idea.priority === "high" ? "high" : idea.priority,
    });

    // Step 2: Update idea status to converted
    const updatedIdea: IdeationIdea = {
      ...idea,
      status: "converted",
      convertedTaskId: task.id,
      updatedAt: Date.now(),
    };

    set((prev) => ({
      ideas: { ...prev.ideas, [ideaId]: updatedIdea },
    }));

    try {
      await get().saveIdea(updatedIdea);
    } catch {
      // Task was created but idea save failed (version conflict).
      // saveIdea reloads ideas on conflict, so retry with fresh version.
      const freshIdea = get().ideas[ideaId];
      if (freshIdea && !freshIdea.convertedTaskId) {
        try {
          await get().saveIdea({
            ...freshIdea,
            status: "converted",
            convertedTaskId: task.id,
            updatedAt: Date.now(),
          });
        } catch {
          // Keep local state updated even if retry fails
        }
      }
      // Ensure local state reflects the conversion
      set((prev) => ({
        ideas: {
          ...prev.ideas,
          [ideaId]: {
            ...(prev.ideas[ideaId] ?? updatedIdea),
            status: "converted" as const,
            convertedTaskId: task.id,
          },
        },
      }));
    }

    return task.id;
  },

  handleKvUpdate: (changes) => {
    let newIdeas = get().ideas;
    let changed = false;

    for (const change of changes) {
      const ideaId = parseIdeationIdeaKey(change.key);
      if (!ideaId) {
        continue;
      }

      if (change.value === null) {
        if (newIdeas[ideaId]) {
          const { [ideaId]: _, ...rest } = newIdeas;
          newIdeas = rest;
          changed = true;
        }
      } else {
        decryptIdeaData(change.value).then((data) => {
          if (!data) {
            return;
          }
          const updatedIdea: IdeationIdea = {
            ...data,
            id: ideaId,
            kvVersion: change.version,
          };
          set((prev) => ({
            ideas: { ...prev.ideas, [ideaId]: updatedIdea },
          }));
        });
      }
    }

    if (changed) {
      set({ ideas: newIdeas });
    }
  },

  setActiveFilter: (filter: IdeationStatus | "all") => {
    set({ activeFilter: filter });
  },

  reset: () => {
    set(initialState);
  },
}));

//
// Selector hooks
//

export function useIdeationIdeas(): ReadonlyArray<IdeationIdea> {
  return ideationStore(useShallow((s) => Object.values(s.ideas)));
}

export function useIdeationIdea(ideaId: string): IdeationIdea | null {
  return ideationStore((s) => s.ideas[ideaId] ?? null);
}

export function useIdeationLoading(): boolean {
  return ideationStore((s) => s.isLoading);
}

export function useIdeationLoaded(): boolean {
  return ideationStore((s) => s.isLoaded);
}

export function useIdeationActiveFilter(): IdeationStatus | "all" {
  return ideationStore((s) => s.activeFilter);
}
