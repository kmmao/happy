/**
 * Roadmap Zustand Store
 *
 * Manages milestones and features (two-level hierarchy).
 * Entities are persisted in UserKVStore with E2E encryption.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { sync } from "./sync";
import { kvList, kvMutate, type KvItem } from "./apiKv";
import {
  type RoadmapMilestone,
  type RoadmapMilestoneData,
  type RoadmapFeature,
  type RoadmapFeatureData,
  roadmapMilestoneKey,
  parseRoadmapMilestoneKey,
  roadmapFeatureKey,
  parseRoadmapFeatureKey,
  createDefaultMilestoneData,
  createDefaultFeatureData,
} from "./roadmapTypes";
import { kanbanStore } from "./kanbanStore";
import { randomUUID } from "expo-crypto";

//
// State
//

interface RoadmapState {
  readonly milestones: Readonly<Record<string, RoadmapMilestone>>;
  readonly features: Readonly<Record<string, RoadmapFeature>>;
  readonly isLoading: boolean;
  readonly isLoaded: boolean;
  readonly expandedMilestoneId: string | null;
}

interface RoadmapActions {
  loadRoadmap: () => Promise<void>;
  // Milestones
  createMilestone: (
    data: Partial<RoadmapMilestoneData> & Pick<RoadmapMilestoneData, "title">,
  ) => Promise<RoadmapMilestone>;
  saveMilestone: (milestone: RoadmapMilestone) => Promise<RoadmapMilestone>;
  deleteMilestone: (milestoneId: string) => Promise<void>;
  // Features
  createFeature: (
    data: Partial<RoadmapFeatureData> &
      Pick<RoadmapFeatureData, "title" | "milestoneId">,
  ) => Promise<RoadmapFeature>;
  saveFeature: (feature: RoadmapFeature) => Promise<RoadmapFeature>;
  deleteFeature: (featureId: string) => Promise<void>;
  convertFeatureToTask: (featureId: string) => Promise<string>;
  // Realtime
  handleKvUpdate: (
    changes: ReadonlyArray<{
      readonly key: string;
      readonly value: string | null;
      readonly version: number;
    }>,
  ) => void;
  // UI
  setExpandedMilestone: (milestoneId: string | null) => void;
  reset: () => void;
}

type RoadmapStore = RoadmapState & RoadmapActions;

//
// Encryption helpers
//

async function encryptData<T>(data: T): Promise<string> {
  const encryption = sync.encryption;
  return await encryption.encryptRaw(data);
}

async function decryptData<T>(encrypted: string): Promise<T | null> {
  const encryption = sync.encryption;
  return await encryption.decryptRaw(encrypted);
}

async function decryptMilestoneKvItem(
  item: KvItem,
): Promise<RoadmapMilestone | null> {
  const id = parseRoadmapMilestoneKey(item.key);
  if (!id) {
    return null;
  }
  const data = await decryptData<RoadmapMilestoneData>(item.value);
  if (!data) {
    return null;
  }
  return { ...data, id, kvVersion: item.version };
}

async function decryptFeatureKvItem(
  item: KvItem,
): Promise<RoadmapFeature | null> {
  const id = parseRoadmapFeatureKey(item.key);
  if (!id) {
    return null;
  }
  const data = await decryptData<RoadmapFeatureData>(item.value);
  if (!data) {
    return null;
  }
  return { ...data, id, kvVersion: item.version };
}

//
// Store
//

const initialState: RoadmapState = {
  milestones: {},
  features: {},
  isLoading: false,
  isLoaded: false,
  expandedMilestoneId: null,
};

export const roadmapStore = create<RoadmapStore>()((set, get) => ({
  ...initialState,

  loadRoadmap: async () => {
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

      // Load milestones and features in parallel
      const [milestoneResponse, featureResponse] = await Promise.all([
        kvList(credentials, {
          prefix: "roadmap/milestone/",
          limit: 500,
        }),
        kvList(credentials, {
          prefix: "roadmap/feature/",
          limit: 500,
        }),
      ]);

      const [decryptedMilestones, decryptedFeatures] = await Promise.all([
        Promise.all(milestoneResponse.items.map(decryptMilestoneKvItem)),
        Promise.all(featureResponse.items.map(decryptFeatureKvItem)),
      ]);

      const milestones: Record<string, RoadmapMilestone> = {};
      for (const ms of decryptedMilestones) {
        if (ms) {
          milestones[ms.id] = ms;
        }
      }

      const features: Record<string, RoadmapFeature> = {};
      for (const f of decryptedFeatures) {
        if (f) {
          features[f.id] = f;
        }
      }

      set({
        milestones,
        features,
        isLoading: false,
        isLoaded: true,
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  //
  // Milestones
  //

  createMilestone: async (data) => {
    const credentials = sync.getCredentials();
    if (!credentials) {
      throw new Error("Not authenticated");
    }

    const id = randomUUID();
    const milestoneData = createDefaultMilestoneData(data);
    const encrypted = await encryptData(milestoneData);
    const key = roadmapMilestoneKey(id);

    const result = await kvMutate(credentials, [
      { key, value: encrypted, version: -1 },
    ]);

    if (!result.success) {
      throw new Error("Failed to create milestone");
    }

    const newMilestone: RoadmapMilestone = {
      ...milestoneData,
      id,
      kvVersion: result.results[0].version,
    };

    set((prev) => ({
      milestones: { ...prev.milestones, [id]: newMilestone },
    }));

    return newMilestone;
  },

  saveMilestone: async (milestone) => {
    const credentials = sync.getCredentials();
    if (!credentials) {
      throw new Error("Not authenticated");
    }

    const updatedData: RoadmapMilestoneData = {
      title: milestone.title,
      description: milestone.description,
      sortOrder: milestone.sortOrder,
      targetDate: milestone.targetDate,
      createdAt: milestone.createdAt,
      updatedAt: Date.now(),
    };

    const encrypted = await encryptData(updatedData);
    const key = roadmapMilestoneKey(milestone.id);

    const result = await kvMutate(credentials, [
      { key, value: encrypted, version: milestone.kvVersion },
    ]);

    if (!result.success) {
      await get().loadRoadmap();
      throw new Error("Milestone was updated on another device");
    }

    const updated: RoadmapMilestone = {
      ...updatedData,
      id: milestone.id,
      kvVersion: result.results[0].version,
    };

    set((prev) => ({
      milestones: { ...prev.milestones, [milestone.id]: updated },
    }));

    return updated;
  },

  deleteMilestone: async (milestoneId) => {
    const milestone = get().milestones[milestoneId];
    if (!milestone) {
      return;
    }

    const credentials = sync.getCredentials();
    if (!credentials) {
      throw new Error("Not authenticated");
    }

    // Cascade: delete all features under this milestone
    const childFeatures = Object.values(get().features).filter(
      (f) => f.milestoneId === milestoneId,
    );

    const mutations = [
      {
        key: roadmapMilestoneKey(milestoneId),
        value: null as string | null,
        version: milestone.kvVersion,
      },
      ...childFeatures.map((f) => ({
        key: roadmapFeatureKey(f.id),
        value: null as string | null,
        version: f.kvVersion,
      })),
    ];

    const result = await kvMutate(credentials, mutations);

    if (!result.success) {
      await get().loadRoadmap();
      throw new Error("Milestone was updated on another device");
    }

    set((prev) => {
      const { [milestoneId]: _, ...restMilestones } = prev.milestones;
      const featureIds = new Set(childFeatures.map((f) => f.id));
      const restFeatures: Record<string, RoadmapFeature> = {};
      for (const [fId, f] of Object.entries(prev.features)) {
        if (!featureIds.has(fId)) {
          restFeatures[fId] = f;
        }
      }
      return {
        milestones: restMilestones,
        features: restFeatures,
      };
    });
  },

  //
  // Features
  //

  createFeature: async (data) => {
    const credentials = sync.getCredentials();
    if (!credentials) {
      throw new Error("Not authenticated");
    }

    const id = randomUUID();
    const featureData = createDefaultFeatureData(data);
    const encrypted = await encryptData(featureData);
    const key = roadmapFeatureKey(id);

    const result = await kvMutate(credentials, [
      { key, value: encrypted, version: -1 },
    ]);

    if (!result.success) {
      throw new Error("Failed to create feature");
    }

    const newFeature: RoadmapFeature = {
      ...featureData,
      id,
      kvVersion: result.results[0].version,
    };

    set((prev) => ({
      features: { ...prev.features, [id]: newFeature },
    }));

    return newFeature;
  },

  saveFeature: async (feature) => {
    const credentials = sync.getCredentials();
    if (!credentials) {
      throw new Error("Not authenticated");
    }

    const updatedData: RoadmapFeatureData = {
      title: feature.title,
      description: feature.description,
      milestoneId: feature.milestoneId,
      status: feature.status,
      moscow: feature.moscow,
      complexity: feature.complexity,
      sortOrder: feature.sortOrder,
      convertedTaskId: feature.convertedTaskId,
      sourceIdeaId: feature.sourceIdeaId,
      createdAt: feature.createdAt,
      updatedAt: Date.now(),
    };

    const encrypted = await encryptData(updatedData);
    const key = roadmapFeatureKey(feature.id);

    const result = await kvMutate(credentials, [
      { key, value: encrypted, version: feature.kvVersion },
    ]);

    if (!result.success) {
      await get().loadRoadmap();
      throw new Error("Feature was updated on another device");
    }

    const updated: RoadmapFeature = {
      ...updatedData,
      id: feature.id,
      kvVersion: result.results[0].version,
    };

    set((prev) => ({
      features: { ...prev.features, [feature.id]: updated },
    }));

    return updated;
  },

  deleteFeature: async (featureId) => {
    const feature = get().features[featureId];
    if (!feature) {
      return;
    }

    const credentials = sync.getCredentials();
    if (!credentials) {
      throw new Error("Not authenticated");
    }

    const key = roadmapFeatureKey(featureId);
    const result = await kvMutate(credentials, [
      { key, value: null, version: feature.kvVersion },
    ]);

    if (!result.success) {
      await get().loadRoadmap();
      throw new Error("Feature was updated on another device");
    }

    set((prev) => {
      const { [featureId]: _, ...rest } = prev.features;
      return { features: rest };
    });
  },

  convertFeatureToTask: async (featureId) => {
    const feature = get().features[featureId];
    if (!feature) {
      throw new Error("Feature not found");
    }

    // Idempotent: if already converted, return existing taskId
    if (feature.convertedTaskId) {
      return feature.convertedTaskId;
    }

    // Step 1: Create kanban task
    const task = await kanbanStore.getState().createTask({
      title: feature.title,
      description: feature.description,
      sourceType: "roadmap",
      sourceId: featureId,
    });

    // Step 2: Persist feature with convertedTaskId, then update local state
    const updatedFeature: RoadmapFeature = {
      ...feature,
      convertedTaskId: task.id,
      updatedAt: Date.now(),
    };

    try {
      const saved = await get().saveFeature(updatedFeature);
      set((prev) => ({
        features: { ...prev.features, [featureId]: saved },
      }));
    } catch {
      // Task already created; feature stays in old state on server
      // Still update local state so UI reflects the conversion
      set((prev) => ({
        features: { ...prev.features, [featureId]: updatedFeature },
      }));
    }

    return task.id;
  },

  handleKvUpdate: (changes) => {
    let newMilestones = get().milestones;
    let newFeatures = get().features;
    let changed = false;

    for (const change of changes) {
      // Try milestone
      const msId = parseRoadmapMilestoneKey(change.key);
      if (msId) {
        if (change.value === null) {
          if (newMilestones[msId]) {
            const { [msId]: _, ...rest } = newMilestones;
            newMilestones = rest;
            changed = true;
          }
        } else {
          decryptData<RoadmapMilestoneData>(change.value).then((data) => {
            if (!data) return;
            const updated: RoadmapMilestone = {
              ...data,
              id: msId,
              kvVersion: change.version,
            };
            set((prev) => ({
              milestones: {
                ...prev.milestones,
                [msId]: updated,
              },
            }));
          });
        }
        continue;
      }

      // Try feature
      const fId = parseRoadmapFeatureKey(change.key);
      if (fId) {
        if (change.value === null) {
          if (newFeatures[fId]) {
            const { [fId]: _, ...rest } = newFeatures;
            newFeatures = rest;
            changed = true;
          }
        } else {
          decryptData<RoadmapFeatureData>(change.value).then((data) => {
            if (!data) return;
            const updated: RoadmapFeature = {
              ...data,
              id: fId,
              kvVersion: change.version,
            };
            set((prev) => ({
              features: {
                ...prev.features,
                [fId]: updated,
              },
            }));
          });
        }
      }
    }

    if (changed) {
      set({ milestones: newMilestones, features: newFeatures });
    }
  },

  setExpandedMilestone: (milestoneId) => {
    set({ expandedMilestoneId: milestoneId });
  },

  reset: () => {
    set(initialState);
  },
}));

//
// Selector hooks
//

export function useRoadmapMilestones(): ReadonlyArray<RoadmapMilestone> {
  return roadmapStore(
    useShallow((s) =>
      Object.values(s.milestones).sort((a, b) => a.sortOrder - b.sortOrder),
    ),
  );
}

export function useRoadmapMilestone(
  milestoneId: string,
): RoadmapMilestone | null {
  return roadmapStore((s) => s.milestones[milestoneId] ?? null);
}

export function useRoadmapFeatures(): ReadonlyArray<RoadmapFeature> {
  return roadmapStore(useShallow((s) => Object.values(s.features)));
}

export function useRoadmapFeature(featureId: string): RoadmapFeature | null {
  return roadmapStore((s) => s.features[featureId] ?? null);
}

export function useRoadmapLoading(): boolean {
  return roadmapStore((s) => s.isLoading);
}

export function useRoadmapLoaded(): boolean {
  return roadmapStore((s) => s.isLoaded);
}

export function useRoadmapExpandedMilestone(): string | null {
  return roadmapStore((s) => s.expandedMilestoneId);
}
