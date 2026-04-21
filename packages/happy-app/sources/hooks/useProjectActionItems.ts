/**
 * Fetches project knowledge action items for new session recommendations.
 * Returns warning/decision entries and high-confidence entries not recently accessed (>14 days).
 * Used in SessionView empty state to prompt user with relevant unresolved issues.
 */

import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { getServerUrl } from "@/sync/serverConfig";
import {
    deriveCollectionViewState,
    type CollectionViewState,
} from "@/utils/collectionViewState";

export interface ActionItem {
    id: string;
    entryType: string;
    title: string;
    content: string;
    tags: string[];
    confidence: string;
    createdAt: string;
}

interface ActionItemsResponse {
    actionItems: ActionItem[];
}

export function useProjectActionItems(
    projectServerId: string | undefined,
): {
    actionItems: ActionItem[];
    loading: boolean;
    error: string | null;
    state: CollectionViewState;
    refresh: () => Promise<void>;
} {
    const [actionItems, setActionItems] = React.useState<ActionItem[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const mountedRef = React.useRef(true);
    const latestRequestTokenRef = React.useRef(0);
    const latestProjectIdRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        return () => { mountedRef.current = false; };
    }, []);

    React.useEffect(() => {
        if (!projectServerId) {
            latestRequestTokenRef.current += 1;
            latestProjectIdRef.current = null;
            setActionItems([]);
            setLoading(false);
            setError(null);
            return;
        }

        if (latestProjectIdRef.current !== projectServerId) {
            latestRequestTokenRef.current += 1;
            latestProjectIdRef.current = projectServerId;
            setActionItems([]);
            setLoading(false);
            setError(null);
        }
    }, [projectServerId]);

    const refresh = React.useCallback(async () => {
        if (!projectServerId) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        const requestToken = latestRequestTokenRef.current + 1;
        latestRequestTokenRef.current = requestToken;
        setLoading(true);
        setError(null);
        try {
            const res = await globalThis.fetch(
                `${getServerUrl()}/v1/projects/${projectServerId}/knowledge/action-items`,
                { headers: { Authorization: `Bearer ${credentials.token}` } },
            );
            if (!res.ok) {
                throw new Error(`Failed to fetch action items: ${res.status}`);
            }
            const data = (await res.json()) as ActionItemsResponse;
            if (!mountedRef.current || requestToken !== latestRequestTokenRef.current) {
                return;
            }
            setActionItems(data.actionItems);
        } catch (fetchError) {
            if (!mountedRef.current || requestToken !== latestRequestTokenRef.current) {
                return;
            }
            setError(
                fetchError instanceof Error
                    ? fetchError.message
                    : "Failed to fetch action items",
            );
        } finally {
            if (!mountedRef.current || requestToken !== latestRequestTokenRef.current) {
                return;
            }
            setLoading(false);
        }
    }, [projectServerId]);

    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    const state = React.useMemo(
        () =>
            deriveCollectionViewState({
                loading,
                error,
                count: actionItems.length,
            }),
        [actionItems.length, error, loading],
    );

    return { actionItems, loading, error: state.error, state, refresh };
}
