const DEFAULT_CONTEXT_WINDOW = 200_000;
const GPT_5X_CONTEXT_WINDOW = 900_000;

// Context window sizes by model pattern (tokens)
const CONTEXT_WINDOW_MAP: Array<[RegExp, number]> = [
  // Any model/mode key indicating 1M context window
  // Matches: "claude-sonnet-4-6[1m]", "[1m]", "sonnet-1m", "opus-1m"
  [/\[1m\]|-1m\b/i, 1_000_000],
  // Claude 3 legacy (100K models)
  [/claude-instant-1/i, 100_000],
  [/claude-2\.0/i, 100_000],
  // Claude 3.7 Sonnet (200K)
  [/claude-3[-_.]7/i, 200_000],
  // All other Claude 3.x / 4.x — 200K
  [/claude/i, 200_000],
];

export const getContextWindowSize = (
  modelCode?: string | null,
  sdkContextWindow?: number,
): number => {
  if (modelCode === "gpt-5.5" || modelCode === "gpt-5.4") return GPT_5X_CONTEXT_WINDOW;
  if (sdkContextWindow && sdkContextWindow > 0) return sdkContextWindow;
  if (!modelCode) return DEFAULT_CONTEXT_WINDOW;
  for (const [pattern, size] of CONTEXT_WINDOW_MAP) {
    if (pattern.test(modelCode)) return size;
  }
  return DEFAULT_CONTEXT_WINDOW;
};

export const formatTokenCount = (tokens: number): string => {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M tokens`;
  } else if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K tokens`;
  }
  return `${tokens} tokens`;
};

export const formatTokenCountShort = (tokens: number): string => {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  } else if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return `${tokens}`;
};

export function formatDurationMs(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Round-based elapsed duration between two epoch-ms timestamps. Always shows the
 * finer unit (e.g. "3m 0s") and renders "--" when there is no end time yet.
 * Deliberately distinct from `formatDurationMs` (floor-based, omits zero units) —
 * folded here from byte-identical local copies in the supervisor run/loop detail
 * screens (ADR-0061).
 */
export function formatDurationBetween(startMs: number, endMs: number | null): string {
    if (!endMs) return "--";
    const seconds = Math.round((endMs - startMs) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}

// ---------------------------------------------------------------------------
// Value formatting owner (ADR-0061)
//
// Single home for how the App renders model ids, USD cost, token counts, and
// durations. Several presentations exist ON PURPOSE and are kept as distinct
// named variants rather than collapsed:
//   - tokens: `formatTokenCount` ("1.2K tokens" — with suffix) /
//     `formatTokenCountShort` ("1.2K") / `formatTokensCompact` ("1.2k" — the
//     message/turn-timeline style, lowercase unit, no suffix).
//   - duration: `formatDurationMs` (floor-based h/m/s clock) /
//     `formatDurationCompact` ("Xm Ys" or "1.4s" decimal seconds) /
//     `formatDurationBetween` (round-based elapsed between two timestamps,
//     always shows finer unit, "--" when unfinished).
//   - cost: `formatCostUsd` (adaptive: 4 decimals under a cent, else 2). The
//     always-4-decimals "precise" style in the usage/supervisor detail views is
//     a deliberately different presentation and stays local to those screens.
// Only byte-identical local copies were folded in here; divergent variants stay
// put (see the ADR for the full list).
// ---------------------------------------------------------------------------

/**
 * Strip a trailing 8-digit date suffix from a raw model id
 * ("claude-sonnet-4-6-20250514" → "claude-sonnet-4-6"). Returns the raw id, NOT
 * a prettified label — for "Opus (1M)" / "GPT-5" style labels use
 * `sessionModelLabel` or `modelModeOptions.formatModelName`.
 */
export const formatModelName = (model: string): string => model.replace(/-\d{8}$/, "");

/** Adaptive USD cost: 4 decimals under a cent, else 2 ("$0.0042" / "$1.20"). */
export const formatCostUsd = (costUsd: number): string =>
  costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(2)}`;

/**
 * Compact token count, lowercase unit, no "tokens" suffix — the message and
 * turn-timeline style ("1.2M" / "1.2k" / "42"). Distinct from
 * `formatTokenCountShort` (uppercase K) and `formatTokenCount` (with suffix).
 */
export const formatTokensCompact = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
};

/**
 * Compact duration: "Xm Ys" over a minute, else decimal seconds ("1.4s").
 * For the floor-based h/m/s clock form use `formatDurationMs`; the turn timeline
 * keeps its own variant that additionally renders sub-second as "Xms".
 */
export const formatDurationCompact = (ms: number): string => {
  if (ms >= 60_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  return `${(ms / 1000).toFixed(1)}s`;
};
