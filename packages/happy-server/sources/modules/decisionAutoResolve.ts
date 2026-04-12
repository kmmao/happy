/**
 * Decision auto-resolution via precedent matching.
 *
 * When a new Decision is created and the WorldAutonomyPolicy allows it, this
 * module can automatically resolve the decision using a matching precedent
 * — bypassing the human Inbox step entirely.
 *
 * Iron law: all auto actions are audited (InboxItem) and can be vetoed.
 */

import type { WorldAutonomyPolicy } from "@kmmao/happy-wire";
import type { PrecedentMatch } from "./decisionMatch";
import { db } from "@/storage/db";
import { inboxCreate } from "./inboxCreate";
import { worldSuggestionRefresh } from "./worldSuggestionGenerate";

interface DecisionOption {
    id: string;
    description: string;
}

// ---------------------------------------------------------------------------
// Pure function: eligibility check
// ---------------------------------------------------------------------------

/**
 * Returns whether the given policy + precedent allow automatic resolution.
 *
 * Rules (all must hold):
 *  1. policy.level is "semi-auto" or "auto"
 *  2. "suggested_decision" is in policy.autoAcceptTypes
 *  3. precedent.chosenOption is present in the decision's option list
 */
export function canAutoResolveDecision(input: {
    policy: WorldAutonomyPolicy;
    precedent: PrecedentMatch;
    decisionOptions: DecisionOption[];
}): { allowed: boolean; reason: string } {
    const { policy, precedent, decisionOptions } = input;

    if (policy.level === "disabled" || policy.level === "suggest") {
        return { allowed: false, reason: `policy level "${policy.level}" does not permit auto-resolution` };
    }

    if (!policy.autoAcceptTypes.includes("suggested_decision")) {
        return { allowed: false, reason: '"suggested_decision" not in autoAcceptTypes' };
    }

    const optionIds = decisionOptions.map((o) => o.id);
    if (!optionIds.includes(precedent.chosenOption)) {
        return {
            allowed: false,
            reason: `precedent chosenOption "${precedent.chosenOption}" not found in current options [${optionIds.join(", ")}]`,
        };
    }

    return { allowed: true, reason: `precedent ${precedent.decisionId} matched and policy is ${policy.level}` };
}

// ---------------------------------------------------------------------------
// Async function: perform auto-resolution
// ---------------------------------------------------------------------------

interface AutoResolveInput {
    accountId: string;
    projectId: string;
    decisionId: string;
    precedent: PrecedentMatch;
}

interface AutoResolveResult {
    resolved: boolean;
    knowledgeId: string | null;
}

/**
 * Execute auto-resolution: flip Decision to "auto_resolved", write a
 * Knowledge precedent, and emit an audit InboxItem (severity: info).
 */
export async function autoResolveDecision(input: AutoResolveInput): Promise<AutoResolveResult> {
    const { accountId, projectId, decisionId, precedent } = input;

    const decision = await db.decision.findFirst({
        where: { id: decisionId, accountId, projectId, status: "pending" },
    });

    if (!decision) {
        return { resolved: false, knowledgeId: null };
    }

    // Parse options to get description for the chosen option
    let chosenDesc = precedent.chosenOption;
    try {
        const options = JSON.parse(decision.options) as DecisionOption[];
        const chosen = options.find((o) => o.id === precedent.chosenOption);
        if (chosen) chosenDesc = chosen.description;
    } catch {
        // Keep chosenDesc as the option id
    }

    const rationale = `[Auto: precedent ${precedent.decisionId}] ${precedent.rationale ?? "matched precedent applied"}`;

    // Build precedent content (same format as manual adjudication)
    const precedentContent = [
        `## Question`,
        decision.question,
        "",
        `## Decision`,
        `**Chosen**: ${chosenDesc}`,
        `**Rationale**: ${rationale}`,
        "",
        decision.context ? `## Context\n${decision.context}` : "",
    ].filter(Boolean).join("\n");

    const precedentTitle = decision.question.length > 100
        ? `${decision.question.substring(0, 97)}...`
        : decision.question;

    // Create Knowledge precedent
    const knowledge = await db.projectKnowledge.create({
        data: {
            projectId,
            entryType: "decision",
            category: "project",
            contributorType: "user",
            action: "create",
            status: "active",
            title: precedentTitle,
            content: precedentContent,
            tags: JSON.stringify(["precedent", "auto_resolved", ...(decision.precedentKey ? [decision.precedentKey] : [])]),
            confidence: "high",
            pinned: false,
        },
    });

    // Update Decision to auto_resolved
    await db.decision.update({
        where: { id: decisionId },
        data: {
            status: "auto_resolved",
            chosenOption: precedent.chosenOption,
            rationale,
            knowledgeId: knowledge.id,
            decidedAt: new Date(),
        },
    });

    // Mark related inbox items as read
    await db.inboxItem.updateMany({
        where: { accountId, refType: "decision", refId: decisionId, read: false },
        data: { read: true },
    });

    // Audit InboxItem (info severity — visible but not alarming)
    void inboxCreate({
        accountId,
        category: "system",
        eventType: "decision.auto_resolved",
        severity: "info",
        title: `Auto-resolved: ${precedentTitle}`,
        body: `Precedent applied: "${precedent.question}" → ${chosenDesc}`,
        referenceUrl: `/decision/${decisionId}`,
        refType: "decision",
        refId: decisionId,
        groupKey: `decision:${decisionId}:auto_resolved`,
    });

    void worldSuggestionRefresh(accountId, projectId);

    return { resolved: true, knowledgeId: knowledge.id };
}
