export type ProjectDetailTabKey =
    | "sessions"
    | "workflows"
    | "git"
    | "supervisor"
    | "health"
    | "events"
    | "research"
    | "traces"
    | "config"
;

const ALWAYS_TABS: ProjectDetailTabKey[] = [
    "sessions",
    "workflows",
    "git",
    "supervisor",
    "health",
    "events",
    "research",
    "traces",
    "config",
];

export function resolveProjectDetailTabs(): ProjectDetailTabKey[] {
    return [...ALWAYS_TABS];
}

export function resolveProjectDetailInitialTab(input: {
    requestedTab?: string;
}): ProjectDetailTabKey {
    const allowedTabs = resolveProjectDetailTabs();

    if (input.requestedTab && allowedTabs.includes(input.requestedTab as ProjectDetailTabKey)) {
        return input.requestedTab as ProjectDetailTabKey;
    }

    return allowedTabs[0] ?? "sessions";
}
