/**
 * Veto an auto-accepted suggestion within the 1-hour veto window.
 *
 * Supported suggestion types:
 *   suggested_task    — cancels the created Task
 *   suggested_goal    — cancels the created Goal
 *   suggested_decision — reverts the Decision back to "pending"
 *
 * Each veto creates an audit InboxItem.
 */

import { db } from "@/storage/db";
import { inboxCreate } from "./inboxCreate";
import { TIME_MS } from "./worldConstants";

export const VETO_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface VetoInput {
    accountId: string;
    projectId: string;
    suggestionId: string;
}

interface VetoResult {
    vetoed: boolean;
    reason?: string;
}

export async function vetoWorldSuggestion(input: VetoInput): Promise<VetoResult> {
    const { accountId, projectId, suggestionId } = input;

    const suggestion = await db.worldSuggestion.findFirst({
        where: {
            id: suggestionId,
            accountId,
            projectId,
            status: "accepted",
            acceptSource: "system_auto",
        },
    });

    if (!suggestion) {
        return { vetoed: false, reason: "Suggestion not found or was not auto-accepted" };
    }

    // Enforce veto window
    if (suggestion.actedAt) {
        const elapsed = Date.now() - suggestion.actedAt.getTime();
        if (elapsed > VETO_WINDOW_MS) {
            return { vetoed: false, reason: "Veto window has expired (1 hour)" };
        }
    }

    const rawPayload = safeParseJson(suggestion.payload);

    if (suggestion.type === "suggested_task") {
        // Find the task created from this suggestion via dedupeKey match
        const task = await db.task.findFirst({
            where: {
                accountId,
                projectId,
                triggerType: "suggestion_auto",
                status: { in: ["dispatching", "queued", "running"] },
                createdAt: suggestion.actedAt
                    ? { gte: new Date(suggestion.actedAt.getTime() - 5_000) }
                    : undefined,
            },
            orderBy: { createdAt: "desc" },
        });

        if (task) {
            await db.task.update({
                where: { id: task.id },
                data: { status: "cancelled", errorMessage: "Vetoed by user" },
            });
        }

        await markSuggestionVetoed(suggestionId);
        await emitVetoAudit({ accountId, suggestionId, type: suggestion.type, title: suggestion.title });
        return { vetoed: true };
    }

    if (suggestion.type === "suggested_goal") {
        // Find the goal created from this suggestion
        const goalPayload = ("goal" in rawPayload && typeof rawPayload.goal === "object" && rawPayload.goal !== null)
            ? rawPayload.goal as { title?: string }
            : null;
        const goalTitle = goalPayload?.title ?? "";

        if (goalTitle) {
            const goal = await db.goal.findFirst({
                where: {
                    accountId,
                    projectId,
                    title: goalTitle,
                    status: { notIn: ["completed", "cancelled"] },
                    createdAt: suggestion.actedAt
                        ? { gte: new Date(suggestion.actedAt.getTime() - 5_000) }
                        : undefined,
                },
                orderBy: { createdAt: "desc" },
            });

            if (goal) {
                await db.goal.update({
                    where: { id: goal.id },
                    data: { status: "cancelled" },
                });
            }
        }

        await markSuggestionVetoed(suggestionId);
        await emitVetoAudit({ accountId, suggestionId, type: suggestion.type, title: suggestion.title });
        return { vetoed: true };
    }

    if (suggestion.type === "suggested_decision") {
        // Revert auto-resolved decision to pending
        const decisionPayload = ("decision" in rawPayload && typeof rawPayload.decision === "object" && rawPayload.decision !== null)
            ? rawPayload.decision as { existingDecisionId?: string }
            : null;

        const decisionId = decisionPayload?.existingDecisionId;
        if (decisionId) {
            const decision = await db.decision.findFirst({
                where: { id: decisionId, accountId, projectId, status: "auto_resolved" },
            });
            if (decision) {
                await db.decision.update({
                    where: { id: decisionId },
                    data: {
                        status: "pending",
                        chosenOption: null,
                        rationale: null,
                        knowledgeId: null,
                        decidedAt: null,
                        expiresAt: new Date(Date.now() + TIME_MS.DAY),
                    },
                });
            }
        }

        await markSuggestionVetoed(suggestionId);
        await emitVetoAudit({ accountId, suggestionId, type: suggestion.type, title: suggestion.title });
        return { vetoed: true };
    }

    return { vetoed: false, reason: `Veto not supported for type: ${suggestion.type}` };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function markSuggestionVetoed(suggestionId: string): Promise<void> {
    await db.worldSuggestion.update({
        where: { id: suggestionId },
        data: { status: "dismissed" } as any,
    });
}

async function emitVetoAudit(input: {
    accountId: string;
    suggestionId: string;
    type: string;
    title: string;
}): Promise<void> {
    void inboxCreate({
        accountId: input.accountId,
        category: "system",
        eventType: "suggestion.vetoed",
        severity: "info",
        title: `Vetoed auto-action: ${input.title}`,
        body: `Auto-accepted ${input.type} was vetoed by user`,
        refType: "world_suggestion",
        refId: input.suggestionId,
        groupKey: `suggestion:${input.suggestionId}:vetoed`,
    });
}

function safeParseJson(raw: string): Record<string, unknown> {
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return {};
    }
}
