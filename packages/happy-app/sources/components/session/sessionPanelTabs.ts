export type SessionPanelTab =
    | "session"
    | "files"
    | "changes"
    | "preview"
    | "terminal"
    | "claude";

export type SessionPanelTabTranslationKey =
    | "sidePanel.session"
    | "sidePanel.files"
    | "sidePanel.changes"
    | "sidePanel.preview"
    | "sidePanel.terminal"
    | "sidePanel.claude";

export interface SessionPanelTabDefinition {
    key: SessionPanelTab;
    labelKey: SessionPanelTabTranslationKey;
}

export interface SessionPanelTabOptions {
    enablePreviewTab: boolean;
}

export function getSessionPanelTabs(
    options: SessionPanelTabOptions,
): SessionPanelTab[] {
    return getSessionPanelTabDefinitions(options).map((tab) => tab.key);
}

export function getSessionPanelTabDefinitions(
    options: SessionPanelTabOptions,
): SessionPanelTabDefinition[] {
    const { enablePreviewTab } = options;
    return [
        { key: "session", labelKey: "sidePanel.session" },
        { key: "changes", labelKey: "sidePanel.changes" },
        { key: "files", labelKey: "sidePanel.files" },
        ...(enablePreviewTab
            ? ([{ key: "preview", labelKey: "sidePanel.preview" }] as const)
            : []),
        { key: "terminal", labelKey: "sidePanel.terminal" },
        // Always present — mirrors the Claude CLI PTY for the session. When
        // no Claude TUI is attached the tab itself renders a placeholder
        // (mirrors how SidePanelTerminalTab handles `sessionOffline`).
        { key: "claude", labelKey: "sidePanel.claude" },
    ];
}

export function resolveSessionPanelActiveTab(
    currentTab: SessionPanelTab,
    tabs: readonly SessionPanelTab[],
): SessionPanelTab {
    return tabs.includes(currentTab) ? currentTab : (tabs[0] ?? "session");
}
