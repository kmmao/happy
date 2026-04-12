/**
 * Match a precedent for a Decision question.
 * Uses precedentKey exact match on existing decided Decisions.
 */

import { db } from "@/storage/db";

export interface PrecedentMatch {
    decisionId: string;
    knowledgeId: string;
    chosenOption: string;
    rationale: string | null;
    question: string;
}

/**
 * Find a matching precedent for a given precedentKey within a project.
 * Returns the most recent decided Decision with matching precedentKey.
 */
export async function matchPrecedent(
    projectId: string,
    precedentKey: string | undefined,
    _question: string,
): Promise<PrecedentMatch | null> {
    // Phase 1: precedentKey exact match only
    // Phase 2+: add embedding semantic match on question
    if (!precedentKey) return null;

    const match = await db.decision.findFirst({
        where: {
            projectId,
            precedentKey,
            status: "decided",
            knowledgeId: { not: null },
        },
        orderBy: { decidedAt: "desc" },
        select: {
            id: true,
            knowledgeId: true,
            chosenOption: true,
            rationale: true,
            question: true,
        },
    });

    if (!match || !match.knowledgeId || !match.chosenOption) return null;

    return {
        decisionId: match.id,
        knowledgeId: match.knowledgeId,
        chosenOption: match.chosenOption,
        rationale: match.rationale,
        question: match.question,
    };
}
