export type SessionKnowledgeTab =
    | "changes"
    | "references"
    | "evicted"
    | "archive";

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

// Archive tab reuses the references dataset (filters client-side), so its
// loading signal is tied to shouldLoadReferences.
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

    const needsReferencesData =
        activeTab === "references"
        || activeTab === "evicted"
        || activeTab === "archive";
    return {
        shouldLoadChanges: hasLoadedChanges || activeTab === "changes",
        shouldLoadReferences: hasLoadedReferences || needsReferencesData,
    };
}
