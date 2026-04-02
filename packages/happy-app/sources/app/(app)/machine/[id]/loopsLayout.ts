export function getQuickActionColumnCount(options: {
    viewportWidth: number;
    isWeb: boolean;
}): number {
    if (!options.isWeb) {
        return 1;
    }
    return options.viewportWidth >= 900 ? 2 : 1;
}

export function getLoopModalMetrics(options: {
    viewportWidth: number;
    viewportHeight: number;
    isWeb: boolean;
}): {
    width: number;
    maxHeight: number;
    minWidth: number | undefined;
    borderRadius: number;
    horizontalPadding: number;
} {
    if (!options.isWeb) {
        return {
            width: Math.max(options.viewportWidth - 24, 280),
            maxHeight: Math.max(options.viewportHeight - 32, 320),
            minWidth: undefined,
            borderRadius: 16,
            horizontalPadding: 16,
        };
    }

    return {
        width: 860,
        maxHeight: Math.round(options.viewportHeight * 0.92),
        minWidth: 720,
        borderRadius: 24,
        horizontalPadding: 20,
    };
}

export function getLoopFormLayoutMode(options: {
    viewportWidth: number;
    isWeb: boolean;
}): {
    modalHeaderStacked: boolean;
    fullWidthButtons: boolean;
    compactSpacing: boolean;
} {
    const isNarrow = !options.isWeb || options.viewportWidth < 768;

    return {
        modalHeaderStacked: isNarrow,
        fullWidthButtons: isNarrow,
        compactSpacing: isNarrow,
    };
}
