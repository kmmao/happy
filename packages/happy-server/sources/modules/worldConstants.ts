/**
 * Shared constants for the world model subsystem (goals, decisions, suggestions, agent messages).
 *
 * Centralises magic numbers that were previously scattered across many files.
 * Import from here instead of hardcoding truncation lengths or time windows.
 */

// ---------------------------------------------------------------------------
// Text truncation
// ---------------------------------------------------------------------------

/** Truncate `str` to `max` characters, appending "…" if shortened. */
export function truncateText(str: string, max: number): string {
    if (str.length <= max) return str;
    return str.substring(0, max - 3) + "...";
}

/** Max-length rules for display text produced by the world subsystem. */
export const TEXT_LIMITS = {
    /** Goal / decision inbox title (leaves room for prefix text). */
    TITLE: 80,
    /** Task label inside a composed suggestion title. */
    TASK_LABEL: 60,
    /** Goal title inside a composed suggestion title. */
    GOAL_TITLE_IN_PREFIX: 56,
    /** Decision question inside a composed suggestion title. */
    DECISION_QUESTION: 50,
    /** Decision question in evidence / reason text (longer). */
    DECISION_QUESTION_LONG: 80,
    /** Short reason / error excerpt. */
    REASON_SHORT: 160,
    /** Long reason / summary. */
    REASON_LONG: 200,
    /** Skill evidence label. */
    EVIDENCE_LABEL: 100,
    /** Agent message body preview in inbox. */
    AGENT_MSG_BODY: 200,
    /** Prompt preview in serialised task. */
    PROMPT_PREVIEW: 100,
    /** Constitution generator convention descriptions. */
    CONVENTION_DESC: 120,
} as const;

// ---------------------------------------------------------------------------
// Time windows (milliseconds)
// ---------------------------------------------------------------------------

export const TIME_MS = {
    /** Default decision / repeat-key expiry. */
    DAY: 24 * 60 * 60 * 1000,
    /** Suggestion "processing" considered stale after this. */
    PROCESSING_STALE: 5 * 60 * 1000,
    /** Suggestion refresh debounce window. */
    REFRESH_DEBOUNCE: 10_000,
    /** Goal planning result timeout. */
    PLANNING_TIMEOUT: 10 * 60 * 1000,
    /** Dispatching recovery window. */
    DISPATCHING_RECOVERY: 2 * 60 * 1000,
    // Stage G: Goal health thresholds
    /** in_progress goal with no task updates for this long → warning. */
    STALE_IN_PROGRESS_WARN: 48 * 60 * 60 * 1000,
    /** in_progress goal with no task updates for this long → critical. */
    STALE_IN_PROGRESS_CRITICAL: 96 * 60 * 60 * 1000,
    /** Blocked goal still blocked after this long → warning. */
    BLOCKED_AGING_WARN: 24 * 60 * 60 * 1000,
    /** Blocked goal still blocked after this long → critical. */
    BLOCKED_AGING_CRITICAL: 72 * 60 * 60 * 1000,
} as const;

/** Minimum number of failed tasks before "repeated failure" signal fires. */
export const REPEATED_FAILURE_THRESHOLD = 3;
