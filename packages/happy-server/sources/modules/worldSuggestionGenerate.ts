/**
 * Generate WorldSuggestion candidates from project fact sources.
 *
 * Three deterministic rules:
 * 1. failed_task_followup — suggest a follow-up task for failed tasks
 * 2. blocked_goal_decompose — suggest unblocking task/goal for blocked goals
 * 3. pending_decision_investigate — suggest investigation task for pending decisions
 */

import { db } from "@/storage/db";
import type { SuggestionEvidence, SuggestionPayload } from "./worldSuggestionTypes";

interface SuggestionCandidate {
    relatedGoalId: string | null;
    relatedTaskId: string | null;
    type: "suggested_goal" | "suggested_task" | "suggested_skill";
    title: string;
    summary: string;
    reason: string;
    evidence: SuggestionEvidence[];
    recommendedRole: string | null;
    payload: SuggestionPayload;
    requiresHuman: boolean;
    dedupeKey: string;
}

interface RefreshResult {
    created: number;
    unchanged: number;
    total: number;
}

export async function worldSuggestionRefresh(
    accountId: string,
    projectId: string,
): Promise<RefreshResult> {
    // 1. Parallel-fetch all fact sources
    const [
        blockedGoals,
        failedTasks,
        pendingDecisions,
        unresolvedMessages,
        completedTasks,
        project,
    ] = await Promise.all([
        db.goal.findMany({
            where: { accountId, projectId, status: "blocked" },
            select: {
                id: true,
                title: true,
                description: true,
                tasks: {
                    where: { status: "failed" },
                    select: { id: true, title: true, errorMessage: true },
                    orderBy: { updatedAt: "desc" },
                    take: 1,
                },
            },
        }),

        db.task.findMany({
            where: { accountId, projectId, status: "failed" },
            select: {
                id: true,
                title: true,
                errorMessage: true,
                goalId: true,
                updatedAt: true,
            },
            orderBy: { updatedAt: "desc" },
            take: 20,
        }),

        db.decision.findMany({
            where: { accountId, projectId, status: "pending" },
            select: {
                id: true,
                question: true,
                goalId: true,
                updatedAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 20,
        }),

        // AgentMessage has no goalId/taskId — query at project level
        db.agentMessage.findMany({
            where: {
                accountId,
                projectId,
                status: { in: ["unread", "read"] },
                msgType: { in: ["conflict", "request"] },
            },
            select: {
                id: true,
                content: true,
                fromRole: true,
                msgType: true,
                sessionId: true,
            },
            orderBy: { createdAt: "desc" },
            take: 20,
        }),

        // Completed tasks with title — candidates for skill extraction
        db.task.findMany({
            where: {
                accountId,
                projectId,
                status: "completed",
                title: { not: null },
                completedAt: { not: null },
            },
            select: {
                id: true,
                title: true,
                goalId: true,
                sessionId: true,
                completedAt: true,
            },
            orderBy: { completedAt: "desc" },
            take: 10,
        }),

        db.project.findFirst({
            where: { id: projectId, accountId },
            select: { narrative: true },
        }),
    ]);

    const narrative = project?.narrative ?? null;

    // Build a lookup: goalId → unresolved messages (via session → task → goalId)
    // For blocked goals, use the project-level messages as context
    const projectMessages = unresolvedMessages;

    // 2. Run generators
    const candidates: SuggestionCandidate[] = [];

    for (const task of failedTasks) {
        candidates.push(failedTaskFollowup(task, narrative));
    }

    for (const goal of blockedGoals) {
        candidates.push(blockedGoalDecompose(goal, narrative));
    }

    for (const decision of pendingDecisions) {
        candidates.push(pendingDecisionInvestigate(decision, narrative));
    }

    // Standalone unresolved messages (not already covered by other generators)
    for (const msg of projectMessages) {
        // Only generate if not already covered by another generator
        const dedupeKey = `message:${msg.id}`;
        const alreadyCovered = candidates.some((c) => c.dedupeKey === dedupeKey);
        if (alreadyCovered) continue;
        candidates.push(unresolvedMessageFollowup(msg));
    }

    // Completed tasks → suggested skill extraction
    for (const task of completedTasks) {
        if (task.title) {
            candidates.push(completedTaskSkill(task as typeof task & { title: string }));
        }
    }

    // 3. Dedupe and upsert (batch query to avoid N+1)
    let created = 0;
    let unchanged = 0;

    const allDedupeKeys = candidates.map((c) => c.dedupeKey);
    const existingRows = await db.worldSuggestion.findMany({
        where: {
            projectId,
            dedupeKey: { in: allDedupeKeys },
            status: "open", // Only open blocks re-creation; dismissed allows re-generation
        },
        select: { dedupeKey: true },
    });
    const existingKeys = new Set(existingRows.map((e) => e.dedupeKey));

    for (const candidate of candidates) {
        if (existingKeys.has(candidate.dedupeKey)) {
            unchanged++;
            continue;
        }

        await db.worldSuggestion.create({
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
                dedupeKey: candidate.dedupeKey,
            },
        });
        created++;
    }

    const total = await db.worldSuggestion.count({
        where: { projectId, accountId, status: "open" },
    });

    return { created, unchanged, total };
}

