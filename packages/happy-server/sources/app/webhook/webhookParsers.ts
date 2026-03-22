import { z } from "zod";

/**
 * Parsed issue data from a webhook payload.
 * Normalized across GitHub, Gitea, and GitLab.
 */
export interface ParsedWebhookIssue {
  readonly issueNumber: number;
  readonly issueTitle: string;
  readonly issueBody: string;
  readonly issueAuthor: string;
  readonly issueLabels: string[];
  readonly issueUrl: string;
  readonly repoUrl: string;
  readonly action: string;
}

/**
 * Actions we care about for auto-issue triggering.
 * "opened" — new issue created with matching labels.
 * "labeled" — label added to existing issue.
 */
const TRIGGER_ACTIONS = new Set(["opened", "labeled"]);

// ── Zod schemas for webhook payloads ─────────────────────

const zLabel = z.object({ name: z.string().optional() }).passthrough();
const zGitLabLabel = z.object({ title: z.string().optional() }).passthrough();

const zGitHubIssueBody = z.object({
  action: z.string(),
  issue: z.object({
    state: z.string(),
    number: z.number(),
    title: z.string().nullish(),
    body: z.string().nullish(),
    user: z.object({ login: z.string().optional() }).passthrough().optional(),
    labels: z.array(zLabel).optional(),
    html_url: z.string().optional(),
  }).passthrough(),
  repository: z.object({ html_url: z.string().optional() }).passthrough().optional(),
}).passthrough();

const zGiteaIssueBody = zGitHubIssueBody.extend({
  label: z.object({ name: z.string().optional() }).passthrough().optional(),
});

const zGitLabIssueBody = z.object({
  object_attributes: z.object({
    action: z.string(),
    state: z.string(),
    iid: z.number(),
    title: z.string().nullish(),
    description: z.string().nullish(),
    url: z.string().optional(),
  }).passthrough(),
  user: z.object({ username: z.string().optional() }).passthrough().optional(),
  labels: z.array(zGitLabLabel).optional(),
  changes: z.object({ labels: z.unknown() }).passthrough().optional(),
  project: z.object({ web_url: z.string().optional() }).passthrough().optional(),
}).passthrough();

const zGitHubOrGiteaPRBody = z.object({
  action: z.string(),
  pull_request: z.object({
    number: z.number().optional(),
    title: z.string().nullish(),
    html_url: z.string().optional(),
    merged: z.boolean().optional(),
    merged_by: z.object({ login: z.string().optional() }).passthrough().nullish(),
    head: z.object({ ref: z.string().optional() }).passthrough().optional(),
    body: z.string().nullish(),
  }).passthrough(),
  sender: z.object({ login: z.string().optional() }).passthrough().optional(),
  repository: z.object({ html_url: z.string().optional() }).passthrough().optional(),
}).passthrough();

const zGitLabMRBody = z.object({
  object_attributes: z.object({
    state: z.string(),
    action: z.string(),
    iid: z.number().optional(),
    title: z.string().nullish(),
    url: z.string().optional(),
    description: z.string().nullish(),
    source_branch: z.string().optional(),
  }).passthrough(),
  user: z.object({ username: z.string().optional() }).passthrough().optional(),
  project: z.object({ web_url: z.string().optional() }).passthrough().optional(),
}).passthrough();

const zCommit = z.object({
  added: z.array(z.string()).optional(),
  modified: z.array(z.string()).optional(),
  removed: z.array(z.string()).optional(),
}).passthrough();

const zGitHubOrGiteaPushBody = z.object({
  ref: z.string().optional(),
  commits: z.array(zCommit).optional(),
  pusher: z.object({
    name: z.string().optional(),
    login: z.string().optional(),
  }).passthrough().optional(),
  sender: z.object({ login: z.string().optional() }).passthrough().optional(),
  repository: z.object({ html_url: z.string().optional() }).passthrough().optional(),
}).passthrough();

const zGitLabPushBody = z.object({
  ref: z.string().optional(),
  commits: z.array(zCommit).optional(),
  user_username: z.string().optional(),
  user_name: z.string().optional(),
  project: z.object({ web_url: z.string().optional() }).passthrough().optional(),
}).passthrough();

// ── GitHub ──────────────────────────────────────────────

/**
 * Parse a GitHub issue webhook payload.
 * Event type header: x-github-event = "issues"
 */
