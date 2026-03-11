/**
 * Build the initial prompt sent to Claude for processing a webhook-triggered issue.
 * Ported from happy-app's launchIssueSession.ts — pure functions, no App dependencies.
 */

// Last webhook flow verified: 2026-03-12

import type { IssueComment } from "./fetchIssueComments";

const MAX_COMMENT_BODY_LENGTH = 2000;
const MAX_TOTAL_COMMENTS_LENGTH = 15000;
const MAX_ISSUE_BODY_LENGTH = 30000;

function formatDate(timestamp: number): string {
  if (timestamp === 0) return "unknown";
  return new Date(timestamp).toISOString().split("T")[0];
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "…";
}

/**
 * Extract image URLs from text containing HTML <img> tags or markdown ![](url) syntax.
 */
function extractImageUrls(text: string): readonly string[] {
  const urls: string[] = [];
  const htmlImgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = htmlImgRegex.exec(text)) !== null) {
    if (match[1]) urls.push(match[1]);
  }
  const mdImgRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
  while ((match = mdImgRegex.exec(text)) !== null) {
    if (match[1]) urls.push(match[1]);
  }
  return [...new Set(urls)];
}

function buildCommentsSection(comments: readonly IssueComment[]): string {
  if (comments.length === 0) return "";

  const nonEmpty = comments.filter((c) => c.body.trim() !== "");
  if (nonEmpty.length === 0) return "";

  const formatted: readonly string[] = nonEmpty.map(
    (c) =>
      `**@${c.author}** (${formatDate(c.createdAt)}):\n> ${truncate(c.body.trim(), MAX_COMMENT_BODY_LENGTH)}`,
  );

  let totalLength = 0;
  let startIndex = 0;
  for (let i = formatted.length - 1; i >= 0; i--) {
    totalLength += formatted[i].length;
    if (totalLength > MAX_TOTAL_COMMENTS_LENGTH) {
      startIndex = i + 1;
      break;
    }
  }

  const kept = formatted.slice(startIndex);
  const skipped = formatted.length - kept.length;
  const header =
    skipped > 0
      ? `## Comments (showing ${kept.length} of ${nonEmpty.length}, ${skipped} older comments omitted)`
      : `## Comments (${kept.length})`;

  return [header, "", ...kept].join("\n\n");
}

export interface WebhookIssueData {
  readonly issueNumber: number;
  readonly issueTitle: string;
  readonly issueBody: string;
  readonly issueAuthor: string;
  readonly issueLabels: string[];
  readonly issueUrl: string;
  readonly repoUrl: string;
}

export interface WorktreeInfo {
  readonly branchName: string;
  readonly parentBranch: string;
}

export function buildIssuePrompt(
  issue: WebhookIssueData,
  comments: readonly IssueComment[],
  worktree: WorktreeInfo,
): string {
  const rawBody = issue.issueBody.trim();
  const bodySection =
    rawBody !== ""
      ? truncate(rawBody, MAX_ISSUE_BODY_LENGTH)
      : "(No description provided)";

  const labels =
    issue.issueLabels.length > 0 ? issue.issueLabels.join(", ") : "none";

  const sections: string[] = [
    `# Issue #${issue.issueNumber}: ${issue.issueTitle}`,
    "",
    "## Metadata",
    `- Repository: ${issue.repoUrl}`,
    `- Author: @${issue.issueAuthor}`,
    `- Labels: ${labels}`,
    ...(issue.issueUrl ? [`- URL: ${issue.issueUrl}`] : []),
    "",
    "## Description",
    bodySection,
  ];

  const commentsSection = buildCommentsSection(comments);
  if (commentsSection) {
    sections.push("", commentsSection);
  }

  const allText = [bodySection, ...comments.map((c) => c.body)].join("\n");
  const imageUrls = extractImageUrls(allText);
  if (imageUrls.length > 0) {
    sections.push(
      "",
      "## Referenced Images",
      "The following images are referenced in this issue. Use WebFetch to view each one for visual context:",
      ...imageUrls.map((url, i) => `${i + 1}. ${url}`),
    );
  }

  sections.push(
    "",
    "## Worktree",
    `- Branch: ${worktree.branchName}`,
    `- Parent branch: ${worktree.parentBranch}`,
  );

  sections.push(
    "",
    "## Your Task",
    "You are an autonomous coding agent working on this issue in an isolated git worktree branch.",
    "",
    "1. Read CLAUDE.md and any project configuration files to understand repo conventions",
    "2. Analyze this issue thoroughly — understand the root cause and full scope",
    "3. If the issue or comments contain image URLs (e.g. screenshots, mockups), use WebFetch to view them for visual context",
    "4. Implement the required changes following the project's coding standards",
    "5. Run existing tests to make sure nothing is broken",
    `6. Create a well-formatted commit referencing this issue (e.g. "fix: description - closes #${issue.issueNumber}")`,
    `7. Sync with the latest base branch to avoid merge conflicts: git fetch origin ${worktree.parentBranch} && git rebase origin/${worktree.parentBranch} (resolve any conflicts if they arise)`,
    `8. Push your branch to the remote: git push -u origin ${worktree.branchName}`,
    `9. Create a pull request: gh pr create --base "${worktree.parentBranch}" --head "${worktree.branchName}" --title "<type>: <short description>" --body "Fixes #${issue.issueNumber}"`,
    "10. After completing, provide a concise summary of what you changed and why",
  );

  return sections.join("\n");
}
