/**
 * Create a Decision and associated InboxItem.
 * Fire-and-forget — caller should `void decisionCreate(...)` or await if needed.
 */

import { db } from "@/storage/db";
import { inboxCreate } from "./inboxCreate";
import { worldSuggestionRefresh } from "./worldSuggestionGenerate";

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

export async function decisionCreate(input: DecisionCreateInput): Promise<{ id: string }> {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

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

    // Create high-priority InboxItem
    void inboxCreate({
        accountId: input.accountId,
        category: "decision",
        eventType: "decision.created",
        severity: "warning",
        title: input.question.length > 80 ? `${input.question.substring(0, 77)}...` : input.question,
        body: input.agentRole ? `From: ${input.agentRole}` : undefined,
        referenceUrl: `/decision/${decision.id}`,
        refType: "decision",
        refId: decision.id,
        groupKey: `decision:${decision.id}:created`,
    });
    void worldSuggestionRefresh(input.accountId, input.projectId);

    return { id: decision.id };
}
