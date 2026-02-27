/**
 * Worktree cleanup logic for session end.
 * Attempts to clean up a Happy-managed worktree after its session ends.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "@/ui/logger";

const execAsync = promisify(exec);

export interface WorktreeCleanupResult {
  readonly action:
    | "cleaned"
    | "skipped-unmerged"
    | "skipped-no-worktree"
    | "skipped-already-cleaned"
    | "error";
  readonly message: string;
}

export interface WorktreeCleanupInput {
  readonly name: string;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly parentRepoPath: string;
  readonly parentBranch: string;
  readonly state: string;
}

/**
 * Attempt to cleanup a worktree after session ends.
 * Only cleans up if the worktree branch has been merged into the parent branch.
 * If not merged, leaves the worktree in place.
 */
export async function cleanupWorktreeOnSessionEnd(
  worktreeInfo: WorktreeCleanupInput,
): Promise<WorktreeCleanupResult> {
  if (
    worktreeInfo.state === "cleaned" ||
    worktreeInfo.state === "cleaning"
  ) {
    return {
      action: "skipped-already-cleaned",
      message: "Worktree already cleaned or cleaning",
    };
  }

  // Prune stale worktrees first
  try {
    await execAsync("git worktree prune", {
      cwd: worktreeInfo.parentRepoPath,
      timeout: 10000,
    });
  } catch {
    // Non-critical
  }

  // Check if the branch has been merged into the parent
  const isMerged = await checkBranchMerged(
    worktreeInfo.parentRepoPath,
    worktreeInfo.branchName,
    worktreeInfo.parentBranch,
  );

  if (worktreeInfo.state === "merged" || isMerged) {
    return await performCleanup(worktreeInfo);
  }

  logger.debug(
    `[WORKTREE CLEANUP] Branch '${worktreeInfo.branchName}' not merged into '${worktreeInfo.parentBranch}', skipping cleanup`,
  );

  return {
    action: "skipped-unmerged",
    message: `Branch '${worktreeInfo.branchName}' has not been merged into '${worktreeInfo.parentBranch}'. Worktree left in place.`,
  };
}

async function checkBranchMerged(
  repoPath: string,
  branchName: string,
  parentBranch: string,
): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      `git branch --merged "${parentBranch}"`,
      { cwd: repoPath, timeout: 10000 },
    );
    // Each line is a branch name (possibly with leading * or spaces)
    const mergedBranches = stdout
      .split("\n")
      .map((line) => line.replace(/^\*?\s+/, "").trim())
      .filter(Boolean);
    return mergedBranches.includes(branchName);
  } catch {
    return false;
  }
}

async function performCleanup(
  worktreeInfo: WorktreeCleanupInput,
): Promise<WorktreeCleanupResult> {
  const { parentRepoPath, name, branchName } = worktreeInfo;
  const worktreeRelPath = `.dev/worktree/${name}`;

  // Remove the worktree directory
  try {
    await execAsync(`git worktree remove "${worktreeRelPath}" --force`, {
      cwd: parentRepoPath,
      timeout: 30000,
    });
    logger.debug(`[WORKTREE CLEANUP] Removed worktree: ${worktreeRelPath}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // If worktree doesn't exist, that's fine
    if (!msg.includes("is not a working tree")) {
      return {
        action: "error",
        message: `Failed to remove worktree: ${msg}`,
      };
    }
    logger.debug(
      `[WORKTREE CLEANUP] Worktree directory already gone: ${worktreeRelPath}`,
    );
  }

  // Delete the branch (safe delete)
  try {
    await execAsync(`git branch -d "${branchName}"`, {
      cwd: parentRepoPath,
      timeout: 10000,
    });
    logger.debug(`[WORKTREE CLEANUP] Deleted branch: ${branchName}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("not fully merged")) {
      logger.debug(
        `[WORKTREE CLEANUP] Branch '${branchName}' not fully merged, keeping it`,
      );
    } else {
      // Branch might already be deleted
      logger.debug(
        `[WORKTREE CLEANUP] Could not delete branch '${branchName}': ${msg}`,
      );
    }
  }

  return {
    action: "cleaned",
    message: `Worktree '${name}' and branch '${branchName}' removed`,
  };
}