// --- Generator: failed task → suggested follow-up task ---

export function failedTaskFollowup(
    task: { id: string; title: string | null; errorMessage: string | null; goalId: string | null },
    _narrative: string | null,
): SuggestionCandidate {
    const taskLabel = task.title ?? task.id;
    const errorSummary = task.errorMessage?.trim() || "Unknown error";

    return {
        relatedGoalId: task.goalId,
        relatedTaskId: task.id,
        type: "suggested_task",
        title: `Follow up: ${truncate(taskLabel, 60)}`,
        summary: `Task "${taskLabel}" failed. A follow-up task can investigate and resolve the issue.`,
        reason: `Task failed with: ${truncate(errorSummary, 200)}`,
        evidence: [
            { kind: "task", id: task.id, label: `Failed: ${taskLabel}` },
        ],
        recommendedRole: "builder",
        payload: {
            task: {
                title: `Fix: ${truncate(taskLabel, 60)}`,
                prompt: [
                    `The previous task "${taskLabel}" failed.`,
                    `Error: ${errorSummary}`,
                    "",
                    "Please investigate the root cause and fix the issue.",
                    "If the fix requires changes to multiple files, make all necessary changes.",
                    "Run tests to verify the fix before completing.",
                ].join("\n"),
                goalId: task.goalId ?? undefined,
                priority: "user",
            },
        },
        requiresHuman: true,
        dedupeKey: `failed_task:${task.id}`,
    };
}

// --- Generator: blocked goal → suggested unblocking task ---

export function blockedGoalDecompose(
    goal: {
        id: string;
        title: string;
        description: string | null;
        tasks: Array<{ id: string; title: string | null; errorMessage: string | null }>;
    },
    _narrative: string | null,
): SuggestionCandidate {
    const failedTask = goal.tasks[0];

    let blockerSummary: string;
    const evidence: SuggestionEvidence[] = [
        { kind: "goal", id: goal.id, label: `Blocked: ${goal.title}` },
    ];

    if (failedTask) {
        blockerSummary = failedTask.errorMessage?.trim() || `Task "${failedTask.title ?? failedTask.id}" failed`;
        evidence.push({ kind: "task", id: failedTask.id, label: `Failed: ${failedTask.title ?? failedTask.id}` });
    } else {
        blockerSummary = "Goal is blocked — check agent messages and session logs for details";
    }

    return {
        relatedGoalId: goal.id,
        relatedTaskId: failedTask?.id ?? null,
        type: "suggested_task",
        title: `Unblock: ${truncate(goal.title, 60)}`,
        summary: `Goal "${goal.title}" is blocked. A task can help resolve the blocker.`,
        reason: `Blocker: ${truncate(blockerSummary, 200)}`,
        evidence,
        recommendedRole: "builder",
        payload: {
            task: {
                title: `Unblock: ${truncate(goal.title, 60)}`,
                prompt: [
                    `Goal "${goal.title}" is currently blocked.`,
                    goal.description ? `Goal description: ${goal.description}` : "",
                    `Blocker: ${blockerSummary}`,
                    "",
                    "Please investigate and resolve this blocker.",
                    "If additional context is needed, check recent session logs and agent messages.",
                ].filter(Boolean).join("\n"),
                goalId: goal.id,
                priority: "user",
            },
        },
        requiresHuman: true,
        dedupeKey: `blocked_goal:${goal.id}`,
    };
}

