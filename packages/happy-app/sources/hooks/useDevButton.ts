/**
 * Computes the Dev button state by matching DevConfig services
 * against running BackgroundTasks.
 *
 * Matching strategy:
 * 1. Port match (most reliable): task port === service port
 * 2. Command substring: task command contains service command's core verb
 */

import * as React from "react";
import type { DevConfig } from "@/utils/devYmlParser";
import { getActiveCommand } from "@/utils/devYmlParser";
import type { BackgroundTask } from "@/hooks/useBackgroundTasks";
import { extractPort } from "@/utils/commandAnalysis";

export type DevButtonState = "hidden" | "idle" | "running" | "partial";

export type DevButtonInfo = {
    readonly state: DevButtonState;
    readonly runningCount: number;
    readonly totalCount: number;
};

export function useDevButton(
    config: DevConfig | null,
    tasks: readonly BackgroundTask[],
): DevButtonInfo {
    return React.useMemo(() => {
        if (!config || config.services.length === 0) {
            return { state: "hidden" as const, runningCount: 0, totalCount: 0 };
        }

        const totalCount = config.services.length;
        let runningCount = 0;

        for (const svc of config.services) {
            const isRunning = tasks.some((task) => {
                if (task.status !== "running") return false;

                // Match by port
                if (svc.port) {
                    const taskPort = extractPort(task.command);
                    if (taskPort && parseInt(taskPort, 10) === svc.port) return true;
                }

                // Match by command substring
                const svcCore = extractCommandCore(getActiveCommand(svc));
                if (svcCore && task.command.includes(svcCore)) return true;

                return false;
            });

            if (isRunning) runningCount++;
        }

        const state: DevButtonState =
            runningCount === 0
                ? "idle"
                : runningCount >= totalCount
                  ? "running"
                  : "partial";

        return { state, runningCount, totalCount };
    }, [config, tasks]);
}

/**
 * Extract the core command verb for matching.
 * "mvn spring-boot:run -Dspring..." → "spring-boot:run"
 * "npm run dev" → "npm run dev"
 * "docker compose up mysql -d" → "docker compose up"
 */
function extractCommandCore(command: string): string | null {
    const trimmed = command.trim();
    if (trimmed.length === 0) return null;

    // For mvn/gradle, use the goal
    const mvnMatch = trimmed.match(/(?:mvn|gradle|gradlew)\s+(\S+)/);
    if (mvnMatch) return mvnMatch[1];

    // For npm/yarn/pnpm, use "run <script>"
    const npmMatch = trimmed.match(/(npm|yarn|pnpm)\s+run\s+(\S+)/);
    if (npmMatch) return `${npmMatch[1]} run ${npmMatch[2]}`;

    // For docker compose, use up to "up" or "start"
    const dockerMatch = trimmed.match(/(docker\s+compose\s+(?:up|start))/);
    if (dockerMatch) return dockerMatch[1];

    // Fallback: first 3 tokens
    return trimmed.split(/\s+/).slice(0, 3).join(" ");
}
