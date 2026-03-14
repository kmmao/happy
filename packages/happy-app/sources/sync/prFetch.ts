/**
 * Pull Request fetching module
 *
 * Fetches PRs from GitHub/Gitea via sessionBash (running commands on user's machine).
 * Uses `gh api` for GitHub (leveraging user's existing auth, with pagination).
 * Uses `curl` + API for Gitea.
 *
 * Mirrors issueFetch.ts patterns exactly.
 */

import { sessionBash } from "./ops";
import { storage } from "./storage";
import type { RepoInfo } from "./issueTypes";
import type {
    PullRequest,
    PRState,
    PRFilterState,
    PRSortField,
    PRSortDirection,
    PRFetchResult,
    PRFileDiff,
    PRComment,
    PRReview,
    ReviewState,
    CheckRun,
    CheckStatus,
    MergeMethod,
    MergeableState,
} from "./prTypes";

const PR_FETCH_TIMEOUT = 15000;
const PR_MERGE_TIMEOUT = 30000;

export const PR_PAGE_SIZE = 50;

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

function resolveRepoPath(sessionId: string, repoPath?: string): string | null {
    const session = storage.getState().sessions[sessionId];
    const sessionPath = session?.metadata?.path;
    if (!sessionPath) return null;
    return repoPath ? `${sessionPath}/${repoPath}` : sessionPath;
}

// ── GitHub response parsers ─────────────────────────────────────────

function deriveGitHubPRState(raw: any): PRState {
    if (raw.merged_at) return "merged";
    if (raw.state === "closed") return "closed";
    return "open";
}

function deriveGitHubMergeableState(raw: any): MergeableState {
    if (raw.mergeable === true) return "mergeable";
    if (raw.mergeable === false) return "conflicting";
    return "unknown";
}

function parseGitHubPR(raw: any): PullRequest {
    return {
        number: raw.number ?? 0,
        title: raw.title ?? "",
        body: raw.body ?? "",
        state: deriveGitHubPRState(raw),
        author: raw.user?.login ?? "",
        labels: (raw.labels ?? []).map((l: any) => ({
            name: l.name ?? "",
            color: l.color ?? "",
        })),
        createdAt: raw.created_at ? new Date(raw.created_at).getTime() : 0,
        updatedAt: raw.updated_at ? new Date(raw.updated_at).getTime() : 0,
        mergedAt: raw.merged_at ? new Date(raw.merged_at).getTime() : null,
        closedAt: raw.closed_at ? new Date(raw.closed_at).getTime() : null,
        url: raw.html_url ?? "",
        headBranch: raw.head?.ref ?? "",
        baseBranch: raw.base?.ref ?? "",
        draft: raw.draft ?? false,
        commentCount: (raw.comments ?? 0) + (raw.review_comments ?? 0),
        additions: raw.additions ?? 0,
        deletions: raw.deletions ?? 0,
        changedFiles: raw.changed_files ?? 0,
        mergeableState: deriveGitHubMergeableState(raw),
        checksStatus: null, // requires separate API call
        reviewDecision: null, // requires separate API call
    };
}

function parseGitHubPRFileDiff(raw: any): PRFileDiff {
    const statusMap: Record<string, PRFileDiff["status"]> = {
        added: "added",
        removed: "removed",
        modified: "modified",
        renamed: "renamed",
    };
    return {
        filename: raw.filename ?? "",
        status: statusMap[raw.status] ?? "modified",
        additions: raw.additions ?? 0,
        deletions: raw.deletions ?? 0,
        previousFilename: raw.previous_filename,
        patch: raw.patch,
    };
}

function parseGitHubReview(raw: any): PRReview {
    const stateMap: Record<string, ReviewState> = {
        APPROVED: "approved",
        CHANGES_REQUESTED: "changes_requested",
        COMMENTED: "commented",
        PENDING: "pending",
        DISMISSED: "dismissed",
    };
    return {
        author: raw.user?.login ?? "",
        state: stateMap[raw.state] ?? "commented",
        body: raw.body ?? "",
        submittedAt: raw.submitted_at ? new Date(raw.submitted_at).getTime() : 0,
    };
}

