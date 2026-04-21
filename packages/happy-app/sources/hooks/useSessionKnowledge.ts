/**
 * Hook for fetching knowledge entries produced by a specific session.
 *
 * API: GET /v1/projects/:id/knowledge?sessionId=xxx
 * Returns all knowledge entries (any status) linked to the given session.
 */

import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { getServerUrl } from "@/sync/serverConfig";
import {
    useSessionKnowledgeAccessRevision,
    useSessionKnowledgeCount,
} from "@/sync/storage";
import { backoff } from "@/utils/time";
import {
    deriveCollectionViewState,
    type CollectionViewState,
} from "@/utils/collectionViewState";
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
) : {
    entries: SessionKnowledgeEntry[];
    loading: boolean;
    error: string | null;
    state: CollectionViewState;
    refresh: () => Promise<void>;
} {
    const [entries, setEntries] = React.useState<SessionKnowledgeEntry[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const mountedRef = React.useRef(true);
    const latestRequestTokenRef = React.useRef(0);
    const latestStateKeyRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        return () => { mountedRef.current = false; };
    }, []);

    React.useEffect(() => {
        const stateKey =
            projectServerId && sessionId
                ? `${projectServerId}:${sessionId}`
                : null;

        if (shouldResetSessionKnowledgeState({ projectServerId, sessionId })) {
            latestRequestTokenRef.current += 1;
            latestStateKeyRef.current = null;
            setEntries([]);
            setLoading(false);
            setError(null);
            return;
        }

        if (latestStateKeyRef.current !== stateKey) {
            latestRequestTokenRef.current += 1;
            latestStateKeyRef.current = stateKey;
            setEntries([]);
            setLoading(false);
            setError(null);
        }
    }, [projectServerId, sessionId]);

    const refresh = React.useCallback(async () => {
        if (!projectServerId || !sessionId) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        const API_ENDPOINT = getServerUrl();
        const requestToken = latestRequestTokenRef.current + 1;
        latestRequestTokenRef.current = requestToken;
        setLoading(true);
        setError(null);
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
        } catch (fetchError) {
            if (!mountedRef.current) return;
            if (!shouldApplyKnowledgeRequestResult({
                requestToken,
                latestRequestToken: latestRequestTokenRef.current,
            })) {
                return;
            }
            setError(
                fetchError instanceof Error
                    ? fetchError.message
                    : "Failed to fetch session knowledge",
            );
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

    // Refetch when server signals new knowledge entries or access changes.
    const knowledgeCount = useSessionKnowledgeCount(sessionId ?? "");
    const accessRevision = useSessionKnowledgeAccessRevision(sessionId ?? "");
    React.useEffect(() => {
        if (knowledgeCount === 0 && accessRevision === 0) return;
        void refresh();
    }, [knowledgeCount, accessRevision, refresh]);

    const state = React.useMemo(
        () =>
            deriveCollectionViewState({
                loading,
                error,
                count: entries.length,
            }),
        [entries.length, error, loading],
    );

    return { entries, loading, error: state.error, state, refresh };
}
