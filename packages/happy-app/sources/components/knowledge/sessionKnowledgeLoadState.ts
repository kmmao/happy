export type SessionKnowledgeTab =
    | "changes"
    | "references"
    | "evicted"
    | "archive";

interface SessionKnowledgeLoadStateInput {
    visible: boolean;
    activeTab: SessionKnowledgeTab;
    hasLoadedChanges: boolean;
}

interface SessionKnowledgeLoadState {
    shouldLoadChanges: boolean;
    shouldLoadReferences: boolean;
}

// Archive tab reuses the references dataset (filters client-side), so its
// loading signal is tied to shouldLoadReferences.
// Accesses are always loaded when visible so tab badge counts are accurate
// even before the user clicks a references-related tab.
export function getSessionKnowledgeLoadState({
    visible,
    activeTab,
    hasLoadedChanges,
}: SessionKnowledgeLoadStateInput): SessionKnowledgeLoadState {
    if (!visible) {
        return {
            shouldLoadChanges: false,
            shouldLoadReferences: false,
        };
    }

    return {
        shouldLoadChanges: hasLoadedChanges || activeTab === "changes",
        shouldLoadReferences: true,
    };
}
