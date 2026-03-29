/**
 * Lightweight hook that provides the last line of a background task's output.
 *
 * Primary: listens for task-log ephemeral events and extracts the last line.
 * Fallback: polls tail -n 1 every 5s (for older CLI versions or non-background tasks).
 *
 * For Docker tasks, also checks if the container is still running via docker inspect.
 * Polling stops when `enabled` is false or the component unmounts.
 */

import * as React from "react";
import { sessionBash } from "@/sync/ops";
import { sync } from "@/sync/sync";

const POLL_INTERVAL_MS = 5000;

function stripAnsi(line: string): string {
    // eslint-disable-next-line no-control-regex
    return line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
}

/** Extract Docker container name from a docker run command (sanitized) */
function extractDockerName(command: string): string | null {
    const match = command.match(/--name\s+(\S+)/);
    if (!match) return null;
    // Only allow safe container name characters to prevent command injection
    return /^[a-zA-Z0-9_.-]+$/.test(match[1]) ? match[1] : null;
}

/** Escape a file path for safe shell interpolation via single quotes */
function shellEscape(path: string): string {
    return `'${path.replace(/'/g, "'\\''")}'`;
}

export type BackgroundTaskLineState = {
    readonly lastLine: string;
    readonly isDead: boolean;
};

export function useBackgroundTaskLastLine(
    sessionId: string,
    outputFile: string | null,
    command: string,
    enabled: boolean,
    taskId?: string,
): BackgroundTaskLineState {
    const [state, setState] = React.useState<BackgroundTaskLineState>({
        lastLine: "",
        isDead: false,
    });

    const failCountRef = React.useRef(0);
    const dockerName = React.useMemo(() => extractDockerName(command), [command]);
    const isDocker = /\bdocker\s+run\b/i.test(command);

    // Listen for streaming chunks to extract last line
    React.useEffect(() => {
        if (!enabled || !taskId) return;

        const unsubscribe = sync.onTaskLog((evSessionId, evTaskId, chunk) => {
            if (evSessionId !== sessionId || evTaskId !== taskId) return;
            // Extract the last non-empty line from the chunk
            const lines = chunk.split("\n").filter((l) => l.trim().length > 0);
            if (lines.length > 0) {
                const raw = lines[lines.length - 1];
                setState({ lastLine: stripAnsi(raw), isDead: false });
                failCountRef.current = 0;
            }
        });

        return unsubscribe;
    }, [enabled, taskId, sessionId]);

    // Fallback polling
    const fetchLastLine = React.useCallback(async () => {
        if (!outputFile) return;

        // For Docker tasks: check if container is still running
        if (isDocker && dockerName) {
            try {
                const check = await sessionBash(sessionId, {
                    command: `docker inspect --format='{{.State.Running}}' ${dockerName} 2>/dev/null || echo "false"`,
                });
                const running = (check.stdout ?? "").trim();
                if (running === "false" || running === "") {
                    setState((prev) => ({ ...prev, isDead: true }));
                    return;
                }
            } catch {
                // docker not available — fall through to log check
            }
        }

        try {
            const result = await sessionBash(sessionId, {
                command: `tail -n 1 ${shellEscape(outputFile)} 2>/dev/null`,
            });
            const line = stripAnsi(result.stdout ?? "").trim();
            if (line.length > 0) {
                failCountRef.current = 0;
                setState({ lastLine: line, isDead: false });
            } else {
                failCountRef.current++;
                if (failCountRef.current >= 2) {
                    setState((prev) => ({ ...prev, isDead: true }));
                }
            }
        } catch {
            failCountRef.current++;
            if (failCountRef.current >= 2) {
                setState((prev) => ({ ...prev, isDead: true }));
            }
        }
    }, [sessionId, outputFile, isDocker, dockerName]);

    React.useEffect(() => {
        if (!enabled || !outputFile) return;
        // If we have a taskId, streaming handles real-time updates;
        // use a slower poll just for liveness checking
        const interval = taskId ? POLL_INTERVAL_MS * 6 : POLL_INTERVAL_MS;

        fetchLastLine();
        const timer = setInterval(fetchLastLine, interval);
        return () => clearInterval(timer);
    }, [enabled, outputFile, fetchLastLine, taskId]);

    return state;
}
