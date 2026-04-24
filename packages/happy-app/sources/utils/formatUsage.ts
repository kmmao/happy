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
