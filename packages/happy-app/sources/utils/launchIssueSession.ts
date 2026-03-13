/**
 * Launch a new worktree session to process a GitHub/Gitea issue.
 *
 * Orchestrates: link reservation → worktree creation → session spawn →
 * permission/model setup → initial prompt.
 *
 * The link is created FIRST ("processing") so that even if later steps fail,
 * the issue is marked and won't be re-triggered by auto-issue service.
 *
 * Independent of UI components — can be called from automation.
 */

import { createWorktree } from "@/utils/createWorktree";
import { machineSpawnNewSession } from "@/sync/ops";
import { storage } from "@/sync/storage";
import { sync } from "@/sync/sync";
import { issueSessionStore } from "@/sync/issueSessionStore";
import { buildIssueKey } from "@/sync/issueSessionTypes";
import { issueStore } from "@/sync/issueStore";
import {
  fetchIssueCommentsViaMachine,
  type IssueComment,
} from "@/sync/issueFetch";
import { log } from "@/log";
import type { AggregatedIssue, RepoInfo } from "@/sync/issueTypes";

export interface LaunchIssueSessionParams {
  readonly issue: AggregatedIssue;
  readonly machineId: string;
  readonly repoPath: string;
}

export interface LaunchIssueSessionResult {
  readonly success: boolean;
  readonly newSessionId?: string;
  readonly error?: string;
}

/**
 * Build the initial prompt sent to Claude for processing the issue.
 * Includes rich metadata, comments, and clear task instructions.
 */
const MAX_COMMENT_BODY_LENGTH = 2000;
const MAX_TOTAL_COMMENTS_LENGTH = 15000;

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
  // HTML: <img ... src="url" ... />
  const htmlImgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = htmlImgRegex.exec(text)) !== null) {
    if (match[1]) urls.push(match[1]);
  }
  // Markdown: ![alt](url)
  const mdImgRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
  while ((match = mdImgRegex.exec(text)) !== null) {
    if (match[1]) urls.push(match[1]);
  }
  // Dedupe while preserving order
  return [...new Set(urls)];
}

function buildCommentsSection(comments: readonly IssueComment[]): string {
  if (comments.length === 0) return "";

  const nonEmpty = comments.filter((c) => c.body.trim() !== "");
  if (nonEmpty.length === 0) return "";

  // Truncate individual comments and enforce total length budget.
  // Keep the newest comments (end of array) when budget is exceeded.
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

interface WorktreeInfo {
  readonly branchName: string;
  readonly parentBranch: string;
}

function buildPrCreateStep(
  issue: AggregatedIssue,
  worktree: WorktreeInfo,
  repoInfo: RepoInfo | undefined,
): string {
  if (repoInfo?.provider === "gitea") {
    const { owner, repo } = repoInfo;
    const apiBase =
      repoInfo.apiBase ?? `${new URL(repoInfo.remoteUrl).origin}/api/v1`;
    return [
      `8. Create a pull request using the Gitea API:`,
      `   curl -s -X POST "${apiBase}/repos/${owner}/${repo}/pulls" \\`,
      `     -H "Authorization: token $GITEA_TOKEN" \\`,
      `     -H "Content-Type: application/json" \\`,
      `     -d '{"title":"<type>: <short description>","body":"Fixes #${issue.number}","base":"${worktree.parentBranch}","head":"${worktree.branchName}"}'`,
    ].join("\n");
  }
  return `8. Create a pull request: gh pr create --base "${worktree.parentBranch}" --head "${worktree.branchName}" --fill`;
}

function buildIssuePrompt(
  issue: AggregatedIssue,
  comments: readonly IssueComment[],
  worktree: WorktreeInfo,
  repoInfo?: RepoInfo,
): string {
  const bodySection =
    issue.body.trim() !== "" ? issue.body : "(No description provided)";

  const labels =
    issue.labels.length > 0
      ? issue.labels.map((l) => l.name).join(", ")
      : "none";

  const sections: string[] = [
    `# Issue #${issue.number}: ${issue.title}`,
    "",
    "## Metadata",
    `- Repository: ${issue.repoLabel}`,
    `- Author: @${issue.author}`,
    `- Labels: ${labels}`,
    `- Created: ${formatDate(issue.createdAt)}`,
    ...(issue.url ? [`- URL: ${issue.url}`] : []),
    "",
    "## Description",
    bodySection,
  ];

  const commentsSection = buildCommentsSection(comments);
  if (commentsSection) {
    sections.push("", commentsSection);
  }

  // Extract image URLs from description and comments for explicit listing
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
    `6. Create a well-formatted commit referencing this issue (e.g. "fix: description - closes #${issue.number}")`,
    `7. Push your branch to the remote: git push -u origin ${worktree.branchName}`,
    buildPrCreateStep(issue, worktree, repoInfo),
    "9. After completing, provide a concise summary of what you changed and why",
  );

  return sections.join("\n");
}

