/**
 * Provides real-time logs from a background task.
 *
 * Primary: subscribes to CLI task-log streaming via RPC + ephemeral events.
 * Fallback: polls the output file every 5s via sessionBash (for older CLI versions).
 *
 * On open:
 * 1. Fetch initial log via sessionBash (tail -n 200)
 * 2. Call subscribeTaskLog RPC to start real-time streaming
 * 3. Listen for task-log ephemeral events and append chunks
 *
 * On close: call unsubscribeTaskLog RPC.
 */

import * as React from "react";
import { sessionBash, subscribeTaskLog, unsubscribeTaskLog } from "@/sync/ops";
import { sync } from "@/sync/sync";

const FALLBACK_POLL_INTERVAL_MS = 5000;
const TAIL_LINES = 200;
const MAX_LOG_LENGTH = 100_000; // Trim log if it exceeds ~100KB

export type BackgroundTaskLogState = {
    readonly log: string;
    readonly isLoading: boolean;
    readonly error: string | null;
    readonly isStreaming: boolean;
};

export function useBackgroundTaskLog(
    sessionId: string,
    outputFile: string | null,
    enabled: boolean,
    taskId?: string,
): BackgroundTaskLogState & { readonly refresh: () => void } {
    const [state, setState] = React.useState<BackgroundTaskLogState>({
        log: "",
        isLoading: false,
        error: null,
        isStreaming: false,
    });

    const streamingRef = React.useRef(false);

    // Fetch initial log snapshot
    const fetchLog = React.useCallback(async () => {
        if (!outputFile) return;
        setState((prev) => ({ ...prev, isLoading: true, error: null }));
        try {
            const result = await sessionBash(sessionId, {
                command: `tail -n ${TAIL_LINES} '${outputFile.replace(/'/g, "'\\''")}' 2>&1`,
            });
            setState((prev) => ({
                ...prev,
                log: result.stdout ?? "",
                isLoading: false,
                error: null,
            }));
        } catch {
            setState((prev) => ({
                ...prev,
                isLoading: false,
                error: "Failed to fetch log",
            }));
        }
    }, [sessionId, outputFile]);

    // Subscribe to real-time streaming
    React.useEffect(() => {
        if (!enabled || !outputFile || !taskId) return;

        // Fetch initial log
        fetchLog();

        // Try to subscribe to real-time streaming
        let cancelled = false;
        void (async () => {
            const result = await subscribeTaskLog(sessionId, taskId, outputFile);
            if (cancelled) return;
            if (result.ok) {
                streamingRef.current = true;
                setState((prev) => ({ ...prev, isStreaming: true }));
            }
        })();

        // Listen for streaming chunks — only append, never overlap with initial fetch
        let receivedFirstChunk = false;
        const unsubscribeListener = sync.onTaskLog((evSessionId, evTaskId, chunk) => {
            if (evSessionId !== sessionId || evTaskId !== taskId) return;
            setState((prev) => {
                // On first streaming chunk, trim any overlap with the tail of existing log
                if (!receivedFirstChunk) {
                    receivedFirstChunk = true;
                    if (prev.log.length > 0) {
                        // Check if chunk starts with content already at the end of the log
                        const tailLen = Math.min(200, prev.log.length);
                        const logTail = prev.log.slice(-tailLen);
                        const overlapIdx = chunk.indexOf(logTail.slice(-50));
                        if (overlapIdx >= 0 && overlapIdx < 100) {
                            // Trim the overlapping prefix from the chunk
                            const trimmedChunk = chunk.slice(overlapIdx + logTail.slice(-50).length);
                            if (trimmedChunk.length === 0) return prev;
                            const newLog = prev.log + trimmedChunk;
                            const trimmed = newLog.length > MAX_LOG_LENGTH
                                ? newLog.slice(newLog.length - MAX_LOG_LENGTH)
                                : newLog;
                            return { ...prev, log: trimmed };
                        }
                    }
                }
                const newLog = prev.log + chunk;
                const trimmed = newLog.length > MAX_LOG_LENGTH
                    ? newLog.slice(newLog.length - MAX_LOG_LENGTH)
                    : newLog;
                return { ...prev, log: trimmed };
            });
        });

        return () => {
            cancelled = true;
            unsubscribeListener();
            // Always attempt unsubscribe — even if subscribeTaskLog hasn't returned yet,
            // the RPC will be a no-op on the CLI side if no watcher exists
            streamingRef.current = false;
            void unsubscribeTaskLog(sessionId, taskId);
        };
    }, [enabled, outputFile, taskId, sessionId, fetchLog]);

    // Fallback polling when streaming is not available
    React.useEffect(() => {
        if (!enabled || !outputFile || state.isStreaming) return;
        if (taskId) return; // We already tried streaming, don't double-poll during setup

        // Pure fallback mode (no taskId available)
        fetchLog();
        const interval = setInterval(fetchLog, FALLBACK_POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [enabled, outputFile, state.isStreaming, taskId, fetchLog]);

    return { ...state, refresh: fetchLog };
}
