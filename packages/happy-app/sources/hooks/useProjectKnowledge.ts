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
    const [archivedEntries, setArchivedEntries] = React.useState<KnowledgeEntry[]>([]);
    const [profile, setProfile] = React.useState<ProjectProfile | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [lastRefreshAt, setLastRefreshAt] = React.useState<number | null>(null);
    const lastRefreshAtRef = React.useRef<number | null>(null);

    const refresh = React.useCallback(async () => {
        if (!projectServerId) return;
        const credentials = await TokenStorage.getCredentials();
        if (!credentials) return;

        const API_ENDPOINT = getServerUrl();
        const headers = authHeaders(credentials.token);

        setLoading(true);
        try {
            const [knowledgeResult, archivedResult, profileResult] = await Promise.all([
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
                        `${API_ENDPOINT}/v1/projects/${projectServerId}/knowledge?status=archived`,
                        { headers },
                    );
                    if (!response.ok) {
                        throw new Error(
                            `Failed to fetch archived knowledge: ${response.status}`,
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
            if (archivedResult) {
                setArchivedEntries(archivedResult.entries);
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
    }, [projectServerId]);

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

    return { entries, archivedEntries, profile, loading, lastRefreshAt, refresh, refreshIfStale, updateEntry, deleteEntry, refineEntry, search, regenerateProfile, fetchLifecycle, runDecay, runMerge };
}
