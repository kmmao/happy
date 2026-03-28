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
    type: "supersedes" | "related";
}

interface ChainResponse {
    chain: ChainEntry[];
    relations: ChainRelation[];
}

export function useKnowledgeEvolution(
    projectServerId: string | undefined,
    entryId: string | undefined,
) {
    const [chain, setChain] = React.useState<ChainEntry[]>([]);
    const [relations, setRelations] = React.useState<ChainRelation[]>([]);
    const [loading, setLoading] = React.useState(false);
    const mountedRef = React.useRef(true);

    React.useEffect(() => {
        return () => { mountedRef.current = false; };
    }, []);

    const refresh = React.useCallback(async () => {
        if (!projectServerId || !entryId) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        const API_ENDPOINT = getServerUrl();
        setLoading(true);
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
                if (!response.ok) {
                    throw new Error(`Failed to fetch chain: ${response.status}`);
                }
                return (await response.json()) as ChainResponse;
            });

            if (!mountedRef.current) return;
            setChain(result.chain);
            setRelations(result.relations);
        } catch {
            // Keep empty state on failure
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [projectServerId, entryId]);

    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    return { chain, relations, loading, refresh };
}
