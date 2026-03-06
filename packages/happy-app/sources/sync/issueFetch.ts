/**
 * Issue fetching module
 *
 * Fetches issues from GitHub/Gitea via sessionBash (running commands on user's machine).
 * Uses `gh api` for GitHub (leveraging user's existing auth, with pagination).
 * Uses `curl` + API for Gitea.
 */

import { sessionBash } from "./ops";
import { storage } from "./storage";
import type {
  Issue,
  IssueLabel,
  RepoInfo,
  IssueFilterState,
} from "./issueTypes";

const ISSUE_FETCH_TIMEOUT = 15000;

export const PAGE_SIZE = 50;

export interface FetchResult {
  readonly issues: readonly Issue[];
  readonly hasMore: boolean;
}

function resolveRepoPath(sessionId: string, repoPath?: string): string | null {
  const session = storage.getState().sessions[sessionId];
  const sessionPath = session?.metadata?.path;
  if (!sessionPath) return null;
  return repoPath ? `${sessionPath}/${repoPath}` : sessionPath;
}

/**
 * Fetch issues from GitHub using `gh api` REST endpoint (supports pagination).
 */
async function fetchGitHubIssues(
  sessionId: string,
  cwd: string,
  repoInfo: RepoInfo,
  state: IssueFilterState,
  page: number,
): Promise<FetchResult> {
  const stateParam = state === "all" ? "all" : state;
  const command = `gh api "repos/${repoInfo.owner}/${repoInfo.repo}/issues?state=${stateParam}&per_page=${PAGE_SIZE}&page=${page}&sort=created&direction=desc" 2>&1`;

  const result = await sessionBash(sessionId, {
    command,
    cwd,
    timeout: ISSUE_FETCH_TIMEOUT,
  });

  if (!result.success || result.exitCode !== 0) {
    const errorMsg =
      result.stdout.trim() ||
      result.stderr.trim() ||
      result.error ||
      "Failed to fetch issues";
    throw new Error(errorMsg);
  }

  const stdout = result.stdout.trim();
  if (!stdout || stdout === "[]") return { issues: [], hasMore: false };

  try {
    const raw: readonly any[] = JSON.parse(stdout);
    // GitHub REST /issues returns PRs too — filter them out
    const issuesOnly = raw.filter((r) => !r.pull_request);
    const issues = issuesOnly.map(parseGitHubIssue);
    // If we got a full page of raw results, there might be more
    return { issues, hasMore: raw.length === PAGE_SIZE };
  } catch {
    throw new Error("Failed to parse GitHub issues response");
  }
}

function parseGitHubIssue(raw: any): Issue {
  return {
    number: raw.number ?? 0,
    title: raw.title ?? "",
    state: raw.state === "open" ? "open" : "closed",
    author: raw.user?.login ?? "",
    labels: (raw.labels ?? []).map(
      (l: any): IssueLabel => ({
        name: l.name ?? "",
        color: l.color ?? "",
      }),
    ),
    createdAt: raw.created_at ? new Date(raw.created_at).getTime() : 0,
    updatedAt: raw.updated_at ? new Date(raw.updated_at).getTime() : 0,
    commentCount: raw.comments ?? 0,
    body: raw.body ?? "",
    url: raw.html_url ?? "",
  };
}

/**
 * Fetch issues from Gitea using curl + REST API (supports pagination).
 */
async function fetchGiteaIssues(
  sessionId: string,
  repoInfo: RepoInfo,
  state: IssueFilterState,
  page: number,
): Promise<FetchResult> {
  if (!repoInfo.apiBase) {
    throw new Error(
      "Gitea API base URL not configured. Check Git Hosts settings.",
    );
  }
  const apiBase = repoInfo.apiBase;
  const stateParam = state === "all" ? "" : `&state=${state}`;
  const url = `${apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/issues?limit=${PAGE_SIZE}&page=${page}${stateParam}&type=issues`;

  // Use -w to capture HTTP status code, don't use -f so we get error body
  // Add Authorization header if apiToken is configured
  const authHeader = repoInfo.apiToken
    ? `-H "Authorization: token ${repoInfo.apiToken}"`
    : "";
  const command = `curl -s ${authHeader} -w "\\n%{http_code}" "${url}" 2>&1`;

  const result = await sessionBash(sessionId, {
    command,
    timeout: ISSUE_FETCH_TIMEOUT,
  });

  if (!result.success || result.exitCode !== 0) {
    throw new Error(
      `Gitea API request failed: ${result.stdout.trim() || result.error || "Unknown error"}\nURL: ${url}`,
    );
  }

  const stdout = result.stdout.trim();

  // Extract HTTP status code from last line
  const lines = stdout.split("\n");
  const httpStatus = lines.pop()?.trim() ?? "";
  const body = lines.join("\n").trim();

  if (httpStatus && !httpStatus.startsWith("2")) {
    throw new Error(
      `Gitea API returned HTTP ${httpStatus}: ${body.slice(0, 200)}\nURL: ${url}`,
    );
  }

  if (!body || body === "[]") return { issues: [], hasMore: false };

  try {
    const raw: readonly any[] = JSON.parse(body);
    const issues = raw.map(parseGiteaIssue);
    return { issues, hasMore: raw.length === PAGE_SIZE };
  } catch {
    throw new Error(
      `Failed to parse Gitea response: ${body.slice(0, 200)}\nURL: ${url}`,
    );
  }
}

