/**
 * Pull Request integration types
 *
 * Mirrors issueTypes.ts patterns. RepoInfo and RepoProvider are
 * shared from issueTypes to avoid duplication.
 */

export type { RepoInfo, RepoProvider, IssueLabel } from "./issueTypes";

// ── PR state ────────────────────────────────────────────────────────

export type PRState = "open" | "closed" | "merged";

export type PRFilterState = "open" | "closed" | "all";

export type PRSortField = "created" | "updated";

export type PRSortDirection = "asc" | "desc";

// ── Merge ───────────────────────────────────────────────────────────

export type MergeMethod = "merge" | "squash" | "rebase";

export type MergeableState =
    | "mergeable"
    | "conflicting"
    | "unknown";

// ── CI / Checks ─────────────────────────────────────────────────────

export type CheckStatus = "pending" | "success" | "failure" | "error";

export interface CheckRun {
    readonly name: string;
    readonly status: CheckStatus;
    readonly url: string;
}

// ── Review ──────────────────────────────────────────────────────────

export type ReviewState =
    | "approved"
    | "changes_requested"
    | "commented"
    | "pending"
    | "dismissed";

export interface PRReview {
    readonly author: string;
    readonly state: ReviewState;
    readonly body: string;
    readonly submittedAt: number;
}

// ── PR file diff ────────────────────────────────────────────────────

export interface PRFileDiff {
    readonly filename: string;
    readonly status: "added" | "removed" | "modified" | "renamed";
    readonly additions: number;
    readonly deletions: number;
    readonly previousFilename?: string;
    readonly patch?: string;
}

// ── PR comment ──────────────────────────────────────────────────────

export interface PRComment {
    readonly id: number;
    readonly author: string;
    readonly body: string;
    readonly createdAt: number;
    readonly updatedAt: number;
}

// ── Core PR type ────────────────────────────────────────────────────

export interface PullRequest {
    readonly number: number;
    readonly title: string;
    readonly body: string;
    readonly state: PRState;
    readonly author: string;
    readonly labels: readonly { readonly name: string; readonly color: string }[];
    readonly createdAt: number;
    readonly updatedAt: number;
    readonly mergedAt: number | null;
    readonly closedAt: number | null;
    readonly url: string;
    readonly headBranch: string;
    readonly baseBranch: string;
    readonly draft: boolean;
    readonly commentCount: number;
    readonly additions: number;
    readonly deletions: number;
    readonly changedFiles: number;
    readonly mergeableState: MergeableState;
    readonly checksStatus: CheckStatus | null;
    readonly reviewDecision: ReviewState | null;
}

/** PR with source repo label — used in aggregated multi-repo view */
export interface AggregatedPR extends PullRequest {
    readonly repoLabel: string;
    readonly projectKey: string;
}

// ── Filters ─────────────────────────────────────────────────────────

export interface PRFilters {
    readonly state: PRFilterState;
    readonly search: string;
    readonly sort: PRSortField;
    readonly direction: PRSortDirection;
}

// ── Fetch result ────────────────────────────────────────────────────

export interface PRFetchResult {
    readonly prs: readonly PullRequest[];
    readonly hasMore: boolean;
}
