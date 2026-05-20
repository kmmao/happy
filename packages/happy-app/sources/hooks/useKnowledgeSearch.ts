/**
 * Hook for cross-project knowledge search with pagination.
 *
 * API: GET /v1/knowledge/search?q=xxx&limit=20&offset=0
 * Returns: { results: SearchResult[], total: number }
 * total=-1 means more results may exist (approximate).
 *
 * Built-in 300ms debounce to avoid flooding the API.
 */

import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { getServerUrl } from "@/sync/serverConfig";
import { throwIfNotOk } from "@/utils/http";

export interface KnowledgeSearchResult {
    id: string;
    projectId: string;
    projectPath: string;
    entryType: string;
    title: string;
    content: string;
    tags: string[];
    confidence: string;
    similarity?: number;
    createdAt: string;
}

interface SearchResponse {
    results: KnowledgeSearchResult[];
    total: number;
}

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;

export function useKnowledgeSearch() {
    const [results, setResults] = React.useState<KnowledgeSearchResult[]>([]);
    const [total, setTotal] = React.useState(0);
    const [loading, setLoading] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const offsetRef = React.useRef(0);
    const requestIdRef = React.useRef(0);
    const timerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined);

    const fetchResults = React.useCallback(async (
        q: string,
        offset: number,
        append: boolean,
    ) => {
        if (!q.trim()) {
            setResults([]);
            setTotal(0);
            return;
        }

        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        const currentRequestId = ++requestIdRef.current;
        setLoading(true);

        try {
            const API_ENDPOINT = getServerUrl();
            const params = new URLSearchParams({
                q: q.trim(),
                limit: String(PAGE_SIZE),
                offset: String(offset),
            });

            const response = await fetch(
                `${API_ENDPOINT}/v1/knowledge/search?${params.toString()}`,
                {
                    headers: {
                        Authorization: `Bearer ${credentials.token}`,
                    },
                },
            );

            // Discard stale responses
            if (requestIdRef.current !== currentRequestId) return;

            throwIfNotOk(response, 'Search failed');

            const data = (await response.json()) as SearchResponse;

            if (append) {
                setResults((prev) => [...prev, ...data.results]);
            } else {
                setResults(data.results);
            }
            setTotal(data.total);
        } catch {
            // Keep current results on failure
        } finally {
            if (requestIdRef.current === currentRequestId) {
                setLoading(false);
            }
        }
    }, []);

    const search = React.useCallback((q: string) => {
        setQuery(q);
        offsetRef.current = 0;

        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            void fetchResults(q, 0, false);
        }, DEBOUNCE_MS);
    }, [fetchResults]);

    const loadMore = React.useCallback(() => {
        if (loading || !query.trim()) return;
        const nextOffset = offsetRef.current + PAGE_SIZE;
        offsetRef.current = nextOffset;
        void fetchResults(query, nextOffset, true);
    }, [loading, query, fetchResults]);

    const hasMore = total === -1 || results.length < total;

    const reset = React.useCallback(() => {
        setQuery("");
        setResults([]);
        setTotal(0);
        offsetRef.current = 0;
        requestIdRef.current++;
    }, []);

    // Cleanup timer on unmount
    React.useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    return { results, total, loading, hasMore, query, search, loadMore, reset };
}
