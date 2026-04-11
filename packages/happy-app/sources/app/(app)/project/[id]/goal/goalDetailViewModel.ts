import type { GoalDetail } from "@/sync/apiProjects";
import type { SuggestionSummary } from "@/sync/apiWorld";

export interface GoalDetailSectionStat {
    label: "tasks" | "subGoals" | "decisions";
    value: string;
}

export interface GoalDetailSectionModel {
    key: "latest-session" | "tasks" | "subgoals" | "blockers" | "decisions";
}

export interface GoalDetailBlockerAction {
    kind: "open_decision" | "open_session" | "mark_read";
    blockerIndex: number;
    targetId: string;
}

export interface GoalDetailViewModel {
    hero: {
        badges: string[];
        progressLabel: string;
        stats: GoalDetailSectionStat[];
    };
    sections: GoalDetailSectionModel[];
    blockerActions: GoalDetailBlockerAction[];
}

export type GoalDetailScreenState =
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "empty" }
    | { kind: "ready" };

export function buildGoalDetailSections(goal: GoalDetail): GoalDetailViewModel {
    const sections: GoalDetailSectionModel[] = [];

    if (goal.latestSession) {
        sections.push({ key: "latest-session" });
    }
    if (goal.tasks.length > 0) {
        sections.push({ key: "tasks" });
    }
    if (goal.subGoals.length > 0) {
        sections.push({ key: "subgoals" });
    }
    if (goal.blockers.length > 0) {
        sections.push({ key: "blockers" });
    }
    if (goal.decisions.length > 0) {
        sections.push({ key: "decisions" });
    }

    const blockerActions: GoalDetailBlockerAction[] = [];
    for (const [index, blocker] of goal.blockers.entries()) {
        if (blocker.decisionId) {
            blockerActions.push({ kind: "open_decision", blockerIndex: index, targetId: blocker.decisionId });
        }
        if (blocker.sessionId) {
            blockerActions.push({ kind: "open_session", blockerIndex: index, targetId: blocker.sessionId });
        }
        if (blocker.sourceMessageId && blocker.messageStatus === "unread") {
            blockerActions.push({ kind: "mark_read", blockerIndex: index, targetId: blocker.sourceMessageId });
        }
    }

    return {
        hero: {
            badges: [goal.status, goal.priority],
            progressLabel: `${goal.progress}%`,
            stats: [
                { label: "tasks", value: String(goal.taskCount) },
                { label: "subGoals", value: String(goal.subGoalCount) },
                { label: "decisions", value: String(goal.decisionCount) },
            ],
        },
        sections,
        blockerActions,
    };
}

export function filterGoalDetailSuggestions(
    suggestions: SuggestionSummary[],
    goalId: string,
): SuggestionSummary[] {
    return suggestions.filter((suggestion) => suggestion.relatedGoalId === goalId);
}

export function deriveGoalDetailScreenState(input: {
    loading: boolean;
    goal: GoalDetail | null;
    error: string | null;
}): GoalDetailScreenState {
    if (input.loading && !input.goal) {
        return { kind: "loading" };
    }
    if (input.error) {
        return { kind: "error", message: input.error };
    }
    if (!input.goal) {
        return { kind: "empty" };
    }
    return { kind: "ready" };
}
