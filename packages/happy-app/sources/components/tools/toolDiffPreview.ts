const DIFF_PREVIEW_LINE_HEIGHT = 20;

export function getDiffPreviewMaxHeight(visibleLineCount?: number): number | undefined {
    if (visibleLineCount == null) {
        return undefined;
    }

    return visibleLineCount * DIFF_PREVIEW_LINE_HEIGHT;
}
