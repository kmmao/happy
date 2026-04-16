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
