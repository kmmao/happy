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

// ── GitHub ──────────────────────────────────────────────

/**
 * Parse a GitHub issue webhook payload.
 * Event type header: x-github-event = "issues"
 */
export function parseGitHubIssueWebhook(
  body: any,
  eventType: string,
): ParsedWebhookIssue | null {
  if (eventType !== "issues") return null;

  const action = body?.action;
  if (!action || !TRIGGER_ACTIONS.has(action)) return null;

  const issue = body?.issue;
  if (!issue || issue.state !== "open") return null;

  return {
    issueNumber: issue.number,
    issueTitle: issue.title ?? "",
    issueBody: issue.body ?? "",
    issueAuthor: issue.user?.login ?? "",
    issueLabels: (issue.labels ?? []).map(
      (l: any) => l.name?.toLowerCase() ?? "",
    ),
    issueUrl: issue.html_url ?? "",
    repoUrl: body.repository?.html_url ?? "",
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
  body: any,
  eventType: string,
): ParsedWebhookIssue | null {
  if (eventType !== "issues" && eventType !== "issue_label") return null;

  const action = body?.action;
  // Gitea uses "label_updated" instead of "labeled"
  const normalizedAction = action === "label_updated" ? "labeled" : action;
  if (!normalizedAction || !TRIGGER_ACTIONS.has(normalizedAction)) return null;

  const issue = body?.issue;
  if (!issue || issue.state !== "open") return null;

  // Gitea bug: body.issue.labels may be empty/stale on label_updated events.
  // Older Gitea versions don't include body.label either.
  // Strategy: merge body.label (if present) into issue.labels.
  // If labels are still empty, dispatch will fetch from API.
  const issueLabels: string[] = (issue.labels ?? []).map(
    (l: any) => l.name?.toLowerCase() ?? "",
  );
  if (action === "label_updated" && body.label?.name) {
    const triggerLabel = body.label.name.toLowerCase();
    if (!issueLabels.includes(triggerLabel)) {
      issueLabels.push(triggerLabel);
    }
  }

  return {
    issueNumber: issue.number,
    issueTitle: issue.title ?? "",
    issueBody: issue.body ?? "",
    issueAuthor: issue.user?.login ?? "",
    issueLabels,
    issueUrl: issue.html_url ?? "",
    repoUrl: body.repository?.html_url ?? "",
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
  body: any,
  eventType: string,
): ParsedWebhookIssue | null {
  if (eventType !== "Issue Hook") return null;

  const attrs = body?.object_attributes;
  if (!attrs) return null;

  // GitLab uses "open" / "update" actions
  const action = attrs.action;
  // Map GitLab actions to our normalized set
  const normalizedAction =
    action === "open"
      ? "opened"
      : action === "update"
        ? "labeled" // label changes come as "update"
        : null;
  if (!normalizedAction || !TRIGGER_ACTIONS.has(normalizedAction)) return null;

  if (attrs.state !== "opened") return null;

  return {
    issueNumber: attrs.iid,
    issueTitle: attrs.title ?? "",
    issueBody: attrs.description ?? "",
    issueAuthor: body.user?.username ?? "",
    issueLabels: (body.labels ?? []).map(
      (l: any) => l.title?.toLowerCase() ?? "",
    ),
    issueUrl: attrs.url ?? "",
    repoUrl: body.project?.web_url ?? "",
    action: normalizedAction,
  };
}

/**
 * Parse a webhook payload for any supported provider.
 */
export function parseWebhookIssue(
  provider: string,
  body: any,
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
