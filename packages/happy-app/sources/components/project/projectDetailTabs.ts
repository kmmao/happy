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
    | "config";

const BASE_TABS: ProjectDetailTabKey[] = [
    "world",
    "roles",
    "members",
    "goals",
    "sessions",
    "git",
    "health",
    "research",
    "config",
];

export function resolveProjectDetailInitialTab(input: {
    requestedTab?: string;
    knowledgeBaseEnabled: boolean;
}): ProjectDetailTabKey {
    const allowedTabs = input.knowledgeBaseEnabled
        ? [...BASE_TABS.slice(0, 8), "knowledge", ...BASE_TABS.slice(8)]
        : BASE_TABS;

    if (input.requestedTab && allowedTabs.includes(input.requestedTab as ProjectDetailTabKey)) {
        return input.requestedTab as ProjectDetailTabKey;
    }

    return "world";
}
