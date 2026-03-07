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
import { log } from "@/log";
import type { AggregatedIssue } from "@/sync/issueTypes";

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
 */
function buildIssuePrompt(issue: AggregatedIssue): string {
  const bodySection =
    issue.body.trim() !== "" ? issue.body : "(No description provided)";

  return [
    `You are working on Issue #${issue.number}: ${issue.title}`,
    `Repository: ${issue.repoLabel}`,
    "",
    "Issue content:",
    bodySection,
    "",
    "Please analyze this issue and implement the required changes. Commit your changes when done.",
  ].join("\n");
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
  const worktreeResult = await createWorktree(machineId, repoPath);
  if (!worktreeResult.success) {
    const error = worktreeResult.error ?? "Failed to create worktree";
    await markFailed(error);
    return { success: false, error };
  }

  // 4. Spawn new session in the worktree directory
  const spawnResult = await machineSpawnNewSession({
    machineId,
    directory: worktreeResult.worktreePath,
    approvedNewDirectoryCreation: true,
    agent: "claude",
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
    await issueSessionStore
      .getState()
      .updateStatus(issueKey, "processing", { sessionId: newSessionId });
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

  // 8. Send initial prompt with issue content
  const prompt = buildIssuePrompt(issue);
  await sync.sendMessage(newSessionId, prompt);

  return { success: true, newSessionId };
}
