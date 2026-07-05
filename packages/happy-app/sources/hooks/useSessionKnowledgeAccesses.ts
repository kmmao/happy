/**
 * Hook for fetching knowledge entries that were referenced (injected) during a session.
 *
 * API: GET /v1/projects/:id/knowledge/accesses?sessionId=xxx
 * Returns all knowledge entries accessed via inject during the given session.
 */

import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { getServerUrl } from "@/sync/serverConfig";
import { useSessionKnowledgeAccessRevision } from "@/sync/storage";
import { backoff } from "@/utils/time";
import { throwIfNotOk } from "@/utils/http";
import {
    deriveCollectionViewState,
    type CollectionViewState,
} from "@/utils/collectionViewState";
import { shouldResetSessionKnowledgeState } from "./sessionKnowledgeState";
import { useLatestRequest } from "./useLatestRequest";

export interface SessionKnowledgeAccessEntry {
    id: string;
    entryType: string;
    category: string | null;
    status: string;
    title: string;
    content: string;
    tags: string[];
    confidence: string;
    sessionId: string | null;
    createdAt: number;
    accessedAt: number;
    // Session TTL-by-turn fields (present on server ≥ 2026-04-17; optional for backward compat).
    hitCount?: number;
    turnsRemaining?: number;
    maxTurns?: number;
    initialTurns?: number;
    hotStatus?: "hot" | "evicted";
    lastHitAt?: number | null;
}

interface AccessesResponse {
    accesses: SessionKnowledgeAccessEntry[];
}

export function useSessionKnowledgeAccesses(
    projectServerId: string | undefined,
    sessionId: string | undefined,
) : {
    accesses: SessionKnowledgeAccessEntry[];
    loading: boolean;
    error: string | null;
    state: CollectionViewState;
    refresh: () => Promise<void>;
    evict: (knowledgeId: string) => Promise<boolean>;
    reinject: (knowledgeId: string) => Promise<boolean>;
} {
    const [accesses, setAccesses] = React.useState<SessionKnowledgeAccessEntry[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const mountedRef = React.useRef(true);
    const request = useLatestRequest();
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
            request.invalidate();
            latestStateKeyRef.current = null;
            setAccesses([]);
            setLoading(false);
            setError(null);
            return;
        }

        if (latestStateKeyRef.current !== stateKey) {
            request.invalidate();
            latestStateKeyRef.current = stateKey;
            setAccesses([]);
            setLoading(false);
            setError(null);
        }
    }, [projectServerId, sessionId]);

    const refresh = React.useCallback(async () => {
        if (!projectServerId || !sessionId) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        const API_ENDPOINT = getServerUrl();
        const token = request.begin();
        setLoading(true);
        setError(null);
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
                throwIfNotOk(response, 'Failed to fetch knowledge accesses');
                return (await response.json()) as AccessesResponse;
            });

            if (!mountedRef.current) return;
            if (!request.isCurrent(token)) {
                return;
            }
            setAccesses(result.accesses);
        } catch (fetchError) {
            if (!mountedRef.current) return;
            if (!request.isCurrent(token)) {
                return;
            }
            setError(
                fetchError instanceof Error
                    ? fetchError.message
                    : "Failed to fetch knowledge accesses",
            );
        } finally {
            if (!mountedRef.current) return;
            if (!request.isCurrent(token)) {
                return;
            }
            setLoading(false);
        }
    }, [projectServerId, sessionId]);

    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    // Refetch when the server pushes a knowledge-access-update ephemeral
    // (applyTurnHit changed turnsRemaining / hitCount or a new entry was injected).
    const accessRevision = useSessionKnowledgeAccessRevision(sessionId ?? "");
    React.useEffect(() => {
        if (accessRevision === 0) return;
        void refresh();
    }, [accessRevision, refresh]);

    /**
     * Manually evict a knowledge entry from this session's hot set.
     * Optimistically marks the local row as evicted for instant feedback, then
     * calls the server to persist. On failure refresh() rolls state back from
     * authoritative data.
     */
    const evict = React.useCallback(
        async (knowledgeId: string): Promise<boolean> => {
            if (!projectServerId || !sessionId) return false;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return false;

            setAccesses((prev) =>
                prev.map((entry) =>
                    entry.id === knowledgeId
                        ? { ...entry, hotStatus: "evicted", turnsRemaining: 0 }
                        : entry,
                ),
            );

            try {
                const response = await fetch(
                    `${getServerUrl()}/v1/projects/${projectServerId}/knowledge/accesses/evict`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${credentials.token}`,
                        },
                        body: JSON.stringify({ sessionId, knowledgeId }),
                    },
                );
                if (!response.ok) {
                    await refresh();
                    return false;
                }
                return true;
            } catch {
                await refresh();
                return false;
            }
        },
        [projectServerId, sessionId, refresh],
    );

    /**
     * Revive a previously-evicted entry: flip hotStatus back to "hot" and
     * reseed turnsRemaining from confidence. Optimistically updates local
     * state; on server failure refresh() pulls authoritative data back.
     */
    const reinject = React.useCallback(
        async (knowledgeId: string): Promise<boolean> => {
            if (!projectServerId || !sessionId) return false;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return false;

            setAccesses((prev) =>
                prev.map((entry) =>
                    entry.id === knowledgeId
                        ? {
                            ...entry,
                            hotStatus: "hot",
                            turnsRemaining: entry.initialTurns ?? entry.turnsRemaining,
                        }
                        : entry,
                ),
            );

            try {
                const response = await fetch(
                    `${getServerUrl()}/v1/projects/${projectServerId}/knowledge/accesses/reinject`,
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${credentials.token}`,
                        },
                        body: JSON.stringify({ sessionId, knowledgeId }),
                    },
                );
                if (!response.ok) {
                    await refresh();
                    return false;
                }
                return true;
            } catch {
                await refresh();
                return false;
            }
        },
        [projectServerId, sessionId, refresh],
    );

    const state = React.useMemo(
        () =>
            deriveCollectionViewState({
                loading,
                error,
                count: accesses.length,
            }),
        [accesses.length, error, loading],
    );

    return {
        accesses,
        loading,
        error: state.error,
        state,
        refresh,
        evict,
        reinject,
    };
}