export async function launchIssueSession(
  params: LaunchIssueSessionParams,
): Promise<LaunchIssueSessionResult> {
  const { issue, machineId, repoPath } = params;

  // 1. Check for existing link (any status — never re-generate)
  const issueKey = buildIssueKey(issue.projectKey, issue.number);
  const existingLink = issueSessionStore.getState().findByIssueKey(issueKey);
  if (existingLink) {
    return {
      success: false,
      error: `ALREADY_EXISTS:${existingLink.status}`,
      newSessionId: existingLink.sessionId,
    };
  }

  // 2. Reserve the link FIRST (status="processing", sessionId="pending")
  //    This prevents re-triggering even if later steps fail.
  try {
    await issueSessionStore.getState().createLink({
      issueNumber: issue.number,
      issueTitle: issue.title,
      projectKey: issue.projectKey,
      repoLabel: issue.repoLabel,
      sessionId: "pending",
      machineId,
      repoPath,
    });
  } catch (error) {
    log.log(
      `⚠️ launchIssueSession: createLink failed for #${issue.number}: ${error}`,
    );
    // If link creation fails (KV conflict), another device may have claimed it
    return {
      success: false,
      error: `LINK_CREATE_FAILED: ${error}`,
    };
  }

  // Helper: mark link as failed if something goes wrong after reservation
  const markFailed = async (errorMessage: string) => {
    try {
      await issueSessionStore
        .getState()
        .updateStatus(issueKey, "failed", { errorMessage });
    } catch {
      // Best-effort — don't throw on cleanup
    }
  };

  // 3. Create worktree
  const worktreeResult = await createWorktree(
    machineId,
    repoPath,
    issue.number,
  );
  if (!worktreeResult.success) {
    const error = worktreeResult.error ?? "Failed to create worktree";
    await markFailed(error);
    return { success: false, error };
  }

  // 4. Spawn new session in the worktree directory
  //    For Gitea: inject GITEA_TOKEN so Claude can create PRs via API
  const repoInfo = issueStore.getState().repoInfoByProject[issue.projectKey];
  const spawnEnv: Record<string, string> | undefined =
    repoInfo?.provider === "gitea" && repoInfo.apiToken
      ? { GITEA_TOKEN: repoInfo.apiToken }
      : undefined;
  const spawnResult = await machineSpawnNewSession({
    machineId,
    directory: worktreeResult.worktreePath,
    approvedNewDirectoryCreation: true,
    agent: "claude",
    environmentVariables: spawnEnv,
  });

  if (spawnResult.type !== "success") {
    const errorMessage =
      spawnResult.type === "error"
        ? spawnResult.errorMessage
        : "Failed to spawn session";
    await markFailed(errorMessage);
    return { success: false, error: errorMessage };
  }

  const newSessionId = spawnResult.sessionId;

  // 5. Update link with real sessionId
  try {
    await issueSessionStore.getState().updateStatus(issueKey, "processing", {
      sessionId: newSessionId,
    });
  } catch {
    // Non-critical — link exists with "pending" sessionId
    log.log(`⚠️ launchIssueSession: updateStatus failed for #${issue.number}`);
  }

  // 6. Refresh sessions so the new one appears in the store
  await sync.refreshSessions();

  // 7. Set permission mode (YOLO) and model (opus)
  storage
    .getState()
    .updateSessionPermissionMode(newSessionId, "bypassPermissions");
  storage.getState().updateSessionModelMode(newSessionId, "opus");

  // 8. Fetch issue comments (non-critical — proceed without on failure)
  let comments: readonly IssueComment[] = [];
  if (repoInfo && repoInfo.provider !== "unknown") {
    try {
      comments = await fetchIssueCommentsViaMachine(
        machineId,
        repoInfo,
        issue.number,
        repoPath,
      );
    } catch {
      log.log(
        `⚠️ launchIssueSession: failed to fetch comments for #${issue.number}`,
      );
    }
  }

  // 9. Send initial prompt with issue content + comments + task instructions
  const prompt = buildIssuePrompt(
    issue,
    comments,
    {
      branchName: worktreeResult.branchName,
      parentBranch: worktreeResult.parentBranch,
    },
    repoInfo,
  );
  await sync.sendMessage(newSessionId, prompt);

  return { success: true, newSessionId };
}
