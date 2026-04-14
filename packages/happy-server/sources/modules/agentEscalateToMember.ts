/**
 * Agent-to-Human escalation: route an AgentMessage to the most appropriate
 * WorldMember based on the issue type and member expertise.
 *
 * Escalation types:
 *   - "technical"  → match by expertise tags
 *   - "process"    → route to admin/owner
 *   - "permission" → route to owner
 */

import { db } from "@/storage/db";
import { inboxCreate } from "./inboxCreate";
import { truncateText, TEXT_LIMITS } from "./worldConstants";
import { log } from "@/utils/log";

type EscalationType = "technical" | "process" | "permission";

interface EscalateInput {
    accountId: string;
    projectId: string;
    fromRole: string;
    msgType: string;
    content: string;
    escalationType: EscalationType;
    /** Hint keywords for expertise matching (e.g. ["database", "migration"]) */
    contextTags?: string[];
    relatedGoalId?: string;
    relatedTaskId?: string;
    sessionId?: string;
    decisionId?: string;
}

interface EscalateResult {
    messageId: string;
    targetMemberId: string | null;
    targetAccountId: string;
}

export async function agentEscalateToMember(input: EscalateInput): Promise<EscalateResult> {
    const members = await db.worldMember.findMany({
        where: {
            projectId: input.projectId,
            availability: { not: "away" },
        },
        select: {
            id: true,
            accountId: true,
            role: true,
            expertise: true,
            availability: true,
            delegateTo: true,
        },
    });

    let targetMemberId: string | null = null;
    let targetAccountId = input.accountId; // fallback to project owner

    if (members.length > 0) {
        const target = findBestMember(members, input.escalationType, input.contextTags ?? []);
        if (target) {
            targetMemberId = target.id;
            targetAccountId = target.accountId;
        }
    }

    // Create AgentMessage with toMemberId
    const message = await db.agentMessage.create({
        data: {
            accountId: input.accountId,
            projectId: input.projectId,
            fromRole: input.fromRole,
            toRole: null, // not targeting a role, targeting a human
            toMemberId: targetMemberId,
            msgType: input.msgType,
            content: input.content,
            status: "unread",
            sessionId: input.sessionId ?? null,
            decisionId: input.decisionId ?? null,
            relatedGoalId: input.relatedGoalId ?? null,
            relatedTaskId: input.relatedTaskId ?? null,
            priority: input.escalationType === "permission" ? "urgent" : "normal",
        },
    });

    // Notify the target member
    void inboxCreate({
        accountId: targetAccountId,
        category: "system",
        eventType: "agent.escalation",
        severity: input.escalationType === "permission" ? "error" : "warning",
        title: `Agent ${input.fromRole}: ${truncateText(input.content, TEXT_LIMITS.TITLE)}`,
        body: `Type: ${input.escalationType}`,
        referenceUrl: input.sessionId ? `/session/${input.sessionId}` : undefined,
        refType: "agentMessage",
        refId: message.id,
        groupKey: `escalation:${message.id}`,
    });

    log(
        { module: "escalation" },
        `Agent "${input.fromRole}" escalated ${input.escalationType} → member ${targetMemberId ?? "owner"}`,
    );

    return {
        messageId: message.id,
        targetMemberId,
        targetAccountId,
    };
}

// --- Internal ---

function findBestMember(
    members: Array<{
        id: string;
        accountId: string;
        role: string;
        expertise: string;
        availability: string;
        delegateTo: string | null;
    }>,
    escalationType: EscalationType,
    contextTags: string[],
): { id: string; accountId: string } | null {
    // Permission issues → owner only
    if (escalationType === "permission") {
        return members.find((m) => m.role === "owner") ?? null;
    }

    // Process issues → admin or owner
    if (escalationType === "process") {
        return members.find((m) => m.role === "owner" || m.role === "admin")
            ?? members[0] ?? null;
    }

    // Technical → match by expertise
    const scored = members
        .filter((m) => m.availability === "active")
        .map((m) => {
            let expertise: string[] = [];
            try { expertise = JSON.parse(m.expertise); } catch { /* empty */ }
            const lowerExp = expertise.map((e) => e.toLowerCase());
            let score = 0;
            for (const tag of contextTags) {
                const lower = tag.toLowerCase();
                for (const exp of lowerExp) {
                    if (exp.includes(lower) || lower.includes(exp)) {
                        score++;
                        break;
                    }
                }
            }
            return { ...m, score };
        })
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            // Admin tiebreaker
            const aAdmin = a.role === "owner" || a.role === "admin" ? 1 : 0;
            const bAdmin = b.role === "owner" || b.role === "admin" ? 1 : 0;
            return bAdmin - aAdmin;
        });

    // Follow delegation if best is delegating
    let best = scored[0] ?? null;
    if (best?.availability === "delegate" && best.delegateTo) {
        const delegate = members.find((m) => m.id === best!.delegateTo);
        if (delegate) {
            best = { ...delegate, score: best.score };
        }
    }

    return best ? { id: best.id, accountId: best.accountId } : null;
}
