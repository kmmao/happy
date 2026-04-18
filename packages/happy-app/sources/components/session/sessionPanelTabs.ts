export type SessionPanelTab =
    | "session"
    | "files"
    | "changes"
    | "preview"
    | "knowledge"
    | "terminal";

export type SessionPanelTabTranslationKey =
    | "sidePanel.session"
    | "sidePanel.files"
    | "sidePanel.changes"
    | "sidePanel.preview"
    | "sidePanel.knowledge"
    | "sidePanel.terminal";

export interface SessionPanelTabDefinition {
    key: SessionPanelTab;
    labelKey: SessionPanelTabTranslationKey;
}

export interface SessionPanelTabOptions {
    enablePreviewTab: boolean;
    knowledgeBaseEnabled: boolean;
}

export function getSessionPanelTabs(
    options: SessionPanelTabOptions,
): SessionPanelTab[] {
    return getSessionPanelTabDefinitions(options).map((tab) => tab.key);
}

export function getSessionPanelTabDefinitions(
    options: SessionPanelTabOptions,
): SessionPanelTabDefinition[] {
    const { enablePreviewTab, knowledgeBaseEnabled } = options;
    return [
        { key: "session", labelKey: "sidePanel.session" },
        ...(knowledgeBaseEnabled
            ? ([{ key: "knowledge", labelKey: "sidePanel.knowledge" }] as const)
            : []),
        { key: "changes", labelKey: "sidePanel.changes" },
        { key: "files", labelKey: "sidePanel.files" },
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
    return tabs.includes(currentTab) ? currentTab : (tabs[0] ?? "session");
}
