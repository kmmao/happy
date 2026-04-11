import { db } from "@/storage/db";
import {
    type SuggestionAcceptSource,
    type SuggestionBucket,
    type SuggestionSerialized,
    type SuggestionStatus,
    type SuggestionType,
} from "@kmmao/happy-wire";
import {
    deriveSuggestionBucket,
    normalizeSuggestionPayload,
    serializeSuggestion,
} from "./worldSuggestionTypes";

export async function worldSuggestionQuery(
    accountId: string,
    projectId: string,
    opts?: {
        status?: SuggestionStatus;
        limit?: number;
        goalId?: string;
        bucket?: SuggestionBucket;
    },
): Promise<SuggestionSerialized[]> {
    await backfillSuggestionBuckets(accountId, projectId);

    const status = opts?.status ?? "open";
    const limit = opts?.limit ?? 50;
    const includeSuspended = status === "open";

    const rows = await db.worldSuggestion.findMany({
        where: {
            accountId,
            projectId,
            ...(opts?.goalId ? { relatedGoalId: opts.goalId } : {}),
            ...(opts?.bucket ? { bucket: opts.bucket } : {}),
            status: includeSuspended ? { in: ["open", "suspended"] } : status,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
    });

    return rows.map((row) => {
        const typedRow = row as typeof row & {
            type: SuggestionType;
            status: SuggestionStatus;
            bucket?: SuggestionBucket | null;
            acceptSource?: string | null;
            acceptAudit?: string | null;
        };

        return serializeSuggestion({
            ...typedRow,
            type: typedRow.type,
            status: typedRow.status,
            acceptSource: normalizeAcceptSource(typedRow.acceptSource),
            acceptAudit: normalizeAcceptAudit(typedRow.acceptAudit),
        });
    });
}

async function backfillSuggestionBuckets(accountId: string, projectId: string): Promise<void> {
    const rows = await db.worldSuggestion.findMany({
        where: {
            accountId,
            projectId,
            status: { in: ["open", "suspended", "processing", "dismissed", "accepted"] },
        },
        select: {
            id: true,
            type: true,
            title: true,
            payload: true,
            evidence: true,
            requiresHuman: true,
            bucket: true,
        },
        orderBy: { createdAt: "desc" },
        take: 200,
    });

    const updates = rows.flatMap((row) => {
        const typedRow = row as typeof row & { bucket?: SuggestionBucket | null; type: SuggestionType };
        const normalizedPayload = normalizeSuggestionPayload({
            type: typedRow.type,
            title: row.title,
            rawPayload: safeParseJson(row.payload, {}),
        });
        const derivedBucket = deriveSuggestionBucket({
            type: typedRow.type,
            payload: normalizedPayload,
            evidence: safeParseJson(row.evidence, []),
            requiresHuman: row.requiresHuman,
        });
        if (typedRow.bucket === derivedBucket) {
            return [];
        }
        return [db.worldSuggestion.update({ where: { id: row.id }, data: { bucket: derivedBucket } })];
    });

    if (updates.length > 0) {
        await Promise.all(updates);
    }
}

function normalizeAcceptSource(raw: string | null | undefined): SuggestionAcceptSource | null {
    if (raw === "human" || raw === "system_auto") {
        return raw;
    }
    return null;
}

function normalizeAcceptAudit(raw: string | null | undefined): string | null {
    return raw ?? null;
}

function safeParseJson(raw: string, fallback: any) {
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}
