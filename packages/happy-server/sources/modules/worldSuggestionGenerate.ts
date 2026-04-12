/**
 * Generate WorldSuggestion candidates from server-side fact sources.
 *
 * Sprint 1 keeps the server as the truth source and stabilizes lifecycle semantics:
 * - same fact after dismiss stays dismissed
 * - changed fact reopens as a new suggestion
 * - missing fact expires old open suggestions
 */

import { db } from "@/storage/db";
import {
    eventRouter,
    buildWorldSuggestionUpdatedEphemeral,
} from "@/app/events/eventRouter";
import { buildGoalBlockerSummary, type GoalBlockerSummary } from "./goalSummary";
import {
    normalizeConcreteImplementationSummary,
    normalizeSuggestionFactText,
} from "./summaryDetailFilter";
import { autoAcceptSuggestedTasksIfEnabled } from "./worldSuggestionAutoAccept";
import { truncateText, TEXT_LIMITS, TIME_MS } from "./worldConstants";
import type { SuggestionBucket, SuggestionEvidence, SuggestionPayload, SuggestionSummary, SuggestionType } from "@kmmao/happy-wire";

interface FailedTaskFact {
    id: string;
    title: string | null;
    errorMessage: string | null;
    goalId: string | null;
    attempt: number;
    maxAttempts: number;
}

interface BlockedGoalFact {
    id: string;
    title: string;
    description: string | null;
    blocker: GoalBlockerSummary | null;
}

interface DecisionAttentionFact {
    id: string;
    question: string;
    goalId: string | null;
    status: "pending" | "expired";
    expiresAt: Date | null;
}

interface CompletedTaskSkillFact {
    id: string;
    title: string | null;
    goalId: string | null;
    sessionId: string;
    summary: string;
}

export interface SuggestionCandidate {
    relatedGoalId: string | null;
    relatedTaskId: string | null;
    type: SuggestionType;
    title: string;
    summary: string;
    reason: string;
    evidence: SuggestionEvidence[];
    recommendedRole: string | null;
    payload: SuggestionPayload;
    requiresHuman: boolean;
    bucket: SuggestionBucket;
    dedupeKey: string;
    factKey: string;
}

interface ExistingSuggestionLifecycle {
    id: string;
    dedupeKey: string;
    factKey: string;
    status: string;
}

interface ReconcileResult {
    toCreate: SuggestionCandidate[];
    toExpireIds: string[];
    unchanged: number;
}

interface RefreshResult {
    created: number;
    unchanged: number;
    total: number;
    debounced?: boolean;
}

const PROCESSING_STALE_MS = TIME_MS.PROCESSING_STALE;
const REFRESH_DEBOUNCE_MS = TIME_MS.REFRESH_DEBOUNCE;

const RETRYABLE_ERROR_PATTERNS = [
    /timeout/i,
    /ECONNRESET/i,
    /ECONNREFUSED/i,
    /ETIMEDOUT/i,
    /rate.?limit/i,
    /\b503\b/,
    /\b429\b/,
    /temporary/i,
    /unavailable/i,
];

function isRetryableError(errorMessage: string | null): boolean {
    if (!errorMessage) return false;
    return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage));
}

