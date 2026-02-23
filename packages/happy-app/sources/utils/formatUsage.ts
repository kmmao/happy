const DEFAULT_CONTEXT_WINDOW = 200_000;

// Context window sizes by model pattern (tokens)
const CONTEXT_WINDOW_MAP: Array<[RegExp, number]> = [
  // Claude 4.6 1M context models (must be before standard 4.6 matches)
  [/claude-.*4-6.*\[1m\]/i, 1_000_000],
  // Claude 3 legacy (100K models)
  [/claude-instant-1/i, 100_000],
  [/claude-2\.0/i, 100_000],
  // Claude 3.7 Sonnet (200K)
  [/claude-3[-_.]7/i, 200_000],
  // All other Claude 3.x / 4.x — 200K
  [/claude/i, 200_000],
];

export const getContextWindowSize = (modelCode?: string | null): number => {
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
