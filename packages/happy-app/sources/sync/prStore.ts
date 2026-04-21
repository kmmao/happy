/**
 * PR Store — Independent Zustand store for GitHub/Gitea pull requests
 *
 * Mirrors issueStore.ts patterns exactly.
 * PRs are fetched on-demand via sessionBash, not persisted locally.
 * Supports infinite scroll pagination with append mode.
 */

import * as React from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
    PullRequest,
    PRFilters,
    PRFilterState,
    PRSortField,
    PRSortDirection,
    AggregatedPR,
    MergeMethod,
} from "./prTypes";
import type { RepoInfo, GitHostMapping } from "./issueTypes";
import { parseRemoteUrl } from "./issueUtils";
import {
    fetchPullRequests,
    fetchPullRequestDetail,
    mergePullRequest as apiMergePR,
    closePullRequest as apiClosePR,
    submitPRReview as apiSubmitReview,
    addPRComment as apiAddPRComment,
} from "./prFetch";
import {
    deriveCollectionViewState,
    type CollectionViewState,
} from "@/utils/collectionViewState";

//
// State
//

interface PRState {
    readonly prsByProject: Readonly<Record<string, readonly PullRequest[]>>;
    readonly repoInfoByProject: Readonly<Record<string, RepoInfo>>;
    readonly isLoading: Readonly<Record<string, boolean>>;
    readonly lastFetchedAt: Readonly<Record<string, number>>;
    readonly errors: Readonly<Record<string, string>>;
    readonly filters: PRFilters;
    readonly pageByProject: Readonly<Record<string, number>>;
    readonly hasMoreByProject: Readonly<Record<string, boolean>>;
}

interface PRActions {
    detectRepoInfo: (
        projectKey: string,
        remoteUrl: string,
        gitHosts?: readonly GitHostMapping[],
    ) => void;
    loadPRs: (
        projectKey: string,
        sessionId: string,
        page?: number,
        repoPath?: string,
        append?: boolean,
    ) => Promise<void>;
    loadMorePRs: (
        projectKeys: readonly string[],
        sessionId: string,
        repoPathByKey?: Readonly<Record<string, string | undefined>>,
    ) => Promise<void>;
    refreshPRs: (
        projectKey: string,
        sessionId: string,
        repoPath?: string,
    ) => Promise<void>;
    refreshAllPRs: (
        projectKeys: readonly string[],
        sessionId: string,
        repoPathByKey?: Readonly<Record<string, string | undefined>>,
    ) => Promise<void>;
    setFilterState: (state: PRFilterState) => void;
    setSearch: (search: string) => void;
    setSort: (sort: PRSortField, direction: PRSortDirection) => void;
    mergePR: (
        projectKey: string,
        prNumber: number,
        method: MergeMethod,
        sessionId: string,
        commitTitle?: string,
        repoPath?: string,
    ) => Promise<void>;
    closePR: (
        projectKey: string,
        prNumber: number,
        sessionId: string,
        repoPath?: string,
    ) => Promise<void>;
    submitReview: (
        projectKey: string,
        prNumber: number,
        event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
        sessionId: string,
        body?: string,
        repoPath?: string,
    ) => Promise<void>;
    addComment: (
        projectKey: string,
        prNumber: number,
        body: string,
        sessionId: string,
        repoPath?: string,
    ) => Promise<void>;
    reset: () => void;
}

type PRStore = PRState & PRActions;

const FETCH_COOLDOWN = 30_000;

const initialState: PRState = {
    prsByProject: {},
    repoInfoByProject: {},
    isLoading: {},
    lastFetchedAt: {},
    errors: {},
    filters: {
        state: "open",
        search: "",
        sort: "created",
        direction: "desc",
    },
    pageByProject: {},
    hasMoreByProject: {},
};