function parseGitHubCheckRun(raw: any): CheckRun {
    const conclusionMap: Record<string, CheckStatus> = {
        success: "success",
        failure: "failure",
        timed_out: "failure",
        action_required: "failure",
        cancelled: "error",
        skipped: "success",
        neutral: "success",
    };
    const status: CheckStatus =
        raw.status === "completed"
            ? (conclusionMap[raw.conclusion] ?? "error")
            : "pending";
    return {
        name: raw.name ?? "",
        status,
        url: raw.html_url ?? "",
    };
}

function parseGitHubComment(raw: any): PRComment {
    return {
        id: raw.id ?? 0,
        author: raw.user?.login ?? "",
        body: raw.body ?? "",
        createdAt: raw.created_at ? new Date(raw.created_at).getTime() : 0,
        updatedAt: raw.updated_at ? new Date(raw.updated_at).getTime() : 0,
    };
}

// ── Gitea response parsers ──────────────────────────────────────────

function deriveGiteaPRState(raw: any): PRState {
    if (raw.merged) return "merged";
    if (raw.state === "closed") return "closed";
    return "open";
}

function parseGiteaPR(raw: any): PullRequest {
    const mergeable = raw.mergeable;
    const mergeableState: MergeableState =
        mergeable === true ? "mergeable"
            : mergeable === false ? "conflicting"
                : "unknown";

    return {
        number: raw.number ?? 0,
        title: raw.title ?? "",
        body: raw.body ?? "",
        state: deriveGiteaPRState(raw),
        author: raw.user?.login ?? "",
        labels: (raw.labels ?? []).map((l: any) => ({
            name: l.name ?? "",
            color: l.color ?? "",
        })),
        createdAt: raw.created_at ? new Date(raw.created_at).getTime() : 0,
        updatedAt: raw.updated_at ? new Date(raw.updated_at).getTime() : 0,
        mergedAt: raw.merged_at ? new Date(raw.merged_at).getTime() : null,
        closedAt: raw.closed_at ? new Date(raw.closed_at).getTime() : null,
        url: raw.html_url ?? "",
        headBranch: raw.head?.ref ?? "",
        baseBranch: raw.base?.ref ?? "",
        draft: raw.draft ?? false,
        commentCount: raw.comments ?? 0,
        additions: raw.additions ?? 0,
        deletions: raw.deletions ?? 0,
        changedFiles: raw.changed_files ?? 0,
        mergeableState,
        checksStatus: null,
        reviewDecision: null,
    };
}

function parseGiteaComment(raw: any): PRComment {
    return {
        id: raw.id ?? 0,
        author: raw.user?.login ?? "",
        body: raw.body ?? "",
        createdAt: raw.created_at ? new Date(raw.created_at).getTime() : 0,
        updatedAt: raw.updated_at ? new Date(raw.updated_at).getTime() : 0,
    };
}

// ── Gitea helper ────────────────────────────────────────────────────

function giteaSort(sort: PRSortField, direction: PRSortDirection): string {
    if (sort === "updated")
        return direction === "asc" ? "&sort=leastupdate" : "&sort=recentupdate";
    return direction === "asc" ? "&sort=oldest" : "";
}

/**
 * Execute a Gitea curl request and return { body, httpStatus }.
 * Throws on bash failure or non-2xx status.
 */
