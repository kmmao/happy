/**
 * Create a Decision and associated InboxItem.
 * Fire-and-forget — caller should `void decisionCreate(...)` or await if needed.
 */

import { db } from "@/storage/db";
import { inboxCreate } from "./inboxCreate";
import { truncateText, TEXT_LIMITS, TIME_MS } from "./worldConstants";
import { worldSuggestionRefresh } from "./worldSuggestionGenerate";
import { matchPrecedent } from "./decisionMatch";
import { canAutoResolveDecision, autoResolveDecision } from "./decisionAutoResolve";
import { resolveWorldAutonomyPolicy } from "./worldSuggestionAutoAccept";
import { routeDecision } from "./decisionRoute";

interface DecisionCreateInput {
    accountId: string;
    projectId: string;
    question: string;
    options: string;        // JSON array: [{id, description, pros, cons}]
    context?: string;
    precedentKey?: string;
    goalId?: string;
    agentRole?: string;
    sessionId?: string;
    loopId?: string;
}

export async function decisionCreate(input: DecisionCreateInput): Promise<{ id: string; autoResolved?: boolean }> {
    const expiresAt = new Date(Date.now() + TIME_MS.DAY);

    const decision = await db.decision.create({
        data: {
            accountId: input.accountId,
            projectId: input.projectId,
            question: input.question,
            options: input.options,
            context: input.context ?? null,
            precedentKey: input.precedentKey ?? null,
            goalId: input.goalId ?? null,
            agentRole: input.agentRole ?? null,
            sessionId: input.sessionId ?? null,
            loopId: input.loopId ?? null,
            expiresAt,
        },
    });

    // Attempt precedent-based auto-resolution before creating Inbox noise
    if (input.precedentKey) {
        const project = await db.project.findUnique({
            where: { id: input.projectId },
            select: { supervisorMode: true, supervisorConfig: true },
        });

        const policy = resolveWorldAutonomyPolicy({
            supervisorMode: project?.supervisorMode ?? null,
            supervisorConfig: project?.supervisorConfig ?? null,
        });

        const precedent = await matchPrecedent(input.projectId, input.precedentKey, input.question);

        if (precedent) {
            let parsedOptions: Array<{ id: string; description: string }> = [];
            try { parsedOptions = JSON.parse(input.options); } catch { /* keep empty */ }

            const check = canAutoResolveDecision({ policy, precedent, decisionOptions: parsedOptions });

            if (check.allowed) {
                const result = await autoResolveDecision({
                    accountId: input.accountId,
                    projectId: input.projectId,
                    decisionId: decision.id,
                    precedent,
                });

                if (result.resolved) {
                    return { id: decision.id, autoResolved: true };
                }
            }
        }
    }

    // Route decision to the best-matching WorldMember
    const route = await routeDecision(input.projectId, input.question, input.context);
    if (route.memberId) {
        await db.decision.update({
            where: { id: decision.id },
            data: {
                assignedTo: route.memberId,
                assignHistory: JSON.stringify([{
                    memberId: route.memberId,
                    assignedAt: new Date().toISOString(),
                    reason: route.reason,
                }]),
            },
        });
    }

    // Notify the assigned member (or the project owner if no routing)
    const notifyAccountId = route.memberAccountId ?? input.accountId;
    void inboxCreate({
        accountId: notifyAccountId,
        category: "decision",
        eventType: "decision.created",
        severity: "warning",
        title: truncateText(input.question, TEXT_LIMITS.TITLE),
        body: input.agentRole ? `From: ${input.agentRole}` : undefined,
        referenceUrl: `/decision/${decision.id}`,
        refType: "decision",
        refId: decision.id,
        groupKey: `decision:${decision.id}:created`,
    });
    void worldSuggestionRefresh(input.accountId, input.projectId);

    return { id: decision.id };
}
