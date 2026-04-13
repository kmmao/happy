import type { SessionKnowledgeAccessEntry } from "@/hooks/useSessionKnowledgeAccesses";
import type { SessionKnowledgeEntry } from "@/hooks/useSessionKnowledge";

export interface KnowledgeSummaryRow {
    icon: string;
    label: string;
    value: string;
    isInteractive: boolean;
}

export type KnowledgeSummaryTranslationKey =
    | "sidePanel.knowledgeCaptured"
    | "sidePanel.knowledgeReferenced"
    | "sidePanel.knowledgeCapturedValue"
    | "sidePanel.knowledgeReferencedValue"
    | "sidePanel.knowledgeLatestPrefix";

export type KnowledgeSummaryTranslate = (
    key: KnowledgeSummaryTranslationKey,
    params?: { count?: number },
) => string;

interface KnowledgeSummaryInput {
    knowledgeCount: number;
    capturedEntries: Pick<SessionKnowledgeEntry, "id" | "title" | "createdAt">[];
    referencedEntries: Pick<SessionKnowledgeAccessEntry, "id" | "title" | "createdAt">[];
    t: KnowledgeSummaryTranslate;
}

function getLatestTitle(
    entries: Array<Pick<SessionKnowledgeEntry, "title" | "createdAt">>
        | Array<Pick<SessionKnowledgeAccessEntry, "title" | "createdAt">>,
): string | null {
    if (entries.length === 0) return null;
    const latest = [...entries].sort((a, b) => b.createdAt - a.createdAt)[0];
    return latest?.title ?? null;
}

function appendLatestTitle(
    baseValue: string,
    latestTitle: string | null,
    translate: KnowledgeSummaryTranslate,
): string {
    if (!latestTitle) return baseValue;
    return `${baseValue} · ${translate("sidePanel.knowledgeLatestPrefix")}: ${latestTitle}`;
}

export function buildKnowledgeSummaryRows({
    knowledgeCount,
    capturedEntries,
    referencedEntries,
    t,
}: KnowledgeSummaryInput): KnowledgeSummaryRow[] {
    const rows: KnowledgeSummaryRow[] = [];

    const capturedCount = Math.max(knowledgeCount, capturedEntries.length);
    if (capturedCount > 0) {
        rows.push({
            icon: "database",
            label: t("sidePanel.knowledgeCaptured"),
            value: appendLatestTitle(
                t("sidePanel.knowledgeCapturedValue", { count: capturedCount }),
                getLatestTitle(capturedEntries),
                t,
            ),
            isInteractive: true,
        });
    }

    if (referencedEntries.length > 0) {
        rows.push({
            icon: "link",
            label: t("sidePanel.knowledgeReferenced"),
            value: appendLatestTitle(
                t("sidePanel.knowledgeReferencedValue", {
                    count: referencedEntries.length,
                }),
                getLatestTitle(referencedEntries),
                t,
            ),
            isInteractive: true,
        });
    }

    return rows;
}
