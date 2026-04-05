/**
 * Hook for fetching knowledge entries that were referenced (injected) during a session.
 *
 * API: GET /v1/projects/:id/knowledge/accesses?sessionId=xxx
 * Returns all knowledge entries accessed via inject during the given session.
 */

import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { getServerUrl } from "@/sync/serverConfig";
import { backoff } from "@/utils/time";

export interface SessionKnowledgeAccessEntry {
    id: string;
    entryType: string;
    category: string | null;
    status: string;
    title: string;
    tags: string[];
    confidence: string;
    sessionId: string | null;
    createdAt: number;
    accessedAt: number;
}

interface AccessesResponse {
    accesses: SessionKnowledgeAccessEntry[];
}

export function useSessionKnowledgeAccesses(
    projectServerId: string | undefined,
    sessionId: string | undefined,
) {
    const [accesses, setAccesses] = React.useState<SessionKnowledgeAccessEntry[]>([]);
    const [loading, setLoading] = React.useState(false);
    const mountedRef = React.useRef(true);

    React.useEffect(() => {
        return () => { mountedRef.current = false; };
    }, []);

    const refresh = React.useCallback(async () => {
        if (!projectServerId || !sessionId) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        const API_ENDPOINT = getServerUrl();
        setLoading(true);
        try {
            const result = await backoff(async () => {
                const response = await fetch(
                    `${API_ENDPOINT}/v1/projects/${projectServerId}/knowledge/accesses?sessionId=${sessionId}`,
                    {
                        headers: {
                            Authorization: `Bearer ${credentials.token}`,
                        },
                    },
                );
                if (!response.ok) {
                    throw new Error(`Failed to fetch knowledge accesses: ${response.status}`);
                }
                return (await response.json()) as AccessesResponse;
            });

            if (!mountedRef.current) return;
            setAccesses(result.accesses);
        } catch {
            // Keep empty state on failure
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [projectServerId, sessionId]);

    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    return { accesses, loading, refresh };
}
