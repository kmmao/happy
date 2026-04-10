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
import { auth } from "@/app/auth/auth";

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
    createdEntityType: "goal" | "task" | "skill" | "decision";
    createdEntityId: string;
    machineId?: string;
}

export async function worldSuggestionAccept(input: AcceptInput): Promise<AcceptResult> {
    const { accountId, projectId, suggestionId, machineId, priorityOverride, roleOverride } = input;

    // Load project path for task dispatch
    const project = await db.project.findFirst({
        where: { id: projectId, accountId },
        select: { path: true },
    });

    const suggestion = await db.worldSuggestion.findFirst({
        where: { id: suggestionId, accountId, projectId, status: { in: ["open", "suspended"] } },
    });
    if (!suggestion) {
        throw new Error("Suggestion not found or already acted upon");
    }

    const payload = SuggestionPayloadSchema.parse(JSON.parse(suggestion.payload));

    if (suggestion.type === "suggested_goal" && payload.goal) {
        const resolvedMachineId = machineId ?? await findActiveMachine(accountId, projectId);
        if (!resolvedMachineId) {
            throw new Error("No active machine found for this project. Please specify a machineId.");
        }

        await inTx(async (tx) => {
            const fresh = await tx.worldSuggestion.findFirst({
                where: { id: suggestionId, accountId, projectId, status: { in: ["open", "suspended"] } },
                select: { id: true },
            });
            if (!fresh) {
                throw new Error("Suggestion not found or already acted upon");
            }

            await tx.worldSuggestion.update({
                where: { id: suggestionId },
                data: { status: "processing", actedAt: new Date() },
            });
        });

        eventRouter.emitEphemeral({
            userId: accountId,
            payload: buildWorldSuggestionUpdatedEphemeral({ projectId, suggestionId, status: "processing" }),
            recipientFilter: { type: "user-scoped-only" },
        });

        try {
            const result = await goalCreate({
                accountId,
                projectId,
                machineId: resolvedMachineId,
                title: payload.goal.title,
                description: payload.goal.detail,
                priority: priorityOverride ?? payload.goal.priority ?? "normal",
                autoDecompose: true,
            });

            await db.worldSuggestion.update({
                where: { id: suggestionId },
                data: { status: "accepted" },
            });

            eventRouter.emitEphemeral({
                userId: accountId,
                payload: buildWorldSuggestionUpdatedEphemeral({ projectId, suggestionId, status: "accepted" }),
                recipientFilter: { type: "user-scoped-only" },
            });

            return {
                suggestionId,
                createdEntityType: "goal" as const,
                createdEntityId: result.id,
                machineId: resolvedMachineId,
            };
        } catch (error) {
            await db.worldSuggestion.update({
                where: { id: suggestionId },
                data: { status: "suspended" },
            });

            eventRouter.emitEphemeral({
                userId: accountId,
                payload: buildWorldSuggestionUpdatedEphemeral({ projectId, suggestionId, status: "suspended" }),
                recipientFilter: { type: "user-scoped-only" },
            });
            throw error;
        }
    }

    if (suggestion.type === "suggested_task" && payload.task) {
        const resolvedMachineId = machineId ?? await findActiveMachine(accountId, projectId);
        if (!resolvedMachineId) {
            throw new Error("No active machine found for this project. Please specify a machineId.");
        }

        // Use inTx for task creation + suggestion status update atomicity
        const result = await inTx(async (tx) => {
            // Re-check status inside transaction to prevent TOCTOU
            const fresh = await tx.worldSuggestion.findFirst({
                where: { id: suggestionId, accountId, projectId, status: { in: ["open", "suspended"] } },
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

            // Dispatch task to CLI after transaction commits.
            afterTx(tx, () => {
                void (async () => {
                    try {
                        const resultToken = await auth.createTaskResultToken({
                            userId: accountId,
                            taskId: task.id,
                        });
                        eventRouter.emitEphemeral({
                            userId: accountId,
                            payload: buildTaskTriggerEphemeral({
                                taskId: task.id,
                                prompt: payload.task!.prompt,
                                directory: project?.path ?? "",
                                priority: task.priority,
                                projectId,
                                resultToken,
                            }),
                            recipientFilter: { type: "machine-scoped-only", machineId: resolvedMachineId },
                        });
                    } catch (error) {
                        const message = error instanceof Error ? error.message : "Unknown dispatch error";
                        await db.task.update({
                            where: { id: task.id },
                            data: { status: "failed", errorMessage: `Task dispatch failed: ${message}` },
                        });
                    }
                })();

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
                where: { id: suggestionId, accountId, projectId, status: { in: ["open", "suspended"] } },
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
            };
        });

        return result;
    }

    if (suggestion.type === "suggested_decision" && payload.decision) {
        const decisionPayload = payload.decision;
        const result = await inTx(async (tx) => {
            const fresh = await tx.worldSuggestion.findFirst({
                where: { id: suggestionId, accountId, projectId, status: { in: ["open", "suspended"] } },
                select: { id: true },
            });
            if (!fresh) {
                throw new Error("Suggestion not found or already acted upon");
            }

            const decisionId = decisionPayload.existingDecisionId
                ? await reopenExistingDecision(tx, {
                    accountId,
                    projectId,
                    decisionId: decisionPayload.existingDecisionId,
                })
                : (await tx.decision.create({
                    data: {
                        accountId,
                        projectId,
                        question: decisionPayload.question,
                        options: JSON.stringify(decisionPayload.options),
                        context: decisionPayload.context ?? null,
                        precedentKey: decisionPayload.precedentKey ?? null,
                        goalId: decisionPayload.goalId ?? suggestion.relatedGoalId ?? null,
                        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                    },
                })).id;

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
                createdEntityType: "decision" as const,
                createdEntityId: decisionId,
            };
        });

        return result;
    }

    throw new Error(`Invalid suggestion type or missing payload for type: ${suggestion.type}`);
}

async function reopenExistingDecision(tx: { decision: { findFirst: typeof db.decision.findFirst; update: typeof db.decision.update } }, input: {
    accountId: string;
    projectId: string;
    decisionId: string;
}): Promise<string> {
    const decision = await tx.decision.findFirst({
        where: {
            id: input.decisionId,
            accountId: input.accountId,
            projectId: input.projectId,
            status: { in: ["pending", "expired"] },
        },
        select: { id: true, status: true },
    });
    if (!decision) {
        throw new Error("Decision not found or no longer pending");
    }
    if (decision.status === "expired") {
        await tx.decision.update({
            where: { id: decision.id },
            data: {
                status: "pending",
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
        });
    }
    return decision.id;
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
