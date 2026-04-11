/**
 * Query open WorldSuggestions for a project.
 */

import { db } from "@/storage/db";
import {
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
    const status = opts?.status ?? "open";
    const limit = opts?.limit ?? 50;

    const rows = await db.worldSuggestion.findMany({
        where: {
            accountId,
            projectId,
            ...(opts?.goalId ? { relatedGoalId: opts.goalId } : {}),
            status: status === "open" ? { in: ["open", "suspended"] } : status,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
    });

    const suggestions = rows.map((row) => serializeSuggestion({
        ...row,
        type: row.type as SuggestionType,
        status: row.status as SuggestionStatus,
    }));
    if (!opts?.bucket) {
        return suggestions;
    }
    return suggestions.filter((item) => item.bucket === opts.bucket);
}
