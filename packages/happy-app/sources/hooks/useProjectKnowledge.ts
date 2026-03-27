/**
 * Hook for fetching and managing project knowledge entries.
 *
 * Makes real API calls to the server knowledge endpoints:
 * - GET  /v1/projects/:id/knowledge      (list entries)
 * - GET  /v1/projects/:id/profile         (project profile)
 * - PATCH /v1/projects/:id/knowledge/:eid (update entry)
 *
 * Follows the same fetch pattern as ProjectHealthTab / apiProjects.
 */

import * as React from "react";
import { TokenStorage } from "@/auth/tokenStorage";
import { getServerUrl } from "@/sync/serverConfig";
import { backoff } from "@/utils/time";

interface KnowledgeEntry {
    id: string;
    entryType: string;
    contributorType: string;
    status: string;
    title: string;
    content: string;
    structured: {
        request?: string;
        findings?: string;
        analysis?: string;
        outcome?: string;
        nextSteps?: string;
    } | null;
    tags: string[];
    confidence: string;
    sessionId: string | null;
    pinned: boolean;
    createdAt: number;
}

interface ProjectProfile {
    techStack: string[];
    architectureType?: string;
    knownPitfalls: string[];
    coreConventions: string[];
    lastUpdatedAt: number;
}

interface KnowledgeListResponse {
    entries: KnowledgeEntry[];
    total: number;
    limit: number;
    offset: number;
}

interface ProfileResponse {
    profile: ProjectProfile | null;
}

interface UpdateEntryResponse {
    entry: KnowledgeEntry;
}

function authHeaders(token: string) {
    return {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
    };
}

export function useProjectKnowledge(projectServerId: string | undefined) {
    const [entries, setEntries] = React.useState<KnowledgeEntry[]>([]);
    const [profile, setProfile] = React.useState<ProjectProfile | null>(null);
    const [loading, setLoading] = React.useState(false);

    const refresh = React.useCallback(async () => {
        if (!projectServerId) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        const API_ENDPOINT = getServerUrl();
        const headers = authHeaders(credentials.token);

        setLoading(true);
        try {
            const [knowledgeResult, profileResult] = await Promise.all([
                backoff(async () => {
                    const response = await fetch(
                        `${API_ENDPOINT}/v1/projects/${projectServerId}/knowledge`,
                        { headers },
                    );
                    if (!response.ok) {
                        throw new Error(
                            `Failed to fetch knowledge: ${response.status}`,
                        );
                    }
                    return (await response.json()) as KnowledgeListResponse;
                }).catch(() => null),
                backoff(async () => {
                    const response = await fetch(
                        `${API_ENDPOINT}/v1/projects/${projectServerId}/profile`,
                        { headers },
                    );
                    if (!response.ok) {
                        throw new Error(
                            `Failed to fetch profile: ${response.status}`,
                        );
                    }
                    return (await response.json()) as ProfileResponse;
                }).catch(() => null),
            ]);

            if (knowledgeResult) {
                setEntries(knowledgeResult.entries);
            }
            if (profileResult) {
                setProfile(profileResult.profile);
            }
        } finally {
            setLoading(false);
        }
    }, [projectServerId]);

    const updateEntry = React.useCallback(
        async (
            entryId: string,
            data: { status?: string; pinned?: boolean },
        ) => {
            if (!projectServerId) return;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            // Optimistic update
            setEntries((prev) =>
                prev.map((e) => (e.id === entryId ? { ...e, ...data } : e)),
            );

            const API_ENDPOINT = getServerUrl();
            try {
                const response = await backoff(async () => {
                    const res = await fetch(
                        `${API_ENDPOINT}/v1/projects/${projectServerId}/knowledge/${entryId}`,
                        {
                            method: "PATCH",
                            headers: authHeaders(credentials.token),
                            body: JSON.stringify(data),
                        },
                    );
                    if (!res.ok) {
                        throw new Error(
                            `Failed to update entry: ${res.status}`,
                        );
                    }
                    return (await res.json()) as UpdateEntryResponse;
                });

                // Replace with server-confirmed data
                setEntries((prev) =>
                    prev.map((e) =>
                        e.id === entryId ? response.entry : e,
                    ),
                );
            } catch {
                // Rollback optimistic update on failure
                await refresh();
            }
        },
        [projectServerId, refresh],
    );

    const search = React.useCallback(
        async (query: string) => {
            if (!projectServerId) return;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            const API_ENDPOINT = getServerUrl();
            setLoading(true);
            try {
                const result = await backoff(async () => {
                    const params = new URLSearchParams({ search: query });
                    const response = await fetch(
                        `${API_ENDPOINT}/v1/projects/${projectServerId}/knowledge?${params.toString()}`,
                        { headers: authHeaders(credentials.token) },
                    );
                    if (!response.ok) {
                        throw new Error(
                            `Failed to search knowledge: ${response.status}`,
                        );
                    }
                    return (await response.json()) as KnowledgeListResponse;
                });
                setEntries(result.entries);
            } catch {
                // Keep current entries on search failure
            } finally {
                setLoading(false);
            }
        },
        [projectServerId],
    );

    // Fetch data on mount and when projectServerId changes
    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    return { entries, profile, loading, refresh, updateEntry, search };
}
