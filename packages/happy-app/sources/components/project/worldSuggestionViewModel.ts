import type { TranslationKey } from "@/text";
import type { SuggestionBucket, SuggestionStatus, SuggestionSummary, SuggestionType } from "@/sync/apiWorld";

export interface SuggestionLike {
    id: string;
}

export interface SuggestionStatusUpdate {
    suggestionId: string;
    status: SuggestionStatus;
}

export interface SuggestionBucketLike extends SuggestionLike {
    bucket?: SuggestionBucket;
    relatedGoalId?: string | null;
}

export function shouldRefetchSuggestions(event: SuggestionStatusUpdate): boolean {
    return event.status === "open" || event.status === "suspended";
}

export function mergeFetchedSuggestions<T extends SuggestionLike>(
    fetched: T[],
    pendingRemovedIds: ReadonlySet<string>,
): T[] {
    return fetched.filter((suggestion) => !pendingRemovedIds.has(suggestion.id));
}

export function mergeVisibleSuggestions<T extends SuggestionSummary>(
    active: T[],
    accepted: T[],
): T[] {
    const byId = new Map<string, T>();

    for (const suggestion of [...active, ...accepted]) {
        if (!byId.has(suggestion.id)) {
            byId.set(suggestion.id, suggestion);
        }
    }

    return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

const TYPE_CONFIG: Record<SuggestionType, { icon: string; color: string }> = {
    suggested_goal: { icon: "flag-outline", color: "#8B5CF6" },
    suggested_task: { icon: "hammer-outline", color: "#3B82F6" },
    suggested_skill: { icon: "school-outline", color: "#10B981" },
    suggested_decision: { icon: "help-circle-outline", color: "#F59E0B" },
};

export function getSuggestionTypeConfig(type: SuggestionType): { icon: string; color: string } {
    return TYPE_CONFIG[type] ?? TYPE_CONFIG.suggested_task;
}

export function getSuggestionPayloadTitle(suggestion: SuggestionSummary): string {
    if (suggestion.type === "suggested_goal") {
        return suggestion.payload.goal.title;
    }
    if (suggestion.type === "suggested_task") {
        return suggestion.payload.task.title;
    }
    if (suggestion.type === "suggested_skill") {
        return suggestion.payload.skill.title;
    }
    return suggestion.payload.decision.question;
}

export function getSuggestionTypeLabelKey(type: SuggestionType): TranslationKey {
    if (type === "suggested_goal") return "suggestions.typeGoal";
    if (type === "suggested_skill") return "suggestions.typeSkill";
    if (type === "suggested_decision") return "suggestions.typeDecision";
    return "suggestions.typeTask";
}

export function getSuggestionAcceptanceLabelKey(suggestion: SuggestionSummary): TranslationKey | null {
    if (suggestion.status !== "accepted") {
        return null;
    }
    if (suggestion.acceptSource === "system_auto") {
        return "suggestions.acceptedAuto";
    }
    if (suggestion.acceptSource === "human") {
        return "suggestions.acceptedManual";
    }
    return "suggestions.acceptedGeneric";
}

export function getSuggestionAutoAcceptReasonKey(suggestion: SuggestionSummary): TranslationKey | null {
    if (suggestion.status !== "accepted") {
        return null;
    }
    if (suggestion.acceptSource !== "system_auto") {
        return null;
    }
    if (!suggestion.acceptAudit) {
        return null;
    }
    if (suggestion.acceptAudit.rule === "safe_suggested_task_auto_accept") {
        return "suggestions.autoAcceptReasonSafeTask";
    }
    return null;
}

export function getSuggestionAutoAcceptOutcomeKey(suggestion: SuggestionSummary): TranslationKey | null {
    if (suggestion.autoAcceptStatus === "skipped" && suggestion.autoAcceptReasonCode === "quota_exhausted") {
        return "suggestions.autoAcceptSkippedQuota";
    }
    if (suggestion.autoAcceptStatus === "skipped" && suggestion.autoAcceptReasonCode === "already_acted") {
        return "suggestions.autoAcceptSkippedAlreadyActed";
    }
    if (suggestion.autoAcceptStatus === "failed" && suggestion.autoAcceptReasonCode === "accept_failed") {
        return "suggestions.autoAcceptFailed";
    }
    return null;
}

export function getSuggestionAutoAcceptFailureDetailKey(suggestion: SuggestionSummary): TranslationKey | null {
    if (suggestion.autoAcceptStatus !== "failed" || suggestion.autoAcceptReasonCode !== "accept_failed") {
        return null;
    }
    if (suggestion.autoAcceptFailureDetail === "dispatch_failed") {
        return "suggestions.autoAcceptFailureDetailDispatchFailed" as TranslationKey;
    }
    if (suggestion.autoAcceptFailureDetail === "payload_invalid") {
        return "suggestions.autoAcceptFailureDetailPayloadInvalid" as TranslationKey;
    }
    if (suggestion.autoAcceptFailureDetail === "auto_accept_failed") {
        return "suggestions.autoAcceptFailureDetailGeneric" as TranslationKey;
    }
    return null;
}

export function shouldShowSuggestionActions(suggestion: SuggestionSummary): boolean {
    return suggestion.status === "open" || suggestion.status === "suspended";
}

export function applySuggestionStatusUpdate<T extends SuggestionLike>(
    suggestions: T[],
    event: SuggestionStatusUpdate,
): T[] {
    if (
        event.status !== "processing"
        && event.status !== "accepted"
        && event.status !== "dismissed"
        && event.status !== "expired"
    ) {
        return suggestions;
    }
    return suggestions.filter((suggestion) => suggestion.id !== event.suggestionId);
}

export function groupSuggestionsByBucket<T extends SuggestionBucketLike>(suggestions: T[]): {
    nextStep: T[];
    needsDecision: T[];
    needsHumanInput: T[];
} {
    return suggestions.reduce(
        (result, suggestion) => {
            if (suggestion.bucket === "needs_decision") {
                result.needsDecision.push(suggestion);
                return result;
            }
            if (suggestion.bucket === "needs_human_input") {
                result.needsHumanInput.push(suggestion);
                return result;
            }
            result.nextStep.push(suggestion);
            return result;
        },
        {
            nextStep: [] as T[],
            needsDecision: [] as T[],
            needsHumanInput: [] as T[],
        },
    );
}

export function filterGoalSuggestions<T extends SuggestionBucketLike>(
    suggestions: T[],
    goalId: string,
): T[] {
    return suggestions.filter((suggestion) => suggestion.relatedGoalId === goalId);
}

export function removeSuggestionOptimistically<T extends SuggestionLike>(
    suggestions: T[],
    suggestionId: string,
): { suggestions: T[]; removedIndex: number } {
    const removedIndex = suggestions.findIndex((suggestion) => suggestion.id === suggestionId);
    if (removedIndex === -1) {
        return { suggestions, removedIndex };
    }
    return {
        suggestions: suggestions.filter((suggestion) => suggestion.id !== suggestionId),
        removedIndex,
    };
}

export function restoreSuggestionAtIndex<T extends SuggestionLike>(
    suggestions: T[],
    suggestion: T,
    index: number,
): T[] {
    if (suggestions.some((item) => item.id === suggestion.id)) {
        return suggestions;
    }
    if (index < 0 || index >= suggestions.length) {
        return [...suggestions, suggestion];
    }
    return [
        ...suggestions.slice(0, index),
        suggestion,
        ...suggestions.slice(index),
    ];
}