async function giteaCurl(
    sessionId: string,
    url: string,
    repoInfo: RepoInfo,
    options: {
        method?: string;
        payload?: string;
        timeout?: number;
    } = {},
): Promise<{ body: string; httpStatus: string }> {
    const method = options.method ?? "GET";
    const timeout = options.timeout ?? PR_FETCH_TIMEOUT;
    const authHeader = repoInfo.apiToken
        ? `-H "Authorization: token ${repoInfo.apiToken}"`
        : "";
    const methodFlag = method !== "GET" ? `-X ${method}` : "";
    const contentType = options.payload
        ? '-H "Content-Type: application/json"'
        : "";
    const dataFlag = options.payload
        ? `-d ${JSON.stringify(options.payload)}`
        : "";

    const command = `curl -s ${methodFlag} ${authHeader} ${contentType} ${dataFlag} -w "\\n%{http_code}" "${url}" 2>&1`;

    const result = await sessionBash(sessionId, { command, timeout });

    if (!result.success || result.exitCode !== 0) {
        throw new Error(
            sanitizeErrorOutput(
                (result.stdout ?? "").trim() || result.error || `${method} request failed`,
            ),
        );
    }

    const stdout = (result.stdout ?? "").trim();
    const lines = stdout.split("\n");
    const httpStatus = lines.pop()?.trim() ?? "";
    const body = lines.join("\n").trim();

    if (httpStatus && !httpStatus.startsWith("2")) {
        throw new Error(
            `Gitea API returned HTTP ${httpStatus}: ${sanitizeErrorOutput(body.slice(0, 200))}`,
        );
    }

    return { body, httpStatus };
}

// ── Fetch PRs ───────────────────────────────────────────────────────

async function fetchGitHubPRs(
    sessionId: string,
    cwd: string,
    repoInfo: RepoInfo,
    state: PRFilterState,
    page: number,
    sort: PRSortField,
    direction: PRSortDirection,
): Promise<PRFetchResult> {
    const stateParam = state;
    const command = `gh api "repos/${repoInfo.owner}/${repoInfo.repo}/pulls?state=${stateParam}&per_page=${PR_PAGE_SIZE}&page=${page}&sort=${sort}&direction=${direction}" 2>&1`;

    const result = await sessionBash(sessionId, {
        command,
        cwd,
        timeout: PR_FETCH_TIMEOUT,
    });

    if (!result.success || result.exitCode !== 0) {
        throw new Error(
            (result.stdout ?? "").trim() || result.error || "Failed to fetch PRs",
        );
    }

    const stdout = (result.stdout ?? "").trim();
    if (!stdout || stdout === "[]") return { prs: [], hasMore: false };

    try {
        const raw: readonly any[] = JSON.parse(stdout);
        const prs = raw.map(parseGitHubPR);
        return { prs, hasMore: raw.length === PR_PAGE_SIZE };
    } catch {
        throw new Error("Failed to parse GitHub PRs response");
    }
}

