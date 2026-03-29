/**
 * Detects and parses .happy/dev.yml from the remote session project.
 *
 * - On mount (when enabled): reads .happy/dev.yml via sessionReadFile
 * - Caches the result per sessionId — only reads once unless refresh() is called
 * - Returns { hasConfig, config, loading, error, refresh }
 */

import * as React from "react";
import { sessionReadFile } from "@/sync/ops";
import { parseDevYml, type DevConfig } from "@/utils/devYmlParser";

export type DevConfigState = {
    readonly hasConfig: boolean;
    readonly config: DevConfig | null;
    readonly loading: boolean;
    readonly error: string | null;
};

// Global cache: sessionId → DevConfig | null
const configCache = new Map<string, DevConfig | null>();

export function useDevConfig(
    sessionId: string,
    enabled: boolean,
): DevConfigState & { readonly refresh: () => void } {
    const [state, setState] = React.useState<DevConfigState>(() => {
        const cached = configCache.get(sessionId);
        if (cached !== undefined) {
            return {
                hasConfig: cached !== null,
                config: cached,
                loading: false,
                error: null,
            };
        }
        return {
            hasConfig: false,
            config: null,
            loading: false,
            error: null,
        };
    });

    const fetchConfig = React.useCallback(async () => {
        setState((prev) => ({ ...prev, loading: true, error: null }));
        try {
            const result = await sessionReadFile(sessionId, ".happy/dev.yml");
            if (!result.success || !result.content) {
                configCache.set(sessionId, null);
                setState({
                    hasConfig: false,
                    config: null,
                    loading: false,
                    error: null,
                });
                return;
            }

            // sessionReadFile returns base64 content
            const decoded = atob(result.content);
            const config = parseDevYml(decoded);
            configCache.set(sessionId, config);
            setState({
                hasConfig: config !== null,
                config,
                loading: false,
                error: null,
            });
        } catch {
            configCache.set(sessionId, null);
            setState({
                hasConfig: false,
                config: null,
                loading: false,
                error: "Failed to read dev.yml",
            });
        }
    }, [sessionId]);

    // Auto-fetch on mount if not cached
    React.useEffect(() => {
        if (!enabled) return;
        if (configCache.has(sessionId)) return;
        fetchConfig();
    }, [enabled, sessionId, fetchConfig]);

    const refresh = React.useCallback(() => {
        configCache.delete(sessionId);
        fetchConfig();
    }, [sessionId, fetchConfig]);

    return { ...state, refresh };
}

/** Clear cached config for a session (e.g., after writing a new dev.yml) */
export function invalidateDevConfigCache(sessionId: string): void {
    configCache.delete(sessionId);
}
