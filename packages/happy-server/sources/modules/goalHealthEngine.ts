/**
 * Pure-function Goal health scoring engine (Stage G).
 *
 * No LLM dependency — all detection is deterministic and fully testable at zero cost.
 * Results feed into the existing suggestion pipeline via buildHealthSuggestionCandidates.
 */

import { db } from "@/storage/db";
import { TIME_MS, REPEATED_FAILURE_THRESHOLD, truncateText } from "./worldConstants";
import type { SuggestionCandidate } from "./worldSuggestionGenerate";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoalHealthInput {
    id: string;
    title: string;
    description: string | null;
    status: string;
    progress: number;
    priority: string;
    createdAt: Date;
    updatedAt: Date;
    blockedSince: Date | null;
    layer: string | null;
    parentGoalId: string | null;
    subGoalCount: number;
    tasks: Array<{
        id: string;
        status: string;
        attempt: number;
        maxAttempts: number;
        errorMessage: string | null;
        updatedAt: Date;
    }>;
}

export type GoalHealthSignalKind =
    | "stale_in_progress"
    | "blocked_aging"
    | "repeated_failure"
    | "all_tasks_terminal_with_failures"
    | "narrative_deviation";

// ---------------------------------------------------------------------------
// Goal Layer classification
// ---------------------------------------------------------------------------

export type GoalLayer = "strategic" | "operational" | "execution";

export function classifyGoalLayer(goal: {
    parentGoalId: string | null;
    subGoalCount: number;
    taskCount: number;
}): GoalLayer {
    if (!goal.parentGoalId && goal.subGoalCount > 0) return "strategic";
    if (goal.parentGoalId && goal.subGoalCount > 0) return "operational";
    if (goal.parentGoalId) return "execution";
    // Root goal with no subGoals but has tasks → operational
    return "operational";
}

export interface GoalHealthSignal {
    kind: GoalHealthSignalKind;
    severity: "info" | "warning" | "critical";
    detail: string;
}

export interface GoalHealthResult {
    goalId: string;
    goalTitle: string;
    goalDescription: string | null;
    goalLayer: GoalLayer;
    score: number;
    signals: GoalHealthSignal[];
}

// ---------------------------------------------------------------------------
// Detection helpers (pure functions, exported for unit testing)
// ---------------------------------------------------------------------------

export function detectStaleInProgress(
    goal: Pick<GoalHealthInput, "status" | "updatedAt">,
    now: Date,
): GoalHealthSignal | null {
    if (goal.status !== "in_progress") return null;
    const ageMs = now.getTime() - goal.updatedAt.getTime();
    const ageH = Math.round(ageMs / 3_600_000);
    if (ageMs >= TIME_MS.STALE_IN_PROGRESS_CRITICAL) {
        return {
            kind: "stale_in_progress",
            severity: "critical",
            detail: `Goal has been in_progress for ${ageH}h without updates (critical threshold: ${TIME_MS.STALE_IN_PROGRESS_CRITICAL / 3_600_000}h).`,
        };
    }
    if (ageMs >= TIME_MS.STALE_IN_PROGRESS_WARN) {
        return {
            kind: "stale_in_progress",
            severity: "warning",
            detail: `Goal has been in_progress for ${ageH}h without updates (warning threshold: ${TIME_MS.STALE_IN_PROGRESS_WARN / 3_600_000}h).`,
        };
    }
    return null;
}

export function detectBlockedAging(
    goal: Pick<GoalHealthInput, "status" | "blockedSince">,
    now: Date,
): GoalHealthSignal | null {
    if (goal.status !== "blocked" || !goal.blockedSince) return null;
    const ageMs = now.getTime() - goal.blockedSince.getTime();
    const ageH = Math.round(ageMs / 3_600_000);
    if (ageMs >= TIME_MS.BLOCKED_AGING_CRITICAL) {
        return {
            kind: "blocked_aging",
            severity: "critical",
            detail: `Goal has been blocked for ${ageH}h (critical threshold: ${TIME_MS.BLOCKED_AGING_CRITICAL / 3_600_000}h).`,
        };
    }
    if (ageMs >= TIME_MS.BLOCKED_AGING_WARN) {
        return {
            kind: "blocked_aging",
            severity: "warning",
            detail: `Goal has been blocked for ${ageH}h (warning threshold: ${TIME_MS.BLOCKED_AGING_WARN / 3_600_000}h).`,
        };
    }
    return null;
}

export function detectRepeatedFailure(
    goal: Pick<GoalHealthInput, "tasks">,
): GoalHealthSignal | null {
    const failedCount = goal.tasks.filter((t) => t.status === "failed").length;
    if (failedCount < REPEATED_FAILURE_THRESHOLD) return null;
    const severity = failedCount >= 5 ? "critical" : "warning";
    return {
        kind: "repeated_failure",
        severity,
        detail: `${failedCount} failed tasks detected (threshold: ${REPEATED_FAILURE_THRESHOLD}).`,
    };
}

