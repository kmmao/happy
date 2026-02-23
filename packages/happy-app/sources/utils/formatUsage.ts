export const MAX_CONTEXT_SIZE = 200000;

// Context window sizes by model pattern (tokens)
const CONTEXT_WINDOW_MAP: Array<[RegExp, number]> = [
  // Claude 3 legacy (100K models)
  [/claude-instant-1/i, 100000],
  [/claude-2\.0/i, 100000],
  // Claude 3.7 Sonnet (200K)
  [/claude-3[-_.]7/i, 200000],
  // All other Claude 3.x / 4.x — 200K
  [/claude/i, 200000],
];

export const getContextWindowSize = (modelCode?: string | null): number => {
  if (!modelCode) return MAX_CONTEXT_SIZE;
  for (const [pattern, size] of CONTEXT_WINDOW_MAP) {
    if (pattern.test(modelCode)) return size;
  }
  return MAX_CONTEXT_SIZE;
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

export const getContextRemainingPercent = (contextSize: number): number => {
  const percentageUsed = (contextSize / MAX_CONTEXT_SIZE) * 100;
  return Math.max(0, Math.min(100, Math.round(100 - percentageUsed)));
};
