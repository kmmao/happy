export type ProjectDetailTabKey =
    | "sessions"
    | "health"
    | "research"
    | "knowledge"
    | "goals"
    | "world"
    | "team"
;

const WORLD_MODEL_TABS: ProjectDetailTabKey[] = [
    "world",
    "team",
    "goals",
];

const ALWAYS_TABS: ProjectDetailTabKey[] = [
    "sessions",
    "health",
    "research",
];

export function resolveProjectDetailTabs(input: {
    worldModelEnabled: boolean;
    knowledgeBaseEnabled: boolean;
}): ProjectDetailTabKey[] {
    const tabs: ProjectDetailTabKey[] = [];
    if (input.worldModelEnabled) {
        tabs.push(...WORLD_MODEL_TABS);
    }
    tabs.push(...ALWAYS_TABS);
    if (input.knowledgeBaseEnabled) {
        tabs.push("knowledge");
    }
    return tabs;
}

export function resolveProjectDetailInitialTab(input: {
    requestedTab?: string;
    worldModelEnabled: boolean;
    knowledgeBaseEnabled: boolean;
}): ProjectDetailTabKey {
    const allowedTabs = resolveProjectDetailTabs(input);

    if (input.requestedTab && allowedTabs.includes(input.requestedTab as ProjectDetailTabKey)) {
        return input.requestedTab as ProjectDetailTabKey;
    }

    return allowedTabs[0] ?? "sessions";
}
