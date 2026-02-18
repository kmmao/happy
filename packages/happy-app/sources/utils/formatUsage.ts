export const MAX_CONTEXT_SIZE = 190000;

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
