/**
 * Utilities for analyzing background task commands.
 *
 * Extracts meaningful labels, ports, and categories from raw shell commands
 * to display in BackgroundTaskBar and BackgroundTaskLogSheet.
 */

import { Ionicons } from "@expo/vector-icons";

export type TaskCategory = "server" | "test" | "build" | "watch" | "generic";

export const categoryIcon: Record<TaskCategory, keyof typeof Ionicons.glyphMap> = {
    server: "globe-outline",
    test: "flask-outline",
    build: "hammer-outline",
    watch: "eye-outline",
    generic: "terminal-outline",
};

export const categoryColor: Record<TaskCategory, string> = {
    server: "#4CAF50",
    test: "#FF9800",
    build: "#2196F3",
    watch: "#9C27B0",
    generic: "#78909C",
};

export function detectCategory(command: string): TaskCategory {
    const lower = command.toLowerCase();

    if (
        /\b(serve|server|dev|start|preview|http\.server|uvicorn|gunicorn|flask run|rails s|php -S)\b/.test(lower) ||
        /\bnext\b/.test(lower) ||
        /\bnuxt\b/.test(lower) ||
        /\bvite\b(?!st)/.test(lower)
    ) {
        return "server";
    }

    if (/\b(test|vitest|jest|pytest|mocha|cypress|playwright)\b/.test(lower)) {
        return "test";
    }

    if (/\b(build|compile|tsc|webpack|rollup|esbuild|pkgroll)\b/.test(lower)) {
        return "build";
    }

    if (/\b(watch|nodemon|chokidar)\b/.test(lower)) {
        return "watch";
    }

    return "generic";
}

export function extractPort(command: string): string | null {
    const flagMatch = command.match(/(?:--port|--Port|-p|-P)[=\s]+(\d{2,5})\b/);
    if (flagMatch) return flagMatch[1];

    const httpServerMatch = command.match(/http\.server\s+(\d{2,5})\b/);
    if (httpServerMatch) return httpServerMatch[1];

    const colonMatch = command.match(/:(\d{2,5})(?:\s|$|\/)/);
    if (colonMatch) return colonMatch[1];

    return null;
}

export function extractCommandName(command: string): string {
    const stripped = command.replace(/^(\s*\w+=\S+\s+)*/, "");
    const match = stripped.match(/^(npx|yarn|pnpm|npm)\s+(run\s+)?(\S+)/);
    if (match) return match[3];
    const pyMatch = stripped.match(/python[23]?\s+-m\s+(\S+)/);
    if (pyMatch) return pyMatch[1];
    const first = stripped.split(/\s+/)[0];
    return first.split("/").pop() ?? first;
}

export function buildSmartLabel(command: string): string {
    const port = extractPort(command);
    const cmdName = extractCommandName(command);
    return port ? `${cmdName} :${port}` : cmdName;
}
