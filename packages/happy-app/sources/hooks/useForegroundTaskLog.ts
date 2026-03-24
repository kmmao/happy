/**
 * Monitors a foreground Bash command by finding its process via ps/grep.
 *
 * Since foreground commands don't have an outputFile (the SDK captures stdout
 * in memory and only exposes it via tool_result on completion), this hook uses
 * sessionBash to periodically run monitoring commands that show:
 * - Process status, PID, CPU, memory, elapsed time
 * - Docker-specific info (containers, images) when applicable
 *
 * Polls every 3 seconds while enabled, same cadence as useBackgroundTaskLog.
 */

import * as React from "react";
import { sessionBash } from "@/sync/ops";

const POLL_INTERVAL_MS = 3000;

// ---------------------------------------------------------------------------
// Shell script builder
// ---------------------------------------------------------------------------

/** Extract a grep-safe search pattern from a command string (first line only) */
function extractSearchPattern(command: string): string {
    const firstLine = command.split("\n")[0];
    const cleaned = firstLine
        .replace(/\s+2>&1/g, "")
        .replace(/\s*[|;].*$/, "")
        .trim();
    return cleaned.slice(0, 80);
}

/** Escape a string for safe use inside single quotes in shell */
function shellEscape(str: string): string {
    return str.replace(/'/g, "'\\''");
}

/** Build a monitoring shell script based on the command being monitored */
function buildMonitorScript(command: string): string {
    const pattern = shellEscape(extractSearchPattern(command));
    const isDocker = /\bdocker\b/.test(command);
    const isDockerBuild = isDocker && /\bbuild\b/.test(command);
    const isDockerCompose = /\bdocker\s+compose\b/.test(command);

    const parts: string[] = [];

    // Find matching processes via ps + grep
    parts.push(
        `PROCS=$(ps ax -ww -o pid,pcpu,pmem,etime,command 2>/dev/null | grep -F '${pattern}' | grep -v 'grep -F')`,
        `if [ -n "$PROCS" ]; then`,
        `  echo "PID       %CPU  %MEM     ELAPSED  COMMAND"`,
        `  echo "$PROCS"`,
        // Show child processes too
        `  MAIN_PID=$(echo "$PROCS" | head -1 | awk '{print $1}')`,
        `  CHILDREN=$(ps ax -ww -o pid,ppid,pcpu,pmem,command 2>/dev/null | awk -v p="$MAIN_PID" '$2 == p')`,
        `  if [ -n "$CHILDREN" ]; then`,
        `    echo ""`,
        `    echo "── Child Processes ──"`,
        `    echo "$CHILDREN"`,
        `  fi`,
        `else`,
        `  echo "(Process not found — may have completed)"`,
        `fi`,
    );

    // Docker-specific monitoring
    if (isDockerBuild || isDockerCompose) {
        parts.push(
            `echo ""`,
            `echo "── Docker Containers ──"`,
            `docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null | head -15 || echo "(docker not available)"`,
        );
    }
    if (isDockerBuild) {
        parts.push(
            `echo ""`,
            `echo "── Docker Images (recent) ──"`,
            `docker image ls --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}' 2>/dev/null | head -10`,
        );
    }

    return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type ForegroundTaskLogState = {
    readonly log: string;
    readonly isLoading: boolean;
    readonly error: string | null;
};

export function useForegroundTaskLog(
    sessionId: string,
    command: string | null,
    enabled: boolean,
): ForegroundTaskLogState & { readonly refresh: () => void } {
    const [state, setState] = React.useState<ForegroundTaskLogState>({
        log: "",
        isLoading: false,
        error: null,
    });

    // Inline fetch inside useEffect to use mounted flag for cleanup
    const refreshRef = React.useRef<() => void>(() => {});

    React.useEffect(() => {
        if (!enabled || !command) return;
        let mounted = true;

        const fetch = async () => {
            if (!mounted) return;
            setState((prev) => ({ ...prev, isLoading: true, error: null }));
            try {
                const script = buildMonitorScript(command);
                const result = await sessionBash(sessionId, { command: script });
                if (mounted) {
                    setState({ log: result.stdout ?? "", isLoading: false, error: null });
                }
            } catch {
                if (mounted) {
                    setState((prev) => ({
                        ...prev,
                        isLoading: false,
                        error: "Failed to fetch process status",
                    }));
                }
            }
        };

        refreshRef.current = fetch;
        fetch();
        const interval = setInterval(fetch, POLL_INTERVAL_MS);
        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, [enabled, command, sessionId]);

    return { ...state, refresh: refreshRef.current };
}