export async function worldSuggestionRefresh(
    accountId: string,
    projectId: string,
): Promise<RefreshResult> {
    const project = await db.project.findUnique({
        where: { id: projectId },
        select: { supervisorConfig: true, supervisorMode: true },
    });

    // Debounce: skip regeneration if refreshed within REFRESH_DEBOUNCE_MS
    const debounceKey = `world-suggestion-refresh:${projectId}`;
    const existing = await db.repeatKey.findUnique({
        where: { key: debounceKey },
    });
    if (existing && existing.expiresAt >= new Date()) {
        const total = await db.worldSuggestion.count({
            where: { projectId, accountId, status: "open" },
        });
        return { created: 0, unchanged: 0, total, debounced: true };
    }
    await db.repeatKey.upsert({
        where: { key: debounceKey },
        create: { key: debounceKey, value: "1", expiresAt: new Date(Date.now() + REFRESH_DEBOUNCE_MS) },
        update: { expiresAt: new Date(Date.now() + REFRESH_DEBOUNCE_MS) },
    });

    const staleProcessingRows = await db.worldSuggestion.findMany({
        where: {
            accountId,
            projectId,
            status: "processing",
            updatedAt: { lte: new Date(Date.now() - PROCESSING_STALE_MS) },
        },
        select: { id: true },
    });

    if (staleProcessingRows.length > 0) {
        await db.worldSuggestion.updateMany({
            where: { id: { in: staleProcessingRows.map((row) => row.id) }, status: "processing" },
            data: { status: "suspended" },
        });

        for (const row of staleProcessingRows) {
            eventRouter.emitEphemeral({
                userId: accountId,
                payload: buildWorldSuggestionUpdatedEphemeral({
                    projectId,
                    suggestionId: row.id,
                    status: "suspended",
                }),
                recipientFilter: { type: "user-scoped-only" },
            });
        }
    }

    const facts = await collectSuggestionFacts(accountId, projectId);
    const candidates = buildSuggestionCandidates(facts);

    const existingRows = await db.worldSuggestion.findMany({
        where: {
            accountId,
            projectId,
            status: { in: ["open", "processing", "suspended", "dismissed", "accepted"] },
        },
        select: { id: true, dedupeKey: true, status: true },
    });

    const lifecycleRows: ExistingSuggestionLifecycle[] = existingRows.map((row) => ({
        id: row.id,
        dedupeKey: row.dedupeKey,
        factKey: extractFactKey(row.dedupeKey),
        status: row.status,
    }));

    const reconcile = reconcileSuggestionCandidates({
        candidates,
        existing: lifecycleRows,
    });

    if (reconcile.toExpireIds.length > 0) {
        const rowsToExpire = await db.worldSuggestion.findMany({
            where: {
                id: { in: reconcile.toExpireIds },
                status: "open",
            },
            select: { id: true },
        });

        await db.worldSuggestion.updateMany({
            where: {
                id: { in: reconcile.toExpireIds },
                status: "open",
            },
            data: {
                status: "expired",
                actedAt: new Date(),
            },
        });

        for (const row of rowsToExpire) {
            eventRouter.emitEphemeral({
                userId: accountId,
                payload: buildWorldSuggestionUpdatedEphemeral({
                    projectId,
                    suggestionId: row.id,
                    status: "expired",
                }),
                recipientFilter: { type: "user-scoped-only" },
            });
        }
    }

    const createdSuggestions: SuggestionSummary[] = [];

    for (const candidate of reconcile.toCreate) {
        const created = await db.worldSuggestion.create({
            data: {
                accountId,
                projectId,
                relatedGoalId: candidate.relatedGoalId,
                relatedTaskId: candidate.relatedTaskId,
                type: candidate.type,
                title: candidate.title,
                summary: candidate.summary,
                reason: candidate.reason,
                evidence: JSON.stringify(candidate.evidence),
                recommendedRole: candidate.recommendedRole,
                payload: JSON.stringify(candidate.payload),
                requiresHuman: candidate.requiresHuman,
                bucket: candidate.bucket,
                dedupeKey: candidate.dedupeKey,
            },
        });

        createdSuggestions.push({
            id: created.id,
            projectId,
            relatedGoalId: candidate.relatedGoalId,
            relatedTaskId: candidate.relatedTaskId,
            type: candidate.type,
            title: candidate.title,
            summary: candidate.summary,
            reason: candidate.reason,
            evidence: candidate.evidence,
            recommendedRole: candidate.recommendedRole,
            payload: candidate.payload,
            requiresHuman: candidate.requiresHuman,
            status: "open",
            dedupeKey: candidate.dedupeKey,
            bucket: candidate.bucket,
            createdAt: Date.now(),
            actedAt: null,
        } as SuggestionSummary);

        eventRouter.emitEphemeral({
            userId: accountId,
            payload: buildWorldSuggestionUpdatedEphemeral({
                projectId,
                suggestionId: created.id,
                status: "open",
            }),
            recipientFilter: { type: "user-scoped-only" },
        });
    }

    await autoAcceptSuggestedTasksIfEnabled({
        accountId,
        projectId,
        supervisorMode: project?.supervisorMode ?? null,
        supervisorConfig: project?.supervisorConfig ?? null,
        suggestions: createdSuggestions,
    });

    const total = await db.worldSuggestion.count({
        where: { projectId, accountId, status: "open" },
    });

    return {
        created: reconcile.toCreate.length,
        unchanged: reconcile.unchanged,
        total,
    };
}

