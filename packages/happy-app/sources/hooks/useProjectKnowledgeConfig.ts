/**
 * Hook for reading and writing project-level knowledge base configuration.
 *
 * API:
 * - GET    /v1/projects/:id/knowledge/config  → resolved config + isCustomized
 * - PATCH  /v1/projects/:id/knowledge/config  → partial update (merge)
 * - DELETE /v1/projects/:id/knowledge/config  → reset to defaults
 */

import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { getServerUrl } from "@/sync/serverConfig";

export interface KnowledgeConfig {
    enabled: boolean;
    mode: "auto" | "full" | "minimal";
    sensitivity: "conservative" | "balanced" | "aggressive";
    trackFileEdits: boolean;
    trackToolCalls: boolean;
    trackTokens: boolean;
    decayEnabled: boolean;
    mergeEnabled: boolean;
    refineEnabled: boolean;
}

interface ConfigResponse {
    config: KnowledgeConfig;
    isCustomized: boolean;
    defaults?: KnowledgeConfig;
}

function authHeaders(token: string) {
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
}

export function useProjectKnowledgeConfig(projectServerId: string | undefined) {
    const [config, setConfig] = React.useState<KnowledgeConfig | null>(null);
    const [isCustomized, setIsCustomized] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [saving, setSaving] = React.useState(false);

    const fetch = React.useCallback(async () => {
        if (!projectServerId) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        setLoading(true);
        try {
            const res = await globalThis.fetch(
                `${getServerUrl()}/v1/projects/${projectServerId}/knowledge/config`,
                { headers: authHeaders(credentials.token) },
            );
            if (!res.ok) return;
            const data = (await res.json()) as ConfigResponse;
            setConfig(data.config);
            setIsCustomized(data.isCustomized);
        } catch {
            // Keep current state on failure
        } finally {
            setLoading(false);
        }
    }, [projectServerId]);

    const update = React.useCallback(
        async (partial: Partial<KnowledgeConfig>) => {
            if (!projectServerId || !config) return;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            // Optimistic update
            const optimistic = { ...config, ...partial };
            setConfig(optimistic);
            setIsCustomized(true);
            setSaving(true);

            try {
                const res = await globalThis.fetch(
                    `${getServerUrl()}/v1/projects/${projectServerId}/knowledge/config`,
                    {
                        method: "PATCH",
                        headers: authHeaders(credentials.token),
                        body: JSON.stringify(partial),
                    },
                );
                if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
                const data = (await res.json()) as ConfigResponse;
                setConfig(data.config);
                setIsCustomized(data.isCustomized);
            } catch {
                // Rollback
                await fetch();
            } finally {
                setSaving(false);
            }
        },
        [projectServerId, config, fetch],
    );

    const resetToDefaults = React.useCallback(async () => {
        if (!projectServerId) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        setSaving(true);
        try {
            const res = await globalThis.fetch(
                `${getServerUrl()}/v1/projects/${projectServerId}/knowledge/config`,
                {
                    method: "DELETE",
                    headers: authHeaders(credentials.token),
                },
            );
            if (!res.ok) throw new Error(`DELETE failed: ${res.status}`);
            const data = (await res.json()) as ConfigResponse;
            setConfig(data.config);
            setIsCustomized(false);
        } catch {
            await fetch();
        } finally {
            setSaving(false);
        }
    }, [projectServerId, fetch]);

    React.useEffect(() => {
        void fetch();
    }, [fetch]);

    return { config, isCustomized, loading, saving, update, resetToDefaults, refresh: fetch };
}
