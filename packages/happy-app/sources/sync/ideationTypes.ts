/**
 * Ideation type definitions and constants
 *
 * Ideas are stored in UserKVStore with E2E encryption.
 * Each idea is an independent KV entry: ideation/idea/{ideaId}
 */

//
// Category definitions
//

export const IDEATION_CATEGORIES = [
    "feature",
    "improvement",
    "bugfix",
    "refactor",
    "documentation",
    "other",
] as const;

export type IdeationCategory = (typeof IDEATION_CATEGORIES)[number];

export const IDEATION_CATEGORY_LABELS = {
    feature: "ideation.categories.feature",
    improvement: "ideation.categories.improvement",
    bugfix: "ideation.categories.bugfix",
    refactor: "ideation.categories.refactor",
    documentation: "ideation.categories.documentation",
    other: "ideation.categories.other",
} as const;

export const IDEATION_CATEGORY_ICONS = {
    feature: "bulb-outline",
    improvement: "trending-up-outline",
    bugfix: "bug-outline",
    refactor: "code-slash-outline",
    documentation: "document-text-outline",
    other: "ellipsis-horizontal-outline",
} as const;

//
// Status definitions
//

export const IDEATION_STATUSES = [
    "draft",
    "active",
    "converted",
    "dismissed",
] as const;

export type IdeationStatus = (typeof IDEATION_STATUSES)[number];

export const IDEATION_STATUS_LABELS = {
    draft: "ideation.statuses.draft",
    active: "ideation.statuses.active",
    converted: "ideation.statuses.converted",
    dismissed: "ideation.statuses.dismissed",
} as const;

//
// Priority definitions
//

export const IDEATION_PRIORITIES = ["low", "medium", "high"] as const;

export type IdeationPriority = (typeof IDEATION_PRIORITIES)[number];

export const IDEATION_PRIORITY_LABELS = {
    low: "kanban.priority.low",
    medium: "kanban.priority.medium",
    high: "kanban.priority.high",
} as const;

//
// Idea data model
//

/**
 * Idea data stored encrypted in KV value.
 * This is the shape that gets JSON.stringify'd → encrypted → stored as KV value.
 */
export interface IdeationIdeaData {
    readonly title: string;
    readonly description: string;
    readonly category: IdeationCategory;
    readonly status: IdeationStatus;
    readonly priority: IdeationPriority;
    readonly tags: readonly string[];
    /** If converted, the kanban task ID it was converted to */
    readonly convertedTaskId: string | null;
    readonly createdAt: number;
    readonly updatedAt: number;
}

/**
 * In-memory idea with id and KV version for optimistic locking.
 * Used by UI components and the ideation store.
 */
export interface IdeationIdea extends IdeationIdeaData {
    readonly id: string;
    /** KV optimistic lock version (-1 = new, 0+ = existing) */
    readonly kvVersion: number;
}

//
// KV key helpers
//

const IDEATION_IDEA_PREFIX = "ideation/idea/";

export function ideationIdeaKey(ideaId: string): string {
    return `${IDEATION_IDEA_PREFIX}${ideaId}`;
}

export function parseIdeationIdeaKey(key: string): string | null {
    if (!key.startsWith(IDEATION_IDEA_PREFIX)) {
        return null;
    }
    return key.slice(IDEATION_IDEA_PREFIX.length);
}

export function isIdeationKey(key: string): boolean {
    return key.startsWith("ideation/");
}

//
// Factory helpers
//

export function createDefaultIdeaData(
    overrides: Partial<IdeationIdeaData> & Pick<IdeationIdeaData, "title">,
): IdeationIdeaData {
    const now = Date.now();
    return {
        title: overrides.title,
        description: overrides.description ?? "",
        category: overrides.category ?? "feature",
        status: overrides.status ?? "draft",
        priority: overrides.priority ?? "medium",
        tags: overrides.tags ?? [],
        convertedTaskId: overrides.convertedTaskId ?? null,
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
    };
}

//
// Utility
//

export function ideasByStatus(
    ideas: ReadonlyArray<IdeationIdea>,
    status: IdeationStatus,
): ReadonlyArray<IdeationIdea> {
    return ideas
        .filter((i) => i.status === status)
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function ideaCountByStatus(
    ideas: ReadonlyArray<IdeationIdea>,
): Record<IdeationStatus, number> {
    const counts: Record<IdeationStatus, number> = {
        draft: 0,
        active: 0,
        converted: 0,
        dismissed: 0,
    };
    for (const idea of ideas) {
        counts[idea.status]++;
    }
    return counts;
}
