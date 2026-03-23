/**
 * Extracts active tasks from session messages for the BackgroundTaskBar.
 *
 * Two kinds of tasks are shown:
 * 1. **Background tasks** — Bash(run_in_background: true). These persist across
 *    states (running / completed / failed) and support log polling via outputFile.
 * 2. **Foreground commands** — Regular Bash/CodexBash calls that are still executing
 *    (tool.state === "running"). These disappear automatically once they complete.
 *
 * Supports manual dismissal of individual tasks via dismissTask().
 */

import * as React from "react";
import { Message } from "@/sync/typesMessage";

export type BackgroundTask = {
    readonly taskId: string;
    readonly callId: string;
    readonly command: string;
    readonly description: string;
    readonly outputFile: string | null;
    readonly startedAt: number;
    readonly status: "running" | "completed" | "failed";
    /** True for run_in_background tasks that have an output file for log polling */
    readonly isBackground: boolean;
};

export type BackgroundTasksResult = {
    readonly tasks: readonly BackgroundTask[];
    readonly dismissTask: (taskId: string) => void;
};

export function useBackgroundTasks(messages: readonly Message[]): BackgroundTasksResult {
    const [dismissed, setDismissed] = React.useState<ReadonlySet<string>>(new Set());

    const allTasks = React.useMemo(() => {
        const tasks: BackgroundTask[] = [];

        for (const msg of messages) {
            if (msg.kind !== "tool-call") continue;
            const { tool } = msg;

            // Only Bash-like tools — Agent/Task tools have their own sidechain UI
            if (tool.name !== "Bash" && tool.name !== "CodexBash") continue;

            const isBackground = Boolean(tool.backgroundTaskId && tool.outputFile);

            // Only show tasks that are still running
            if (tool.state !== "running") continue;

            const command =
                typeof tool.input?.command === "string"
                    ? tool.input.command
                    : "unknown";
            const description =
                typeof tool.input?.description === "string"
                    ? tool.input.description
                    : command;

            tasks.push({
                taskId: tool.backgroundTaskId ?? msg.id,
                callId: msg.id,
                command,
                description,
                outputFile: tool.outputFile ?? null,
                startedAt: tool.startedAt ?? msg.createdAt,
                isBackground,
                status: "running" as const,
            });
        }

        // Deduplicate: when the same command is run multiple times (e.g. restarting
        // a Docker container), only keep the latest entry per command string.
        const seen = new Map<string, number>();
        for (let i = tasks.length - 1; i >= 0; i--) {
            const key = tasks[i].command;
            if (!seen.has(key)) {
                seen.set(key, i);
            }
        }
        const deduped = tasks.filter((_, i) => {
            const key = tasks[i].command;
            return seen.get(key) === i;
        });

        return deduped;
    }, [messages]);

    const tasks = React.useMemo(
        () => allTasks.filter((t) => !dismissed.has(t.taskId)),
        [allTasks, dismissed],
    );

    const dismissTask = React.useCallback((taskId: string) => {
        setDismissed((prev) => {
            const next = new Set(prev);
            next.add(taskId);
            return next;
        });
    }, []);

    return { tasks, dismissTask };
}
