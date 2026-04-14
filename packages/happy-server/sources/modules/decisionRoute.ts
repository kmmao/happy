/**
 * Route a Decision to the best-matching WorldMember based on
 * expertise tags extracted from the question/context and member availability.
 *
 * Returns the WorldMember.id of the best candidate, or null if no
 * explicit members exist (falls back to implicit owner).
 */

import { db } from "@/storage/db";
import { log } from "@/utils/log";

interface RouteResult {
    memberId: string | null;
    memberAccountId: string | null;
    reason: string;
}

/**
 * Simple keyword-based expertise matching.
 * Extracts lowercase tokens from the question and context,
 * then scores each member by how many of their expertise tags appear.
 */
function extractTags(question: string, context?: string | null): string[] {
    const text = `${question} ${context ?? ""}`.toLowerCase();
    // Split on non-word characters, dedupe, filter short tokens
    const tokens = [...new Set(text.split(/\W+/).filter((t) => t.length > 2))];
    return tokens;
}

function matchExpertise(tags: string[], memberExpertise: string[]): number {
    if (memberExpertise.length === 0) return 0;
    const lowerExpertise = memberExpertise.map((e) => e.toLowerCase());
    let score = 0;
    for (const tag of tags) {
        for (const exp of lowerExpertise) {
            if (exp.includes(tag) || tag.includes(exp)) {
                score++;
                break;
            }
        }
    }
    return score;
}

export async function routeDecision(
    projectId: string,
    question: string,
    context?: string | null,
): Promise<RouteResult> {
    const members = await db.worldMember.findMany({
        where: { projectId },
        select: {
            id: true,
            accountId: true,
            role: true,
            expertise: true,
            availability: true,
            decisionScope: true,
            delegateTo: true,
        },
    });

    // No explicit members → implicit owner handles all
    if (members.length === 0) {
        return { memberId: null, memberAccountId: null, reason: "no_members" };
    }

    const tags = extractTags(question, context);

    const candidates = members
        .filter((m) => m.decisionScope !== "none")
        .map((m) => {
            let expertise: string[] = [];
            try { expertise = JSON.parse(m.expertise); } catch { /* empty */ }

            return {
                id: m.id,
                accountId: m.accountId,
                role: m.role,
                availability: m.availability,
                delegateTo: m.delegateTo,
                decisionScope: m.decisionScope,
                expertiseScore: matchExpertise(tags, expertise),
                isAdmin: m.role === "owner" || m.role === "admin",
            };
        })
        // Prefer active members, then by expertise, then by admin status
        .sort((a, b) => {
            // Active first
            const aActive = a.availability === "active" ? 1 : 0;
            const bActive = b.availability === "active" ? 1 : 0;
            if (bActive !== aActive) return bActive - aActive;

            // Higher expertise score first
            if (b.expertiseScore !== a.expertiseScore) return b.expertiseScore - a.expertiseScore;

            // Admin tiebreaker
            return (b.isAdmin ? 1 : 0) - (a.isAdmin ? 1 : 0);
        });

    if (candidates.length === 0) {
        // All members have decisionScope=none → fall back to owner
        const owner = members.find((m) => m.role === "owner");
        return {
            memberId: owner?.id ?? null,
            memberAccountId: owner?.accountId ?? null,
            reason: "fallback_owner_all_scope_none",
        };
    }

    let best = candidates[0];

    // If best candidate is "delegate", follow the delegation chain (max 3 hops)
    let hops = 0;
    while (best.availability === "delegate" && best.delegateTo && hops < 3) {
        const delegate = candidates.find((c) => c.id === best.delegateTo);
        if (!delegate) break;
        best = delegate;
        hops++;
    }

    // If best is still "away" after delegation, fall back to any active admin
    if (best.availability !== "active") {
        const activeAdmin = candidates.find(
            (c) => c.availability === "active" && c.isAdmin,
        );
        if (activeAdmin) {
            best = activeAdmin;
        }
        // If no active admin, we still assign to the best candidate even if away
        // (they'll get notified and can reassign)
    }

    log({ module: "decision" }, `Routed decision to member ${best.id} (expertise=${best.expertiseScore}, role=${best.role})`);

    return {
        memberId: best.id,
        memberAccountId: best.accountId,
        reason: best.expertiseScore > 0 ? "expertise_match" : "admin_fallback",
    };
}

/**
 * Reassign a pending Decision to a different member.
 * Updates assignedTo and appends to assignHistory.
 */
export async function reassignDecision(
    decisionId: string,
    newMemberId: string,
    reason: string,
): Promise<void> {
    const decision = await db.decision.findUnique({
        where: { id: decisionId },
        select: { assignedTo: true, assignHistory: true },
    });
    if (!decision) return;

    let history: Array<{ memberId: string; assignedAt: string; reason: string }> = [];
    try { history = JSON.parse(decision.assignHistory); } catch { /* empty */ }

    if (decision.assignedTo) {
        history.push({
            memberId: decision.assignedTo,
            assignedAt: new Date().toISOString(),
            reason,
        });
    }

    await db.decision.update({
        where: { id: decisionId },
        data: {
            assignedTo: newMemberId,
            assignHistory: JSON.stringify(history),
        },
    });
}
