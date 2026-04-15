export type MobileSessionPanelTab =
    | "files"
    | "changes"
    | "code"
    | "preview"
    | "summary"
    | "terminal";

interface MobileSessionPanelVisibilityInput {
    showSidePanelOuter: boolean;
    sessionIsOnline: boolean;
}

export function shouldShowMobileSessionPanelButton({
    showSidePanelOuter,
    sessionIsOnline,
}: MobileSessionPanelVisibilityInput): boolean {
    return !showSidePanelOuter && sessionIsOnline;
}

export function getMobileSessionPanelTabs(): MobileSessionPanelTab[] {
    return ["files", "changes", "code", "preview", "summary", "terminal"];
}
