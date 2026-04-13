export type SessionKnowledgeTab = "changes" | "references";

interface SessionKnowledgeLoadStateInput {
    visible: boolean;
    activeTab: SessionKnowledgeTab;
    hasLoadedChanges: boolean;
    hasLoadedReferences: boolean;
}

interface SessionKnowledgeLoadState {
    shouldLoadChanges: boolean;
    shouldLoadReferences: boolean;
}

export function getSessionKnowledgeLoadState({
    visible,
    activeTab,
    hasLoadedChanges,
    hasLoadedReferences,
}: SessionKnowledgeLoadStateInput): SessionKnowledgeLoadState {
    if (!visible) {
        return {
            shouldLoadChanges: false,
            shouldLoadReferences: false,
        };
    }

    return {
        shouldLoadChanges: hasLoadedChanges || activeTab === "changes",
        shouldLoadReferences: hasLoadedReferences || activeTab === "references",
    };
}
