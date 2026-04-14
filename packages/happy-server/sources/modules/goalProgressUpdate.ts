/**
 * Update Goal progress when a related Task reaches a terminal state.
 * Recursively updates parent goals.
 * Fire-and-forget — caller should `void goalProgressUpdate(...)`.
 */

import { db } from "@/storage/db";
import { inboxNotifyMembers } from "./inboxNotifyMembers";
import { eventRouter, buildGoalProgressEphemeral } from "@/app/events/eventRouter";
import { log } from "@/utils/log";
import { truncateText, TEXT_LIMITS } from "./worldConstants";
import { classifyGoalLayer } from "./goalHealthEngine";

const MAX_RECURSION_DEPTH = 5;

interface GoalProgressInput {
    goalId: string;
    accountId: string;
}

export async function goalProgressUpdate(input: GoalProgressInput, depth: number = 0): Promise<void> {
    if (depth >= MAX_RECURSION_DEPTH) {
        log({ module: "goal", level: "error" }, `Max recursion depth reached for goal ${input.goalId}`);
        return;
    }

    try {
        const goal = await db.goal.findFirst({
            where: { id: input.goalId, accountId: input.accountId },
            select: {
                id: true,
                accountId: true,
                projectId: true,
                title: true,
                status: true,
                parentGoalId: true,
                plannerTaskId: true,
                _count: { select: { subGoals: true } },
            },
        });

        if (!goal) return;

        // Don't update cancelled/completed goals
        if (goal.status === "cancelled" || goal.status === "completed") return;

        // Count tasks (exclude the planner task itself from progress calculation)
        const where: Record<string, unknown> = { goalId: goal.id };
        if (goal.plannerTaskId) {
            where.id = { not: goal.plannerTaskId };
        }

        const tasks = await db.task.findMany({
            where,
            select: { status: true },
        });

        if (tasks.length === 0) return;

        // Calculate progress
        const completedCount = tasks.filter((t) => t.status === "completed").length;
        const failedCount = tasks.filter((t) => t.status === "failed").length;
        const cancelledCount = tasks.filter((t) => t.status === "cancelled").length;
        const terminalCount = completedCount + failedCount + cancelledCount;
        const progress = Math.round((completedCount / tasks.length) * 100);

        // Determine status
        let newStatus: string;
        if (completedCount === tasks.length) {
            newStatus = "completed";
        } else if (cancelledCount === tasks.length) {
            newStatus = "cancelled";
        } else if (failedCount > 0 && terminalCount === tasks.length) {
            // All tasks are terminal but some failed
            newStatus = "blocked";
        } else if (terminalCount > 0 || tasks.some((t) => t.status === "running")) {
            newStatus = "in_progress";
        } else {
            newStatus = goal.status; // Keep current status
        }

        // Update goal (manage blockedSince for health aging detection + layer)
        const wasBlocked = goal.status === "blocked";
        const becomesBlocked = newStatus === "blocked";
        const blockedSinceUpdate: { blockedSince?: Date | null } =
            !wasBlocked && becomesBlocked ? { blockedSince: new Date() }
            : wasBlocked && !becomesBlocked ? { blockedSince: null }
            : {};

        const layer = classifyGoalLayer({
            parentGoalId: goal.parentGoalId,
            subGoalCount: goal._count.subGoals,
            taskCount: tasks.length,
        });

        await db.goal.update({
            where: { id: goal.id },
            data: { progress, status: newStatus, layer, ...blockedSinceUpdate },
        });

        // Emit ephemeral to App
        eventRouter.emitEphemeral({
            userId: goal.accountId,
            payload: buildGoalProgressEphemeral({
                goalId: goal.id,
                projectId: goal.projectId,
                status: newStatus,
                progress,
            }),
            recipientFilter: { type: "user-scoped-only" },
        });

        // Notify on completion
        if (newStatus === "completed" && goal.status !== "completed") {
            void inboxNotifyMembers({
                accountId: goal.accountId,
                projectId: goal.projectId,
                category: "goal",
                eventType: "goal.completed",
                severity: "info",
                title: `Goal completed: ${truncateText(goal.title, TEXT_LIMITS.TASK_LABEL)}`,
                body: `All ${tasks.length} tasks finished`,
                referenceUrl: `/project/${goal.projectId}/goals/${goal.id}`,
                refType: "goal",
                refId: goal.id,
                groupKey: `goal:${goal.id}:completed`,
            });
        }

        // Recursively update parent goal
        if (goal.parentGoalId) {
            await goalProgressUpdate(
                { goalId: goal.parentGoalId, accountId: goal.accountId },
                depth + 1,
            );
        }

        log({ module: "goal" }, `Goal ${goal.id} progress → ${progress}% (${newStatus})`);
    } catch (err) {
        log({ module: "goal", level: "error" }, `Failed to update goal progress: ${err}`);
    }
}
