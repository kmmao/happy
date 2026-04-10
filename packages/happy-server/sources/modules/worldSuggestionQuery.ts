/**
 * Query open WorldSuggestions for a project.
 */

import { db } from "@/storage/db";
import { serializeSuggestion, type SuggestionSerialized, type SuggestionStatus } from "./worldSuggestionTypes";

export async function worldSuggestionQuery(
    accountId: string,
    projectId: string,
    opts?: { status?: SuggestionStatus; limit?: number },
): Promise<SuggestionSerialized[]> {
    const status = opts?.status ?? "open";
    const limit = opts?.limit ?? 50;

    const rows = await db.worldSuggestion.findMany({
        where: {
            accountId,
            projectId,
            status: status === "open" ? { in: ["open", "suspended"] } : status,
        },
        orderBy: { createdAt: "desc" },
        take: limit,
    });

    return rows.map(serializeSuggestion);
}