async function collectSuggestionFacts(accountId: string, projectId: string): Promise<{
    failedTasks: FailedTaskFact[];
    blockedGoals: BlockedGoalFact[];
    attentionDecisions: DecisionAttentionFact[];
    completedTaskSkills: CompletedTaskSkillFact[];
}> {
    const [failedTasks, completedTasks, blockedGoalsRaw, pendingDecisions, expiredDecisions, planningTimeoutGoalIds] = await Promise.all([
        db.task.findMany({
            where: { accountId, projectId, status: "failed" },
            select: {
                id: true,
                title: true,
                errorMessage: true,
                goalId: true,
                attempt: true,
                maxAttempts: true,
                updatedAt: true,
            },
            orderBy: { updatedAt: "desc" },
            take: 20,
        }),
        db.task.findMany({
            where: { accountId, projectId, status: "completed", sessionId: { not: null } },
            select: {
                id: true,
                title: true,
                goalId: true,
                sessionId: true,
                updatedAt: true,
            },
            orderBy: { updatedAt: "desc" },
            take: 20,
        }),
        db.goal.findMany({
            where: { accountId, projectId, status: "blocked" },
            select: {
                id: true,
                title: true,
                description: true,
                plannerTaskId: true,
                updatedAt: true,
                tasks: {
                    select: { id: true, title: true, status: true, errorMessage: true },
                    orderBy: { updatedAt: "desc" },
                    take: 10,
                },
            },
        }),
        db.decision.findMany({
            where: { accountId, projectId, status: "pending" },
            select: { id: true, question: true, goalId: true, status: true, expiresAt: true },
            orderBy: { createdAt: "desc" },
            take: 20,
        }),
        db.decision.findMany({
            where: { accountId, projectId, status: "expired" },
            select: { id: true, question: true, goalId: true, status: true, expiresAt: true },
            orderBy: { updatedAt: "desc" },
            take: 20,
        }),
        db.goal.findMany({
            where: {
                accountId,
                projectId,
                status: "blocked",
                plannerTaskId: { not: null },
                updatedAt: { lte: new Date(Date.now() - 10 * 60 * 1000) },
            },
            select: { id: true },
        }),
    ]);

    const timeoutGoalIds = new Set(planningTimeoutGoalIds.map((goal) => goal.id));
    const blockedGoals = blockedGoalsRaw.map((goal) => ({
        id: goal.id,
        title: goal.title,
        description: goal.description,
        blocker: buildGoalBlockerSummary({
            goalStatus: "blocked",
            plannerTimedOut: timeoutGoalIds.has(goal.id),
            tasks: goal.tasks,
            agentMessages: [],
        }),
    }));

    const completedTaskSkills = await buildCompletedTaskSkillFacts(completedTasks);

    return {
        failedTasks: failedTasks.map((task) => ({
            id: task.id,
            title: task.title,
            errorMessage: task.errorMessage,
            goalId: task.goalId,
            attempt: task.attempt,
            maxAttempts: task.maxAttempts,
        })),
        blockedGoals,
        attentionDecisions: [...pendingDecisions, ...expiredDecisions].map((decision) => ({
            id: decision.id,
            question: decision.question,
            goalId: decision.goalId,
            status: decision.status as "pending" | "expired",
            expiresAt: decision.expiresAt,
        })),
        completedTaskSkills,
    };
}

export function buildSuggestionCandidates(input: {
    failedTasks: FailedTaskFact[];
    blockedGoals: BlockedGoalFact[];
    attentionDecisions: DecisionAttentionFact[];
    completedTaskSkills: CompletedTaskSkillFact[];
}): SuggestionCandidate[] {
    const candidates: SuggestionCandidate[] = [];

    for (const task of input.failedTasks) {
        if (task.attempt >= task.maxAttempts) {
            candidates.push(retryExhaustedDecision(task));
            continue;
        }
        if (isRetryableError(task.errorMessage)) {
            candidates.push(retryableFailedTask(task));
        } else {
            candidates.push(failedTaskFollowup(task));
        }
    }

    for (const goal of input.blockedGoals) {
        if (!goal.blocker) continue;
        candidates.push(blockedGoalAttention(goal));
        if (
            goal.blocker.kind !== "planner_timeout"
            && !goal.blocker.requiresHuman
        ) {
            candidates.push(blockedGoalSupplement(goal));
        }
    }

    for (const decision of input.attentionDecisions) {
        candidates.push(decisionAttention(decision));
    }

    for (const task of input.completedTaskSkills) {
        candidates.push(completedTaskSkillSuggestion(task));
    }

    return candidates;
}

