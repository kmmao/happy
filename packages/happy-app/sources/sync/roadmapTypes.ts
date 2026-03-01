/**
 * Roadmap type definitions and constants
 *
 * Two-level hierarchy: Milestone → Feature
 * Each entity is stored in UserKVStore with E2E encryption.
 * - Milestones: roadmap/milestone/{milestoneId}
 * - Features:  roadmap/feature/{featureId}
 */

//
// MoSCoW priority
//

export const ROADMAP_MOSCOW = [
    "must_have",
    "should_have",
    "could_have",
    "wont_have",
] as const;

export type RoadmapMoscow = (typeof ROADMAP_MOSCOW)[number];

export const ROADMAP_MOSCOW_LABELS = {
    must_have: "roadmap.moscow.mustHave",
    should_have: "roadmap.moscow.shouldHave",
    could_have: "roadmap.moscow.couldHave",
    wont_have: "roadmap.moscow.wontHave",
} as const;

//
// Feature status
//

export const ROADMAP_FEATURE_STATUSES = [
    "planned",
    "in_progress",
    "completed",
    "cancelled",
] as const;

export type RoadmapFeatureStatus =
    (typeof ROADMAP_FEATURE_STATUSES)[number];

export const ROADMAP_FEATURE_STATUS_LABELS = {
    planned: "roadmap.featureStatuses.planned",
    in_progress: "roadmap.featureStatuses.inProgress",
    completed: "roadmap.featureStatuses.completed",
    cancelled: "roadmap.featureStatuses.cancelled",
} as const;

//
// Complexity
//

export const ROADMAP_COMPLEXITIES = [
    "trivial",
    "simple",
    "moderate",
    "complex",
    "very_complex",
] as const;

export type RoadmapComplexity = (typeof ROADMAP_COMPLEXITIES)[number];

export const ROADMAP_COMPLEXITY_LABELS = {
    trivial: "roadmap.complexity.trivial",
    simple: "roadmap.complexity.simple",
    moderate: "roadmap.complexity.moderate",
    complex: "roadmap.complexity.complex",
    very_complex: "roadmap.complexity.veryComplex",
} as const;

//
// Milestone data model
//

export interface RoadmapMilestoneData {
    readonly title: string;
    readonly description: string;
    readonly sortOrder: number;
    readonly targetDate: number | null;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface RoadmapMilestone extends RoadmapMilestoneData {
    readonly id: string;
    readonly kvVersion: number;
}

//
// Feature data model
//

export interface RoadmapFeatureData {
    readonly title: string;
    readonly description: string;
    readonly milestoneId: string;
    readonly status: RoadmapFeatureStatus;
    readonly moscow: RoadmapMoscow;
    readonly complexity: RoadmapComplexity;
    readonly sortOrder: number;
    readonly convertedTaskId: string | null;
    /** Source idea ID if promoted from ideation */
    readonly sourceIdeaId: string | null;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface RoadmapFeature extends RoadmapFeatureData {
    readonly id: string;
    readonly kvVersion: number;
}

//
// KV key helpers
//

const ROADMAP_MILESTONE_PREFIX = "roadmap/milestone/";
const ROADMAP_FEATURE_PREFIX = "roadmap/feature/";

export function roadmapMilestoneKey(milestoneId: string): string {
    return `${ROADMAP_MILESTONE_PREFIX}${milestoneId}`;
}

export function parseRoadmapMilestoneKey(key: string): string | null {
    if (!key.startsWith(ROADMAP_MILESTONE_PREFIX)) {
        return null;
    }
    return key.slice(ROADMAP_MILESTONE_PREFIX.length);
}

export function roadmapFeatureKey(featureId: string): string {
    return `${ROADMAP_FEATURE_PREFIX}${featureId}`;
}

export function parseRoadmapFeatureKey(key: string): string | null {
    if (!key.startsWith(ROADMAP_FEATURE_PREFIX)) {
        return null;
    }
    return key.slice(ROADMAP_FEATURE_PREFIX.length);
}

export function isRoadmapKey(key: string): boolean {
    return key.startsWith("roadmap/");
}

//
// Factory helpers
//

export function createDefaultMilestoneData(
    overrides: Partial<RoadmapMilestoneData> &
        Pick<RoadmapMilestoneData, "title">,
): RoadmapMilestoneData {
    const now = Date.now();
    return {
        title: overrides.title,
        description: overrides.description ?? "",
        sortOrder: overrides.sortOrder ?? now,
        targetDate: overrides.targetDate ?? null,
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
    };
}

export function createDefaultFeatureData(
    overrides: Partial<RoadmapFeatureData> &
        Pick<RoadmapFeatureData, "title" | "milestoneId">,
): RoadmapFeatureData {
    const now = Date.now();
    return {
        title: overrides.title,
        description: overrides.description ?? "",
        milestoneId: overrides.milestoneId,
        status: overrides.status ?? "planned",
        moscow: overrides.moscow ?? "should_have",
        complexity: overrides.complexity ?? "moderate",
        sortOrder: overrides.sortOrder ?? now,
        convertedTaskId: overrides.convertedTaskId ?? null,
        sourceIdeaId: overrides.sourceIdeaId ?? null,
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
    };
}

//
// Utility
//

export function featuresForMilestone(
    features: ReadonlyArray<RoadmapFeature>,
    milestoneId: string,
): ReadonlyArray<RoadmapFeature> {
    return features
        .filter((f) => f.milestoneId === milestoneId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function milestoneProgress(
    features: ReadonlyArray<RoadmapFeature>,
    milestoneId: string,
): { total: number; completed: number; percentage: number } {
    const msFeatures = features.filter(
        (f) => f.milestoneId === milestoneId,
    );
    const total = msFeatures.length;
    const completed = msFeatures.filter(
        (f) => f.status === "completed",
    ).length;
    return {
        total,
        completed,
        percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
}

export function featureCountByStatus(
    features: ReadonlyArray<RoadmapFeature>,
): Record<RoadmapFeatureStatus, number> {
    const counts: Record<RoadmapFeatureStatus, number> = {
        planned: 0,
        in_progress: 0,
        completed: 0,
        cancelled: 0,
    };
    for (const feature of features) {
        counts[feature.status]++;
    }
    return counts;
}
