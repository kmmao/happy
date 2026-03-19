/**
 * Shared utilities for supervisor tabs (Health & Research).
 *
 * Extracted from ProjectHealthTab and ProjectResearchTab to eliminate duplication.
 */

import * as React from "react";

/** Format elapsed seconds as "M:SS" or "Ns". */
export function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

/**
 * Asymptotic progress estimate: fast at first, slows down, never hits 100%.
 * - pending phase: 0-8%  (tau=15s, cap=8%)
 * - running phase: 8-95% (tau=70s, cap=95%)
 */
export function estimateProgress(
    status: string,
    elapsedSeconds: number,
): number {
    if (status === "pending") {
        return Math.round(8 * (1 - Math.exp(-elapsedSeconds / 15)));
    }
    return Math.round(8 + 87 * (1 - Math.exp(-elapsedSeconds / 70)));
}

/** Reactively tracks seconds since a given timestamp, updating every second. */
export function useElapsedSeconds(startTimestamp: number | null): number {
    const [elapsed, setElapsed] = React.useState(0);
    React.useEffect(() => {
        if (startTimestamp == null) {
            setElapsed(0);
            return;
        }
        const calc = () =>
            Math.max(0, Math.floor((Date.now() - startTimestamp) / 1000));
        setElapsed(calc());
        const id = setInterval(() => setElapsed(calc()), 1000);
        return () => clearInterval(id);
    }, [startTimestamp]);
    return elapsed;
}

/** Dimension progress state shared by both tabs. */
export interface DimensionProgress {
    readonly currentDimension: string;
    readonly dimensionIndex: number;
    readonly totalDimensions: number;
}
