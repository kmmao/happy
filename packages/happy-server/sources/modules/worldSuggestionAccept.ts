/**
 * Accept a WorldSuggestion — create the real entity and mark as accepted.
 */

import { auth } from "@/app/auth/auth";
import {
    eventRouter,
    buildTaskTriggerEphemeral,
    buildWorldSuggestionUpdatedEphemeral,
} from "@/app/events/eventRouter";
import { db } from "@/storage/db";
import { afterTx, inTx } from "@/storage/inTx";
import { goalCreate } from "./goalCreate";
import { validateSuggestionPayload } from "./worldSuggestionTypes";

type AcceptSource = "human" | "system_auto";

interface AcceptInput {
    accountId: string;
    projectId: string;
    suggestionId: string;
    machineId?: string;
    priorityOverride?: string;
    roleOverride?: string;
    acceptSource?: AcceptSource;
}

interface AcceptResult {
    suggestionId: string;
    createdEntityType: "goal" | "task" | "skill" | "decision";
    createdEntityId: string;
    machineId?: string;
}

export async function worldSuggestionAccept(input: AcceptInput): Promise<AcceptResult> {
    const {
        accountId,
        projectId,
        suggestionId,
        machineId,
        priorityOverride,
        roleOverride,
        acceptSource = "human",
    } = input;

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

    const rawPayload = safeParseJson(suggestion.payload);

    if (suggestion.type === "suggested_goal") {
        const payload = validateSuggestionPayload({
            type: suggestion.type,
            rawPayload,
        }) as { goal: { title: string; detail?: string; priority?: string } } | null;
        if (!payload) {
            throw new Error("Suggestion payload does not match suggestion type");
        }
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
                data: { status: "processing", actedAt: new Date(), acceptSource },
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
                data: { status: "accepted", acceptSource },
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

    if (suggestion.type === "suggested_task") {
        const payload = validateSuggestionPayload({
            type: suggestion.type,
            rawPayload,
        }) as { task: { title: string; prompt: string; roleType?: string; goalId?: string; priority?: string } } | null;
        if (!payload) {
            throw new Error("Suggestion payload does not match suggestion type");
        }
        const resolvedMachineId = machineId ?? await findActiveMachine(accountId, projectId);
        if (!resolvedMachineId) {
            throw new Error("No active machine found for this project. Please specify a machineId.");
        }

        return inTx(async (tx) => {
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
                    prompt: payload.task.prompt,
                    title: payload.task.title,
                    priority: priorityOverride ?? payload.task.priority ?? "user",
                    roleType: roleOverride ?? payload.task.roleType ?? null,
                    goalId: payload.task.goalId ?? suggestion.relatedGoalId ?? null,
                    triggerType: acceptSource === "system_auto" ? "suggestion_auto" : "manual",
                    status: "dispatching",
                    maxAttempts: 3,
                },
            });

            await tx.worldSuggestion.update({
                where: { id: suggestionId },
                data: { status: "accepted", actedAt: new Date(), acceptSource },
            });

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
                                prompt: payload.task.prompt,
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
                createdEntityType: "task",
                createdEntityId: task.id,
                machineId: resolvedMachineId,
            };
        });
    }

    if (suggestion.type === "suggested_skill") {
        const payload = validateSuggestionPayload({
            type: suggestion.type,
            rawPayload,
        }) as { skill: { title: string; content: string; sourceTaskId?: string } } | null;
        if (!payload) {
            throw new Error("Suggestion payload does not match suggestion type");
        }
        return inTx(async (tx) => {
            const fresh = await tx.worldSuggestion.findFirst({
                where: { id: suggestionId, accountId, projectId, status: { in: ["open", "suspended"] } },
                select: { id: true },
            });
            if (!fresh) {
                throw new Error("Suggestion not found or already acted upon");
            }

            const baseName = payload.skill.title;
            const fallbackName = suggestion.relatedTaskId ? `${baseName} (${suggestion.relatedTaskId})` : null;
            let skill;
            try {
                skill = await tx.skill.create({
                    data: {
                        accountId,
                        projectId,
                        name: baseName,
                        content: payload.skill.content,
                        archived: false,
                    },
                });
            } catch (error) {
                if (!isUniqueConstraintError(error) || !fallbackName) {
                    throw error;
                }
                skill = await tx.skill.create({
                    data: {
                        accountId,
                        projectId,
                        name: fallbackName,
                        content: payload.skill.content,
                        archived: false,
                    },
                });
            }

            await tx.worldSuggestion.update({
                where: { id: suggestionId },
                data: { status: "accepted", actedAt: new Date(), acceptSource },
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
                createdEntityType: "skill",
                createdEntityId: skill.id,
            };
        });
    }

    if (suggestion.type === "suggested_decision") {
        const payload = validateSuggestionPayload({
            type: suggestion.type,
            rawPayload,
        }) as { decision: { question: string; context?: string; goalId?: string; existingDecisionId?: string; precedentKey?: string; options: Array<{ id: string; description: string; pros?: string; cons?: string }> } } | null;
        if (!payload) {
            throw new Error("Suggestion payload does not match suggestion type");
        }
        const decisionPayload = payload.decision;
        return inTx(async (tx) => {
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
                data: { status: "accepted", actedAt: new Date(), acceptSource },
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
                createdEntityType: "decision",
                createdEntityId: decisionId,
            };
        });
    }

    throw new Error(`Invalid suggestion type or missing payload for type: ${suggestion.type}`);
}

function isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
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
    const recentTask = await db.task.findFirst({
        where: { accountId, projectId },
        orderBy: { updatedAt: "desc" },
        select: { machineId: true },
    });
    if (recentTask) return recentTask.machineId;

    const project = await db.project.findFirst({
        where: { id: projectId, accountId },
        select: { machineId: true },
    });
    return project?.machineId ?? null;
}

function safeParseJson(raw: string): Record<string, unknown> {
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return {};
    }
}