export function reconcileSuggestionCandidates(input: {
    candidates: SuggestionCandidate[];
    existing: ExistingSuggestionLifecycle[];
}): ReconcileResult {
    const existingByDedupe = new Map(input.existing.map((item) => [item.dedupeKey, item]));
    const existingByFamily = new Map<string, ExistingSuggestionLifecycle[]>();

    for (const item of input.existing) {
        const family = extractFamilyKey(item.dedupeKey);
        const bucket = existingByFamily.get(family) ?? [];
        bucket.push(item);
        existingByFamily.set(family, bucket);
    }

    const toCreate: SuggestionCandidate[] = [];
    const toExpireIds = new Set<string>();
    let unchanged = 0;
    const seenFamilies = new Set<string>();

    for (const candidate of input.candidates) {
        const exact = existingByDedupe.get(candidate.dedupeKey);
        const family = extractFamilyKey(candidate.dedupeKey);
        seenFamilies.add(family);

        if (exact) {
            unchanged += 1;
            continue;
        }

        const familyRows = existingByFamily.get(family) ?? [];
        const sameFactDismissed = familyRows.find((row) => row.status === "dismissed" && row.factKey === candidate.factKey);
        if (sameFactDismissed) {
            unchanged += 1;
            continue;
        }

        for (const row of familyRows) {
            if (row.status === "open") {
                toExpireIds.add(row.id);
            }
            if (row.status === "dismissed" && row.factKey !== candidate.factKey) {
                toExpireIds.add(row.id);
            }
        }

        toCreate.push(candidate);
    }

    for (const row of input.existing) {
        const family = extractFamilyKey(row.dedupeKey);
        if (seenFamilies.has(family)) continue;
        if (row.status === "open") {
            toExpireIds.add(row.id);
        }
    }

    return {
        toCreate,
        toExpireIds: Array.from(toExpireIds),
        unchanged,
    };
}

export function retryableFailedTask(task: FailedTaskFact): SuggestionCandidate {
    const taskLabel = task.title ?? task.id;
    const errorSummary = normalizeSuggestionFactText(task.errorMessage, "Unknown error");
    const factKey = [task.id, task.attempt, task.maxAttempts, errorSummary].join("|");

    return {
        relatedGoalId: task.goalId,
        relatedTaskId: task.id,
        type: "suggested_task",
        title: `Auto-retry: ${truncateText(taskLabel, 60)}`,
        summary: `Task "${taskLabel}" failed with a transient error and can be safely retried.`,
        reason: `Transient error detected: ${truncateText(errorSummary, 200)}`,
        evidence: [{ kind: "task", id: task.id, label: `Failed: ${taskLabel}` }],
        recommendedRole: "builder",
        payload: {
            task: {
                title: `Retry: ${truncateText(taskLabel, 60)}`,
                prompt: [
                    `The previous task "${taskLabel}" failed with a transient error.`,
                    `Error: ${errorSummary}`,
                    "",
                    "This is a read-only investigation and retry. Do not change any persistent state beyond what is strictly needed to complete the original task.",
                    "Verify connectivity or resource availability before retrying, then proceed if clear.",
                ].join("\n"),
                goalId: task.goalId ?? undefined,
                priority: "user",
            },
        },
        requiresHuman: false,
        bucket: "next_step",
        dedupeKey: `retryable_failed_task:${task.id}:${task.attempt}:${errorSummary}`,
        factKey,
    };
}

