const MIN_CONCRETE_SUMMARY_LENGTH = 24;

const EXACT_UNSTABLE_SUMMARIES = new Set([
    "done",
    "completed successfully",
    "task completed successfully",
]);

const UNSTABLE_PHRASES = [
    "need user decision",
    "waiting for user",
    "blocked",
    "todo",
];

const GENERIC_COMPLETION_PATTERNS = [
    /^(?:completed|implemented) (?:the )?requested (?:changes|updates) and verified (?:everything|it) works as expected[.!]*$/,
    /^(?:completed|implemented) (?:the )?requested (?:changes|updates), and verified (?:everything|it) works as expected[.!]*$/,
];

const IMPLEMENTATION_ACTION_PATTERN = /\b(updated?|refactored?|reused?|hardened|optimized|fixed|patched|migrated|added|removed|collapsed|capped|deduped|inlined|improved|switched|extracted)\b/;

const IMPLEMENTATION_NOUN_PHRASE_PATTERN = /\b(?:oauth|auth|token|callback|flow|middleware|header|query|schema|migration|route|validator|session|key|retry|backoff|delay|queue|loop|cache|events?|repeat key|index|timeout|scheduler|jwks|parser|parsing)\b[^.]{0,40}\b(?:hardening|caching|deduplication|starvation|validator)\b/;

const IMPLEMENTATION_DETAIL_PATTERNS = [
    /\b(?:updated?|refactored?|reused?|hardened|optimized|fixed|patched|migrated|added|removed|collapsed|capped|deduped|inlined|improved|switched|extracted)\b[^.]{4,}/,
    /:\s*(?:updated?|refactored?|reused?|hardened|optimized|fixed|patched|migrated|added|removed|collapsed|capped|deduped|inlined|improved|switched|extracted)\b[^.]{4,}/,
    IMPLEMENTATION_NOUN_PHRASE_PATTERN,
    /\band\s+(?:capped|deduped|reused?|cached|validated|verified|removed|added|switched|extracted|improved)\b[^.]{4,}/,
];

const HARD_REJECT_PATTERNS = [
    /^verified\b.*\btests?\b.*\bpass(?:ed)?[.!]*$/,
];

const GENERIC_FILLER_PATTERNS = [
    /\brequested (?:change|changes|fix|fixes|update|updates)\b/g,
    /\ball tests passed(?: successfully)?\b/g,
    /\bworks as expected\b/g,
];

export function normalizeSuggestionFactText(input: string | null, fallback: string): string {
    const normalized = input?.trim();
    return normalized && normalized.length > 0 ? normalized : fallback;
}

export function normalizeConcreteImplementationSummary(input: string): string | null {
    const summary = input.trim();
    if (summary.length < MIN_CONCRETE_SUMMARY_LENGTH) return null;

    const lower = summary.toLowerCase();
    if (EXACT_UNSTABLE_SUMMARIES.has(lower)) {
        return null;
    }

    if (UNSTABLE_PHRASES.some((phrase) => lower.includes(phrase))) {
        return null;
    }

    if (GENERIC_COMPLETION_PATTERNS.some((pattern) => pattern.test(lower))) {
        return null;
    }

    if (!hasConcreteImplementationDetail(lower)) {
        return null;
    }

    return summary;
}

function hasConcreteImplementationDetail(summary: string): boolean {
    if (HARD_REJECT_PATTERNS.some((pattern) => pattern.test(summary))) {
        return false;
    }

    if (!IMPLEMENTATION_ACTION_PATTERN.test(summary) && !IMPLEMENTATION_NOUN_PHRASE_PATTERN.test(summary)) {
        return false;
    }

    const hasImplementationDetail = IMPLEMENTATION_DETAIL_PATTERNS.some((pattern) => pattern.test(summary));
    if (!hasImplementationDetail) {
        return false;
    }

    const strippedGenericFillers = GENERIC_FILLER_PATTERNS.reduce((result, pattern) => result.replace(pattern, ""), summary).trim();

    return strippedGenericFillers.length >= MIN_CONCRETE_SUMMARY_LENGTH;
}