export function parseGitHubIssueWebhook(
  body: unknown,
  eventType: string,
): ParsedWebhookIssue | null {
  if (eventType !== "issues") return null;

  const parsed = zGitHubIssueBody.safeParse(body);
  if (!parsed.success) return null;
  const data = parsed.data;

  const action = data.action;
  if (!TRIGGER_ACTIONS.has(action)) return null;

  const issue = data.issue;
  if (issue.state !== "open") return null;

  return {
    issueNumber: issue.number,
    issueTitle: issue.title ?? "",
    issueBody: issue.body ?? "",
    issueAuthor: issue.user?.login ?? "",
    issueLabels: (issue.labels ?? []).map(
      (l) => l.name?.toLowerCase() ?? "",
    ),
    issueUrl: issue.html_url ?? "",
    repoUrl: data.repository?.html_url ?? "",
    action,
  };
}

// ── Gitea ───────────────────────────────────────────────

/**
 * Parse a Gitea issue webhook payload.
 * Event type headers:
 *   x-gitea-event = "issues" — new issue / issue actions
 *   x-gitea-event = "issue_label" — label added/removed
 * Gitea uses "label_updated" for label changes.
 */
export function parseGiteaIssueWebhook(
  body: unknown,
  eventType: string,
): ParsedWebhookIssue | null {
  if (eventType !== "issues" && eventType !== "issue_label") return null;

  const parsed = zGiteaIssueBody.safeParse(body);
  if (!parsed.success) return null;
  const data = parsed.data;

  const action = data.action;
  // Gitea uses "label_updated" instead of "labeled"
  const normalizedAction = action === "label_updated" ? "labeled" : action;
  if (!TRIGGER_ACTIONS.has(normalizedAction)) return null;

  const issue = data.issue;
  if (issue.state !== "open") return null;

  // Gitea bug: body.issue.labels may be empty/stale on label_updated events.
  // Older Gitea versions don't include body.label either.
  // Strategy: merge body.label (if present) into issue.labels.
  // If labels are still empty, dispatch will fetch from API.
  const baseLabels: readonly string[] = (issue.labels ?? []).map(
    (l) => l.name?.toLowerCase() ?? "",
  );
  const issueLabels: readonly string[] =
    action === "label_updated" && data.label?.name
      ? baseLabels.includes(data.label.name.toLowerCase())
        ? baseLabels
        : [...baseLabels, data.label.name.toLowerCase()]
      : baseLabels;

  return {
    issueNumber: issue.number,
    issueTitle: issue.title ?? "",
    issueBody: issue.body ?? "",
    issueAuthor: issue.user?.login ?? "",
    issueLabels: [...issueLabels],
    issueUrl: issue.html_url ?? "",
    repoUrl: data.repository?.html_url ?? "",
    action: normalizedAction,
  };
}

// ── GitLab ──────────────────────────────────────────────

/**
 * Parse a GitLab issue webhook payload.
 * Event type header: x-gitlab-event = "Issue Hook"
 * GitLab structure differs significantly from GitHub/Gitea.
 */
export function parseGitLabIssueWebhook(
  body: unknown,
  eventType: string,
): ParsedWebhookIssue | null {
  if (eventType !== "Issue Hook") return null;

  const parsed = zGitLabIssueBody.safeParse(body);
  if (!parsed.success) return null;
  const data = parsed.data;

  const attrs = data.object_attributes;

  // GitLab uses "open" / "update" actions.
  // Only map "update" to "labeled" when labels actually changed
  // (otherwise title edits, assignee changes etc. would false-trigger).
  const action = attrs.action;
  const normalizedAction =
    action === "open"
      ? "opened"
      : action === "update" && data.changes?.labels
        ? "labeled"
        : null;
  if (!normalizedAction || !TRIGGER_ACTIONS.has(normalizedAction)) return null;

  if (attrs.state !== "opened") return null;

  return {
    issueNumber: attrs.iid,
    issueTitle: attrs.title ?? "",
    issueBody: attrs.description ?? "",
    issueAuthor: data.user?.username ?? "",
    issueLabels: (data.labels ?? []).map(
      (l) => l.title?.toLowerCase() ?? "",
    ),
    issueUrl: attrs.url ?? "",
    repoUrl: data.project?.web_url ?? "",
    action: normalizedAction,
  };
}

/**
 * Parse a webhook payload for any supported provider.
 */
