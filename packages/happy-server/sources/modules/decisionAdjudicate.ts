/**
 * Adjudicate a Decision: update status, create Knowledge precedent, notify.
 */

import { db } from "@/storage/db";
import { inboxCreate } from "./inboxCreate";
import { log } from "@/utils/log";

interface AdjudicateInput {
    decisionId: string;
    accountId: string;
    chosenOption: string;
    rationale?: string;
}

interface AdjudicateResult {
    decision: { id: string; status: string; knowledgeId: string | null };
}

export async function decisionAdjudicate(input: AdjudicateInput): Promise<AdjudicateResult> {
    const decision = await db.decision.findFirst({
        where: { id: input.decisionId, accountId: input.accountId, status: "pending" },
    });

    if (!decision) {
        throw new Error("Decision not found or already resolved");
    }

    // Parse options to get chosen option description
    let chosenDesc = input.chosenOption;
    try {
        const options = JSON.parse(decision.options) as Array<{ id: string; description: string }>;
        const chosen = options.find((o) => o.id === input.chosenOption);
        if (chosen) {
            chosenDesc = chosen.description;
        }
    } catch {
        // best effort
    }

    // Build precedent content
    const precedentContent = [
        `## Question`,
        decision.question,
        "",
        `## Decision`,
        `**Chosen**: ${chosenDesc}`,
        input.rationale ? `**Rationale**: ${input.rationale}` : "",
        "",
        decision.context ? `## Context\n${decision.context}` : "",
    ].filter(Boolean).join("\n");

    const precedentTitle = decision.question.length > 100
        ? `${decision.question.substring(0, 97)}...`
        : decision.question;

    // Create Knowledge precedent entry
    const knowledge = await db.projectKnowledge.create({
        data: {
            projectId: decision.projectId,
            entryType: "decision",
            category: "project",
            contributorType: "user",
            action: "create",
            status: "active",
            title: precedentTitle,
            content: precedentContent,
            tags: JSON.stringify(["precedent", ...(decision.precedentKey ? [decision.precedentKey] : [])]),
            confidence: "high",
            pinned: true,
        },
    });

    // Update Decision
    const updated = await db.decision.update({
        where: { id: decision.id },
        data: {
            status: "decided",
            chosenOption: input.chosenOption,
            rationale: input.rationale ?? null,
            knowledgeId: knowledge.id,
            decidedAt: new Date(),
        },
    });

    // Mark related inbox items as read
    await db.inboxItem.updateMany({
        where: {
            accountId: input.accountId,
            refType: "decision",
            refId: decision.id,
            read: false,
        },
        data: { read: true },
    });

    log({ module: "decision" }, `Decision ${decision.id} adjudicated → option "${input.chosenOption}", precedent ${knowledge.id}`);

    return {
        decision: {
            id: updated.id,
            status: updated.status,
            knowledgeId: knowledge.id,
        },
    };
}
