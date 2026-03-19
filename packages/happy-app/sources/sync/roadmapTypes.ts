/**
 * Roadmap Types — Data structures for per-project milestone + feature planning
 *
 * Two-level structure: Milestone → Feature
 * Stored in UserKVStore with E2E encryption.
 * KV key format:
 *   roadmap:p:{projectId}:milestone:{milestoneId}
 *   roadmap:p:{projectId}:feature:{featureId}
 */

//
// Status & Priority enums
//

export type MilestoneStatus = "planning" | "active" | "completed" | "on_hold";
export type FeatureStatus = "planned" | "in_progress" | "completed" | "cancelled";
export type MoscowPriority = "must_have" | "should_have" | "could_have" | "wont_have";
export type FeatureComplexity = "trivial" | "simple" | "moderate" | "complex" | "very_complex";

export const MILESTONE_STATUSES: readonly MilestoneStatus[] = [
    "planning",
    "active",
    "completed",
    "on_hold",
] as const;

export const FEATURE_STATUSES: readonly FeatureStatus[] = [
    "planned",
    "in_progress",
    "completed",
    "cancelled",
] as const;

export const MOSCOW_PRIORITIES: readonly MoscowPriority[] = [
    "must_have",
    "should_have",
    "could_have",
    "wont_have",
] as const;

export const FEATURE_COMPLEXITIES: readonly FeatureComplexity[] = [
    "trivial",
    "simple",
    "moderate",
    "complex",
    "very_complex",
] as const;


//
// Data structures
//

export interface RoadmapMilestone {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly status: MilestoneStatus;
    readonly targetDate: number | null;
    readonly sortOrder: number;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface RoadmapFeature {
    readonly id: string;
    readonly milestoneId: string;
    readonly title: string;
    readonly description: string;
    readonly status: FeatureStatus;
    readonly moscow: MoscowPriority;
    readonly complexity: FeatureComplexity;
    readonly sortOrder: number;
    readonly convertedTaskId: string | null;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface RoadmapMilestoneEntry {
    readonly milestone: RoadmapMilestone;
    readonly kvVersion: number;
}

export interface RoadmapFeatureEntry {
    readonly feature: RoadmapFeature;
    readonly kvVersion: number;
}

//
// KV key helpers
//

const KV_PREFIX = "roadmap:p:";

export function milestoneKvKey(projectId: string, milestoneId: string): string {
    return `${KV_PREFIX}${projectId}:milestone:${milestoneId}`;
}

export function featureKvKey(projectId: string, featureId: string): string {
    return `${KV_PREFIX}${projectId}:feature:${featureId}`;
}

export function roadmapKvPrefix(projectId: string): string {
    return `${KV_PREFIX}${projectId}:`;
}

export function parseRoadmapKvKey(
    key: string,
): { projectId: string; type: "milestone" | "feature"; entityId: string } | null {
    if (!key.startsWith(KV_PREFIX)) return null;
    const rest = key.slice(KV_PREFIX.length);

    const milestoneIdx = rest.indexOf(":milestone:");
    if (milestoneIdx >= 0) {
        const projectId = rest.slice(0, milestoneIdx);
        const entityId = rest.slice(milestoneIdx + ":milestone:".length);
        if (!projectId || !entityId) return null;
        return { projectId, type: "milestone", entityId };
    }

    const featureIdx = rest.indexOf(":feature:");
    if (featureIdx >= 0) {
        const projectId = rest.slice(0, featureIdx);
        const entityId = rest.slice(featureIdx + ":feature:".length);
        if (!projectId || !entityId) return null;
        return { projectId, type: "feature", entityId };
    }

    return null;
}
