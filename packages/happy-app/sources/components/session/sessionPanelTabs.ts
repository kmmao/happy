export type SessionPanelTab =
    | "files"
    | "changes"
    | "code"
    | "preview"
    | "summary"
    | "terminal";

export function getSessionPanelTabs(
    enablePreviewTab: boolean,
): SessionPanelTab[] {
    return [
        "changes",
        "files",
        "code",
        ...(enablePreviewTab ? (["preview"] as const) : []),
        "summary",
        "terminal",
    ];
}

export function resolveSessionPanelActiveTab(
    currentTab: SessionPanelTab,
    tabs: readonly SessionPanelTab[],
): SessionPanelTab {
    return tabs.includes(currentTab) ? currentTab : (tabs[0] ?? "changes");
}
