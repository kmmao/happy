/**
 * Lightweight hook that polls only the last line of a background task's output.
 *
 * Unlike useBackgroundTaskLog (which fetches 200 lines every 3s for the log sheet),
 * this hook reads only 1 line at a 5-second interval — designed for the compact
 * BackgroundTaskBar where we just need a live status glimpse.
 *
 * For Docker tasks, also checks if the container is still running via docker inspect.
 * Polling stops when `enabled` is false or the component unmounts.
 */

import * as React from "react";
import { sessionBash } from "@/sync/ops";

const POLL_INTERVAL_MS = 5000;

function stripAnsi(line: string): string {
    // eslint-disable-next-line no-control-regex
    return line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
}

/** Extract Docker container name from a docker run command */
function extractDockerName(command: string): string | null {
    const match = command.match(/--name\s+(\S+)/);
    return match ? match[1] : null;
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
): BackgroundTaskLineState {
    const [state, setState] = React.useState<BackgroundTaskLineState>({
        lastLine: "",
        isDead: false,
    });

    const failCountRef = React.useRef(0);
    const dockerName = React.useMemo(() => extractDockerName(command), [command]);
    const isDocker = /\bdocker\s+run\b/i.test(command);

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
                command: `tail -n 1 ${outputFile} 2>/dev/null`,
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

        fetchLastLine();

        const interval = setInterval(fetchLastLine, POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [enabled, outputFile, fetchLastLine]);

    return state;
}
