export function parseIntervalMs(raw: string): number | null {
    const match = raw.trim().match(/^(\d+)([smhd])$/i);
    if (!match) {
        return null;
    }
    const value = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multiplier = unit === "s" ? 1_000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return value * multiplier;
}

export function formatIntervalMs(ms: number): string {
    if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
    if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
    if (ms % 60_000 === 0) return `${ms / 60_000}m`;
    return `${Math.round(ms / 1_000)}s`;
}

export function formatTimestamp(value?: number | null): string {
    if (!value) {
        return "-";
    }
    return new Date(value).toLocaleString();
}

export function isRpcMethodUnavailableError(error: unknown): boolean {
    return error instanceof Error && error.message === "RPC method not available";
}

export function parseEnvironmentVariables(raw: string): Record<string, string> | undefined {
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
        return undefined;
    }
    const entries: Record<string, string> = {};
    for (const line of lines) {
        const idx = line.indexOf("=");
        if (idx <= 0) {
            throw new Error("Invalid environment variable format (expected KEY=VALUE)");
        }
        entries[line.slice(0, idx).trim()] = line.slice(idx + 1);
    }
    return Object.keys(entries).length > 0 ? entries : undefined;
}

export function formatEnvironmentVariables(value?: Record<string, string>): string {
    if (!value) {
        return "";
    }
    return Object.entries(value).map(([key, entry]) => `${key}=${entry}`).join("\n");
}

export function parseLineList(raw: string): string[] | undefined {
    const values = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return values.length > 0 ? values : undefined;
}

export function formatLineList(value?: string[]): string {
    return value?.join("\n") ?? "";
}

export function parsePositiveInteger(raw: string): number | null | undefined {
    const normalized = raw.trim();
    if (!normalized) {
        return undefined;
    }
    if (!/^\d+$/.test(normalized)) {
        return null;
    }
    const value = Number(normalized);
    return value > 0 ? value : null;
}

export function isValidTimeOfDay(raw: string): boolean {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(raw.trim());
}

export function parseDownstreamTriggers(raw: string): Array<"completed" | "failed"> | null | undefined {
    const values = parseLineList(raw);
    if (!values) {
        return undefined;
    }
    const normalized = [...new Set(values.map((value) => value.toLowerCase()))];
    if (normalized.every((value) => value === "completed" || value === "failed")) {
        return normalized as Array<"completed" | "failed">;
    }
    return null;
}

export function formatDownstreamTriggers(value?: Array<"completed" | "failed">): string {
    return value?.join("\n") ?? "";
}

export function normalizeMachineRootPath(path: string): string {
    const replaced = path.trim().replace(/\\/g, "/");
    const trimmed = replaced.replace(/\/+$/, "");
    return trimmed || "/";
}

/** Longest shared directory prefix for absolute-style paths (Unix /… or Windows drive paths). */
export function commonDirectoryPrefix(paths: string[]): string {
    if (paths.length === 0) {
        return "";
    }
    const normalized = paths
        .map((p) => normalizeMachineRootPath(p))
        .filter((p) => p.length > 0);
    if (normalized.length === 0) {
        return "";
    }
    const firstParts = normalized[0]!.split("/").filter(Boolean);
    if (firstParts.length === 0) {
        return "/";
    }
    let depth = firstParts.length;
    for (let i = 1; i < normalized.length; i++) {
        const parts = normalized[i]!.split("/").filter(Boolean);
        let j = 0;
        while (j < depth && j < parts.length && parts[j] === firstParts[j]) {
            j++;
        }
        depth = j;
        if (depth === 0) {
            return "";
        }
    }
    const allAbsolute = normalized.every((s) => s.startsWith("/"));
    const prefix = (allAbsolute ? "/" : "") + firstParts.slice(0, depth).join("/");
    return normalizeMachineRootPath(prefix);
}
