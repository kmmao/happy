/**
 * Issue Store — Independent Zustand store for GitHub/Gitea issues
 *
 * NOT in storage.ts to keep it manageable.
 * Issues are fetched on-demand via sessionBash, not persisted locally.
 * Uses page-based pagination (not infinite scroll).
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type {
  Issue,
  RepoInfo,
  IssueFilters,
  IssueFilterState,
  GitHostMapping,
} from "./issueTypes";
import { parseRemoteUrl } from "./issueUtils";
import { fetchIssues, checkGhCliAvailable } from "./issueFetch";

//
// State
//

interface IssueState {
  readonly issuesByProject: Readonly<Record<string, readonly Issue[]>>;
  readonly repoInfoByProject: Readonly<Record<string, RepoInfo>>;
  readonly isLoading: Readonly<Record<string, boolean>>;
  readonly lastFetchedAt: Readonly<Record<string, number>>;
  readonly errors: Readonly<Record<string, string>>;
  readonly filters: IssueFilters;
  readonly ghAvailable: Readonly<Record<string, boolean | null>>;
  readonly pageByProject: Readonly<Record<string, number>>;
  readonly hasMoreByProject: Readonly<Record<string, boolean>>;
}

interface IssueActions {
  detectRepoInfo: (
    projectKey: string,
    remoteUrl: string,
    gitHosts?: readonly GitHostMapping[],
  ) => void;
  /** Load issues for a specific page (replaces current list) */
  loadIssues: (
    projectKey: string,
    sessionId: string,
    page?: number,
    repoPath?: string,
  ) => Promise<void>;
  /** Navigate to a specific page */
  goToPage: (
    projectKey: string,
    sessionId: string,
    page: number,
    repoPath?: string,
  ) => Promise<void>;
  refreshIssues: (
    projectKey: string,
    sessionId: string,
    repoPath?: string,
  ) => Promise<void>;
  setFilterState: (state: IssueFilterState) => void;
  setSearch: (search: string) => void;
  checkGhAvailable: (sessionId: string, repoPath?: string) => Promise<boolean>;
  reset: () => void;
}

type IssueStore = IssueState & IssueActions;

const FETCH_COOLDOWN = 30_000;

const initialState: IssueState = {
  issuesByProject: {},
  repoInfoByProject: {},
  isLoading: {},
  lastFetchedAt: {},
  errors: {},
  filters: { state: "open", search: "" },
  ghAvailable: {},
  pageByProject: {},
  hasMoreByProject: {},
};

export const issueStore = create<IssueStore>()((set, get) => ({
  ...initialState,

  detectRepoInfo: (
    projectKey: string,
    remoteUrl: string,
    gitHosts?: readonly GitHostMapping[],
  ) => {
    const existing = get().repoInfoByProject[projectKey];
    // Re-parse if remoteUrl changed OR gitHosts changed (apiBase may differ)
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

    // Tag with gitHostsKey for cache invalidation
    const tagged = { ...info, _gitHostsKey: gitHostsKey } as RepoInfo & {
      _gitHostsKey: string;
    };

    set((prev) => ({
      repoInfoByProject: { ...prev.repoInfoByProject, [projectKey]: tagged },
      // Clear cooldown so issues reload with new apiBase
      lastFetchedAt: { ...prev.lastFetchedAt, [projectKey]: 0 },
    }));
  },

  loadIssues: async (
    projectKey: string,
    sessionId: string,
    page: number = 1,
    repoPath?: string,
  ) => {
    const { isLoading, lastFetchedAt, repoInfoByProject } = get();

    if (isLoading[projectKey]) return;

    // Only apply cooldown for same-page re-fetches
    const currentPage = get().pageByProject[projectKey] ?? 1;
    if (page === currentPage) {
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
      const state = get().filters.state;
      const result = await fetchIssues(
        sessionId,
        repoInfo,
        state,
        page,
        repoPath,
      );

      set((prev) => ({
        issuesByProject: {
          ...prev.issuesByProject,
          [projectKey]: result.issues,
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

  goToPage: async (
    projectKey: string,
    sessionId: string,
    page: number,
    repoPath?: string,
  ) => {
    // Force load by clearing cooldown for this project
    set((prev) => ({
      lastFetchedAt: { ...prev.lastFetchedAt, [projectKey]: 0 },
    }));
    await get().loadIssues(projectKey, sessionId, page, repoPath);
  },

  refreshIssues: async (
    projectKey: string,
    sessionId: string,
    repoPath?: string,
  ) => {
    const currentPage = get().pageByProject[projectKey] ?? 1;
    set((prev) => ({
      lastFetchedAt: { ...prev.lastFetchedAt, [projectKey]: 0 },
    }));
    await get().loadIssues(projectKey, sessionId, currentPage, repoPath);
  },

  setFilterState: (state: IssueFilterState) => {
    set((prev) => ({
      filters: { ...prev.filters, state },
      lastFetchedAt: {},
      pageByProject: {},
      hasMoreByProject: {},
      issuesByProject: {},
    }));
  },

  setSearch: (search: string) => {
    set((prev) => ({
      filters: { ...prev.filters, search },
    }));
  },

  checkGhAvailable: async (sessionId: string, repoPath?: string) => {
    const key = `${sessionId}:${repoPath ?? ""}`;
    const cached = get().ghAvailable[key];
    if (cached !== null && cached !== undefined) return cached;

    const available = await checkGhCliAvailable(sessionId, repoPath);
    set((prev) => ({
      ghAvailable: { ...prev.ghAvailable, [key]: available },
    }));
    return available;
  },

  reset: () => {
    set(initialState);
  },
}));

//
// Selector hooks
//

export function useIssues(projectKey: string): readonly Issue[] {
  return issueStore(
    useShallow((s) => {
      const issues = s.issuesByProject[projectKey] ?? [];
      const { search } = s.filters;
      if (!search) return issues;
      const lower = search.toLowerCase();
      return issues.filter(
        (i) =>
          i.title.toLowerCase().includes(lower) ||
          String(i.number).includes(lower) ||
          i.author.toLowerCase().includes(lower),
      );
    }),
  );
}

export function useIssueRepoInfo(projectKey: string): RepoInfo | null {
  return issueStore((s) => s.repoInfoByProject[projectKey] ?? null);
}

export function useIssueLoading(projectKey: string): boolean {
  return issueStore((s) => s.isLoading[projectKey] ?? false);
}

export function useIssuePage(projectKey: string): number {
  return issueStore((s) => s.pageByProject[projectKey] ?? 1);
}

export function useIssueHasMore(projectKey: string): boolean {
  return issueStore((s) => s.hasMoreByProject[projectKey] ?? false);
}

export function useIssueError(projectKey: string): string {
  return issueStore((s) => s.errors[projectKey] ?? "");
}

export function useIssueFilters(): IssueFilters {
  return issueStore(useShallow((s) => s.filters));
}

export function useIssueOpenCount(projectKey: string): number {
  return issueStore(
    (s) =>
      (s.issuesByProject[projectKey] ?? []).filter((i) => i.state === "open")
        .length,
  );
}

export function useIssueClosedCount(projectKey: string): number {
  return issueStore(
    (s) =>
      (s.issuesByProject[projectKey] ?? []).filter((i) => i.state === "closed")
        .length,
  );
}
