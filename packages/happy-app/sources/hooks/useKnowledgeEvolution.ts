/**
 * Hook for fetching knowledge evolution chain data.
 *
 * API: GET /v1/projects/:id/knowledge/:entryId/chain
 * Returns: { chain: ChainEntry[], relations: ChainRelation[] }
 */

import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { getServerUrl } from "@/sync/serverConfig";
import { backoff } from "@/utils/time";
import { throwIfNotOk } from "@/utils/http";
import {
    deriveCollectionViewState,
    type CollectionViewState,
} from "@/utils/collectionViewState";

export interface ChainEntry {
    id: string;
    entryType: string;
    action: string;
    status: string;
    title: string;
    content: string;
    tags: string[];
    confidence: string;
    supersedesId: string | null;
    createdAt: string;
}

export interface ChainRelation {
    from: string;
    to: string;
    type: "supersedes" | "related" | "contradicts" | "refines" | "combines";
}

interface ChainResponse {
    chain: ChainEntry[];
    relations: ChainRelation[];
}

export function useKnowledgeEvolution(
    projectServerId: string | undefined,
    entryId: string | undefined,
) : {
    chain: ChainEntry[];
    relations: ChainRelation[];
    loading: boolean;
    error: string | null;
    state: CollectionViewState;
    refresh: () => Promise<void>;
} {
    const [chain, setChain] = React.useState<ChainEntry[]>([]);
    const [relations, setRelations] = React.useState<ChainRelation[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const mountedRef = React.useRef(true);

    React.useEffect(() => {
        return () => { mountedRef.current = false; };
    }, []);

    React.useEffect(() => {
        setChain([]);
        setRelations([]);
        setLoading(false);
        setError(null);
    }, [projectServerId, entryId]);

    const refresh = React.useCallback(async () => {
        if (!projectServerId || !entryId) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        const API_ENDPOINT = getServerUrl();
        setLoading(true);
        setError(null);
        try {
            const result = await backoff(async () => {
                const response = await fetch(
                    `${API_ENDPOINT}/v1/projects/${projectServerId}/knowledge/${entryId}/chain`,
                    {
                        headers: {
                            Authorization: `Bearer ${credentials.token}`,
                        },
                    },
                );
                throwIfNotOk(response, 'Failed to fetch chain');
                return (await response.json()) as ChainResponse;
            });

            if (!mountedRef.current) return;
            setChain(result.chain);
            setRelations(result.relations);
        } catch (fetchError) {
            if (!mountedRef.current) return;
            setError(
                fetchError instanceof Error
                    ? fetchError.message
                    : "Failed to fetch knowledge evolution",
            );
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [projectServerId, entryId]);

    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    const state = React.useMemo(
        () =>
            deriveCollectionViewState({
                loading,
                error,
                count: chain.length,
            }),
        [chain.length, error, loading],
    );

    return { chain, relations, loading, error: state.error, state, refresh };
}
