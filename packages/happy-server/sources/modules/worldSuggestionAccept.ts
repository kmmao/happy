/**
 * Accept a WorldSuggestion — create the real entity and mark as accepted.
 */

import { db } from "@/storage/db";
import { inTx, afterTx } from "@/storage/inTx";
import { goalCreate } from "./goalCreate";
import {
    eventRouter,
    buildWorldSuggestionUpdatedEphemeral,
    buildTaskTriggerEphemeral,
} from "@/app/events/eventRouter";
import { SuggestionPayloadSchema } from "./worldSuggestionTypes";

interface AcceptInput {
    accountId: string;
    projectId: string;
    suggestionId: string;
    machineId?: string;
    priorityOverride?: string;
    roleOverride?: string;
}

interface AcceptResult {
    suggestionId: string;
    createdEntityType: "goal" | "task" | "skill";
    createdEntityId: string;
    machineId?: string;
}

export async function worldSuggestionAccept(input: AcceptInput): Promise<AcceptResult> {
    const { accountId, projectId, suggestionId, machineId, priorityOverride, roleOverride } = input;

    // Resolve machineId early — needed for Goal/Task creation
    const resolvedMachineId = machineId ?? await findActiveMachine(accountId, projectId);
    if (!resolvedMachineId) {
        throw new Error("No active machine found for this project. Please specify a machineId.");
    }

    // Load project path for task dispatch
    const project = await db.project.findFirst({
        where: { id: projectId, accountId },
        select: { path: true },
    });

    // For suggested_goal, goalCreate has its own transaction and dispatch logic
    // so we handle it outside inTx to avoid nested transaction issues
    const suggestion = await db.worldSuggestion.findFirst({
        where: { id: suggestionId, accountId, projectId, status: "open" },
    });
    if (!suggestion) {
        throw new Error("Suggestion not found or already acted upon");
    }

    const payload = SuggestionPayloadSchema.parse(JSON.parse(suggestion.payload));

    if (suggestion.type === "suggested_goal" && payload.goal) {
        // goalCreate manages its own transaction + planner dispatch
        const result = await goalCreate({
            accountId,
            projectId,
            machineId: resolvedMachineId,
            title: payload.goal.title,
            description: payload.goal.detail,
            priority: priorityOverride ?? payload.goal.priority ?? "normal",
            autoDecompose: true,
        });

        // Mark suggestion as accepted (separate from goalCreate tx)
        await db.worldSuggestion.update({
            where: { id: suggestionId },
            data: { status: "accepted", actedAt: new Date() },
        });

        eventRouter.emitEphemeral({
            userId: accountId,
            payload: buildWorldSuggestionUpdatedEphemeral({ projectId, suggestionId, status: "accepted" }),
            recipientFilter: { type: "user-scoped-only" },
        });

        return {
            suggestionId,
            createdEntityType: "goal",
            createdEntityId: result.id,
            machineId: resolvedMachineId,
        };
    }

    if (suggestion.type === "suggested_task" && payload.task) {
        // Use inTx for task creation + suggestion status update atomicity
        const result = await inTx(async (tx) => {
            // Re-check status inside transaction to prevent TOCTOU
            const fresh = await tx.worldSuggestion.findFirst({
                where: { id: suggestionId, accountId, projectId, status: "open" },
                select: { id: true },
            });
            if (!fresh) {
                throw new Error("Suggestion not found or already acted upon");
            }

            const task = await tx.task.create({
                data: {
                    accountId,
                    projectId,
                    machineId: resolvedMachineId,
                    prompt: payload.task!.prompt,
                    title: payload.task!.title,
                    priority: priorityOverride ?? payload.task!.priority ?? "user",
                    roleType: roleOverride ?? payload.task!.roleType ?? null,
                    goalId: payload.task!.goalId ?? suggestion.relatedGoalId ?? null,
                    triggerType: "manual",
                    status: "dispatching",
                    maxAttempts: 3,
                },
            });

            await tx.worldSuggestion.update({
                where: { id: suggestionId },
                data: { status: "accepted", actedAt: new Date() },
            });

            // Dispatch task to CLI after transaction commits
            afterTx(tx, () => {
                eventRouter.emitEphemeral({
                    userId: accountId,
                    payload: buildTaskTriggerEphemeral({
                        taskId: task.id,
                        prompt: payload.task!.prompt,
                        directory: project?.path ?? "",
                        priority: task.priority,
                        projectId,
                    }),
                    recipientFilter: { type: "machine-scoped-only", machineId: resolvedMachineId },
                });

                eventRouter.emitEphemeral({
                    userId: accountId,
                    payload: buildWorldSuggestionUpdatedEphemeral({ projectId, suggestionId, status: "accepted" }),
                    recipientFilter: { type: "user-scoped-only" },
                });
            });

            return {
                suggestionId,
                createdEntityType: "task" as const,
                createdEntityId: task.id,
                machineId: resolvedMachineId,
            };
        });

        return result;
    }

    if (suggestion.type === "suggested_skill" && payload.skill) {
        const result = await inTx(async (tx) => {
            const fresh = await tx.worldSuggestion.findFirst({
                where: { id: suggestionId, accountId, projectId, status: "open" },
                select: { id: true },
            });
            if (!fresh) {
                throw new Error("Suggestion not found or already acted upon");
            }

            const skill = await tx.skill.create({
                data: {
                    accountId,
                    projectId,
                    name: payload.skill!.title,
                    content: payload.skill!.content,
                    archived: false,
                },
            });

            await tx.worldSuggestion.update({
                where: { id: suggestionId },
                data: { status: "accepted", actedAt: new Date() },
            });

            afterTx(tx, () => {
                eventRouter.emitEphemeral({
                    userId: accountId,
                    payload: buildWorldSuggestionUpdatedEphemeral({ projectId, suggestionId, status: "accepted" }),
                    recipientFilter: { type: "user-scoped-only" },
                });
            });

            return {
                suggestionId,
                createdEntityType: "skill" as const,
                createdEntityId: skill.id,
                machineId: resolvedMachineId,
            };
        });

        return result;
    }

    throw new Error(`Invalid suggestion type or missing payload for type: ${suggestion.type}`);
}

async function findActiveMachine(accountId: string, projectId: string): Promise<string | null> {
    // Find the machine that most recently had a task in this project
    const recentTask = await db.task.findFirst({
        where: { accountId, projectId },
        orderBy: { updatedAt: "desc" },
        select: { machineId: true },
    });
    if (recentTask) return recentTask.machineId;

    // Fallback: find the machine associated with this project
    const project = await db.project.findFirst({
        where: { id: projectId, accountId },
        select: { machineId: true },
    });
    return project?.machineId ?? null;
}
