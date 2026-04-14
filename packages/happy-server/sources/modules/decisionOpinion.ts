/**
 * Decision opinions: allows multiple WorldMembers to weigh in
 * before the final adjudication. When opinions conflict, the
 * system can escalate to a higher-authority member.
 */

import { db } from "@/storage/db";
import { inboxCreate } from "./inboxCreate";
import { truncateText, TEXT_LIMITS } from "./worldConstants";
import { log } from "@/utils/log";

interface Opinion {
    memberId: string;
    accountId: string;
    chosenOption: string;
    rationale: string | null;
    createdAt: string;
}

interface AddOpinionInput {
    decisionId: string;
    accountId: string;
    memberId: string;
    chosenOption: string;
    rationale?: string;
}

interface AddOpinionResult {
    added: boolean;
    conflict: boolean;          // true if opinions disagree
    opinions: Opinion[];
    conflictSummary?: string;   // human-readable conflict description if any
}

/**
 * Add an opinion from a WorldMember to a pending Decision.
 * If opinions now conflict, escalate to an admin/owner.
 */
export async function addDecisionOpinion(input: AddOpinionInput): Promise<AddOpinionResult> {
    const decision = await db.decision.findFirst({
        where: { id: input.decisionId, status: "pending" },
        select: { id: true, projectId: true, accountId: true, question: true, options: true, opinions: true },
    });

    if (!decision) {
        throw Object.assign(new Error("Decision not found or already resolved"), { statusCode: 404 });
    }

    // Validate chosen option exists
    let optionsList: Array<{ id: string; description: string }> = [];
    try { optionsList = JSON.parse(decision.options); } catch { /* empty */ }
    const chosenDesc = optionsList.find((o) => o.id === input.chosenOption)?.description;
    if (!chosenDesc) {
        throw Object.assign(new Error("Invalid option"), { statusCode: 400 });
    }

    let opinions: Opinion[] = [];
    try { opinions = JSON.parse(decision.opinions); } catch { /* empty */ }

    // Replace existing opinion from same member, or add new
    const existing = opinions.findIndex((o) => o.memberId === input.memberId);
    const newOpinion: Opinion = {
        memberId: input.memberId,
        accountId: input.accountId,
        chosenOption: input.chosenOption,
        rationale: input.rationale ?? null,
        createdAt: new Date().toISOString(),
    };

    if (existing >= 0) {
        opinions = opinions.map((o, i) => i === existing ? newOpinion : o);
    } else {
        opinions = [...opinions, newOpinion];
    }

    await db.decision.update({
        where: { id: decision.id },
        data: { opinions: JSON.stringify(opinions) },
    });

    // Check for conflicts
    const uniqueChoices = new Set(opinions.map((o) => o.chosenOption));
    const hasConflict = uniqueChoices.size > 1;

    let conflictSummary: string | undefined;

    if (hasConflict && opinions.length >= 2) {
        // Build summary
        const choiceCounts = new Map<string, number>();
        for (const op of opinions) {
            choiceCounts.set(op.chosenOption, (choiceCounts.get(op.chosenOption) ?? 0) + 1);
        }
        const parts = [...choiceCounts.entries()].map(([optId, count]) => {
            const desc = optionsList.find((o) => o.id === optId)?.description ?? optId;
            return `"${desc}" (${count} vote${count > 1 ? "s" : ""})`;
        });
        conflictSummary = parts.join(" vs ");

        // Escalate: notify the owner/admin that opinions conflict
        const owner = await db.worldMember.findFirst({
            where: { projectId: decision.projectId, role: { in: ["owner", "admin"] } },
            select: { accountId: true },
            orderBy: { role: "asc" }, // owner first
        });

        if (owner) {
            void inboxCreate({
                accountId: owner.accountId,
                category: "decision",
                eventType: "decision.conflict",
                severity: "warning",
                title: `Opinions conflict: ${truncateText(decision.question, TEXT_LIMITS.DECISION_QUESTION)}`,
                body: conflictSummary,
                referenceUrl: `/decision/${decision.id}`,
                refType: "decision",
                refId: decision.id,
                groupKey: `decision:${decision.id}:conflict`,
            });
        }

        log({ module: "decision" }, `Decision ${decision.id}: opinion conflict — ${conflictSummary}`);
    }

    return {
        added: true,
        conflict: hasConflict,
        opinions,
        conflictSummary,
    };
}
