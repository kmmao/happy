export type SessionPanelTab =
    | "files"
    | "changes"
    | "code"
    | "preview"
    | "summary"
    | "terminal";

export type SessionPanelTabTranslationKey =
    | "sidePanel.files"
    | "sidePanel.changes"
    | "sidePanel.code"
    | "sidePanel.preview"
    | "sidePanel.summary"
    | "sidePanel.terminal";

export interface SessionPanelTabDefinition {
    key: SessionPanelTab;
    labelKey: SessionPanelTabTranslationKey;
}

export function getSessionPanelTabs(
    enablePreviewTab: boolean,
): SessionPanelTab[] {
    return getSessionPanelTabDefinitions(enablePreviewTab).map((tab) => tab.key);
}

export function getSessionPanelTabDefinitions(
    enablePreviewTab: boolean,
): SessionPanelTabDefinition[] {
    return [
        { key: "summary", labelKey: "sidePanel.summary" },
        { key: "changes", labelKey: "sidePanel.changes" },
        { key: "files", labelKey: "sidePanel.files" },
        { key: "code", labelKey: "sidePanel.code" },
        ...(enablePreviewTab
            ? ([{ key: "preview", labelKey: "sidePanel.preview" }] as const)
            : []),
        { key: "terminal", labelKey: "sidePanel.terminal" },
    ];
}

export function resolveSessionPanelActiveTab(
    currentTab: SessionPanelTab,
    tabs: readonly SessionPanelTab[],
): SessionPanelTab {
    return tabs.includes(currentTab) ? currentTab : (tabs[0] ?? "summary");
}
