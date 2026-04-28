export interface ChatListTimingDecisionInput {
    durationMs: number;
    thresholdMs: number;
    nowMs: number;
    lastLoggedAtMs: number | null;
    cooldownMs: number;
}

export function shouldLogChatListTiming(input: ChatListTimingDecisionInput): boolean {
    if (input.durationMs < input.thresholdMs) return false;
    if (input.lastLoggedAtMs == null) return true;
    return input.nowMs - input.lastLoggedAtMs >= input.cooldownMs;
}
