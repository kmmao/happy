export const MOBILE_MODEL_SELECTOR_MAX_WIDTH = 700;

export function shouldUseModelSelectorModal({
    screenWidth,
}: {
    platformOs: string;
    screenWidth: number;
}): boolean {
    return screenWidth < MOBILE_MODEL_SELECTOR_MAX_WIDTH;
}
