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
import {
    shouldApplyKnowledgeRequestResult,
    shouldResetSessionKnowledgeState,
} from "./sessionKnowledgeState";

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
) {
    const [accesses, setAccesses] = React.useState<SessionKnowledgeAccessEntry[]>([]);
    const [loading, setLoading] = React.useState(false);
    const mountedRef = React.useRef(true);
    const latestRequestTokenRef = React.useRef(0);

    React.useEffect(() => {
        return () => { mountedRef.current = false; };
    }, []);

    React.useEffect(() => {
        if (!shouldResetSessionKnowledgeState({ projectServerId, sessionId })) return;
        latestRequestTokenRef.current += 1;
        setAccesses([]);
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
            if (!shouldApplyKnowledgeRequestResult({
                requestToken,
                latestRequestToken: latestRequestTokenRef.current,
            })) {
                return;
            }
            setAccesses(result.accesses);
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

    // Refetch when the server pushes a knowledge-access-update ephemeral
    // (applyTurnHit changed turnsRemaining / hitCount or a new entry was injected).
    const accessRevision = useSessionKnowledgeAccessRevision(sessionId ?? "");
    React.useEffect(() => {
        if (accessRevision === 0) return;
        void refresh();
    }, [accessRevision, refresh]);

    return { accesses, loading, refresh };
}
