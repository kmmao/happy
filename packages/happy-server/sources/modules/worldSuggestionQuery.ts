import { db } from "@/storage/db";
import {
    type SuggestionAcceptSource,
    type SuggestionBucket,
    type SuggestionSerialized,
    type SuggestionStatus,
    type SuggestionType,
} from "@kmmao/happy-wire";
import { serializeSuggestion } from "./worldSuggestionTypes";

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
            autoAcceptStatus?: string | null;
            autoAcceptReasonCode?: string | null;
            autoAcceptFailureDetail?: string | null;
        };

        return serializeSuggestion({
            ...typedRow,
            type: typedRow.type,
            status: typedRow.status,
            acceptSource: normalizeAcceptSource(typedRow.acceptSource),
            acceptAudit: normalizeAcceptAudit(typedRow.acceptAudit),
            autoAcceptStatus: typedRow.autoAcceptStatus ?? null,
            autoAcceptReasonCode: typedRow.autoAcceptReasonCode ?? null,
            autoAcceptFailureDetail: typedRow.autoAcceptFailureDetail ?? null,
        });
    });
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
