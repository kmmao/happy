import type { SessionKnowledgeAccessEntry } from "@/hooks/useSessionKnowledgeAccesses";
import type { SessionKnowledgeEntry } from "@/hooks/useSessionKnowledge";
import type { SessionKnowledgeTab } from "@/components/knowledge/sessionKnowledgeLoadState";

export interface KnowledgeSummaryRow {
    icon: string;
    label: string;
    value: string;
    isInteractive: boolean;
    targetTab?: SessionKnowledgeTab;
}

export type KnowledgeSummaryTranslationKey =
    | "sidePanel.knowledgeCaptured"
    | "sidePanel.knowledgeReferenced"
    | "sidePanel.knowledgeCapturedValue"
    | "sidePanel.knowledgeReferencedValue"
    | "sidePanel.knowledgeLatestPrefix"
    | "sidePanel.knowledgeHitSuffix"
    | "sidePanel.knowledgeHotSuffix";

export type KnowledgeSummaryTranslate = (
    key: KnowledgeSummaryTranslationKey,
    params?: { count?: number },
) => string;

interface KnowledgeSummaryInput {
    knowledgeCount: number;
    capturedEntries: Pick<SessionKnowledgeEntry, "id" | "title" | "createdAt">[];
    referencedEntries: Pick<
        SessionKnowledgeAccessEntry,
        "id" | "title" | "createdAt" | "hitCount" | "hotStatus"
    >[];
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
            targetTab: "changes",
        });
    }

    // Always render the Referenced row so users can see session knowledge state at
    // a glance (including the zero state). TTL suffixes (hit/hot) only appear when
    // the server provides those fields.
    const hitCount = referencedEntries.filter((e) => (e.hitCount ?? 0) > 0).length;
    const hotCount = referencedEntries.filter((e) => e.hotStatus === "hot").length;
    const hasTtlStats = referencedEntries.some(
        (e) => e.hitCount !== undefined || e.hotStatus !== undefined,
    );

    let referencedValue = appendLatestTitle(
        t("sidePanel.knowledgeReferencedValue", {
            count: referencedEntries.length,
        }),
        getLatestTitle(referencedEntries),
        t,
    );
    if (hasTtlStats || referencedEntries.length > 0) {
        referencedValue =
            referencedValue +
            t("sidePanel.knowledgeHitSuffix", { count: hitCount }) +
            t("sidePanel.knowledgeHotSuffix", { count: hotCount });
    }

    rows.push({
        icon: "link",
        label: t("sidePanel.knowledgeReferenced"),
        value: referencedValue,
        isInteractive: true,
        targetTab: "references",
    });

    return rows;
}