function parseGiteaIssue(raw: any): Issue {
  return {
    number: raw.number ?? 0,
    title: raw.title ?? "",
    state: raw.state === "open" ? "open" : "closed",
    author: raw.user?.login ?? "",
    labels: (raw.labels ?? []).map(
      (l: any): IssueLabel => ({
        name: l.name ?? "",
        color: l.color ?? "",
      }),
    ),
    createdAt: raw.created_at ? new Date(raw.created_at).getTime() : 0,
    updatedAt: raw.updated_at ? new Date(raw.updated_at).getTime() : 0,
    commentCount: raw.comments ?? 0,
    body: raw.body ?? "",
    url: raw.html_url ?? "",
  };
}

/**
 * Fetch issues with pagination support.
 * For GitHub: uses `gh api` REST endpoint.
 * For Gitea: uses `curl` against REST API.
 */
export async function fetchIssues(
  sessionId: string,
  repoInfo: RepoInfo,
  state: IssueFilterState = "open",
  page: number = 1,
  repoPath?: string,
): Promise<FetchResult> {
  if (repoInfo.provider === "github") {
    const cwd = resolveRepoPath(sessionId, repoPath);
    if (!cwd) throw new Error("Session path not found");
    return fetchGitHubIssues(sessionId, cwd, repoInfo, state, page);
  }

  if (repoInfo.provider === "gitea") {
    return fetchGiteaIssues(sessionId, repoInfo, state, page);
  }

  throw new Error(`Unsupported provider: ${repoInfo.provider}`);
}

/**
 * Update issue state (close or reopen).
 */
export async function updateIssueState(
  sessionId: string,
  repoInfo: RepoInfo,
  issueNumber: number,
  newState: "open" | "closed",
  repoPath?: string,
): Promise<void> {
  if (repoInfo.provider === "github") {
    const cwd = resolveRepoPath(sessionId, repoPath);
    if (!cwd) throw new Error("Session path not found");
    const stateReason =
      newState === "closed" ? ' -f state_reason="completed"' : "";
    const command = `gh api -X PATCH "repos/${repoInfo.owner}/${repoInfo.repo}/issues/${issueNumber}" -f state="${newState}"${stateReason} 2>&1`;
    const result = await sessionBash(sessionId, {
      command,
      cwd,
      timeout: ISSUE_FETCH_TIMEOUT,
    });
    if (!result.success || result.exitCode !== 0) {
      throw new Error(
        result.stdout.trim() || result.error || "Failed to update issue state",
      );
    }
    return;
  }

  if (repoInfo.provider === "gitea") {
    if (!repoInfo.apiBase) {
      throw new Error("Gitea API base URL not configured.");
    }
    const url = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${issueNumber}`;
    const authHeader = repoInfo.apiToken
      ? `-H "Authorization: token ${repoInfo.apiToken}"`
      : "";
    const command = `curl -s -X PATCH ${authHeader} -H "Content-Type: application/json" -d '{"state":"${newState}"}' -w "\\n%{http_code}" "${url}" 2>&1`;
    const result = await sessionBash(sessionId, {
      command,
      timeout: ISSUE_FETCH_TIMEOUT,
    });
    if (!result.success || result.exitCode !== 0) {
      throw new Error(
        result.stdout.trim() || result.error || "Failed to update issue state",
      );
    }
    const lines = result.stdout.trim().split("\n");
    const httpStatus = lines.pop()?.trim() ?? "";
    if (httpStatus && !httpStatus.startsWith("2")) {
      throw new Error(`Gitea API returned HTTP ${httpStatus}`);
    }
    return;
  }

  throw new Error(`Unsupported provider: ${repoInfo.provider}`);
}

/**
 * Add a comment to an issue.
 */
export async function addIssueComment(
  sessionId: string,
  repoInfo: RepoInfo,
  issueNumber: number,
  body: string,
  repoPath?: string,
): Promise<void> {
  if (repoInfo.provider === "github") {
    const cwd = resolveRepoPath(sessionId, repoPath);
    if (!cwd) throw new Error("Session path not found");
    const command = `gh api -X POST "repos/${repoInfo.owner}/${repoInfo.repo}/issues/${issueNumber}/comments" -f body=${JSON.stringify(body)} 2>&1`;
    const result = await sessionBash(sessionId, {
      command,
      cwd,
      timeout: ISSUE_FETCH_TIMEOUT,
    });
    if (!result.success || result.exitCode !== 0) {
      throw new Error(
        result.stdout.trim() || result.error || "Failed to add comment",
      );
    }
    return;
  }

  if (repoInfo.provider === "gitea") {
    if (!repoInfo.apiBase) {
      throw new Error("Gitea API base URL not configured.");
    }
    const url = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${issueNumber}/comments`;
    const authHeader = repoInfo.apiToken
      ? `-H "Authorization: token ${repoInfo.apiToken}"`
      : "";
    const escapedBody = JSON.stringify(body);
    const command = `curl -s -X POST ${authHeader} -H "Content-Type: application/json" -d '{"body":${escapedBody}}' -w "\\n%{http_code}" "${url}" 2>&1`;
    const result = await sessionBash(sessionId, {
      command,
      timeout: ISSUE_FETCH_TIMEOUT,
    });
    if (!result.success || result.exitCode !== 0) {
      throw new Error(
        result.stdout.trim() || result.error || "Failed to add comment",
      );
    }
    const lines = result.stdout.trim().split("\n");
    const httpStatus = lines.pop()?.trim() ?? "";
    if (httpStatus && !httpStatus.startsWith("2")) {
      throw new Error(`Gitea API returned HTTP ${httpStatus}`);
    }
    return;
  }

  throw new Error(`Unsupported provider: ${repoInfo.provider}`);
}

