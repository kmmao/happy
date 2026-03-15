/**
 * Pure utility functions for supervisor health scoring.
 * Extracted to enable unit testing and reuse across routes.
 */

export type SeverityCounts = {
    critical: number;
    high: number;
    medium: number;
    low: number;
};

export type HealthGrade = "A" | "B" | "C" | "D" | "F";

/**
 * Compute a weighted health score from severity counts.
 * Higher score = more/worse issues = less healthy.
 */
export function computeHealthScore(counts: SeverityCounts): number {
    return (
        counts.critical * 10 +
        counts.high * 5 +
        counts.medium * 2 +
        counts.low * 1
    );
}

/**
 * Derive a letter grade from a health score.
 */
export function computeHealthGrade(score: number): HealthGrade {
    if (score <= 5) return "A";
    if (score <= 15) return "B";
    if (score <= 30) return "C";
    if (score <= 50) return "D";
    return "F";
}

/**
 * Count severities from an array of objects with a `severity` field.
 */
export function countSeverities(
    actions: readonly { severity: string }[],
): SeverityCounts {
    const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const a of actions) {
        const sev = a.severity as keyof SeverityCounts;
        if (sev in counts) counts[sev]++;
    }
    return counts;
}

/**
 * Determine trend direction from two consecutive action counts.
 */
export function computeTrendDirection(
    currentCount: number,
    previousCount: number,
): "improving" | "stable" | "declining" {
    if (currentCount < previousCount) return "improving";
    if (currentCount > previousCount) return "declining";
    return "stable";
}
