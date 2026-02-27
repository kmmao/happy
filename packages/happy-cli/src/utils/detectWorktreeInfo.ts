/**
 * Detect if the current working directory is inside a Happy-managed git worktree.
 * Uses git commands to determine worktree status and extract relevant info.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { resolve, basename } from "path";

const execAsync = promisify(exec);

export interface WorktreeDetectResult {
  readonly isWorktree: boolean;
  readonly name: string;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly parentRepoPath: string;
  readonly parentBranch: string;
}

async function gitCommand(
  command: string,
  cwd: string,
): Promise<string | null> {
  try {
    const { stdout } = await execAsync(command, { cwd, timeout: 10000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Detect if `cwd` is inside a Happy-managed git worktree (.dev/worktree/).
 * Returns worktree info if detected, null otherwise.
 */
export async function detectWorktreeInfo(
  cwd: string,
): Promise<WorktreeDetectResult | null> {
  // Check if this is a git worktree by comparing git-dir and git-common-dir
  const [gitDir, gitCommonDir] = await Promise.all([
    gitCommand("git rev-parse --git-dir", cwd),
    gitCommand("git rev-parse --git-common-dir", cwd),
  ]);

  if (!gitDir || !gitCommonDir) {
    return null;
  }

  // In a worktree, git-dir points to .git/worktrees/<name>
  // In the main repo, git-dir equals git-common-dir (both are .git)
  const resolvedGitDir = resolve(cwd, gitDir);
  const resolvedCommonDir = resolve(cwd, gitCommonDir);

  if (resolvedGitDir === resolvedCommonDir) {
    // Not a worktree — this is the main repo
    return null;
  }

  // Get the worktree root path
  const worktreePath = await gitCommand("git rev-parse --show-toplevel", cwd);
  if (!worktreePath) {
    return null;
  }

  // Check if this is a Happy-managed worktree (path contains .dev/worktree/)
  if (!worktreePath.includes(".dev/worktree/")) {
    return null;
  }

  // Extract worktree name from path (last segment of .dev/worktree/{name})
  const name = basename(worktreePath);

  // Get current branch (this is the worktree branch)
  const branchName =
    (await gitCommand("git rev-parse --abbrev-ref HEAD", cwd)) || name;

  // Derive parent repo path: strip .dev/worktree/{name} from worktree path
  const devWorktreeIndex = worktreePath.indexOf(".dev/worktree/");
  const parentRepoPath =
    devWorktreeIndex > 0
      ? worktreePath.substring(0, devWorktreeIndex - 1)
      : resolve(resolvedCommonDir, "..");

  // Get the parent branch: check the default branch of the parent repo
  const parentBranch =
    (await gitCommand(
      "git rev-parse --abbrev-ref HEAD",
      parentRepoPath,
    )) || "main";

  return {
    isWorktree: true,
    name,
    branchName,
    worktreePath,
    parentRepoPath,
    parentBranch,
  };
}
