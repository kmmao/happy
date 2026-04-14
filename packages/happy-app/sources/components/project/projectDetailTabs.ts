export type ProjectDetailTabKey =
    | "sessions"
    | "health"
    | "research"
    | "knowledge"
    | "goals"
    | "world"
    | "team"
;

const BASE_TABS: ProjectDetailTabKey[] = [
    "world",
    "team",
    "goals",
    "sessions",
    "health",
    "research",
];

export function resolveProjectDetailInitialTab(input: {
    requestedTab?: string;
    knowledgeBaseEnabled: boolean;
}): ProjectDetailTabKey {
    const allowedTabs = input.knowledgeBaseEnabled
        ? [...BASE_TABS, "knowledge"]
        : BASE_TABS;

    if (input.requestedTab && allowedTabs.includes(input.requestedTab as ProjectDetailTabKey)) {
        return input.requestedTab as ProjectDetailTabKey;
    }

    return "world";
}
