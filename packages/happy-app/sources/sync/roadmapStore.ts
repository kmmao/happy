/**
 * Roadmap Store — Zustand store for per-project milestone + feature management
 *
 * Uses UserKVStore with E2E encryption.
 * Two KV prefixes per project: milestone and feature.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { AsyncLock } from "@/utils/lock";
import { sync } from "./sync";
import { kvList, kvMutate, type KvItem } from "./apiKv";
import {
    type RoadmapMilestone,
    type RoadmapMilestoneEntry,
    type RoadmapFeature,
    type RoadmapFeatureEntry,
    type MilestoneStatus,
    type FeatureStatus,
    type MoscowPriority,
    type FeatureComplexity,
    milestoneKvKey,
    featureKvKey,
    roadmapKvPrefix,
    parseRoadmapKvKey,
} from "./roadmapTypes";

//
// Encryption helpers
//

async function encryptData(data: RoadmapMilestone | RoadmapFeature): Promise<string> {
    return await sync.encryption.encryptRaw(data);
}

async function decryptData<T>(encrypted: string): Promise<T | null> {
    return await sync.encryption.decryptRaw(encrypted);
}

interface DecryptedMilestone {
    projectId: string;
    entry: RoadmapMilestoneEntry;
}

interface DecryptedFeature {
    projectId: string;
    entry: RoadmapFeatureEntry;
}

async function decryptKvItem(item: KvItem): Promise<
    | { type: "milestone"; data: DecryptedMilestone }
    | { type: "feature"; data: DecryptedFeature }
    | null
> {
    const parsed = parseRoadmapKvKey(item.key);
    if (!parsed) return null;

    if (parsed.type === "milestone") {
        const milestone = await decryptData<RoadmapMilestone>(item.value);
        if (!milestone) return null;
        return {
            type: "milestone",
            data: {
                projectId: parsed.projectId,
                entry: { milestone, kvVersion: item.version },
            },
        };
    }

    const feature = await decryptData<RoadmapFeature>(item.value);
    if (!feature) return null;
    return {
        type: "feature",
        data: {
            projectId: parsed.projectId,
            entry: { feature, kvVersion: item.version },
        },
    };
}

//
// State
//

interface RoadmapState {
    readonly milestonesByProject: Readonly<Record<string, Readonly<Record<string, RoadmapMilestoneEntry>>>>;
    readonly featuresByProject: Readonly<Record<string, Readonly<Record<string, RoadmapFeatureEntry>>>>;
    readonly loadedProjects: Readonly<Record<string, boolean>>;
    readonly loadingProjects: Readonly<Record<string, boolean>>;
}

interface RoadmapActions {
    loadRoadmap: (projectId: string) => Promise<void>;
    saveMilestone: (projectId: string, milestone: RoadmapMilestone) => Promise<void>;
    createMilestone: (projectId: string, data: {
        title: string;
        description: string;
        targetDate: number | null;
    }) => Promise<RoadmapMilestone>;
    updateMilestone: (projectId: string, milestoneId: string, updates: Partial<Pick<RoadmapMilestone, "title" | "description" | "status" | "targetDate">>) => Promise<void>;
    deleteMilestone: (projectId: string, milestoneId: string) => Promise<void>;
    saveFeature: (projectId: string, feature: RoadmapFeature) => Promise<void>;
    createFeature: (projectId: string, data: {
        milestoneId: string;
        title: string;
        description: string;
        moscow: MoscowPriority;
        complexity: FeatureComplexity;
    }) => Promise<RoadmapFeature>;
    updateFeature: (projectId: string, featureId: string, updates: Partial<Pick<RoadmapFeature, "title" | "description" | "status" | "moscow" | "complexity">>) => Promise<void>;
    deleteFeature: (projectId: string, featureId: string) => Promise<void>;
    reset: () => void;
}

type RoadmapStore = RoadmapState & RoadmapActions;

const initialState: RoadmapState = {
    milestonesByProject: {},
    featuresByProject: {},
    loadedProjects: {},
    loadingProjects: {},
};

let loadLocks: Record<string, AsyncLock> = {};

function getLoadLock(projectId: string): AsyncLock {
    if (!loadLocks[projectId]) {
        loadLocks[projectId] = new AsyncLock();
    }
    return loadLocks[projectId];
}

//
// Store
//

export const roadmapStore = create<RoadmapStore>()((set, get) => ({
    ...initialState,

    loadRoadmap: async (projectId: string) => {
        const lock = getLoadLock(projectId);
        await lock.inLock(async () => {
            if (get().loadedProjects[projectId]) return;

            set((prev) => ({
                loadingProjects: { ...prev.loadingProjects, [projectId]: true },
            }));

            try {
                const credentials = sync.getCredentials();
                if (!credentials) {
                    set((prev) => ({
                        loadingProjects: { ...prev.loadingProjects, [projectId]: false },
                        loadedProjects: { ...prev.loadedProjects, [projectId]: true },
                    }));
                    return;
                }

                const KV_LOAD_LIMIT = 1000;
                const response = await kvList(credentials, {
                    prefix: roadmapKvPrefix(projectId),
                    limit: KV_LOAD_LIMIT,
                });

                if (response.items.length >= KV_LOAD_LIMIT) {
                    console.warn(`[roadmapStore] Project ${projectId} has ${response.items.length} items (milestones+features), possible data truncation at limit=${KV_LOAD_LIMIT}`);
                }

                const decrypted = await Promise.all(response.items.map(decryptKvItem));

                const milestones: Record<string, RoadmapMilestoneEntry> = {};
                const features: Record<string, RoadmapFeatureEntry> = {};

                for (const item of decrypted) {
                    if (!item) continue;
                    if (item.type === "milestone" && item.data.projectId === projectId) {
                        milestones[item.data.entry.milestone.id] = item.data.entry;
                    } else if (item.type === "feature" && item.data.projectId === projectId) {
                        features[item.data.entry.feature.id] = item.data.entry;
                    }
                }

                set((prev) => ({
                    milestonesByProject: { ...prev.milestonesByProject, [projectId]: milestones },
                    featuresByProject: { ...prev.featuresByProject, [projectId]: features },
                    loadingProjects: { ...prev.loadingProjects, [projectId]: false },
                    loadedProjects: { ...prev.loadedProjects, [projectId]: true },
                }));
            } catch (error) {
                set((prev) => ({
                    loadingProjects: { ...prev.loadingProjects, [projectId]: false },
                }));
                throw error;
            }
        });
    },

    saveMilestone: async (projectId, milestone) => {
        const credentials = sync.getCredentials();
        if (!credentials) throw new Error("Not authenticated");

        const existing = get().milestonesByProject[projectId]?.[milestone.id];
        const version = existing ? existing.kvVersion : -1;

        const encrypted = await encryptData(milestone);
        const key = milestoneKvKey(projectId, milestone.id);

        const result = await kvMutate(credentials, [{ key, value: encrypted, version }]);

        if (!result.success) {
            set((prev) => ({ loadedProjects: { ...prev.loadedProjects, [projectId]: false } }));
            await get().loadRoadmap(projectId);
            throw new Error("Milestone was updated on another device");
        }

        set((prev) => ({
            milestonesByProject: {
                ...prev.milestonesByProject,
                [projectId]: {
                    ...prev.milestonesByProject[projectId],
                    [milestone.id]: { milestone, kvVersion: result.results[0].version },
                },
            },
        }));
    },

    createMilestone: async (projectId, data) => {
        const now = Date.now();
        const existing = get().milestonesByProject[projectId] ?? {};
        const maxSort = Object.values(existing).reduce(
            (max, e) => Math.max(max, e.milestone.sortOrder),
            0,
        );

        const milestone: RoadmapMilestone = {
            id: crypto.randomUUID(),
            title: data.title,
            description: data.description,
            status: "planning",
            targetDate: data.targetDate,
            sortOrder: maxSort + 1,
            createdAt: now,
            updatedAt: now,
        };

        await get().saveMilestone(projectId, milestone);
        return milestone;
    },

    updateMilestone: async (projectId, milestoneId, updates) => {
        const entry = get().milestonesByProject[projectId]?.[milestoneId];
        if (!entry) throw new Error("Milestone not found");

        const updated: RoadmapMilestone = {
            ...entry.milestone,
            ...updates,
            updatedAt: Date.now(),
        };

        await get().saveMilestone(projectId, updated);
    },

    deleteMilestone: async (projectId, milestoneId) => {
        const credentials = sync.getCredentials();
        if (!credentials) throw new Error("Not authenticated");

        const milestoneEntry = get().milestonesByProject[projectId]?.[milestoneId];
        if (!milestoneEntry) return;

        // Also delete all features under this milestone
        const projectFeatures = get().featuresByProject[projectId] ?? {};
        const featuresToDelete = Object.values(projectFeatures)
            .filter((e) => e.feature.milestoneId === milestoneId);

        const mutations = [
            { key: milestoneKvKey(projectId, milestoneId), value: null as string | null, version: milestoneEntry.kvVersion },
            ...featuresToDelete.map((e) => ({
                key: featureKvKey(projectId, e.feature.id),
                value: null as string | null,
                version: e.kvVersion,
            })),
        ];

        const result = await kvMutate(credentials, mutations);

        if (!result.success) {
            set((prev) => ({ loadedProjects: { ...prev.loadedProjects, [projectId]: false } }));
            await get().loadRoadmap(projectId);
            throw new Error("Data was updated on another device");
        }

        set((prev) => {
            const { [milestoneId]: _, ...remainingMilestones } = prev.milestonesByProject[projectId] ?? {};

            const featureIdsToRemove = new Set(featuresToDelete.map((e) => e.feature.id));
            const remainingFeatures = Object.fromEntries(
                Object.entries(prev.featuresByProject[projectId] ?? {})
                    .filter(([id]) => !featureIdsToRemove.has(id)),
            );

            return {
                milestonesByProject: { ...prev.milestonesByProject, [projectId]: remainingMilestones },
                featuresByProject: { ...prev.featuresByProject, [projectId]: remainingFeatures },
            };
        });
    },

    saveFeature: async (projectId, feature) => {
        const credentials = sync.getCredentials();
        if (!credentials) throw new Error("Not authenticated");

        const existing = get().featuresByProject[projectId]?.[feature.id];
        const version = existing ? existing.kvVersion : -1;

        const encrypted = await encryptData(feature);
        const key = featureKvKey(projectId, feature.id);

        const result = await kvMutate(credentials, [{ key, value: encrypted, version }]);

        if (!result.success) {
            set((prev) => ({ loadedProjects: { ...prev.loadedProjects, [projectId]: false } }));
            await get().loadRoadmap(projectId);
            throw new Error("Feature was updated on another device");
        }

        set((prev) => ({
            featuresByProject: {
                ...prev.featuresByProject,
                [projectId]: {
                    ...prev.featuresByProject[projectId],
                    [feature.id]: { feature, kvVersion: result.results[0].version },
                },
            },
        }));
    },

    createFeature: async (projectId, data) => {
        const now = Date.now();
        const existing = get().featuresByProject[projectId] ?? {};
        const milestoneFeatures = Object.values(existing).filter(
            (e) => e.feature.milestoneId === data.milestoneId,
        );
        const maxSort = milestoneFeatures.reduce(
            (max, e) => Math.max(max, e.feature.sortOrder),
            0,
        );

        const feature: RoadmapFeature = {
            id: crypto.randomUUID(),
            milestoneId: data.milestoneId,
            title: data.title,
            description: data.description,
            status: "planned",
            moscow: data.moscow,
            complexity: data.complexity,
            sortOrder: maxSort + 1,
            convertedTaskId: null,
            createdAt: now,
            updatedAt: now,
        };

        await get().saveFeature(projectId, feature);
        return feature;
    },

    updateFeature: async (projectId, featureId, updates) => {
        const entry = get().featuresByProject[projectId]?.[featureId];
        if (!entry) throw new Error("Feature not found");

        const updated: RoadmapFeature = {
            ...entry.feature,
            ...updates,
            updatedAt: Date.now(),
        };

        await get().saveFeature(projectId, updated);
    },

    deleteFeature: async (projectId, featureId) => {
        const credentials = sync.getCredentials();
        if (!credentials) throw new Error("Not authenticated");

        const entry = get().featuresByProject[projectId]?.[featureId];
        if (!entry) return;

        const key = featureKvKey(projectId, featureId);
        const result = await kvMutate(credentials, [
            { key, value: null, version: entry.kvVersion },
        ]);

        if (!result.success) {
            set((prev) => ({ loadedProjects: { ...prev.loadedProjects, [projectId]: false } }));
            await get().loadRoadmap(projectId);
            throw new Error("Feature was updated on another device");
        }

        set((prev) => {
            const { [featureId]: _, ...remainingFeatures } = prev.featuresByProject[projectId] ?? {};
            return {
                featuresByProject: { ...prev.featuresByProject, [projectId]: remainingFeatures },
            };
        });
    },

    reset: () => {
        loadLocks = {};
        set(initialState);
    },
}));

//
// Selector hooks
//

export function useMilestones(projectId: string): readonly RoadmapMilestone[] {
    return roadmapStore(
        useShallow((s) => {
            const entries = s.milestonesByProject[projectId] ?? {};
            return Object.values(entries)
                .map((e) => e.milestone)
                .sort((a, b) => a.sortOrder - b.sortOrder);
        }),
    );
}

export function useMilestone(projectId: string, milestoneId: string): RoadmapMilestone | null {
    return roadmapStore(
        (s) => s.milestonesByProject[projectId]?.[milestoneId]?.milestone ?? null,
    );
}

export function useFeaturesForMilestone(
    projectId: string,
    milestoneId: string,
): readonly RoadmapFeature[] {
    return roadmapStore(
        useShallow((s) => {
            const entries = s.featuresByProject[projectId] ?? {};
            return Object.values(entries)
                .map((e) => e.feature)
                .filter((f) => f.milestoneId === milestoneId)
                .sort((a, b) => a.sortOrder - b.sortOrder);
        }),
    );
}

export function useFeature(projectId: string, featureId: string): RoadmapFeature | null {
    return roadmapStore(
        (s) => s.featuresByProject[projectId]?.[featureId]?.feature ?? null,
    );
}

export function useRoadmapLoading(projectId: string): boolean {
    return roadmapStore((s) => s.loadingProjects[projectId] ?? false);
}

export function useRoadmapLoaded(projectId: string): boolean {
    return roadmapStore((s) => s.loadedProjects[projectId] ?? false);
}

export function useMilestoneProgress(
    projectId: string,
    milestoneId: string,
): { completed: number; total: number } {
    return roadmapStore(
        useShallow((s) => {
            const entries = s.featuresByProject[projectId] ?? {};
            const features = Object.values(entries)
                .map((e) => e.feature)
                .filter((f) => f.milestoneId === milestoneId);
            return {
                completed: features.filter((f) => f.status === "completed").length,
                total: features.length,
            };
        }),
    );
}