export function parseWebhookIssue(
  provider: string,
  body: unknown,
  eventType: string,
): ParsedWebhookIssue | null {
  switch (provider) {
    case "github":
      return parseGitHubIssueWebhook(body, eventType);
    case "gitea":
      return parseGiteaIssueWebhook(body, eventType);
    case "gitlab":
      return parseGitLabIssueWebhook(body, eventType);
    default:
      return null;
  }
}

// ── PR Merge Parsing ───────────────────────────────────

/**
 * Parsed PR merge data from a webhook payload.
 * Used to auto-archive sessions when their associated PR is merged.
 */
export interface ParsedWebhookPRMerge {
  readonly prNumber: number;
  readonly prTitle: string;
  readonly prUrl: string;
  readonly mergedBy: string;
  readonly headBranch: string;
  readonly repoUrl: string;
  readonly linkedIssueNumbers: readonly number[];
}

/**
 * Extract issue numbers referenced in PR body or branch name.
 * Matches: Fixes #N, Closes #N, Resolves #N (case-insensitive).
 * Also extracts from branch names like issue-123, fix/456.
 */
function extractLinkedIssueNumbers(
  prBody: string,
  headBranch: string,
): readonly number[] {
  const numbers = new Set<number>();

  // Parse PR body for "Fixes #N", "Closes #N", "Resolves #N"
  const bodyPattern = /(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = bodyPattern.exec(prBody)) !== null) {
    numbers.add(Number(match[1]));
  }

  // Parse branch name for issue number patterns
  // e.g. issue-123, fix/123, feature/123-add-login, 123-feature-name
  const branchPatterns = [
    /issue[/-](\d+)/i,
    /fix[/-](\d+)/i,
    /feat[/-](\d+)/i,
    /feature[/-](\d+)/i,
    /bug[/-](\d+)/i,
    /hotfix[/-](\d+)/i,
    /chore[/-](\d+)/i,
    /^(\d+)[/-]/,
  ];
  for (const pattern of branchPatterns) {
    const branchMatch = headBranch.match(pattern);
    if (branchMatch) {
      numbers.add(Number(branchMatch[1]));
    }
  }

  return [...numbers];
}

/**
 * Parse a GitHub/Gitea pull_request merge webhook payload.
 * Event: x-github-event / x-gitea-event = "pull_request", action = "closed", merged = true
 * GitHub and Gitea share identical PR merge payload structure.
 */
function parseGitHubOrGiteaPRMerge(
  body: unknown,
  eventType: string,
): ParsedWebhookPRMerge | null {
  if (eventType !== "pull_request") return null;

  const parsed = zGitHubOrGiteaPRBody.safeParse(body);
  if (!parsed.success) return null;
  const data = parsed.data;

  if (data.action !== "closed") return null;

  const pr = data.pull_request;
  if (!pr.merged) return null;

  const prBody = pr.body ?? "";
  const headBranch = pr.head?.ref ?? "";

  return {
    prNumber: pr.number ?? 0,
    prTitle: pr.title ?? "",
    prUrl: pr.html_url ?? "",
    mergedBy: pr.merged_by?.login ?? data.sender?.login ?? "",
    headBranch,
    repoUrl: data.repository?.html_url ?? "",
    linkedIssueNumbers: extractLinkedIssueNumbers(prBody, headBranch),
  };
}

/**
 * Parse a GitLab merge request merge webhook payload.
 * Event: x-gitlab-event = "Merge Request Hook", state = "merged"
 */
function parseGitLabPRMerge(
  body: unknown,
  eventType: string,
): ParsedWebhookPRMerge | null {
  if (eventType !== "Merge Request Hook") return null;

  const parsed = zGitLabMRBody.safeParse(body);
  if (!parsed.success) return null;
  const data = parsed.data;

  const attrs = data.object_attributes;
  if (attrs.state !== "merged" || attrs.action !== "merge") return null;

  const prBody = attrs.description ?? "";
  const headBranch = attrs.source_branch ?? "";

  return {
    prNumber: attrs.iid ?? 0,
    prTitle: attrs.title ?? "",
    prUrl: attrs.url ?? "",
    mergedBy: data.user?.username ?? "",
    headBranch,
    repoUrl: data.project?.web_url ?? "",
    linkedIssueNumbers: extractLinkedIssueNumbers(prBody, headBranch),
  };
}

/**
 * Parse a webhook payload for a PR merge event across all providers.
 */
