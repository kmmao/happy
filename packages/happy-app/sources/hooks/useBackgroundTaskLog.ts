/**
 * Polls the output file of a background task to retrieve real-time logs.
 *
 * Uses sessionBash to execute `tail -n 200 <outputFile>` at a 3-second interval.
 * Polling only runs when `enabled` is true (i.e., the log sheet is open).
 * Stops automatically when the component unmounts or `enabled` becomes false.
 */

import * as React from "react";
import { sessionBash } from "@/sync/ops";

const POLL_INTERVAL_MS = 3000;
const TAIL_LINES = 200;

export type BackgroundTaskLogState = {
    readonly log: string;
    readonly isLoading: boolean;
    readonly error: string | null;
};

export function useBackgroundTaskLog(
    sessionId: string,
    outputFile: string | null,
    enabled: boolean,
): BackgroundTaskLogState & { readonly refresh: () => void } {
    const [state, setState] = React.useState<BackgroundTaskLogState>({
        log: "",
        isLoading: false,
        error: null,
    });

    const fetchLog = React.useCallback(async () => {
        if (!outputFile) return;
        setState((prev) => ({ ...prev, isLoading: true, error: null }));
        try {
            const result = await sessionBash(sessionId, {
                command: `tail -n ${TAIL_LINES} ${outputFile} 2>&1`,
            });
            setState({
                log: result.stdout ?? "",
                isLoading: false,
                error: null,
            });
        } catch {
            setState((prev) => ({
                ...prev,
                isLoading: false,
                error: "Failed to fetch log",
            }));
        }
    }, [sessionId, outputFile]);

    // Poll when enabled
    React.useEffect(() => {
        if (!enabled || !outputFile) return;

        // Fetch immediately
        fetchLog();

        const interval = setInterval(fetchLog, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [enabled, outputFile, fetchLog]);

    return { ...state, refresh: fetchLog };
}