async function fetchGiteaPRs(
    sessionId: string,
    repoInfo: RepoInfo,
    state: PRFilterState,
    page: number,
    sort: PRSortField,
    direction: PRSortDirection,
): Promise<PRFetchResult> {
    if (!repoInfo.apiBase) {
        throw new Error("Gitea API base URL not configured. Check Git Hosts settings.");
    }

    const stateParam = state === "all" ? "" : `&state=${state}`;
    const sortParam = giteaSort(sort, direction);
    const url = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls?limit=${PR_PAGE_SIZE}&page=${page}${stateParam}${sortParam}`;

    const { body } = await giteaCurl(sessionId, url, repoInfo);

    if (!body || body === "[]") return { prs: [], hasMore: false };

    try {
        const raw: readonly any[] = JSON.parse(body);
        const prs = raw.map(parseGiteaPR);
        return { prs, hasMore: raw.length === PR_PAGE_SIZE };
    } catch {
        throw new Error("Failed to parse Gitea PRs response");
    }
}

/**
 * Fetch PRs with pagination support.
 */
export async function fetchPullRequests(
    sessionId: string,
    repoInfo: RepoInfo,
    state: PRFilterState = "open",
    page: number = 1,
    repoPath?: string,
    sort: PRSortField = "created",
    direction: PRSortDirection = "desc",
): Promise<PRFetchResult> {
    if (repoInfo.provider === "github") {
        const cwd = resolveRepoPath(sessionId, repoPath);
        if (!cwd) throw new Error("Session path not found");
        return fetchGitHubPRs(sessionId, cwd, repoInfo, state, page, sort, direction);
    }

    if (repoInfo.provider === "gitea") {
        return fetchGiteaPRs(sessionId, repoInfo, state, page, sort, direction);
    }

    throw new Error(`Unsupported provider: ${repoInfo.provider}`);
}

// ── Fetch single PR detail ──────────────────────────────────────────

/**
 * Fetch a single PR with full detail (includes mergeable state, additions/deletions).
 */
export async function fetchPullRequestDetail(
    sessionId: string,
    repoInfo: RepoInfo,
    prNumber: number,
    repoPath?: string,
): Promise<PullRequest> {
    if (repoInfo.provider === "github") {
        const cwd = resolveRepoPath(sessionId, repoPath);
        if (!cwd) throw new Error("Session path not found");
        const command = `gh api "repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}" 2>&1`;
        const result = await sessionBash(sessionId, { command, cwd, timeout: PR_FETCH_TIMEOUT });
        if (!result.success || result.exitCode !== 0) {
            throw new Error(
                (result.stdout ?? "").trim() || result.error || "Failed to fetch PR detail",
            );
        }
        try {
            return parseGitHubPR(JSON.parse((result.stdout ?? "").trim()));
        } catch {
            throw new Error("Failed to parse PR detail response");
        }
    }

    if (repoInfo.provider === "gitea") {
        if (!repoInfo.apiBase) throw new Error("Gitea API base URL not configured.");
        const url = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}`;
        const { body } = await giteaCurl(sessionId, url, repoInfo);
        try {
            return parseGiteaPR(JSON.parse(body));
        } catch {
            throw new Error("Failed to parse PR detail response");
        }
    }

    throw new Error(`Unsupported provider: ${repoInfo.provider}`);
}

// ── Fetch PR files ──────────────────────────────────────────────────

/**
 * Fetch changed files for a PR (paginated, per-file diffs).
 */
