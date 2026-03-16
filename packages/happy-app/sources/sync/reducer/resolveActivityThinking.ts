/**
 * Resolves the thinking state when an ephemeral activity heartbeat arrives.
 *
 * Lifecycle events (turn-start / turn-end) are the authoritative source for
 * thinking state transitions.  They stamp `thinkingAt = Date.now()` on the
 * app clock.  Ephemeral heartbeats arrive every ~2 s from the CLI and carry
 * their own `activeAt` timestamp (server-capped CLI clock).
 *
 * If the session's `thinkingAt` is newer than the heartbeat's `activeAt`, the
 * heartbeat is stale relative to the last lifecycle event and must NOT
 * overwrite the thinking state — otherwise the UI flashes back to "online"
 * momentarily.
 */

export interface SessionThinkingState {
    thinking: boolean;
    thinkingAt: number;
}

export interface ActivityHeartbeat {
    active: boolean;
    activeAt: number;
    thinking: boolean;
}

export interface ResolvedThinkingState {
    thinking: boolean;
    thinkingAt: number;
}

export function resolveActivityThinking(
    session: SessionThinkingState,
    heartbeat: ActivityHeartbeat,
): ResolvedThinkingState {
    const lifecycleIsNewer = session.thinkingAt > heartbeat.activeAt;

    if (lifecycleIsNewer) {
        return {
            thinking: session.thinking,
            thinkingAt: session.thinkingAt,
        };
    }

    return {
        thinking: heartbeat.active ? heartbeat.thinking : false,
        thinkingAt: heartbeat.thinking ? heartbeat.activeAt : session.thinkingAt,
    };
}