export const prStore = create<PRStore>()((set, get) => ({
    ...initialState,

    detectRepoInfo: (
        projectKey: string,
        remoteUrl: string,
        gitHosts?: readonly GitHostMapping[],
    ) => {
        const existing = get().repoInfoByProject[projectKey];
        const gitHostsKey = gitHosts
            ? gitHosts
                .map((h) => `${h.host}:${h.provider}:${h.apiToken ?? ""}`)
                .join(",")
            : "";
        const existingKey = (existing as any)?._gitHostsKey ?? "";
        if (existing?.remoteUrl === remoteUrl && gitHostsKey === existingKey)
            return;

        const info = parseRemoteUrl(remoteUrl, gitHosts);
        if (!info) return;

        const tagged = { ...info, _gitHostsKey: gitHostsKey } as RepoInfo & {
            _gitHostsKey: string;
        };

        set((prev) => ({
            repoInfoByProject: { ...prev.repoInfoByProject, [projectKey]: tagged },
            lastFetchedAt: { ...prev.lastFetchedAt, [projectKey]: 0 },
        }));
    },

    loadPRs: async (
        projectKey: string,
        sessionId: string,
        page: number = 1,
        repoPath?: string,
        append: boolean = false,
    ) => {
        const { isLoading, lastFetchedAt, repoInfoByProject } = get();

        if (isLoading[projectKey]) return;

        const currentPage = get().pageByProject[projectKey] ?? 1;
        if (page === currentPage && !append) {
            const lastFetched = lastFetchedAt[projectKey] ?? 0;
            if (Date.now() - lastFetched < FETCH_COOLDOWN) return;
        }

        const repoInfo = repoInfoByProject[projectKey];
        if (!repoInfo || repoInfo.provider === "unknown") return;

        set((prev) => ({
            isLoading: { ...prev.isLoading, [projectKey]: true },
            errors: { ...prev.errors, [projectKey]: "" },
        }));

        try {
            const { state, sort, direction } = get().filters;
            const result = await fetchPullRequests(
                sessionId,
                repoInfo,
                state,
                page,
                repoPath,
                sort,
                direction,
            );

            set((prev) => ({
                prsByProject: {
                    ...prev.prsByProject,
                    [projectKey]: append
                        ? [...(prev.prsByProject[projectKey] ?? []), ...result.prs]
                        : result.prs,
                },
                lastFetchedAt: { ...prev.lastFetchedAt, [projectKey]: Date.now() },
                isLoading: { ...prev.isLoading, [projectKey]: false },
                pageByProject: { ...prev.pageByProject, [projectKey]: page },
                hasMoreByProject: {
                    ...prev.hasMoreByProject,
                    [projectKey]: result.hasMore,
                },
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            set((prev) => ({
                isLoading: { ...prev.isLoading, [projectKey]: false },
                errors: { ...prev.errors, [projectKey]: message },
            }));
        }
    },

    loadMorePRs: async (
        projectKeys: readonly string[],
        sessionId: string,
        repoPathByKey?: Readonly<Record<string, string | undefined>>,
    ) => {
        const promises = projectKeys
            .filter((key) => get().hasMoreByProject[key])
            .map((key) => {
                const currentPage = get().pageByProject[key] ?? 1;
                set((prev) => ({
                    lastFetchedAt: { ...prev.lastFetchedAt, [key]: 0 },
                }));
                return get().loadPRs(
                    key,
                    sessionId,
                    currentPage + 1,
                    repoPathByKey?.[key],
                    true,
                );
            });
        await Promise.all(promises);
    },

    refreshPRs: async (
        projectKey: string,
        sessionId: string,
        repoPath?: string,
    ) => {
        const currentPage = get().pageByProject[projectKey] ?? 1;
        set((prev) => ({
            lastFetchedAt: { ...prev.lastFetchedAt, [projectKey]: 0 },
        }));
        await get().loadPRs(projectKey, sessionId, currentPage, repoPath);
    },

    refreshAllPRs: async (
        projectKeys: readonly string[],
        sessionId: string,
        repoPathByKey?: Readonly<Record<string, string | undefined>>,
    ) => {
        set((prev) => {
            const cleared = { ...prev.lastFetchedAt };
            const clearedPages = { ...prev.pageByProject };
            const clearedHasMore = { ...prev.hasMoreByProject };
            const clearedPRs = { ...prev.prsByProject };
            for (const key of projectKeys) {
                cleared[key] = 0;
                clearedPages[key] = 1;
                clearedHasMore[key] = false;
                delete clearedPRs[key];
            }
            return {
                lastFetchedAt: cleared,
                pageByProject: clearedPages,
                hasMoreByProject: clearedHasMore,
                prsByProject: clearedPRs,
            };
        });
        await Promise.all(
            projectKeys.map((key) =>
                get().loadPRs(key, sessionId, 1, repoPathByKey?.[key]),
            ),
        );
    },

    setFilterState: (state: PRFilterState) => {
        set((prev) => ({
            filters: { ...prev.filters, state },
            lastFetchedAt: {},
            pageByProject: {},
            hasMoreByProject: {},
            prsByProject: {},
        }));
    },

    setSearch: (search: string) => {
        set((prev) => ({
            filters: { ...prev.filters, search },
        }));
    },

    setSort: (sort: PRSortField, direction: PRSortDirection) => {
        set((prev) => ({
            filters: { ...prev.filters, sort, direction },
            lastFetchedAt: {},
            pageByProject: {},
            hasMoreByProject: {},
            prsByProject: {},
        }));
    },

    mergePR: async (
        projectKey: string,
        prNumber: number,
        method: MergeMethod,
        sessionId: string,
        commitTitle?: string,
        repoPath?: string,
    ) => {
        const repoInfo = get().repoInfoByProject[projectKey];
        if (!repoInfo || repoInfo.provider === "unknown") {
            throw new Error("Repository info not found");
        }
        await apiMergePR(sessionId, repoInfo, prNumber, method, commitTitle, repoPath);
        // Update local state
        set((prev) => {
            const prs = prev.prsByProject[projectKey] ?? [];
            const updated = prs.map((pr) =>
                pr.number === prNumber
                    ? { ...pr, state: "merged" as const, mergedAt: Date.now(), updatedAt: Date.now() }
                    : pr,
            );
            return {
                prsByProject: { ...prev.prsByProject, [projectKey]: updated },
            };
        });
    },

    closePR: async (
        projectKey: string,
        prNumber: number,
        sessionId: string,
        repoPath?: string,
    ) => {
        const repoInfo = get().repoInfoByProject[projectKey];
        if (!repoInfo || repoInfo.provider === "unknown") {
            throw new Error("Repository info not found");
        }
        await apiClosePR(sessionId, repoInfo, prNumber, repoPath);
        set((prev) => {
            const prs = prev.prsByProject[projectKey] ?? [];
            const updated = prs.map((pr) =>
                pr.number === prNumber
                    ? { ...pr, state: "closed" as const, closedAt: Date.now(), updatedAt: Date.now() }
                    : pr,
            );
            return {
                prsByProject: { ...prev.prsByProject, [projectKey]: updated },
            };
        });
        // Remove from visible list if filter is "open"
        const currentFilter = get().filters.state;
        if (currentFilter === "open") {
            set((prev) => ({
                prsByProject: {
                    ...prev.prsByProject,
                    [projectKey]: (prev.prsByProject[projectKey] ?? []).filter(
                        (pr) => pr.number !== prNumber,
                    ),
                },
            }));
        }
    },

    submitReview: async (
        projectKey: string,
        prNumber: number,
        event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
        sessionId: string,
        body?: string,
        repoPath?: string,
    ) => {
        const repoInfo = get().repoInfoByProject[projectKey];
        if (!repoInfo || repoInfo.provider === "unknown") {
            throw new Error("Repository info not found");
        }
        await apiSubmitReview(sessionId, repoInfo, prNumber, event, body, repoPath);
    },

    addComment: async (
        projectKey: string,
        prNumber: number,
        body: string,
        sessionId: string,
        repoPath?: string,
    ) => {
        const repoInfo = get().repoInfoByProject[projectKey];
        if (!repoInfo || repoInfo.provider === "unknown") {
            throw new Error("Repository info not found");
        }
        await apiAddPRComment(sessionId, repoInfo, prNumber, body, repoPath);
        set((prev) => {
            const prs = prev.prsByProject[projectKey] ?? [];
            const updated = prs.map((pr) =>
                pr.number === prNumber
                    ? { ...pr, commentCount: pr.commentCount + 1, updatedAt: Date.now() }
                    : pr,
            );
            return {
                prsByProject: { ...prev.prsByProject, [projectKey]: updated },
            };
        });
    },

    reset: () => {
        set(initialState);
    },
}));

//
// Selector hooks
//

export function usePRs(projectKey: string): readonly PullRequest[] {
    return prStore(
        useShallow((s) => {
            const prs = s.prsByProject[projectKey] ?? [];
            const { search } = s.filters;
            if (!search) return prs;
            const lower = search.toLowerCase();
            return prs.filter(
                (pr) =>
                    pr.title.toLowerCase().includes(lower) ||
                    String(pr.number).includes(lower) ||
                    pr.author.toLowerCase().includes(lower) ||
                    pr.headBranch.toLowerCase().includes(lower),
            );
        }),
    );
}

export function usePRRepoInfo(projectKey: string): RepoInfo | null {
    return prStore((s) => s.repoInfoByProject[projectKey] ?? null);
}

export function usePRLoading(projectKey: string): boolean {
    return prStore((s) => s.isLoading[projectKey] ?? false);
}

export function usePRHasMore(projectKey: string): boolean {
    return prStore((s) => s.hasMoreByProject[projectKey] ?? false);
}

export function usePRError(projectKey: string): string {
    return prStore((s) => s.errors[projectKey] ?? "");
}

export function usePRFilters(): PRFilters {
    return prStore(useShallow((s) => s.filters));
}

export function usePROpenCount(projectKey: string): number {
    return prStore(
        (s) =>
            (s.prsByProject[projectKey] ?? []).filter((pr) => pr.state === "open")
                .length,
    );
}

//
// Aggregated multi-repo selectors
//

export function useAggregatedPRs(
    projectKeys: readonly string[],
): readonly AggregatedPR[] {
    const snapshot = prStore((s) => {
        let fp = `${s.filters.search}|${s.filters.sort}|${s.filters.direction}`;
        for (const key of projectKeys) {
            const prs = s.prsByProject[key];
            const info = s.repoInfoByProject[key];
            if (prs && prs.length > 0) {
                fp += `|${key}:${prs.length}:${prs[0]!.number}:${prs[prs.length - 1]!.number}:${prs[0]!.updatedAt}`;
            } else {
                fp += `|${key}:0`;
            }
            if (info) {
                fp += `:${info.owner}/${info.repo}`;
            }
        }
        return fp;
    });

    return React.useMemo(() => {
        void snapshot;
        const s = prStore.getState();
        const result: AggregatedPR[] = [];
        for (const key of projectKeys) {
            const prs = s.prsByProject[key] ?? [];
            const info = s.repoInfoByProject[key];
            const repoLabel = info ? `${info.owner}/${info.repo}` : key;
            for (const pr of prs) {
                result.push({ ...pr, repoLabel, projectKey: key });
            }
        }
        const { search, sort: sortField, direction: sortDir } = s.filters;
        const filtered = search
            ? result.filter((pr) => {
                const lower = search.toLowerCase();
                return (
                    pr.title.toLowerCase().includes(lower) ||
                    String(pr.number).includes(lower) ||
                    pr.author.toLowerCase().includes(lower) ||
                    pr.headBranch.toLowerCase().includes(lower) ||
                    pr.repoLabel.toLowerCase().includes(lower)
                );
            })
            : result;
        const sortFn = (a: AggregatedPR, b: AggregatedPR) => {
            const aVal = sortField === "updated" ? a.updatedAt : a.createdAt;
            const bVal = sortField === "updated" ? b.updatedAt : b.createdAt;
            return sortDir === "asc" ? aVal - bVal : bVal - aVal;
        };
        return filtered.sort(sortFn);
    }, [projectKeys, snapshot]);
}

export function useAggregatedPRLoading(projectKeys: readonly string[]): boolean {
    return prStore((s) => projectKeys.some((k) => s.isLoading[k]));
}

export function useAggregatedPRError(projectKeys: readonly string[]): string {
    return prStore((s) => {
        const errors = projectKeys
            .map((k) => s.errors[k])
            .filter((e) => e && e.length > 0);
        return errors.join("\n");
    });
}

export function useAggregatedPROpenCount(projectKeys: readonly string[]): number {
    return prStore((s) =>
        projectKeys.reduce(
            (sum, k) =>
                sum +
                (s.prsByProject[k] ?? []).filter((pr) => pr.state === "open").length,
            0,
        ),
    );
}

export function useAggregatedPRHasMore(projectKeys: readonly string[]): boolean {
    return prStore((s) => projectKeys.some((k) => s.hasMoreByProject[k]));
}

export interface AggregatedPRListState {
    readonly prs: readonly AggregatedPR[];
    readonly loading: boolean;
    readonly error: string | null;
    readonly state: CollectionViewState;
}

export function useAggregatedPRListState(
    projectKeys: readonly string[],
): AggregatedPRListState {
    const prs = useAggregatedPRs(projectKeys);
    const loading = useAggregatedPRLoading(projectKeys);
    const error = useAggregatedPRError(projectKeys);

    return React.useMemo(() => {
        const state = deriveCollectionViewState({
            loading,
            error,
            count: prs.length,
        });

        return {
            prs,
            loading,
            error: state.error,
            state,
        };
    }, [prs, loading, error]);
}