export async function fetchPRFiles(
    sessionId: string,
    repoInfo: RepoInfo,
    prNumber: number,
    repoPath?: string,
    page: number = 1,
): Promise<{ files: readonly PRFileDiff[]; hasMore: boolean }> {
    if (repoInfo.provider === "github") {
        const cwd = resolveRepoPath(sessionId, repoPath);
        if (!cwd) throw new Error("Session path not found");
        const command = `gh api "repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}/files?per_page=${PR_PAGE_SIZE}&page=${page}" 2>&1`;
        const result = await sessionBash(sessionId, { command, cwd, timeout: PR_FETCH_TIMEOUT });
        if (!result.success || result.exitCode !== 0) {
            throw new Error(
                (result.stdout ?? "").trim() || result.error || "Failed to fetch PR files",
            );
        }
        const stdout = (result.stdout ?? "").trim();
        if (!stdout || stdout === "[]") return { files: [], hasMore: false };
        try {
            const raw: readonly any[] = JSON.parse(stdout);
            return {
                files: raw.map(parseGitHubPRFileDiff),
                hasMore: raw.length === PR_PAGE_SIZE,
            };
        } catch {
            throw new Error("Failed to parse PR files response");
        }
    }

    if (repoInfo.provider === "gitea") {
        if (!repoInfo.apiBase) throw new Error("Gitea API base URL not configured.");
        const url = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}/files?limit=${PR_PAGE_SIZE}&page=${page}`;
        const { body } = await giteaCurl(sessionId, url, repoInfo);
        if (!body || body === "[]") return { files: [], hasMore: false };
        try {
            const raw: readonly any[] = JSON.parse(body);
            const files: PRFileDiff[] = raw.map((f: any) => ({
                filename: f.filename ?? "",
                status: f.status === "added" ? "added"
                    : f.status === "deleted" ? "removed"
                        : f.status === "renamed" ? "renamed"
                            : "modified",
                additions: f.additions ?? 0,
                deletions: f.deletions ?? 0,
                previousFilename: f.previous_filename,
                patch: f.patch,
            }));
            return { files, hasMore: raw.length === PR_PAGE_SIZE };
        } catch {
            throw new Error("Failed to parse PR files response");
        }
    }

    throw new Error(`Unsupported provider: ${repoInfo.provider}`);
}

// ── Fetch PR reviews ────────────────────────────────────────────────

export async function fetchPRReviews(
    sessionId: string,
    repoInfo: RepoInfo,
    prNumber: number,
    repoPath?: string,
): Promise<readonly PRReview[]> {
    if (repoInfo.provider === "github") {
        const cwd = resolveRepoPath(sessionId, repoPath);
        if (!cwd) throw new Error("Session path not found");
        const command = `gh api "repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}/reviews" 2>&1`;
        const result = await sessionBash(sessionId, { command, cwd, timeout: PR_FETCH_TIMEOUT });
        if (!result.success || result.exitCode !== 0) return [];
        try {
            const raw: readonly any[] = JSON.parse((result.stdout ?? "").trim());
            return raw.map(parseGitHubReview);
        } catch {
            return [];
        }
    }

    if (repoInfo.provider === "gitea") {
        if (!repoInfo.apiBase) return [];
        const url = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}/reviews`;
        try {
            const { body } = await giteaCurl(sessionId, url, repoInfo);
            if (!body || body === "[]") return [];
            const raw: readonly any[] = JSON.parse(body);
            return raw.map((r: any): PRReview => ({
                author: r.user?.login ?? "",
                state: r.state?.toLowerCase() === "approved" ? "approved"
                    : r.state?.toLowerCase() === "request_changes" ? "changes_requested"
                        : "commented",
                body: r.body ?? "",
                submittedAt: r.submitted_at ? new Date(r.submitted_at).getTime() : 0,
            }));
        } catch {
            return [];
        }
    }

    return [];
}

// ── Fetch PR check runs / CI status ─────────────────────────────────

export async function fetchPRChecks(
    sessionId: string,
    repoInfo: RepoInfo,
    prNumber: number,
    repoPath?: string,
): Promise<readonly CheckRun[]> {
    if (repoInfo.provider === "github") {
        const cwd = resolveRepoPath(sessionId, repoPath);
        if (!cwd) throw new Error("Session path not found");
        // Get the PR head SHA first from detail, then fetch check runs
        const detailCmd = `gh api "repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}" --jq '.head.sha' 2>&1`;
        const detailResult = await sessionBash(sessionId, { command: detailCmd, cwd, timeout: PR_FETCH_TIMEOUT });
        if (!detailResult.success || detailResult.exitCode !== 0) return [];
        const sha = (detailResult.stdout ?? "").trim();
        if (!sha) return [];

        const checksCmd = `gh api "repos/${repoInfo.owner}/${repoInfo.repo}/commits/${sha}/check-runs?per_page=100" --jq '.check_runs' 2>&1`;
        const checksResult = await sessionBash(sessionId, { command: checksCmd, cwd, timeout: PR_FETCH_TIMEOUT });
        if (!checksResult.success || checksResult.exitCode !== 0) return [];
        try {
            const raw: readonly any[] = JSON.parse((checksResult.stdout ?? "").trim());
            return raw.map(parseGitHubCheckRun);
        } catch {
            return [];
        }
    }

    // Gitea: commit status API (similar concept)
    if (repoInfo.provider === "gitea") {
        if (!repoInfo.apiBase) return [];
        try {
            // Get PR head SHA
            const prUrl = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}`;
            const { body: prBody } = await giteaCurl(sessionId, prUrl, repoInfo);
            const prData = JSON.parse(prBody);
            const sha = prData.head?.sha;
            if (!sha) return [];

            const statusUrl = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/commits/${sha}/statuses?limit=50`;
            const { body } = await giteaCurl(sessionId, statusUrl, repoInfo);
            if (!body || body === "[]") return [];
            const raw: readonly any[] = JSON.parse(body);
            return raw.map((s: any): CheckRun => ({
                name: s.context ?? s.description ?? "",
                status: s.status === "success" ? "success"
                    : s.status === "failure" ? "failure"
                        : s.status === "error" ? "error"
                            : "pending",
                url: s.target_url ?? "",
            }));
        } catch {
            return [];
        }
    }

    return [];
}