export function detectAllTerminalWithFailures(
    goal: Pick<GoalHealthInput, "tasks">,
): GoalHealthSignal | null {
    if (goal.tasks.length === 0) return null;
    const allTerminal = goal.tasks.every((t) =>
        ["completed", "failed", "cancelled"].includes(t.status),
    );
    const hasFailures = goal.tasks.some((t) => t.status === "failed");
    if (!allTerminal || !hasFailures) return null;
    return {
        kind: "all_tasks_terminal_with_failures",
        severity: "critical",
        detail: `All ${goal.tasks.length} tasks are terminal but some failed. Goal may need replanning.`,
    };
}

// ---------------------------------------------------------------------------
// Narrative deviation (V1: lexical overlap, no LLM)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall",
    "should", "may", "might", "must", "can", "could", "to", "of", "in",
    "for", "on", "with", "at", "by", "from", "as", "into", "through",
    "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
    "it", "its", "this", "that", "these", "those", "i", "we", "you",
    "he", "she", "they", "me", "us", "him", "her", "them", "my", "our",
    "your", "his", "their",
]);

/** Tokenize text: split on whitespace/punctuation, lowercase, drop short/stop words. */
export function tokenize(text: string): Set<string> {
    const tokens = text
        .toLowerCase()
        .split(/[\s,.\-;:!?()[\]{}"'/\\]+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    return new Set(tokens);
}

export function detectNarrativeDeviation(input: {
    goalTitle: string;
    goalDescription: string | null;
    projectNarrative: string | null;
}): GoalHealthSignal | null {
    if (!input.projectNarrative || input.projectNarrative.trim().length === 0) return null;

    const narrativeTokens = tokenize(input.projectNarrative);
    if (narrativeTokens.size === 0) return null;

    const goalText = [input.goalTitle, input.goalDescription].filter(Boolean).join(" ");
    const goalTokens = tokenize(goalText);
    if (goalTokens.size === 0) return null;

    let overlap = 0;
    for (const token of goalTokens) {
        if (narrativeTokens.has(token)) overlap++;
    }
    const overlapRate = overlap / goalTokens.size;

    if (overlapRate < 0.1) {
        return {
            kind: "narrative_deviation",
            severity: "warning",
            detail: `Goal tokens overlap with project narrative at ${Math.round(overlapRate * 100)}% (threshold: 10%). Goal may have drifted from project vision.`,
        };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Core scoring (pure function, no DB dependency)
// ---------------------------------------------------------------------------

export function scoreGoalHealth(
    goal: GoalHealthInput,
    now: Date,
    context?: { projectNarrative?: string | null },
): GoalHealthResult {
    const signals: GoalHealthSignal[] = [];
    const goalLayer = classifyGoalLayer({
        parentGoalId: goal.parentGoalId,
        subGoalCount: goal.subGoalCount,
        taskCount: goal.tasks.length,
    });

    const stale = detectStaleInProgress(goal, now);
    if (stale) signals.push(stale);

    const blockedAging = detectBlockedAging(goal, now);
    if (blockedAging) signals.push(blockedAging);

    const repeated = detectRepeatedFailure(goal);
    if (repeated) signals.push(repeated);

    const terminal = detectAllTerminalWithFailures(goal);
    if (terminal) signals.push(terminal);

    if (context?.projectNarrative) {
        const deviation = detectNarrativeDeviation({
            goalTitle: goal.title,
            goalDescription: goal.description,
            projectNarrative: context.projectNarrative,
        });
        if (deviation) signals.push(deviation);
    }

    let score = 100;
    for (const signal of signals) {
        switch (signal.kind) {
            case "stale_in_progress":
                score -= signal.severity === "critical" ? 40 : 20;
                break;
            case "blocked_aging":
                score -= signal.severity === "critical" ? 35 : 15;
                break;
            case "repeated_failure": {
                const failedCount = goal.tasks.filter((t) => t.status === "failed").length;
                score -= (failedCount - 2) * 10;
                break;
            }
            case "all_tasks_terminal_with_failures":
                score -= 30;
                break;
            case "narrative_deviation":
                score -= 15;
                break;
        }
    }

    return {
        goalId: goal.id,
        goalTitle: goal.title,
        goalDescription: goal.description,
        goalLayer,
        score: Math.max(0, score),
        signals,
    };
}

// ---------------------------------------------------------------------------
// DB integration: compute scores and persist
// ---------------------------------------------------------------------------

export async function refreshGoalHealthScores(
    accountId: string,
    projectId: string,
    projectNarrative?: string | null,
): Promise<GoalHealthResult[]> {
    const goals = await db.goal.findMany({
        where: {
            accountId,
            projectId,
            status: { in: ["in_progress", "blocked"] },
        },
        select: {
            id: true,
            title: true,
            description: true,
            status: true,
            progress: true,
            priority: true,
            createdAt: true,
            updatedAt: true,
            blockedSince: true,
            layer: true,
            parentGoalId: true,
            tasks: {
                select: {
                    id: true,
                    status: true,
                    attempt: true,
                    maxAttempts: true,
                    errorMessage: true,
                    updatedAt: true,
                },
            },
            _count: { select: { subGoals: true } },
        },
    });

    const now = new Date();
    const context = projectNarrative ? { projectNarrative } : undefined;
    const results: GoalHealthResult[] = [];

    for (const goal of goals) {
        const result = scoreGoalHealth(
            { ...goal, subGoalCount: goal._count.subGoals },
            now,
            context,
        );
        results.push(result);

        await db.goal.update({
            where: { id: goal.id },
            data: { healthScore: result.score, layer: result.goalLayer },
        });
    }

    return results;
}

// ---------------------------------------------------------------------------
// Suggestion candidates from health signals
// ---------------------------------------------------------------------------

export function buildHealthSuggestionCandidates(
    results: GoalHealthResult[],
): SuggestionCandidate[] {
    const candidates: SuggestionCandidate[] = [];

    for (const result of results) {
        for (const signal of result.signals) {
            const candidate = buildCandidateForSignal(result, signal);
            if (candidate) candidates.push(candidate);
        }
    }

    return candidates;
}

function buildCandidateForSignal(
    result: GoalHealthResult,
    signal: GoalHealthSignal,
): SuggestionCandidate | null {
    const { goalId, goalTitle, goalDescription, goalLayer } = result;

    switch (signal.kind) {
        case "stale_in_progress":
            return {
                relatedGoalId: goalId,
                relatedTaskId: null,
                type: "suggested_task",
                title: `Check progress: ${truncateText(goalTitle, 56)}`,
                summary: `Goal "${goalTitle}" has been in_progress for an extended period without task updates.`,
                reason: signal.detail,
                evidence: [{ kind: "goal", id: goalId, label: `Stale: ${goalTitle}` }],
                recommendedRole: "analyst",
                payload: {
                    task: {
                        title: `Check progress: ${truncateText(goalTitle, 56)}`,
                        prompt: [
                            `Goal "${goalTitle}" appears stale — no updates detected for an extended period.`,
                            goalDescription ? `Goal description: ${goalDescription}` : "",
                            "",
                            "Investigate current status: are tasks running, blocked, or silently failed?",
                            "Summarize findings and recommend whether to continue, reprioritize, or close.",
                        ].filter(Boolean).join("\n"),
                        goalId,
                        priority: "normal",
                    },
                },
                requiresHuman: false,
                bucket: "next_step",
                dedupeKey: `stale_goal_attention:${goalId}:${signal.severity}`,
                factKey: `${goalId}|stale_${signal.severity}`,
            };

        case "blocked_aging":
            if (signal.severity !== "critical") return null;
            return {
                relatedGoalId: goalId,
                relatedTaskId: null,
                type: "suggested_decision",
                title: `Blocked too long: ${truncateText(goalTitle, 50)}`,
                summary: `Goal "${goalTitle}" has been blocked for over ${TIME_MS.BLOCKED_AGING_CRITICAL / 3_600_000}h and needs a decision.`,
                reason: signal.detail,
                evidence: [{ kind: "goal", id: goalId, label: `Blocked: ${goalTitle}` }],
                recommendedRole: null,
                payload: {
                    decision: {
                        question: `Goal "${goalTitle}" has been blocked for over ${TIME_MS.BLOCKED_AGING_CRITICAL / 3_600_000}h. What should happen?`,
                        context: goalDescription ?? signal.detail,
                        goalId,
                        precedentKey: "goal.blocked_too_long",
                        options: [
                            { id: "investigate_and_unblock", description: "Create a focused task to investigate and unblock" },
                            { id: "replan", description: "Cancel current tasks and replan the goal" },
                            { id: "cancel_goal", description: "Cancel this goal as no longer relevant" },
                        ],
                    },
                },
                requiresHuman: true,
                bucket: "needs_decision",
                dedupeKey: `blocked_goal_aging:${goalId}:${signal.severity}`,
                factKey: `${goalId}|blocked_${signal.severity}`,
            };

        case "repeated_failure":
            if (signal.severity !== "critical") return null;
            return {
                relatedGoalId: goalId,
                relatedTaskId: null,
                type: "suggested_decision",
                title: `Repeated failures: ${truncateText(goalTitle, 50)}`,
                summary: `Goal "${goalTitle}" has accumulated ≥5 failed tasks. Consider replanning.`,
                reason: signal.detail,
                evidence: [{ kind: "goal", id: goalId, label: `Failing: ${goalTitle}` }],
                recommendedRole: null,
                payload: {
                    decision: {
                        question: `Goal "${goalTitle}" has repeated task failures. How should execution continue?`,
                        context: goalDescription ?? signal.detail,
                        goalId,
                        precedentKey: "goal.repeated_failure",
                        options: [
                            { id: "replan_with_different_approach", description: "Replan with a fundamentally different approach" },
                            { id: "pause_and_diagnose", description: "Pause and run a diagnostic investigation" },
                            { id: "cancel_goal", description: "Cancel this goal" },
                        ],
                    },
                },
                requiresHuman: true,
                bucket: "needs_decision",
                dedupeKey: `repeated_failure_replan:${goalId}:${signal.severity}`,
                factKey: `${goalId}|repeated_${signal.severity}`,
            };

        case "all_tasks_terminal_with_failures":
            // Strategic layer: suggest a new high-level goal (human required)
            // Operational layer: suggest a new sub-goal (can be auto-accepted)
            // Execution layer: suggest a replan task (granular, not a new goal)
            if (goalLayer === "strategic" || goalLayer === "operational") {
                const isStrategic = goalLayer === "strategic";
                return {
                    relatedGoalId: goalId,
                    relatedTaskId: null,
                    type: "suggested_goal",
                    title: `Replan goal: ${truncateText(goalTitle, 50)}`,
                    summary: `All tasks for ${goalLayer} goal "${goalTitle}" are terminal with failures — a new goal is needed.`,
                    reason: signal.detail,
                    evidence: [{ kind: "goal", id: goalId, label: `Needs replan: ${goalTitle}` }],
                    recommendedRole: "planner",
                    payload: {
                        goal: {
                            title: `Replan: ${truncateText(goalTitle, 56)}`,
                            detail: [
                                `Original goal "${goalTitle}" had all tasks fail.`,
                                goalDescription ? `Description: ${goalDescription}` : "",
                                "Create a new decomposition with root-cause analysis built in.",
                            ].filter(Boolean).join(" "),
                            priority: "normal",
                        },
                    },
                    requiresHuman: isStrategic,
                    bucket: isStrategic ? "needs_decision" : "next_step",
                    dedupeKey: `goal_replan_needed:${goalId}`,
                    factKey: `${goalId}|replan_needed`,
                };
            }
            // Execution layer: a targeted replan task suffices
            return {
                relatedGoalId: goalId,
                relatedTaskId: null,
                type: "suggested_task",
                title: `Replan needed: ${truncateText(goalTitle, 50)}`,
                summary: `All tasks for goal "${goalTitle}" are terminal but some failed. A new plan is required.`,
                reason: signal.detail,
                evidence: [{ kind: "goal", id: goalId, label: `Needs replan: ${goalTitle}` }],
                recommendedRole: "planner",
                payload: {
                    task: {
                        title: `Replan: ${truncateText(goalTitle, 56)}`,
                        prompt: [
                            `Goal "${goalTitle}" has all tasks in terminal state, but some failed.`,
                            goalDescription ? `Goal description: ${goalDescription}` : "",
                            "",
                            "Review the failed tasks and create a new decomposition plan.",
                            "Address the root causes of the failures in the new plan.",
                        ].filter(Boolean).join("\n"),
                        goalId,
                        priority: "user",
                    },
                },
                requiresHuman: false,
                bucket: "next_step",
                dedupeKey: `goal_replan_needed:${goalId}`,
                factKey: `${goalId}|replan_needed`,
            };

        case "narrative_deviation":
            return {
                relatedGoalId: goalId,
                relatedTaskId: null,
                type: "suggested_decision",
                title: `Off-narrative: ${truncateText(goalTitle, 50)}`,
                summary: `Goal "${goalTitle}" appears to have drifted from the project narrative.`,
                reason: signal.detail,
                evidence: [{ kind: "goal", id: goalId, label: `Drifted: ${goalTitle}` }],
                recommendedRole: null,
                payload: {
                    decision: {
                        question: `Goal "${goalTitle}" has low overlap with the project narrative. Is this intentional?`,
                        context: goalDescription ?? signal.detail,
                        goalId,
                        precedentKey: "goal.narrative_deviation",
                        options: [
                            { id: "keep_as_is", description: "This goal is intentionally outside the main narrative" },
                            { id: "realign", description: "Update the goal to better align with the narrative" },
                            { id: "cancel_goal", description: "Cancel this goal as off-track" },
                        ],
                    },
                },
                requiresHuman: true,
                bucket: "needs_decision",
                dedupeKey: `narrative_deviation:${goalId}`,
                factKey: `${goalId}|narrative_deviation`,
            };

        default:
            return null;
    }
}
