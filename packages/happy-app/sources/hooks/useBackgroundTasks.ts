/**
 * Provides the list of active background tasks from the reducer's
 * SDK event-driven registry (task-start / task-progress / task-end).
 *
 * No longer scans messages — reads directly from ReducerState.backgroundTasks.
 * Supports manual dismissal via dismissTask().
 */

import * as React from "react";
import { BackgroundTaskEntry } from "@/sync/reducer/reducer";

export type BackgroundTask = {
    readonly taskId: string;
    readonly command: string;
    readonly description: string;
    readonly outputFile: string | null;
    readonly startedAt: number;
    /** The hook filters to "running" only, but the broad union is needed because
     *  BackgroundTaskLogSheet can observe status transitions while the sheet is open. */
    readonly status: "running" | "completed" | "failed" | "stopped";
    readonly summary: string | null;
    /** Always true — only SDK background tasks are tracked here */
    readonly isBackground: true;
};

export type BackgroundTasksResult = {
    readonly tasks: readonly BackgroundTask[];
    readonly dismissTask: (taskId: string) => void;
};

const EMPTY_TASKS: readonly BackgroundTask[] = [];

export function useBackgroundTasks(
    entries: ReadonlyMap<string, BackgroundTaskEntry>,
    isConnected: boolean = true,
): BackgroundTasksResult {
    const [dismissed, setDismissed] = React.useState<ReadonlySet<string>>(new Set());

    const tasks = React.useMemo(() => {
        if (!isConnected) return EMPTY_TASKS;

        const result: BackgroundTask[] = [];
        for (const entry of entries.values()) {
            if (entry.status !== "running") continue;
            if (dismissed.has(entry.taskId)) continue;
            result.push({
                taskId: entry.taskId,
                command: entry.command,
                description: entry.description,
                outputFile: entry.outputFile,
                startedAt: entry.startedAt,
                status: entry.status,
                summary: entry.summary,
                isBackground: true,
            });
        }
        return result;
    }, [entries, isConnected, dismissed]);

    const dismissTask = React.useCallback((taskId: string) => {
        setDismissed((prev) => {
            const next = new Set(prev);
            next.add(taskId);
            return next;
        });
    }, []);

    return { tasks, dismissTask };
}