/**
 * Create a new issue.
 */
export async function createIssue(
  sessionId: string,
  repoInfo: RepoInfo,
  title: string,
  body: string,
  repoPath?: string,
): Promise<Issue> {
  if (repoInfo.provider === "github") {
    const cwd = resolveRepoPath(sessionId, repoPath);
    if (!cwd) throw new Error("Session path not found");
    const bodyArg = body ? ` -f body=${JSON.stringify(body)}` : "";
    const command = `gh api -X POST "repos/${repoInfo.owner}/${repoInfo.repo}/issues" -f title=${JSON.stringify(title)}${bodyArg} 2>&1`;
    const result = await sessionBash(sessionId, {
      command,
      cwd,
      timeout: ISSUE_FETCH_TIMEOUT,
    });
    if (!result.success || result.exitCode !== 0) {
      throw new Error(
        result.stdout.trim() || result.error || "Failed to create issue",
      );
    }
    try {
      const raw = JSON.parse(result.stdout.trim());
      return parseGitHubIssue(raw);
    } catch {
      throw new Error("Failed to parse create issue response");
    }
  }

  if (repoInfo.provider === "gitea") {
    if (!repoInfo.apiBase) {
      throw new Error("Gitea API base URL not configured.");
    }
    const url = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/issues`;
    const authHeader = repoInfo.apiToken
      ? `-H "Authorization: token ${repoInfo.apiToken}"`
      : "";
    const payload = JSON.stringify({ title, body });
    const command = `curl -s -X POST ${authHeader} -H "Content-Type: application/json" -d ${JSON.stringify(payload)} -w "\\n%{http_code}" "${url}" 2>&1`;
    const result = await sessionBash(sessionId, {
      command,
      timeout: ISSUE_FETCH_TIMEOUT,
    });
    if (!result.success || result.exitCode !== 0) {
      throw new Error(
        result.stdout.trim() || result.error || "Failed to create issue",
      );
    }
    const lines = result.stdout.trim().split("\n");
    const httpStatus = lines.pop()?.trim() ?? "";
    const responseBody = lines.join("\n").trim();
    if (httpStatus && !httpStatus.startsWith("2")) {
      throw new Error(`Gitea API returned HTTP ${httpStatus}`);
    }
    try {
      const raw = JSON.parse(responseBody);
      return parseGiteaIssue(raw);
    } catch {
      throw new Error("Failed to parse create issue response");
    }
  }

  throw new Error(`Unsupported provider: ${repoInfo.provider}`);
}

/**
 * Check if `gh` CLI is available and authenticated.
 */
export async function checkGhCliAvailable(
  sessionId: string,
  repoPath?: string,
): Promise<boolean> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) return false;

  const result = await sessionBash(sessionId, {
    command: "gh auth status 2>&1",
    cwd,
    timeout: 5000,
  });

  return result.success && result.exitCode === 0;
}