// ── Fetch PR comments ───────────────────────────────────────────────

export async function fetchPRComments(
    sessionId: string,
    repoInfo: RepoInfo,
    prNumber: number,
    repoPath?: string,
): Promise<readonly PRComment[]> {
    if (repoInfo.provider === "github") {
        const cwd = resolveRepoPath(sessionId, repoPath);
        if (!cwd) throw new Error("Session path not found");
        // Issue comments endpoint works for PR comments too
        const command = `gh api "repos/${repoInfo.owner}/${repoInfo.repo}/issues/${prNumber}/comments?per_page=100" 2>&1`;
        const result = await sessionBash(sessionId, { command, cwd, timeout: PR_FETCH_TIMEOUT });
        if (!result.success || result.exitCode !== 0) return [];
        try {
            const raw: readonly any[] = JSON.parse((result.stdout ?? "").trim());
            return raw.map(parseGitHubComment);
        } catch {
            return [];
        }
    }

    if (repoInfo.provider === "gitea") {
        if (!repoInfo.apiBase) return [];
        const url = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${prNumber}/comments?limit=100`;
        try {
            const { body } = await giteaCurl(sessionId, url, repoInfo);
            if (!body || body === "[]") return [];
            const raw: readonly any[] = JSON.parse(body);
            return raw.map(parseGiteaComment);
        } catch {
            return [];
        }
    }

    return [];
}

// ── PR Actions ──────────────────────────────────────────────────────

/**
 * Merge a pull request.
 */
export async function mergePullRequest(
    sessionId: string,
    repoInfo: RepoInfo,
    prNumber: number,
    method: MergeMethod = "merge",
    commitTitle?: string,
    repoPath?: string,
): Promise<void> {
    if (repoInfo.provider === "github") {
        const cwd = resolveRepoPath(sessionId, repoPath);
        if (!cwd) throw new Error("Session path not found");
        const titleArg = commitTitle ? ` -f commit_title=${JSON.stringify(commitTitle)}` : "";
        const command = `gh api -X PUT "repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}/merge" -f merge_method="${method}"${titleArg} 2>&1`;
        const result = await sessionBash(sessionId, { command, cwd, timeout: PR_MERGE_TIMEOUT });
        if (!result.success || result.exitCode !== 0) {
            throw new Error(
                (result.stdout ?? "").trim() || result.error || "Failed to merge PR",
            );
        }
        return;
    }

    if (repoInfo.provider === "gitea") {
        if (!repoInfo.apiBase) throw new Error("Gitea API base URL not configured.");
        const giteaMethod = method === "rebase" ? "rebase" : method === "squash" ? "squash" : "merge";
        const payload: Record<string, unknown> = { Do: giteaMethod };
        if (commitTitle) payload.merge_message_field = commitTitle;
        const url = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}/merge`;
        await giteaCurl(sessionId, url, repoInfo, {
            method: "POST",
            payload: JSON.stringify(payload),
            timeout: PR_MERGE_TIMEOUT,
        });
        return;
    }

    throw new Error(`Unsupported provider: ${repoInfo.provider}`);
}

/**
 * Close a pull request (without merging).
 */