export function blockedGoalSupplement(goal: BlockedGoalFact): SuggestionCandidate {
    const blocker = goal.blocker!;
    const summary = normalizeSuggestionFactText(goal.description, "Goal is blocked");
    const blockerSummary = normalizeSuggestionFactText(blocker.summary, summary);
    const factKey = [goal.id, blocker.kind, "supplement", blockerSummary].join("|");

    return {
        relatedGoalId: goal.id,
        relatedTaskId: blocker.sourceTaskId ?? null,
        type: "suggested_task",
        title: `Explore blocker: ${truncateText(goal.title, 56)}`,
        summary: `Read-only investigation to understand what is blocking goal "${goal.title}".`,
        reason: `Blocker identified but may be resolvable autonomously: ${truncateText(blockerSummary, 160)}`,
        evidence: [
            { kind: "goal", id: goal.id, label: `Blocked: ${goal.title}` },
        ],
        recommendedRole: "analyst",
        payload: {
            task: {
                title: `Investigate: ${truncateText(goal.title, 56)}`,
                prompt: [
                    `Goal "${goal.title}" is blocked.`,
                    goal.description ? `Goal description: ${goal.description}` : "",
                    `Blocker: ${blockerSummary}`,
                    "",
                    "Perform a read-only investigation. Identify the root cause of the blocker and summarize findings.",
                    "Do not make any persistent changes. Output a structured analysis with recommended next steps.",
                ].filter(Boolean).join("\n"),
                goalId: goal.id,
                priority: "user",
            },
        },
        requiresHuman: false,
        bucket: "next_step",
        dedupeKey: `blocked_goal_supplement:${goal.id}:${blocker.kind}:${blockerSummary}`,
        factKey,
    };
}

export function failedTaskFollowup(task: FailedTaskFact): SuggestionCandidate {
    const taskLabel = task.title ?? task.id;
    const errorSummary = normalizeSuggestionFactText(task.errorMessage, "Unknown error");
    const factKey = [task.id, task.attempt, task.maxAttempts, errorSummary].join("|");

    return {
        relatedGoalId: task.goalId,
        relatedTaskId: task.id,
        type: "suggested_task",
        title: `Follow up: ${truncateText(taskLabel, 60)}`,
        summary: `Task "${taskLabel}" failed and still has retry budget. Run a focused follow-up task before escalating.`,
        reason: `Task failed with: ${truncateText(errorSummary, 200)}`,
        evidence: [{ kind: "task", id: task.id, label: `Failed: ${taskLabel}` }],
        recommendedRole: "builder",
        payload: {
            task: {
                title: `Fix: ${truncateText(taskLabel, 60)}`,
                prompt: [
                    `The previous task "${taskLabel}" failed.`,
                    `Error: ${errorSummary}`,
                    "",
                    "Investigate the root cause and make the smallest fix that gets this work unstuck.",
                    "Run verification before completing.",
                ].join("\n"),
                goalId: task.goalId ?? undefined,
                priority: "user",
            },
        },
        requiresHuman: true,
        bucket: "next_step",
        dedupeKey: `failed_task_followup:${task.id}:${task.attempt}:${task.maxAttempts}:${errorSummary}`,
        factKey,
    };
}

export function retryExhaustedDecision(task: FailedTaskFact): SuggestionCandidate {
    const taskLabel = task.title ?? task.id;
    const errorSummary = normalizeSuggestionFactText(task.errorMessage, "Unknown error");
    const factKey = [task.id, task.attempt, task.maxAttempts, errorSummary].join("|");

    return {
        relatedGoalId: task.goalId,
        relatedTaskId: task.id,
        type: "suggested_decision",
        title: `Decide next step: ${truncateText(taskLabel, 60)}`,
        summary: `Task "${taskLabel}" exhausted retries. Human decision is needed before more execution.`,
        reason: `Retry budget exhausted after ${task.attempt}/${task.maxAttempts} attempts. Last error: ${truncateText(errorSummary, 160)}`,
        evidence: [{ kind: "task", id: task.id, label: `Retry exhausted: ${taskLabel}` }],
        recommendedRole: null,
        payload: {
            decision: {
                question: `Task "${taskLabel}" exhausted retries. What should happen next?`,
                context: `Last error: ${errorSummary}`,
                goalId: task.goalId ?? undefined,
                precedentKey: "task.retry_exhausted",
                options: [
                    { id: "retry_with_changes", description: "Create a new remediation task with a changed approach" },
                    { id: "change_scope", description: "Change the task or goal scope before retrying" },
                    { id: "stop", description: "Stop this line of execution for now" },
                ],
            },
        },
        requiresHuman: true,
        bucket: "needs_decision",
        dedupeKey: `retry_exhausted_decision:${task.id}:${task.attempt}:${task.maxAttempts}:${errorSummary}`,
        factKey,
    };
}