export function parseWebhookPRMerge(
  provider: string,
  body: unknown,
  eventType: string,
): ParsedWebhookPRMerge | null {
  switch (provider) {
    case "github":
    case "gitea":
      return parseGitHubOrGiteaPRMerge(body, eventType);
    case "gitlab":
      return parseGitLabPRMerge(body, eventType);
    default:
      return null;
  }
}

/**
 * Extract the event type header for a given provider.
 */
export function getEventTypeHeader(
  provider: string,
  headers: Record<string, string | undefined>,
): string {
  switch (provider) {
    case "github":
      return headers["x-github-event"] ?? "";
    case "gitea":
      return headers["x-gitea-event"] ?? "";
    case "gitlab":
      return headers["x-gitlab-event"] ?? "";
    default:
      return "";
  }
}

/**
 * Extract the delivery ID header for a given provider.
 */
export function getDeliveryId(
  provider: string,
  headers: Record<string, string | undefined>,
): string {
  switch (provider) {
    case "github":
      return headers["x-github-delivery"] ?? "";
    case "gitea":
      return headers["x-gitea-delivery"] ?? "";
    case "gitlab":
      // GitLab uses x-gitlab-event-uuid
      return headers["x-gitlab-event-uuid"] ?? "";
    default:
      return "";
  }
}

// ── Push Event Parsing (for supervisor incremental scan) ──

export interface ParsedWebhookPush {
  readonly ref: string;
  readonly branch: string;
  readonly repoUrl: string;
  readonly changedFiles: string[];
  readonly pusher: string;
}

/**
 * Parse a push event from any provider to extract changed files.
 */
export function parseWebhookPush(
  provider: string,
  body: unknown,
  eventType: string,
): ParsedWebhookPush | null {
  switch (provider) {
    case "github":
      return parseGitHubOrGiteaPush(body, eventType, "github");
    case "gitea":
      return parseGitHubOrGiteaPush(body, eventType, "gitea");
    case "gitlab":
      return parseGitLabPush(body, eventType);
    default:
      return null;
  }
}

/**
 * Parse a GitHub/Gitea push webhook payload.
 * GitHub uses pusher.name, Gitea uses pusher.login as the primary pusher field.
 */
function parseGitHubOrGiteaPush(
  body: unknown,
  eventType: string,
  provider: "github" | "gitea",
): ParsedWebhookPush | null {
  if (eventType !== "push") return null;

  const parsed = zGitHubOrGiteaPushBody.safeParse(body);
  if (!parsed.success) return null;
  const data = parsed.data;

  const ref = data.ref ?? "";
  if (!ref.startsWith("refs/heads/")) return null;

  const changedFiles = extractChangedFilesFromCommits(data.commits);
  if (changedFiles.length === 0) return null;

  const pusher =
    provider === "github"
      ? (data.pusher?.name ?? data.sender?.login ?? "")
      : (data.pusher?.login ?? data.sender?.login ?? "");

  return {
    ref,
    branch: ref.replace("refs/heads/", ""),
    repoUrl: data.repository?.html_url ?? "",
    changedFiles,
    pusher,
  };
}

function parseGitLabPush(
  body: unknown,
  eventType: string,
): ParsedWebhookPush | null {
  if (eventType !== "Push Hook") return null;

  const parsed = zGitLabPushBody.safeParse(body);
  if (!parsed.success) return null;
  const data = parsed.data;

  const ref = data.ref ?? "";
  if (!ref.startsWith("refs/heads/")) return null;

  const changedFiles = extractChangedFilesFromCommits(data.commits);
  if (changedFiles.length === 0) return null;

  return {
    ref,
    branch: ref.replace("refs/heads/", ""),
    repoUrl: data.project?.web_url ?? "",
    changedFiles,
    pusher: data.user_username ?? data.user_name ?? "",
  };
}

/**
 * Collect unique changed file paths from commit payloads.
 * GitHub/Gitea/GitLab all use added/removed/modified arrays.
 */
function extractChangedFilesFromCommits(
  commits: z.infer<typeof zCommit>[] | undefined,
): string[] {
  if (!Array.isArray(commits)) return [];

  const files = new Set<string>();
  for (const commit of commits) {
    for (const f of commit.added ?? []) files.add(f);
    for (const f of commit.modified ?? []) files.add(f);
    for (const f of commit.removed ?? []) files.add(f);
  }
  return Array.from(files);
}
