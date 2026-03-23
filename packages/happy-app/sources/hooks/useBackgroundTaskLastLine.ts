/**
 * Lightweight hook that polls only the last line of a background task's output.
 *
 * Unlike useBackgroundTaskLog (which fetches 200 lines every 3s for the log sheet),
 * this hook reads only 1 line at a 5-second interval — designed for the compact
 * BackgroundTaskBar where we just need a live status glimpse.
 *
 * Also detects process exit signals in the output to report dead tasks.
 * Polling stops when `enabled` is false or the component unmounts.
 */

import * as React from "react";
import { sessionBash } from "@/sync/ops";

const POLL_INTERVAL_MS = 5000;

/** Patterns that indicate the background process has exited */
const EXIT_PATTERNS = [
    /\berror waiting for container\b/i,
    /\bunexpected EOF\b/i,
    /\bcontainer .* exited\b/i,
    /\bprocess exited\b/i,
    /\bconnection refused\b/i,
];

function stripAnsi(line: string): string {
    // eslint-disable-next-line no-control-regex
    return line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
}

function detectExit(line: string): boolean {
    return EXIT_PATTERNS.some((p) => p.test(line));
}

export type BackgroundTaskLineState = {
    readonly lastLine: string;
    readonly isDead: boolean;
};

export function useBackgroundTaskLastLine(
    sessionId: string,
    outputFile: string | null,
    enabled: boolean,
): BackgroundTaskLineState {
    const [state, setState] = React.useState<BackgroundTaskLineState>({
        lastLine: "",
        isDead: false,
    });

    const fetchLastLine = React.useCallback(async () => {
        if (!outputFile) return;
        try {
            const result = await sessionBash(sessionId, {
                command: `tail -n 1 ${outputFile} 2>/dev/null`,
            });
            const line = stripAnsi(result.stdout ?? "").trim();
            if (line.length > 0) {
                setState({ lastLine: line, isDead: detectExit(line) });
            }
        } catch {
            // Best effort — ignore failures
        }
    }, [sessionId, outputFile]);

    React.useEffect(() => {
        if (!enabled || !outputFile) return;

        fetchLastLine();

        const interval = setInterval(fetchLastLine, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [enabled, outputFile, fetchLastLine]);

    return state;
}