export function blockedGoalAttention(goal: BlockedGoalFact): SuggestionCandidate {
    const blocker = goal.blocker ?? {
        kind: "agent_request",
        summary: "Goal is blocked",
        requiresHuman: true,
    };
    const summary = normalizeSuggestionFactText(goal.description, "Goal is blocked");
    const blockerSummary = normalizeSuggestionFactText(blocker.summary, summary);
    const factKey = [goal.id, blocker.kind, blockerSummary].join("|");

    if (blocker.kind === "planner_timeout") {
        return {
            relatedGoalId: goal.id,
            relatedTaskId: null,
            type: "suggested_decision",
            title: `Resolve planning timeout: ${truncateText(goal.title, 50)}`,
            summary: `Goal "${goal.title}" is blocked because planning timed out and needs a human decision.`,
            reason: blockerSummary,
            evidence: [{ kind: "goal", id: goal.id, label: `Blocked: ${goal.title}` }],
            recommendedRole: null,
            payload: {
                decision: {
                    question: `Goal "${goal.title}" is blocked after planner timeout. How should planning continue?`,
                    context: summary,
                    goalId: goal.id,
                    precedentKey: "goal.planner_timeout",
                    options: [
                        { id: "retry_planning", description: "Retry planning with clarified requirements" },
                        { id: "manual_breakdown", description: "Manually break this goal into smaller tasks" },
                        { id: "defer_goal", description: "Defer this goal until constraints are clearer" },
                    ],
                },
            },
            requiresHuman: true,
            bucket: "needs_decision",
            dedupeKey: `blocked_goal_attention:${goal.id}:planner_timeout:${blockerSummary}`,
            factKey,
        };
    }

    return {
        relatedGoalId: goal.id,
        relatedTaskId: blocker.sourceTaskId ?? null,
        type: "suggested_task",
        title: `Unblock: ${truncateText(goal.title, 60)}`,
        summary: `Goal "${goal.title}" is blocked. Create a focused task to remove the blocker.`,
        reason: blockerSummary,
        evidence: [
            { kind: "goal", id: goal.id, label: `Blocked: ${goal.title}` },
            ...(blocker.sourceTaskId ? [{ kind: "task" as const, id: blocker.sourceTaskId, label: `Source task: ${blocker.sourceTaskId}` }] : []),
            ...(blocker.decisionId ? [{ kind: "decision" as const, id: blocker.decisionId, label: `Decision: ${blocker.decisionId}` }] : []),
        ],
        recommendedRole: blocker.requiresHuman ? null : "builder",
        payload: {
            task: {
                title: `Unblock: ${truncateText(goal.title, 60)}`,
                prompt: [
                    `Goal "${goal.title}" is blocked.`,
                    goal.description ? `Goal description: ${goal.description}` : "",
                    `Blocker: ${blockerSummary}`,
                    "",
                    "Investigate the blocker and propose or implement the smallest change that unblocks progress.",
                ].filter(Boolean).join("\n"),
                goalId: goal.id,
                priority: "user",
            },
        },
        requiresHuman: true,
        bucket: blocker.requiresHuman ? "needs_human_input" : "next_step",
        dedupeKey: `blocked_goal_attention:${goal.id}:${blocker.kind}:${blockerSummary}`,
        factKey,
    };
}

export function decisionAttention(decision: DecisionAttentionFact): SuggestionCandidate {
    const expiresAt = decision.expiresAt?.toISOString() ?? "none";
    const factKey = [decision.id, decision.status, expiresAt].join("|");
    const expired = decision.status === "expired";

    return {
        relatedGoalId: decision.goalId,
        relatedTaskId: null,
        type: "suggested_decision",
        title: expired
            ? `Expired decision: ${truncateText(decision.question, 50)}`
            : `Pending decision: ${truncateText(decision.question, 50)}`,
        summary: expired
            ? `Decision "${truncateText(decision.question, 80)}" expired and still needs human attention.`
            : `Decision "${truncateText(decision.question, 80)}" is pending and needs human attention.`,
        reason: expired
            ? `Decision expired${decision.expiresAt ? ` at ${decision.expiresAt.toISOString()}` : ""}`
            : `Decision pending${decision.expiresAt ? ` until ${decision.expiresAt.toISOString()}` : ""}`,
        evidence: [{ kind: "decision", id: decision.id, label: truncateText(decision.question, 80) }],
        recommendedRole: null,
        payload: {
            decision: {
                question: decision.question,
                goalId: decision.goalId ?? undefined,
                existingDecisionId: decision.id,
                context: expired ? "This decision expired before being adjudicated." : "This decision is still pending adjudication.",
                precedentKey: expired ? "decision.expired_attention" : "decision.pending_attention",
                options: [
                    { id: "adjudicate_now", description: "Review and adjudicate this decision now" },
                    { id: "gather_more_context", description: "Gather more context before adjudicating" },
                    { id: "defer", description: "Defer this decision again" },
                ],
            },
        },
        requiresHuman: true,
        bucket: "needs_decision",
        dedupeKey: `decision_attention:${decision.id}:${decision.status}:${expiresAt}`,
        factKey,
    };
}

