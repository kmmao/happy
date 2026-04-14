export type ProjectDetailTabKey =
    | "sessions"
    | "git"
    | "health"
    | "research"
    | "knowledge"
    | "goals"
    | "world"
    | "roles"
    | "members"
;

const BASE_TABS: ProjectDetailTabKey[] = [
    "world",
    "roles",
    "members",
    "goals",
    "sessions",
    "git",
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
