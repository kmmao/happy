/**
 * Extracts background tasks from session messages.
 *
 * A background task is created when Claude uses Bash(run_in_background: true).
 * The reducer marks such tool calls with backgroundTaskId + outputFile fields.
 * This hook scans the message list and returns a flat array of active/completed tasks.
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

export function useBackgroundTasks(messages: readonly Message[]): readonly BackgroundTask[] {
    return React.useMemo(() => {
        const tasks: BackgroundTask[] = [];

        for (const msg of messages) {
            if (msg.kind !== "tool-call") continue;
            const { tool } = msg;
            if (!tool.backgroundTaskId || !tool.outputFile) continue;

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
}
