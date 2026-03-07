/**
 * Issue fetching module
 *
 * Fetches issues from GitHub/Gitea via sessionBash (running commands on user's machine).
 * Uses `gh api` for GitHub (leveraging user's existing auth, with pagination).
 * Uses `curl` + API for Gitea.
 */

import { sessionBash, machineBash } from "./ops";
import { storage } from "./storage";
import type {
  Issue,
  IssueLabel,
  RepoInfo,
  IssueFilterState,
  IssueSortField,
  IssueSortDirection,
} from "./issueTypes";

const ISSUE_FETCH_TIMEOUT = 15000;

export const PAGE_SIZE = 50;

/**
 * Remove sensitive tokens from error messages to prevent leakage.
 */
function sanitizeErrorOutput(message: string): string {
  return message
    .replace(/Authorization:\s*token\s+\S+/gi, "Authorization: [REDACTED]")
    .replace(
      /-H\s+"Authorization:\s*token\s+[^"]*"/gi,
      '-H "Authorization: [REDACTED]"',
    )
    .replace(/token\s+[a-zA-Z0-9_-]{20,}/g, "token [REDACTED]");
}

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
  sort: IssueSortField,
  direction: IssueSortDirection,
  labels: readonly string[],
): Promise<FetchResult> {
  const stateParam = state === "all" ? "all" : state;
  const labelsParam = labels.length > 0 ? `&labels=${labels.join(",")}` : "";
  const command = `gh api "repos/${repoInfo.owner}/${repoInfo.repo}/issues?state=${stateParam}&per_page=${PAGE_SIZE}&page=${page}&sort=${sort}&direction=${direction}${labelsParam}" 2>&1`;

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
 * Map sort field and direction to Gitea API sort parameter.
 */
function mapGiteaSort(
  sort: IssueSortField,
  direction: IssueSortDirection,
): string {
  if (sort === "comments") return "&sort=mostcomment";
  if (sort === "updated")
    return direction === "asc" ? "&sort=leastupdate" : "&sort=recentupdate";
  // sort === "created"
  return direction === "asc" ? "&sort=oldest" : ""; // default is newest
}

/**
 * Fetch issues from Gitea using curl + REST API (supports pagination).
 */
async function fetchGiteaIssues(
  sessionId: string,
  repoInfo: RepoInfo,
  state: IssueFilterState,
  page: number,
  sort: IssueSortField,
  direction: IssueSortDirection,
  labels: readonly string[],
): Promise<FetchResult> {
  if (!repoInfo.apiBase) {
    throw new Error(
      "Gitea API base URL not configured. Check Git Hosts settings.",
    );
  }
  const apiBase = repoInfo.apiBase;
  const stateParam = state === "all" ? "" : `&state=${state}`;
  const sortParam = mapGiteaSort(sort, direction);
  const labelsParam =
    labels.length > 0
      ? `&labels=${labels.map(encodeURIComponent).join(",")}`
      : "";
  const url = `${apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/issues?limit=${PAGE_SIZE}&page=${page}${stateParam}&type=issues${sortParam}${labelsParam}`;

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
      `Gitea API request failed: ${sanitizeErrorOutput(result.stdout.trim() || result.error || "Unknown error")}\nURL: ${url}`,
    );
  }

  const stdout = result.stdout.trim();

  // Extract HTTP status code from last line
  const lines = stdout.split("\n");
  const httpStatus = lines.pop()?.trim() ?? "";
  const body = lines.join("\n").trim();

  if (httpStatus && !httpStatus.startsWith("2")) {
    throw new Error(
      `Gitea API returned HTTP ${httpStatus}: ${sanitizeErrorOutput(body.slice(0, 200))}\nURL: ${url}`,
    );
  }

  if (!body || body === "[]") return { issues: [], hasMore: false };

  try {
    const raw: readonly any[] = JSON.parse(body);
    const issues = raw.map(parseGiteaIssue);
    return { issues, hasMore: raw.length === PAGE_SIZE };
  } catch {
    throw new Error(
      `Failed to parse Gitea response: ${sanitizeErrorOutput(body.slice(0, 200))}\nURL: ${url}`,
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
  sort: IssueSortField = "created",
  direction: IssueSortDirection = "desc",
  labels: readonly string[] = [],
): Promise<FetchResult> {
  if (repoInfo.provider === "github") {
    const cwd = resolveRepoPath(sessionId, repoPath);
    if (!cwd) throw new Error("Session path not found");
    return fetchGitHubIssues(
      sessionId,
      cwd,
      repoInfo,
      state,
      page,
      sort,
      direction,
      labels,
    );
  }

  if (repoInfo.provider === "gitea") {
    return fetchGiteaIssues(
      sessionId,
      repoInfo,
      state,
      page,
      sort,
      direction,
      labels,
    );
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
        sanitizeErrorOutput(
          result.stdout.trim() ||
            result.error ||
            "Failed to update issue state",
        ),
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
        sanitizeErrorOutput(
          result.stdout.trim() || result.error || "Failed to add comment",
        ),
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
 * Fetch available labels for a repository.
 */
export async function fetchLabels(
  sessionId: string,
  repoInfo: RepoInfo,
  repoPath?: string,
): Promise<readonly IssueLabel[]> {
  if (repoInfo.provider === "github") {
    const cwd = resolveRepoPath(sessionId, repoPath);
    if (!cwd) throw new Error("Session path not found");
    const command = `gh api "repos/${repoInfo.owner}/${repoInfo.repo}/labels?per_page=100" 2>&1`;
    const result = await sessionBash(sessionId, {
      command,
      cwd,
      timeout: ISSUE_FETCH_TIMEOUT,
    });
    if (!result.success || result.exitCode !== 0) {
      return [];
    }
    try {
      const raw = JSON.parse(result.stdout.trim());
      if (!Array.isArray(raw)) return [];
      return raw.map((l: any) => ({
        name: String(l.name ?? ""),
        color: String(l.color ?? ""),
      }));
    } catch {
      return [];
    }
  }

  if (repoInfo.provider === "gitea") {
    if (!repoInfo.apiBase) return [];
    const authHeader = repoInfo.apiToken
      ? `-H "Authorization: token ${repoInfo.apiToken}"`
      : "";

    // Fetch repo-level and org-level labels in parallel
    const repoUrl = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/labels?limit=50`;
    const orgUrl = `${repoInfo.apiBase}/orgs/${repoInfo.owner}/labels?limit=50`;

    const parseGiteaLabels = (stdout: string): readonly IssueLabel[] => {
      const lines = stdout.trim().split("\n");
      const httpStatus = lines.pop()?.trim() ?? "";
      const responseBody = lines.join("\n").trim();
      if (!httpStatus.startsWith("2")) return [];
      try {
        const raw = JSON.parse(responseBody);
        if (!Array.isArray(raw)) return [];
        return raw.map((l: any) => ({
          name: String(l.name ?? ""),
          color: String(l.color ?? ""),
        }));
      } catch {
        return [];
      }
    };

    const [repoResult, orgResult] = await Promise.all([
      sessionBash(sessionId, {
        command: `curl -s ${authHeader} -w "\\n%{http_code}" "${repoUrl}" 2>&1`,
        timeout: ISSUE_FETCH_TIMEOUT,
      }),
      sessionBash(sessionId, {
        command: `curl -s ${authHeader} -w "\\n%{http_code}" "${orgUrl}" 2>&1`,
        timeout: ISSUE_FETCH_TIMEOUT,
      }),
    ]);

    const repoLabels =
      repoResult.success && repoResult.exitCode === 0
        ? parseGiteaLabels(repoResult.stdout)
        : [];
    const orgLabels =
      orgResult.success && orgResult.exitCode === 0
        ? parseGiteaLabels(orgResult.stdout)
        : [];

    // Merge, repo labels take priority (dedupe by name)
    const seen = new Set<string>();
    const merged: IssueLabel[] = [];
    for (const label of [...repoLabels, ...orgLabels]) {
      if (!seen.has(label.name)) {
        seen.add(label.name);
        merged.push(label);
      }
    }
    return merged;
  }

  return [];
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
  labels?: readonly string[],
): Promise<Issue> {
  if (repoInfo.provider === "github") {
    const cwd = resolveRepoPath(sessionId, repoPath);
    if (!cwd) throw new Error("Session path not found");
    const bodyArg = body ? ` -f body=${JSON.stringify(body)}` : "";
    const labelsArgs = labels?.length
      ? labels.map((l) => ` -f labels[]=${JSON.stringify(l)}`).join("")
      : "";
    const command = `gh api -X POST "repos/${repoInfo.owner}/${repoInfo.repo}/issues" -f title=${JSON.stringify(title)}${bodyArg}${labelsArgs} 2>&1`;
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
        sanitizeErrorOutput(
          result.stdout.trim() || result.error || "Failed to create issue",
        ),
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
 * Replace all labels on a Gitea issue.
 * Gitea PATCH /issues doesn't support labels directly — use PUT /issues/:id/labels.
 */
async function replaceGiteaIssueLabels(
  sessionId: string,
  repoInfo: RepoInfo,
  issueNumber: number,
  labelNames: readonly string[],
): Promise<void> {
  if (!repoInfo.apiBase) return;
  // Gitea PUT /labels expects label IDs, but we can use the label replacement endpoint
  // that accepts label names via the body. However Gitea API actually expects IDs...
  // Alternative: use PATCH /issues/{index} with labels array of IDs.
  // For simplicity, we'll clear existing labels then add by name using individual endpoints.
  // Actually, Gitea 1.20+ supports PUT /repos/{owner}/{repo}/issues/{index}/labels with IDs.
  // Since we only have names, we need to resolve names→IDs first.

  const authHeader = repoInfo.apiToken
    ? `-H "Authorization: token ${repoInfo.apiToken}"`
    : "";

  // Fetch all available labels (repo + org) to resolve names → IDs
  const [repoLabelsResult, orgLabelsResult] = await Promise.all([
    sessionBash(sessionId, {
      command: `curl -s ${authHeader} -w "\\n%{http_code}" "${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/labels?limit=50" 2>&1`,
      timeout: ISSUE_FETCH_TIMEOUT,
    }),
    sessionBash(sessionId, {
      command: `curl -s ${authHeader} -w "\\n%{http_code}" "${repoInfo.apiBase}/orgs/${repoInfo.owner}/labels?limit=50" 2>&1`,
      timeout: ISSUE_FETCH_TIMEOUT,
    }),
  ]);

  const parseLabelIds = (stdout: string): ReadonlyMap<string, number> => {
    const lines = stdout.trim().split("\n");
    const httpStatus = lines.pop()?.trim() ?? "";
    const responseBody = lines.join("\n").trim();
    if (!httpStatus.startsWith("2")) return new Map();
    try {
      const raw = JSON.parse(responseBody);
      if (!Array.isArray(raw)) return new Map();
      const map = new Map<string, number>();
      for (const l of raw) {
        if (l.name && l.id) map.set(String(l.name), Number(l.id));
      }
      return map;
    } catch {
      return new Map();
    }
  };

  const repoMap =
    repoLabelsResult.success && repoLabelsResult.exitCode === 0
      ? parseLabelIds(repoLabelsResult.stdout)
      : new Map<string, number>();
  const orgMap =
    orgLabelsResult.success && orgLabelsResult.exitCode === 0
      ? parseLabelIds(orgLabelsResult.stdout)
      : new Map<string, number>();

  // Resolve label names to IDs (repo labels take priority)
  const labelIds: number[] = [];
  for (const name of labelNames) {
    const id = repoMap.get(name) ?? orgMap.get(name);
    if (id !== undefined) labelIds.push(id);
  }

  // PUT /repos/{owner}/{repo}/issues/{index}/labels replaces all labels
  const url = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${issueNumber}/labels`;
  const payload = JSON.stringify({ labels: labelIds });
  const command = `curl -s -X PUT ${authHeader} -H "Content-Type: application/json" -d ${JSON.stringify(payload)} -w "\\n%{http_code}" "${url}" 2>&1`;
  const result = await sessionBash(sessionId, {
    command,
    timeout: ISSUE_FETCH_TIMEOUT,
  });
  if (!result.success || result.exitCode !== 0) return;
  const lines = result.stdout.trim().split("\n");
  const httpStatus = lines.pop()?.trim() ?? "";
  if (httpStatus && !httpStatus.startsWith("2")) {
    throw new Error(
      `Failed to update labels: Gitea API returned HTTP ${httpStatus}`,
    );
  }
}

/**
 * Edit an issue's title and/or body.
 */
export async function editIssue(
  sessionId: string,
  repoInfo: RepoInfo,
  issueNumber: number,
  title: string,
  body: string,
  repoPath?: string,
  labels?: readonly string[],
): Promise<void> {
  if (repoInfo.provider === "github") {
    const cwd = resolveRepoPath(sessionId, repoPath);
    if (!cwd) throw new Error("Session path not found");
    // Build gh api command — use --input for JSON body to support labels array
    const payload: Record<string, unknown> = { title, body };
    if (labels) {
      payload.labels = labels;
    }
    const command = `echo ${JSON.stringify(JSON.stringify(payload))} | gh api -X PATCH "repos/${repoInfo.owner}/${repoInfo.repo}/issues/${issueNumber}" --input - 2>&1`;
    const result = await sessionBash(sessionId, {
      command,
      cwd,
      timeout: ISSUE_FETCH_TIMEOUT,
    });
    if (!result.success || result.exitCode !== 0) {
      throw new Error(
        result.stdout.trim() || result.error || "Failed to edit issue",
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
    const payload: Record<string, unknown> = { title, body };
    const command = `curl -s -X PATCH ${authHeader} -H "Content-Type: application/json" -d ${JSON.stringify(JSON.stringify(payload))} -w "\n%{http_code}" "${url}" 2>&1`;
    const result = await sessionBash(sessionId, {
      command,
      timeout: ISSUE_FETCH_TIMEOUT,
    });
    if (!result.success || result.exitCode !== 0) {
      throw new Error(
        sanitizeErrorOutput(
          result.stdout.trim() || result.error || "Failed to edit issue",
        ),
      );
    }
    const lines = result.stdout.trim().split("\n");
    const httpStatus = lines.pop()?.trim() ?? "";
    if (httpStatus && !httpStatus.startsWith("2")) {
      throw new Error(`Gitea API returned HTTP ${httpStatus}`);
    }

    // Gitea requires separate API call to replace labels
    if (labels) {
      await replaceGiteaIssueLabels(sessionId, repoInfo, issueNumber, labels);
    }
    return;
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

/**
 * Update issue state via machineBash (no active session required).
 * Used for closing issues after worktree merge when the session has ended.
 */
export async function updateIssueStateViaMachine(
  machineId: string,
  repoInfo: RepoInfo,
  issueNumber: number,
  newState: "open" | "closed",
  cwd: string,
): Promise<void> {
  if (repoInfo.provider === "github") {
    const stateReason =
      newState === "closed" ? ' -f state_reason="completed"' : "";
    const command = `gh api -X PATCH "repos/${repoInfo.owner}/${repoInfo.repo}/issues/${issueNumber}" -f state="${newState}"${stateReason} 2>&1`;
    const result = await machineBash(machineId, command, cwd);
    if (!result.success || result.exitCode !== 0) {
      throw new Error(
        result.stdout.trim() ||
          result.stderr.trim() ||
          "Failed to update issue state",
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
    const result = await machineBash(machineId, command, cwd);
    if (!result.success || result.exitCode !== 0) {
      throw new Error(
        sanitizeErrorOutput(
          result.stdout.trim() ||
            result.stderr.trim() ||
            "Failed to update issue state",
        ),
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
 * Add a comment to an issue via machineBash (no active session required).
 * Used for adding completion comments after worktree merge.
 */
export async function addIssueCommentViaMachine(
  machineId: string,
  repoInfo: RepoInfo,
  issueNumber: number,
  body: string,
  cwd: string,
): Promise<void> {
  if (repoInfo.provider === "github") {
    const command = `gh api -X POST "repos/${repoInfo.owner}/${repoInfo.repo}/issues/${issueNumber}/comments" -f body=${JSON.stringify(body)} 2>&1`;
    const result = await machineBash(machineId, command, cwd);
    if (!result.success || result.exitCode !== 0) {
      throw new Error(
        result.stdout.trim() || result.stderr.trim() || "Failed to add comment",
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
    const result = await machineBash(machineId, command, cwd);
    if (!result.success || result.exitCode !== 0) {
      throw new Error(
        sanitizeErrorOutput(
          result.stdout.trim() ||
            result.stderr.trim() ||
            "Failed to add comment",
        ),
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
