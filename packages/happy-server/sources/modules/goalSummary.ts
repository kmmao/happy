export interface GoalTaskStatusSummary {
    dispatching: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
}

const GOAL_TASK_STATUSES: Array<keyof GoalTaskStatusSummary> = [
    "dispatching",
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
];

export interface GoalTaskStatusLike {
    status: string;
}

export interface GoalTaskSessionLike {
    id: string;
    title: string | null;
    status: string;
    sessionId: string | null;
    updatedAt: Date;
}

export interface GoalTaskBlockerLike {
    id: string;
    title: string | null;
    status: string;
}

export interface GoalAgentMessageBlockerLike {
    id: string;
    fromRole: string;
    msgType: string;
    content: string;
    status: string;
    sessionId: string | null;
    decisionId: string | null;
    createdAt: Date;
}

export interface GoalLatestSessionSummary {
    sessionId: string;
    taskId: string;
    taskTitle: string | null;
    status: string;
    updatedAt: number;
}

export interface GoalBlockerSummary {
    kind: "planner_timeout" | "task_failed" | "agent_conflict" | "agent_request";
    summary: string;
    sourceTaskId?: string;
    sourceMessageId?: string;
    requiresHuman: boolean;
    sessionId?: string;
    decisionId?: string;
    messageStatus?: "unread" | "read" | "resolved";
}

export function buildGoalTaskStatusSummary(tasks: GoalTaskStatusLike[]): GoalTaskStatusSummary {
    const summary: GoalTaskStatusSummary = {
        dispatching: 0,
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
    };

    for (const task of tasks) {
        if (GOAL_TASK_STATUSES.includes(task.status as keyof GoalTaskStatusSummary)) {
            summary[task.status as keyof GoalTaskStatusSummary] += 1;
        }
    }

    return summary;
}

export function selectLatestGoalSession(tasks: GoalTaskSessionLike[]): GoalLatestSessionSummary | null {
    const latest = tasks
        .filter((task) => task.sessionId)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

    if (!latest?.sessionId) {
        return null;
    }

    return {
        sessionId: latest.sessionId,
        taskId: latest.id,
        taskTitle: latest.title,
        status: latest.status,
        updatedAt: latest.updatedAt.getTime(),
    };
}

function buildAgentMessageBlockerSummary(
    agentMessages: GoalAgentMessageBlockerLike[],
    tasks: GoalTaskBlockerLike[],
): GoalBlockerSummary | null {
    const unresolved = agentMessages
        .filter((message) => message.status !== "resolved")
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const hasFailedTask = tasks.some((task) => task.status === "failed");
    if (hasFailedTask) {
        return null;
    }

    const conflict = unresolved.find((message) => message.msgType === "conflict");
    if (conflict) {
        return {
            kind: "agent_conflict",
            summary: `${conflict.fromRole} conflict: ${conflict.content}`,
            requiresHuman: true,
            sourceMessageId: conflict.id,
            sessionId: conflict.sessionId ?? undefined,
            decisionId: conflict.decisionId ?? undefined,
            messageStatus: conflict.status as GoalBlockerSummary["messageStatus"],
        };
    }

    const request = unresolved.find((message) => message.msgType === "request");
    if (request) {
        return {
            kind: "agent_request",
            summary: `${request.fromRole} request: ${request.content}`,
            requiresHuman: true,
            sourceMessageId: request.id,
            sessionId: request.sessionId ?? undefined,
            decisionId: request.decisionId ?? undefined,
            messageStatus: request.status as GoalBlockerSummary["messageStatus"],
        };
    }

    return null;
}
export function buildGoalBlockerSummary(input: {
    goalStatus: string;
    plannerTimedOut: boolean;
    tasks: GoalTaskBlockerLike[];
    agentMessages: GoalAgentMessageBlockerLike[];
}): GoalBlockerSummary | null {
    if (input.goalStatus !== "blocked") {
        return null;
    }

    if (input.plannerTimedOut) {
        return {
            kind: "planner_timeout",
            summary: "Planning result timed out",
            requiresHuman: false,
        };
    }

    const failedTask = input.tasks.find((task) => task.status === "failed");
    if (failedTask) {
        return {
            kind: "task_failed",
            summary: `Task failed: ${failedTask.title ?? failedTask.id}`,
            sourceTaskId: failedTask.id,
            requiresHuman: false,
        };
    }

    return buildAgentMessageBlockerSummary(input.agentMessages, input.tasks);
}
