/**
 * Adjudicate a Decision: update status, create Knowledge precedent, notify.
 */

import { db } from "@/storage/db";
import { lawSuggestionApply } from "./lawSuggestionApply";
import { log } from "@/utils/log";
import { worldSuggestionRefresh } from "./worldSuggestionGenerate";

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
        if (!chosen) {
            throw new Error("Invalid decision option");
        }
        chosenDesc = chosen.description;
    } catch (error) {
        if (error instanceof Error && error.message === "Invalid decision option") {
            throw error;
        }
        throw new Error("Decision options are invalid");
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

    void worldSuggestionRefresh(input.accountId, decision.projectId);

    // Post-adjudication: handle law_suggestion approval
    void handleLawSuggestionIfApproved(decision.id, decision.projectId, input.accountId, input.chosenOption);

    return {
        decision: {
            id: updated.id,
            status: updated.status,
            knowledgeId: knowledge.id,
        },
    };
}

/**
 * If this Decision was created from a law_suggestion AgentMessage and the
 * chosen option is "approve", apply the suggested law to the project.
 */
async function handleLawSuggestionIfApproved(
    decisionId: string,
    projectId: string,
    accountId: string,
    chosenOption: string,
): Promise<void> {
    try {
        if (chosenOption !== "approve") return;

        const agentMessage = await db.agentMessage.findFirst({
            where: { decisionId, msgType: "law_suggestion" },
            select: { id: true, content: true },
        });

        if (!agentMessage) return;

        await lawSuggestionApply(projectId, accountId, agentMessage.content);

        await db.agentMessage.update({
            where: { id: agentMessage.id },
            data: { status: "resolved" },
        });

        log({ module: "decision" }, `Law suggestion ${agentMessage.id} approved and applied`);
    } catch (err) {
        log({ module: "decision", level: "error" }, `Failed to handle law suggestion post-adjudication: ${err}`);
    }
}