// --- Generator: pending decision → suggested investigation task ---

export function pendingDecisionInvestigate(
    decision: { id: string; question: string; goalId: string | null },
    _narrative: string | null,
): SuggestionCandidate {
    return {
        relatedGoalId: decision.goalId,
        relatedTaskId: null,
        type: "suggested_task",
        title: `Investigate: ${truncate(decision.question, 50)}`,
        summary: `A pending decision needs more information before it can be resolved.`,
        reason: `Decision pending: "${truncate(decision.question, 200)}"`,
        evidence: [
            { kind: "decision", id: decision.id, label: truncate(decision.question, 80) },
        ],
        recommendedRole: "builder",
        payload: {
            task: {
                title: `Research: ${truncate(decision.question, 50)}`,
                prompt: [
                    `There is a pending decision that needs more information:`,
                    `"${decision.question}"`,
                    "",
                    "Please investigate the codebase and gather relevant context to help make this decision.",
                    "Provide your findings as a structured summary.",
                ].join("\n"),
                goalId: decision.goalId ?? undefined,
                priority: "user",
            },
        },
        requiresHuman: true,
        dedupeKey: `pending_decision:${decision.id}`,
    };
}

// --- Generator: standalone unresolved AgentMessage ---

function unresolvedMessageFollowup(
    msg: { id: string; content: string; fromRole: string; msgType: string; sessionId: string | null },
): SuggestionCandidate {
    return {
        relatedGoalId: null,
        relatedTaskId: null,
        type: "suggested_task",
        title: `Resolve ${msg.msgType}: ${truncate(msg.content, 50)}`,
        summary: `An unresolved ${msg.msgType} from ${msg.fromRole} needs attention.`,
        reason: `${msg.fromRole} ${msg.msgType}: ${truncate(msg.content, 200)}`,
        evidence: [
            { kind: "message", id: msg.id, label: `${msg.fromRole}: ${truncate(msg.content, 60)}` },
        ],
        recommendedRole: null,
        payload: {
            task: {
                title: `Handle ${msg.msgType} from ${msg.fromRole}`,
                prompt: [
                    `There is an unresolved ${msg.msgType} from role "${msg.fromRole}":`,
                    `"${msg.content}"`,
                    "",
                    "Please investigate and resolve this issue.",
                ].join("\n"),
                priority: "user",
            },
        },
        requiresHuman: true,
        dedupeKey: `message:${msg.id}`,
    };
}

// --- Generator: completed task → suggested skill extraction ---

export function completedTaskSkill(
    task: { id: string; title: string; goalId: string | null; sessionId: string | null },
): SuggestionCandidate {
    return {
        relatedGoalId: task.goalId,
        relatedTaskId: task.id,
        type: "suggested_skill",
        title: `Extract skill: ${truncate(task.title, 50)}`,
        summary: `Task "${task.title}" completed successfully. Consider extracting a reusable skill from this work.`,
        reason: `Completed task may contain reusable patterns or instructions.`,
        evidence: [
            { kind: "task", id: task.id, label: `Completed: ${task.title}` },
        ],
        recommendedRole: null,
        payload: {
            skill: {
                title: task.title,
                content: [
                    `# ${task.title}`,
                    "",
                    "## Instructions",
                    "",
                    "<!-- Edit this skill with the reusable instructions extracted from the completed task. -->",
                    "<!-- Review the session output to identify patterns worth preserving. -->",
                    "",
                ].join("\n"),
                sourceTaskId: task.id,
            },
        },
        requiresHuman: true,
        dedupeKey: `completed_task_skill:${task.id}`,
    };
}

// --- Helpers ---

function truncate(str: string, max: number): string {
    if (str.length <= max) return str;
    return str.substring(0, max - 3) + "...";
}
