/**
 * Extracts background tasks from session messages.
 *
 * A background task is created when Claude uses Bash(run_in_background: true).
 * The reducer marks such tool calls with backgroundTaskId + outputFile fields.
 * This hook scans the message list and returns a flat array of active/completed tasks.
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
    readonly outputFile: string;
    readonly startedAt: number;
    readonly status: "running" | "completed" | "failed";
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
            if (!tool.backgroundTaskId || !tool.outputFile) continue;

            // Only show Bash background tasks — Agent/Task tools have their own sidechain UI
            if (tool.name !== "Bash" && tool.name !== "CodexBash") continue;

            const command =
                typeof tool.input?.command === "string"
                    ? tool.input.command
                    : "unknown";
            const description =
                typeof tool.input?.description === "string"
                    ? tool.input.description
                    : command;

            tasks.push({
                taskId: tool.backgroundTaskId,
                callId: msg.id,
                command,
                description,
                outputFile: tool.outputFile,
                startedAt: tool.startedAt ?? msg.createdAt,
                // tool.state is managed by the reducer:
                // - stays "running" after tool_result (background tasks keep running)
                // - set to "completed" when task-end event arrives
                // - set to "error" on failure
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
