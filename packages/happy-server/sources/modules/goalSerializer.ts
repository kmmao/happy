/**
 * Goal serialization helpers.
 *
 * Extracted from goalRoutes.ts to keep the route file focused on HTTP handling.
 */

import {
    buildGoalBlockerSummary,
    buildGoalTaskStatusSummary,
    selectLatestGoalSession,
} from "./goalSummary";
import { truncateText, TEXT_LIMITS } from "./worldConstants";

export type GoalAgentMessageSummary = {
    id: string;
    fromRole: string;
    msgType: string;
    content: string;
    status: string;
    sessionId: string | null;
    decisionId: string | null;
    createdAt: Date;
};

export function serializeGoal(goal: Record<string, unknown>, agentMessages: GoalAgentMessageSummary[] = []): Record<string, unknown> {
    const g = goal as {
        id: string;
        projectId: string;
        title: string;
        description: string | null;
        status: string;
        progress: number;
        priority: string;
        deadline: Date | null;
        parentGoalId: string | null;
        machineId: string;
        createdBy: string;
        plannerTaskId: string | null;
        createdAt: Date;
        updatedAt: Date;
        tasks?: Array<{
            id: string;
            title: string | null;
            status: string;
            sessionId: string | null;
            roleType: string | null;
            errorMessage: string | null;
            createdAt: Date;
            completedAt: Date | null;
        }>;
        _count?: { subGoals: number; tasks: number; decisions: number };
    };

    const tasks = g.tasks ?? [];
    const taskStatusSummary = buildGoalTaskStatusSummary(tasks);
    const latestSession = selectLatestGoalSession(tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        sessionId: task.sessionId,
        updatedAt: task.completedAt ?? task.createdAt,
    })));
    const blocker = buildGoalBlockerSummary({
        goalStatus: g.status,
        plannerTimedOut: g.status === "blocked" && Boolean(g.plannerTaskId) && tasks.length === 0,
        tasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            errorMessage: task.errorMessage,
        })),
        agentMessages,
    });

    return {
        id: g.id,
        projectId: g.projectId,
        title: g.title,
        description: g.description,
        status: g.status,
        progress: g.progress,
        priority: g.priority,
        deadline: g.deadline?.getTime() ?? null,
        parentGoalId: g.parentGoalId,
        machineId: g.machineId,
        createdBy: g.createdBy,
        plannerTaskId: g.plannerTaskId,
        createdAt: g.createdAt.getTime(),
        updatedAt: g.updatedAt.getTime(),
        subGoalCount: g._count?.subGoals ?? 0,
        taskCount: g._count?.tasks ?? 0,
        decisionCount: g._count?.decisions ?? 0,
        taskStatusSummary,
        latestSession,
        blocker,
        tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            sessionId: t.sessionId,
            roleType: t.roleType,
        })),
    };
}

export function serializeGoalDetail(goal: Record<string, unknown>, agentMessages: GoalAgentMessageSummary[] = []): Record<string, unknown> {
    const base = serializeGoal(goal, agentMessages);
    const g = goal as {
        tasks?: Array<{
            id: string;
            title: string | null;
            status: string;
            sessionId: string | null;
            roleType: string | null;
            prompt: string;
            priority: string;
            createdAt: Date;
            completedAt: Date | null;
        }>;
        subGoals?: Array<{
            id: string;
            title: string;
            status: string;
            progress: number;
            priority: string;
        }>;
        decisions?: Array<{
            id: string;
            question: string;
            status: string;
            createdAt: Date;
        }>;
    };

    return {
        ...base,
        tasks: g.tasks?.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            sessionId: t.sessionId,
            roleType: t.roleType,
            promptPreview: truncateText(t.prompt, TEXT_LIMITS.PROMPT_PREVIEW),
            priority: t.priority,
            createdAt: t.createdAt.getTime(),
            completedAt: t.completedAt?.getTime() ?? null,
        })) ?? [],
        subGoals: g.subGoals ?? [],
        blockers: base.blocker ? [base.blocker] : [],
        decisions: g.decisions?.map((d) => ({
            id: d.id,
            question: d.question,
            status: d.status,
            createdAt: d.createdAt.getTime(),
        })) ?? [],
    };
}
