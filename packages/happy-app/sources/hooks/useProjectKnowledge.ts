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
import { throwIfNotOk } from "@/utils/http";

interface KnowledgeEntry {
    id: string;
    entryType: string;
    category: string | null;
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
    evolutionSize?: number;
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

export interface LifecycleStats {
    active: number;
    superseded: number;
    archived: number;
    total: number;
    totalRelations: number;
}

export interface LifecycleTrendPoint {
    date: string;
    created: number;
    superseded: number;
    archived: number;
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

const PAGE_SIZE = 30;

export function useProjectKnowledge(projectServerId: string | undefined) {
    const [entries, setEntries] = React.useState<KnowledgeEntry[]>([]);
    const [archivedEntries, setArchivedEntries] = React.useState<KnowledgeEntry[]>([]);
    const [supersededEntries, setSupersededEntries] = React.useState<KnowledgeEntry[]>([]);
    const [profile, setProfile] = React.useState<ProjectProfile | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [loadingMore, setLoadingMore] = React.useState(false);
    const [hasMore, setHasMore] = React.useState(false);
    const [lastRefreshAt, setLastRefreshAt] = React.useState<number | null>(null);
    const lastRefreshAtRef = React.useRef<number | null>(null);
    const totalRef = React.useRef(0);

    const fetchPage = React.useCallback(async (
        headers: Record<string, string>,
        apiEndpoint: string,
        status?: string,
        offset = 0,
        limit = PAGE_SIZE,
    ): Promise<KnowledgeListResponse | null> => {
        if (!projectServerId) return null;
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        if (status) params.set("status", status);
        return backoff(async () => {
            const response = await fetch(
                `${apiEndpoint}/v1/projects/${projectServerId}/knowledge?${params}`,
                { headers },
            );
            throwIfNotOk(response, 'Failed to fetch knowledge');
            return (await response.json()) as KnowledgeListResponse;
        }).catch(() => null);
    }, [projectServerId]);

    const refresh = React.useCallback(async () => {
        if (!projectServerId) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        const API_ENDPOINT = getServerUrl();
        const headers = authHeaders(credentials.token);

        setLoading(true);
        try {
            const [knowledgeResult, archivedResult, supersededResult, profileResult] = await Promise.all([
                fetchPage(headers, API_ENDPOINT, undefined, 0, PAGE_SIZE),
                fetchPage(headers, API_ENDPOINT, "archived", 0, PAGE_SIZE),
                fetchPage(headers, API_ENDPOINT, "superseded", 0, PAGE_SIZE),
                backoff(async () => {
                    const response = await fetch(
                        `${API_ENDPOINT}/v1/projects/${projectServerId}/profile`,
                        { headers },
                    );
                    throwIfNotOk(response, 'Failed to fetch profile');
                    return (await response.json()) as ProfileResponse;
                }).catch(() => null),
            ]);

            if (knowledgeResult) {
                setEntries(knowledgeResult.entries);
                totalRef.current = knowledgeResult.total;
                setHasMore(knowledgeResult.entries.length < knowledgeResult.total);
            }
            if (archivedResult) {
                setArchivedEntries(archivedResult.entries);
            }
            if (supersededResult) {
                setSupersededEntries(supersededResult.entries);
            }
            if (profileResult) {
                setProfile(profileResult.profile);
            }
            if (knowledgeResult || profileResult) {
                const now = Date.now();
                lastRefreshAtRef.current = now;
                setLastRefreshAt(now);
            }
        } finally {
            setLoading(false);
        }
    }, [projectServerId, fetchPage]);

    const loadMore = React.useCallback(async () => {
        if (!projectServerId || loadingMore || !hasMore) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        const API_ENDPOINT = getServerUrl();
        const headers = authHeaders(credentials.token);
        const offset = entries.length;

        setLoadingMore(true);
        try {
            const result = await fetchPage(headers, API_ENDPOINT, undefined, offset, PAGE_SIZE);
            if (result) {
                setEntries((prev) => [...prev, ...result.entries]);
                totalRef.current = result.total;
                setHasMore(offset + result.entries.length < result.total);
            }
        } finally {
            setLoadingMore(false);
        }
    }, [projectServerId, loadingMore, hasMore, entries.length, fetchPage]);

    const updateEntry = React.useCallback(
        async (
            entryId: string,
            data: { status?: string; pinned?: boolean },
        ) => {
            if (!projectServerId) return;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            const isArchiving = data.status === "archived";
            const isRestoring = data.status === "active";

            // Optimistic update: move between active/archived lists
            if (isArchiving) {
                setEntries((prev) => {
                    const target = prev.find((e) => e.id === entryId);
                    if (target) {
                        setArchivedEntries((ap) => [{ ...target, ...data }, ...ap]);
                    }
                    return prev.filter((e) => e.id !== entryId);
                });
            } else if (isRestoring) {
                setArchivedEntries((prev) => {
                    const target = prev.find((e) => e.id === entryId);
                    if (target) {
                        setEntries((ep) => [{ ...target, ...data }, ...ep]);
                    }
                    return prev.filter((e) => e.id !== entryId);
                });
            } else {
                setEntries((prev) =>
                    prev.map((e) => (e.id === entryId ? { ...e, ...data } : e)),
                );
            }

            const API_ENDPOINT = getServerUrl();
            try {
                await backoff(async () => {
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
            } catch {
                // Rollback optimistic update on failure
                await refresh();
            }
        },
        [projectServerId, refresh],
    );

    const deleteEntry = React.useCallback(
        async (entryId: string) => {
            if (!projectServerId) return;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            // Optimistic removal
            setArchivedEntries((prev) => prev.filter((e) => e.id !== entryId));
            setEntries((prev) => prev.filter((e) => e.id !== entryId));

            const API_ENDPOINT = getServerUrl();
            try {
                await backoff(async () => {
                    const res = await fetch(
                        `${API_ENDPOINT}/v1/projects/${projectServerId}/knowledge/${entryId}`,
                        {
                            method: "DELETE",
                            headers: authHeaders(credentials.token),
                        },
                    );
                    if (!res.ok) {
                        throw new Error(
                            `Failed to delete entry: ${res.status}`,
                        );
                    }
                });
            } catch {
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

    const refreshIfStale = React.useCallback(
        async (thresholdMs: number) => {
            if (lastRefreshAtRef.current && Date.now() - lastRefreshAtRef.current < thresholdMs) return;
            await refresh();
        },
        [refresh],
    );

    // Fetch data on mount and when projectServerId changes
    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    const regenerateProfile = React.useCallback(async () => {
        if (!projectServerId) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        const API_ENDPOINT = getServerUrl();
        try {
            const response = await backoff(async () => {
                const res = await fetch(
                    `${API_ENDPOINT}/v1/projects/${projectServerId}/profile/regenerate`,
                    {
                        method: "POST",
                        headers: authHeaders(credentials.token),
                    },
                );
                if (!res.ok) {
                    throw new Error(`Failed to regenerate profile: ${res.status}`);
                }
                return (await res.json()) as ProfileResponse;
            });

            if (response?.profile) {
                setProfile(response.profile);
            } else {
                await refresh();
            }
        } catch {
            await refresh();
        }
    }, [projectServerId, refresh]);

    const refineEntry = React.useCallback(
        async (entryId: string) => {
            if (!projectServerId) return;
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            const API_ENDPOINT = getServerUrl();
            try {
                const result = await backoff(async () => {
                    const res = await fetch(
                        `${API_ENDPOINT}/v1/projects/${projectServerId}/knowledge/${entryId}/refine`,
                        {
                            method: "POST",
                            headers: authHeaders(credentials.token),
                        },
                    );
                    if (!res.ok) {
                        throw new Error(`Failed to refine entry: ${res.status}`);
                    }
                    return (await res.json()) as { success: boolean; entry: KnowledgeEntry | null };
                });
                // Update the entry in-place with the refined version
                if (result?.entry) {
                    setEntries((prev) =>
                        prev.map((e) => (e.id === entryId ? result.entry! : e)),
                    );
                }
            } catch {
                // Silently fail — user can retry
            }
        },
        [projectServerId],
    );

    const fetchLifecycle = React.useCallback(async () => {
        if (!projectServerId) return null;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return null;

        const API_ENDPOINT = getServerUrl();
        try {
            const res = await fetch(
                `${API_ENDPOINT}/v1/projects/${projectServerId}/knowledge/lifecycle`,
                { headers: authHeaders(credentials.token) },
            );
            if (!res.ok) return null;
            return (await res.json()) as LifecycleStats;
        } catch {
            return null;
        }
    }, [projectServerId]);

    const fetchLifecycleTrend = React.useCallback(async () => {
        if (!projectServerId) return null;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return null;

        const API_ENDPOINT = getServerUrl();
        try {
            const res = await fetch(
                `${API_ENDPOINT}/v1/projects/${projectServerId}/knowledge/lifecycle-trend`,
                { headers: authHeaders(credentials.token) },
            );
            if (!res.ok) return null;
            const data = (await res.json()) as { trend: LifecycleTrendPoint[] };
            return data.trend;
        } catch {
            return null;
        }
    }, [projectServerId]);

    const runDecay = React.useCallback(async () => {
        if (!projectServerId) return null;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return null;

        const API_ENDPOINT = getServerUrl();
        const res = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectServerId}/knowledge/decay`,
            { method: "POST", headers: authHeaders(credentials.token) },
        );
        if (!res.ok) throw new Error(`Decay failed: ${res.status}`);
        const result = (await res.json()) as { archived: number };
        await refresh();
        return result;
    }, [projectServerId, refresh]);

    const runMerge = React.useCallback(async () => {
        if (!projectServerId) return null;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return null;

        const API_ENDPOINT = getServerUrl();
        const res = await fetch(
            `${API_ENDPOINT}/v1/projects/${projectServerId}/knowledge/merge`,
            { method: "POST", headers: authHeaders(credentials.token) },
        );
        if (!res.ok) throw new Error(`Merge failed: ${res.status}`);
        const result = (await res.json()) as { merged: number; clusters: number };
        await refresh();
        return result;
    }, [projectServerId, refresh]);

    const repoMapEntries = React.useMemo(
        () => entries.filter((e) => e.entryType === "repo_map"),
        [entries],
    );

    return { entries, archivedEntries, supersededEntries, profile, loading, loadingMore, hasMore, lastRefreshAt, refresh, refreshIfStale, loadMore, updateEntry, deleteEntry, refineEntry, search, regenerateProfile, fetchLifecycle, fetchLifecycleTrend, runDecay, runMerge, repoMapEntries };
}
