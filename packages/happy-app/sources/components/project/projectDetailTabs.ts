export type ProjectDetailTabKey =
    | "sessions"
    | "health"
    | "research"
    | "knowledge"
;

const ALWAYS_TABS: ProjectDetailTabKey[] = [
    "sessions",
    "health",
    "research",
];

export function resolveProjectDetailTabs(input: {
    knowledgeBaseEnabled: boolean;
}): ProjectDetailTabKey[] {
    const tabs: ProjectDetailTabKey[] = [...ALWAYS_TABS];
    if (input.knowledgeBaseEnabled) {
        tabs.push("knowledge");
    }
    return tabs;
}

export function resolveProjectDetailInitialTab(input: {
    requestedTab?: string;
    knowledgeBaseEnabled: boolean;
}): ProjectDetailTabKey {
    const allowedTabs = resolveProjectDetailTabs(input);

    if (input.requestedTab && allowedTabs.includes(input.requestedTab as ProjectDetailTabKey)) {
        return input.requestedTab as ProjectDetailTabKey;
    }

    return allowedTabs[0] ?? "sessions";
}