export function completedTaskSkillSuggestion(task: CompletedTaskSkillFact): SuggestionCandidate {
    const taskLabel = task.title ?? task.id;
    const factKey = [task.id, task.sessionId, task.summary].join("|");

    return {
        relatedGoalId: task.goalId,
        relatedTaskId: task.id,
        type: "suggested_skill",
        title: `Extract skill: ${truncateText(taskLabel, 60)}`,
        summary: `Task "${taskLabel}" completed with a stable execution summary that can be reused as a skill.`,
        reason: truncateText(task.summary, 200),
        evidence: [
            { kind: "task", id: task.id, label: `Completed: ${taskLabel}` },
            { kind: "message", id: task.sessionId, label: truncateText(task.summary, 100) },
        ],
        recommendedRole: null,
        payload: {
            skill: {
                title: `From task: ${truncateText(taskLabel, 60)}`,
                content: [
                    `When this pattern recurs, apply the approach proven by task \"${taskLabel}\".`,
                    `Successful outcome: ${task.summary}`,
                ].join("\n\n"),
                sourceTaskId: task.id,
            },
        },
        requiresHuman: true,
        bucket: "next_step",
        dedupeKey: `completed_task_skill:${task.id}:${task.sessionId}:${task.summary}`,
        factKey,
    };
}

async function buildCompletedTaskSkillFacts(tasks: Array<{
    id: string;
    title: string | null;
    goalId: string | null;
    sessionId: string | null;
}>): Promise<CompletedTaskSkillFact[]> {
    const eligibleTasks = tasks.filter((task) => task.sessionId);
    if (eligibleTasks.length === 0) return [];

    const existingBindings = await db.taskSkillBinding.findMany({
        where: { taskId: { in: eligibleTasks.map((task) => task.id) } },
        select: { taskId: true },
    });
    const boundTaskIds = new Set(existingBindings.map((binding) => binding.taskId));
    const sessionIds = eligibleTasks
        .filter((task) => !boundTaskIds.has(task.id))
        .map((task) => task.sessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId));
    if (sessionIds.length === 0) return [];

    const sessionEvents = await db.sessionEvent.findMany({
        where: { sessionId: { in: sessionIds }, eventType: "session_end" },
        select: { sessionId: true, eventType: true, summary: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }],
    });
    const latestStableSummaryBySession = new Map<string, string>();
    for (const event of sessionEvents) {
        if (latestStableSummaryBySession.has(event.sessionId)) continue;
        const stableSummary = normalizeConcreteImplementationSummary(event.summary);
        if (!stableSummary) continue;
        latestStableSummaryBySession.set(event.sessionId, stableSummary);
    }

    return eligibleTasks
        .filter((task) => !boundTaskIds.has(task.id))
        .map((task) => {
            const sessionId = task.sessionId as string;
            const summary = latestStableSummaryBySession.get(sessionId);
            if (!summary) return null;
            return {
                id: task.id,
                title: task.title,
                goalId: task.goalId,
                sessionId,
                summary,
            } satisfies CompletedTaskSkillFact;
        })
        .filter((task): task is CompletedTaskSkillFact => task !== null);
}

function extractFamilyKey(dedupeKey: string): string {
    const parts = dedupeKey.split(":");
    if (parts.length <= 2) return dedupeKey;
    return `${parts[0]}:${parts[1]}`;
}

function extractFactKey(dedupeKey: string): string {
    const parts = dedupeKey.split(":");
    if (parts.length <= 2) return dedupeKey;
    return parts.slice(1).join("|");
}

// truncateText imported from worldConstants