export async function closePullRequest(
    sessionId: string,
    repoInfo: RepoInfo,
    prNumber: number,
    repoPath?: string,
): Promise<void> {
    if (repoInfo.provider === "github") {
        const cwd = resolveRepoPath(sessionId, repoPath);
        if (!cwd) throw new Error("Session path not found");
        const command = `gh api -X PATCH "repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}" -f state="closed" 2>&1`;
        const result = await sessionBash(sessionId, { command, cwd, timeout: PR_FETCH_TIMEOUT });
        if (!result.success || result.exitCode !== 0) {
            throw new Error(
                (result.stdout ?? "").trim() || result.error || "Failed to close PR",
            );
        }
        return;
    }

    if (repoInfo.provider === "gitea") {
        if (!repoInfo.apiBase) throw new Error("Gitea API base URL not configured.");
        const url = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}`;
        await giteaCurl(sessionId, url, repoInfo, {
            method: "PATCH",
            payload: JSON.stringify({ state: "closed" }),
        });
        return;
    }

    throw new Error(`Unsupported provider: ${repoInfo.provider}`);
}

/**
 * Submit a review (approve, request changes, or comment).
 */
export async function submitPRReview(
    sessionId: string,
    repoInfo: RepoInfo,
    prNumber: number,
    event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
    body?: string,
    repoPath?: string,
): Promise<void> {
    if (repoInfo.provider === "github") {
        const cwd = resolveRepoPath(sessionId, repoPath);
        if (!cwd) throw new Error("Session path not found");
        const bodyArg = body ? ` -f body=${JSON.stringify(body)}` : "";
        const command = `gh api -X POST "repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}/reviews" -f event="${event}"${bodyArg} 2>&1`;
        const result = await sessionBash(sessionId, { command, cwd, timeout: PR_FETCH_TIMEOUT });
        if (!result.success || result.exitCode !== 0) {
            throw new Error(
                (result.stdout ?? "").trim() || result.error || "Failed to submit review",
            );
        }
        return;
    }

    if (repoInfo.provider === "gitea") {
        if (!repoInfo.apiBase) throw new Error("Gitea API base URL not configured.");
        const giteaEvent = event === "APPROVE" ? "APPROVED"
            : event === "REQUEST_CHANGES" ? "REQUEST_CHANGES"
                : "COMMENT";
        const payload: Record<string, unknown> = { event: giteaEvent };
        if (body) payload.body = body;
        const url = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}/reviews`;
        await giteaCurl(sessionId, url, repoInfo, {
            method: "POST",
            payload: JSON.stringify(payload),
        });
        return;
    }

    throw new Error(`Unsupported provider: ${repoInfo.provider}`);
}

/**
 * Add a comment to a pull request.
 */
export async function addPRComment(
    sessionId: string,
    repoInfo: RepoInfo,
    prNumber: number,
    body: string,
    repoPath?: string,
): Promise<void> {
    if (repoInfo.provider === "github") {
        const cwd = resolveRepoPath(sessionId, repoPath);
        if (!cwd) throw new Error("Session path not found");
        const command = `gh api -X POST "repos/${repoInfo.owner}/${repoInfo.repo}/issues/${prNumber}/comments" -f body=${JSON.stringify(body)} 2>&1`;
        const result = await sessionBash(sessionId, { command, cwd, timeout: PR_FETCH_TIMEOUT });
        if (!result.success || result.exitCode !== 0) {
            throw new Error(
                (result.stdout ?? "").trim() || result.error || "Failed to add comment",
            );
        }
        return;
    }

    if (repoInfo.provider === "gitea") {
        if (!repoInfo.apiBase) throw new Error("Gitea API base URL not configured.");
        const url = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/issues/${prNumber}/comments`;
        const escapedBody = JSON.stringify(body);
        await giteaCurl(sessionId, url, repoInfo, {
            method: "POST",
            payload: `{"body":${escapedBody}}`,
        });
        return;
    }

    throw new Error(`Unsupported provider: ${repoInfo.provider}`);
}
