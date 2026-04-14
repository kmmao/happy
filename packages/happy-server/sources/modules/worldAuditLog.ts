/**
 * WorldAuditLog — records who changed what in the World Model.
 * Fire-and-forget writes; reads through REST API.
 */

import { db } from "@/storage/db";
import { log } from "@/utils/log";

interface AuditLogInput {
    accountId: string;
    projectId: string;
    memberId?: string | null;
    action: string;         // e.g. "law.create", "narrative.update", "decision.adjudicate"
    entityType: string;     // law | narrative | role | decision | member
    entityId?: string;
    summary: string;
    before?: unknown;       // Will be JSON.stringify'd
    after?: unknown;        // Will be JSON.stringify'd
}

/**
 * Write an audit log entry. Fire-and-forget.
 */
export async function auditLog(input: AuditLogInput): Promise<void> {
    try {
        await db.worldAuditLog.create({
            data: {
                accountId: input.accountId,
                projectId: input.projectId,
                memberId: input.memberId ?? null,
                action: input.action,
                entityType: input.entityType,
                entityId: input.entityId ?? null,
                summary: input.summary,
                before: input.before != null ? JSON.stringify(input.before) : null,
                after: input.after != null ? JSON.stringify(input.after) : null,
            },
        });
    } catch (err) {
        log({ module: "audit", level: "error" }, `Failed to write audit log: ${err}`);
    }
}

/**
 * Query audit logs for a project with optional filters.
 */
export async function queryAuditLogs(input: {
    projectId: string;
    entityType?: string;
    limit?: number;
    offset?: number;
}): Promise<{ logs: AuditLogEntry[]; total: number }> {
    const where: Record<string, unknown> = { projectId: input.projectId };
    if (input.entityType) where.entityType = input.entityType;

    const [logs, total] = await Promise.all([
        db.worldAuditLog.findMany({
            where,
            include: {
                account: { select: { id: true, username: true, firstName: true, lastName: true } },
            },
            orderBy: { createdAt: "desc" },
            take: input.limit ?? 50,
            skip: input.offset ?? 0,
        }),
        db.worldAuditLog.count({ where }),
    ]);

    return {
        logs: logs.map((l) => ({
            id: l.id,
            accountId: l.accountId,
            memberId: l.memberId,
            action: l.action,
            entityType: l.entityType,
            entityId: l.entityId,
            summary: l.summary,
            before: safeParseJson(l.before),
            after: safeParseJson(l.after),
            createdAt: l.createdAt.getTime(),
            account: l.account ? {
                id: l.account.id,
                username: l.account.username,
                firstName: l.account.firstName,
                lastName: l.account.lastName,
            } : null,
        })),
        total,
    };
}

export interface AuditLogEntry {
    id: string;
    accountId: string;
    memberId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    summary: string;
    before: unknown;
    after: unknown;
    createdAt: number;
    account: { id: string; username: string | null; firstName: string | null; lastName: string | null } | null;
}

function safeParseJson(val: string | null): unknown {
    if (!val) return null;
    try { return JSON.parse(val); } catch { return val; }
}
