/**
 * Fetches project knowledge action items for new session recommendations.
 * Returns warning/decision entries and high-confidence entries not recently accessed (>14 days).
 * Used in SessionView empty state to prompt user with relevant unresolved issues.
 */

import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { getServerUrl } from "@/sync/serverConfig";

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

export function useProjectActionItems(projectServerId: string | undefined) {
    const [actionItems, setActionItems] = React.useState<ActionItem[]>([]);
    const [loading, setLoading] = React.useState(false);

    const fetch = React.useCallback(async () => {
        if (!projectServerId) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        setLoading(true);
        try {
            const res = await globalThis.fetch(
                `${getServerUrl()}/v1/projects/${projectServerId}/knowledge/action-items`,
                { headers: { Authorization: `Bearer ${credentials.token}` } },
            );
            if (!res.ok) return;
            const data = (await res.json()) as ActionItemsResponse;
            setActionItems(data.actionItems);
        } catch {
            // Keep empty state on failure
        } finally {
            setLoading(false);
        }
    }, [projectServerId]);

    React.useEffect(() => {
        void fetch();
    }, [fetch]);

    return { actionItems, loading, refresh: fetch };
}
