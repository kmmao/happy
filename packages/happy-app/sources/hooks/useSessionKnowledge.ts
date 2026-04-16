/**
 * Hook for fetching knowledge entries produced by a specific session.
 *
 * API: GET /v1/projects/:id/knowledge?sessionId=xxx
 * Returns all knowledge entries (any status) linked to the given session.
 */

import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { getServerUrl } from "@/sync/serverConfig";
import { backoff } from "@/utils/time";
import {
    shouldApplyKnowledgeRequestResult,
    shouldResetSessionKnowledgeState,
} from "./sessionKnowledgeState";

export interface SessionKnowledgeEntry {
    id: string;
    entryType: string;
    category: string | null;
    status: string;
    title: string;
    content: string;
    tags: string[];
    confidence: string;
    createdAt: number;
}

interface KnowledgeListResponse {
    entries: SessionKnowledgeEntry[];
    total: number;
}

export function useSessionKnowledge(
    projectServerId: string | undefined,
    sessionId: string | undefined,
) {
    const [entries, setEntries] = React.useState<SessionKnowledgeEntry[]>([]);
    const [loading, setLoading] = React.useState(false);
    const mountedRef = React.useRef(true);
    const latestRequestTokenRef = React.useRef(0);

    React.useEffect(() => {
        return () => { mountedRef.current = false; };
    }, []);

    React.useEffect(() => {
        if (!shouldResetSessionKnowledgeState({ projectServerId, sessionId })) return;
        latestRequestTokenRef.current += 1;
        setEntries([]);
        setLoading(false);
    }, [projectServerId, sessionId]);

    const refresh = React.useCallback(async () => {
        if (!projectServerId || !sessionId) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        const API_ENDPOINT = getServerUrl();
        const requestToken = latestRequestTokenRef.current + 1;
        latestRequestTokenRef.current = requestToken;
        setLoading(true);
        try {
            const result = await backoff(async () => {
                const response = await fetch(
                    `${API_ENDPOINT}/v1/projects/${projectServerId}/knowledge?sessionId=${sessionId}&limit=50`,
                    {
                        headers: {
                            Authorization: `Bearer ${credentials.token}`,
                        },
                    },
                );
                if (!response.ok) {
                    throw new Error(`Failed to fetch session knowledge: ${response.status}`);
                }
                return (await response.json()) as KnowledgeListResponse;
            });

            if (!mountedRef.current) return;
            if (!shouldApplyKnowledgeRequestResult({
                requestToken,
                latestRequestToken: latestRequestTokenRef.current,
            })) {
                return;
            }
            setEntries(result.entries);
        } catch {
            // Keep empty state on failure
        } finally {
            if (!mountedRef.current) return;
            if (!shouldApplyKnowledgeRequestResult({
                requestToken,
                latestRequestToken: latestRequestTokenRef.current,
            })) {
                return;
            }
            setLoading(false);
        }
    }, [projectServerId, sessionId]);

    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    return { entries, loading, refresh };
}
