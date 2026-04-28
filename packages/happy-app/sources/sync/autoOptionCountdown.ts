function getDisplayedCountdownSeconds(remainingMs: number): number {
    return Math.ceil(remainingMs / 1000);
}

export function shouldPublishCountdownRemaining(
    previousRemainingMs: number | null | undefined,
    nextRemainingMs: number,
): boolean {
    if (nextRemainingMs <= 0) return true;
    if (previousRemainingMs == null) return true;

    return getDisplayedCountdownSeconds(previousRemainingMs) !== getDisplayedCountdownSeconds(nextRemainingMs);
}
