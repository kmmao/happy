/**
 * Query open WorldSuggestions for a project.
 */

import { db } from "@/storage/db";
import {
    deriveSuggestionBucket,
    serializeSuggestion,
    type SuggestionBucket,
    type SuggestionSerialized,
    type SuggestionStatus,
    type SuggestionType,
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

    return rows.map((row) => serializeSuggestion({
        ...(row as typeof row & {
            type: SuggestionType;
            status: SuggestionStatus;
            bucket?: SuggestionBucket | null;
        }),
        type: row.type as SuggestionType,
        status: row.status as SuggestionStatus,
    }));
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
            payload: true,
            evidence: true,
            requiresHuman: true,
            bucket: true,
        },
        take: 200,
    });

    const updates = rows.flatMap((row) => {
        const typedRow = row as typeof row & { bucket?: SuggestionBucket | null; type: SuggestionType };
        const derivedBucket = deriveSuggestionBucket({
            type: typedRow.type,
            payload: safeParseJson(row.payload, {}),
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

function safeParseJson(raw: string, fallback: any) {
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}
