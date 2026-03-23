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

            // Foreground commands: only show while running
            if (!isBackground && tool.state !== "running") continue;

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
                status:
                    tool.state === "error"
                        ? "failed"
                        : tool.state === "completed"
                          ? "completed"
                          : "running",
            });
        }

        return tasks;
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
