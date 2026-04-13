import type { SessionKnowledgeAccessEntry } from "@/hooks/useSessionKnowledgeAccesses";
import type { SessionKnowledgeEntry } from "@/hooks/useSessionKnowledge";
import type { SessionKnowledgeTab } from "./sessionKnowledgeLoadState";

interface SessionKnowledgeDisplayTimestampInput {
    activeTab: SessionKnowledgeTab;
    entry: Pick<SessionKnowledgeEntry, "createdAt"> | Pick<SessionKnowledgeAccessEntry, "createdAt" | "accessedAt">;
}

export function getSessionKnowledgeDisplayTimestamp({
    activeTab,
    entry,
}: SessionKnowledgeDisplayTimestampInput): number {
    if (activeTab === "references" && "accessedAt" in entry) {
        return entry.accessedAt;
    }
    return entry.createdAt;
}
