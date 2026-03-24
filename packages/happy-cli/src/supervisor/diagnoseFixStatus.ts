/**
 * Diagnose and auto-report fix status when a fix session exits
 * without properly updating the server.
 *
 * Called from onChildExited in the daemon after a brief delay
 * to allow in-flight curl reports to reach the server first.
 */

import { execFile } from "child_process";
import { logger } from "@/ui/logger";
import type { SupervisorFixStatusData } from "@/api/apiMachine";

interface DiagnoseOptions {
  readonly sessionId: string;
  readonly repoPath: string;
  readonly branchName: string;
  readonly parentBranch: string;
  readonly actionId: string;
  readonly projectId: string;
  readonly fixMode?: "fix" | "analyze-first";
  readonly emitFixStatus: (data: SupervisorFixStatusData) => void;
}

/**
 * Run a git command in the given directory with a timeout.
 */
function git(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", [...args], { cwd, timeout: 10_000 }, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Check whether a branch has been merged into the parent branch.
 * Returns true if all commits on branchName are reachable from parentBranch.
 */
async function isBranchMerged(
  repoPath: string,
  branchName: string,
  parentBranch: string,
): Promise<boolean> {
  try {
    // Fetch latest remote state first
    await git(["fetch", "origin", parentBranch], repoPath);
  } catch {
    // best-effort — may be offline
  }

  try {
    // If there are no commits on branchName that aren't on parentBranch, it's merged
    const output = await git(
      ["log", `origin/${parentBranch}..${branchName}`, "--oneline"],
      repoPath,
    );
    return output === "";
  } catch {
    // Branch doesn't exist locally — check remote
    try {
      const output = await git(
        ["log", `origin/${parentBranch}..origin/${branchName}`, "--oneline"],
        repoPath,
      );
      return output === "";
    } catch {
      // Neither local nor remote branch exists — treat as not merged
      return false;
    }
  }
}

/**
 * Count commits on the fix branch that aren't on the parent branch.
 */
async function countBranchCommits(
  repoPath: string,
  branchName: string,
  parentBranch: string,
): Promise<number> {
  try {
    const output = await git(
      ["rev-list", "--count", `origin/${parentBranch}..${branchName}`],
      repoPath,
    );
    return parseInt(output, 10) || 0;
  } catch {
    try {
      const output = await git(
        ["rev-list", "--count", `origin/${parentBranch}..origin/${branchName}`],
        repoPath,
      );
      return parseInt(output, 10) || 0;
    } catch {
      return 0;
    }
  }
}

/**
 * Diagnose the state of a fix session and report the appropriate status
 * if it hasn't already been reported.
 */
export async function diagnoseAndReportFixStatus(
  opts: DiagnoseOptions,
): Promise<void> {
  const { sessionId, repoPath, branchName, parentBranch, actionId, projectId, emitFixStatus } = opts;

  logger.debug(
    `[FIX-DIAGNOSE] Diagnosing fix session ${sessionId} (action ${actionId}, branch ${branchName})`,
  );

  // Check if the branch was merged (changes applied successfully)
  const merged = await isBranchMerged(repoPath, branchName, parentBranch);

  if (merged) {
    logger.info(
      `[FIX-DIAGNOSE] Fix branch ${branchName} is merged into ${parentBranch} — reporting completed`,
    );
    emitFixStatus({
      actionId,
      projectId,
      fixStatus: "completed",
      fixSessionId: sessionId,
    });
    return;
  }

  // Not merged — check if there were any commits at all
  const commitCount = await countBranchCommits(repoPath, branchName, parentBranch);

  // For analyze-first sessions: no merge is expected (analysis is read-only).
  // Report "analyzed" unless there are commits (which means auto-fix was attempted but failed).
  if (opts.fixMode === "analyze-first" && commitCount === 0) {
    logger.info(
      `[FIX-DIAGNOSE] Analyze-first session ${sessionId} completed with no commits — reporting analyzed`,
    );
    emitFixStatus({
      actionId,
      projectId,
      fixStatus: "analyzed",
      fixSessionId: sessionId,
    });
    return;
  }

  if (commitCount > 0) {
    logger.info(
      `[FIX-DIAGNOSE] Fix branch ${branchName} has ${commitCount} commit(s) but not merged — reporting failed`,
    );
  } else {
    logger.info(
      `[FIX-DIAGNOSE] Fix branch ${branchName} has no commits — reporting failed`,
    );
  }

  emitFixStatus({
    actionId,
    projectId,
    fixStatus: "failed",
    fixSessionId: sessionId,
  });
}
