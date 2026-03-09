/**
 * GitHub/Gitea Issue integration types
 */

export type RepoProvider = "github" | "gitea" | "unknown";

export interface RepoInfo {
  readonly provider: RepoProvider;
  readonly owner: string;
  readonly repo: string;
  readonly remoteUrl: string;
  readonly apiBase?: string; // Gitea custom API base URL
  readonly apiToken?: string; // Gitea API token for private repos
}

export interface Issue {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed";
  readonly author: string;
  readonly labels: readonly IssueLabel[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly commentCount: number;
  readonly body: string;
  readonly url: string;
}

export interface IssueLabel {
  readonly name: string;
  readonly color: string;
}

export interface WebhookRepoConfig {
  readonly repoUrl: string;
  readonly machineId: string;
  readonly repoPath: string;
  readonly secret: string;
  readonly routeId?: string;
  readonly enabled: boolean;
}

export interface GitHostMapping {
  readonly host: string;
  readonly provider: "github" | "gitea";
  readonly apiToken?: string;
  readonly autoIssueEnabled?: boolean;
  readonly autoIssueLabel?: string;
  readonly autoIssueAllowedAuthors?: readonly string[];
  readonly webhookRepos?: readonly WebhookRepoConfig[];
}

export type IssueFilterState = "open" | "closed" | "all";

export type IssueSortField = "created" | "updated" | "comments";
export type IssueSortDirection = "asc" | "desc";

export interface IssueFilters {
  readonly state: IssueFilterState;
  readonly search: string;
  readonly sort: IssueSortField;
  readonly direction: IssueSortDirection;
  readonly labels: readonly string[];
}

/** Issue with source repo label — used in aggregated multi-repo view */
export interface AggregatedIssue extends Issue {
  readonly repoLabel: string; // "owner/repo"
  readonly projectKey: string;
}
