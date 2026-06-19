/**
 * Create a Git worktree locally (no RPC, uses child_process).
 * Ported from happy-app's createWorktree.ts for CLI-side webhook handling.
 */

import { logger } from "@/ui/logger";
import { execFileLocal } from "./execFileLocal";

const adjectives = [
  "clever",
  "happy",
  "swift",
  "bright",
  "calm",
  "bold",
  "quiet",
  "brave",
  "wise",
  "eager",
  "gentle",
  "quick",
  "sharp",
  "smooth",
  "fresh",
  "nimble",
  "serene",
  "vivid",
  "lively",
  "noble",
  "daring",
  "fierce",
  "agile",
  "witty",
  "keen",
  "mellow",
  "steady",
  "lucid",
  "plucky",
  "crisp",
];

const nouns = [
  "ocean",
  "forest",
  "cloud",
  "star",
  "river",
  "mountain",
  "valley",
  "bridge",
  "beacon",
  "harbor",
  "garden",
  "meadow",
  "canyon",
  "island",
  "desert",
  "aurora",
  "glacier",
  "summit",
  "prairie",
  "lagoon",
  "falcon",
  "phoenix",
  "condor",
  "osprey",
  "sparrow",
  "crystal",
  "quartz",
  "marble",
  "cobalt",
  "bronze",
];

function generateWorktreeName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const hash = Math.random().toString(16).slice(2, 6);
  return `${adj}-${noun}-${hash}`;
}

export interface CreateWorktreeResult {
  readonly success: boolean;
  readonly worktreePath: string;
  readonly branchName: string;
  readonly parentBranch: string;
  readonly error?: string;
}

/**
 * Force-remove a worktree and its branch. Best-effort, never throws.
 */
export async function removeWorktreeForced(
  basePath: string,
  branchName: string,
): Promise<void> {
  const worktreeRelPath = `.dev/worktree/${branchName}`;
  try {
    await execFileLocal(
      "git",
      ["worktree", "remove", worktreeRelPath, "--force"],
      basePath,
    );
  } catch {
    /* best-effort */
  }
  try {
    await execFileLocal("git", ["branch", "-D", branchName], basePath);
  } catch {
    /* best-effort */
  }
}

export interface CreateWorktreeOptions {
  readonly issueNumber?: number;
  readonly prefix?: string;
  readonly startPoint?: string;
}

/**
 * Resolve the parent branch name for the current repository.
 * Returns the current HEAD branch, or falls back to the remote default branch, or "main".
 */
/**
 * Fetch a branch from origin. Best-effort: returns true on success, false on failure.
 */
export async function fetchOriginBranch(
  basePath: string,
  branch: string,
): Promise<boolean> {
  const result = await execFileLocal(
    "git",
    ["fetch", "origin", branch],
    basePath,
  );
  return result.exitCode === 0;
}

export async function resolveParentBranch(basePath: string): Promise<string> {
  const branchResult = await execFileLocal(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    basePath,
  );
  const branch = branchResult.stdout.trim();
  if (branchResult.exitCode === 0 && branch && branch !== "HEAD") {
    return branch;
  }
  const defaultResult = await execFileLocal(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
    basePath,
  );
  return defaultResult.exitCode === 0
    ? defaultResult.stdout.trim().replace("origin/", "")
    : "main";
}

export async function createWorktreeLocal(
  basePath: string,
  options?: CreateWorktreeOptions,
): Promise<CreateWorktreeResult> {
  const randomPart = generateWorktreeName();
  const issueNumber = options?.issueNumber;
  const prefix = options?.prefix;
  const name = issueNumber != null
    ? `issue-${issueNumber}-${randomPart}`
    : prefix
      ? `${prefix}-${randomPart}`
      : randomPart;

  // Check if it's a git repository
  const gitCheck = await execFileLocal(
    "git",
    ["rev-parse", "--git-dir"],
    basePath,
  );
  if (gitCheck.exitCode !== 0) {
    return {
      success: false,
      worktreePath: "",
      branchName: "",
      parentBranch: "",
      error: "Not a Git repository",
    };
  }

  // Determine parent branch: derive from startPoint if provided, otherwise detect from HEAD
  const startPoint = options?.startPoint;
  const parentBranch = startPoint
    ? startPoint.replace(/^origin\//, "")
    : await resolveParentBranch(basePath);

  // Create the worktree with new branch (optionally from a specific start point)
  const worktreeRelPath = `.dev/worktree/${name}`;
  const worktreeArgs = startPoint
    ? ["worktree", "add", "-b", name, worktreeRelPath, startPoint]
    : ["worktree", "add", "-b", name, worktreeRelPath];
  let result = await execFileLocal("git", worktreeArgs, basePath);

  // If worktree/branch exists, try with numbered suffixes
  if (result.exitCode !== 0 && result.stderr.includes("already exists")) {
    for (let i = 2; i <= 4; i++) {
      const newName = `${name}-${i}`;
      const newRelPath = `.dev/worktree/${newName}`;
      const retryArgs = startPoint
        ? ["worktree", "add", "-b", newName, newRelPath, startPoint]
        : ["worktree", "add", "-b", newName, newRelPath];
      result = await execFileLocal("git", retryArgs, basePath);

      if (result.exitCode === 0) {
        logger.debug(
          `[WEBHOOK] Created worktree ${newName} at ${basePath}/${newRelPath}`,
        );
        return {
          success: true,
          worktreePath: `${basePath}/${newRelPath}`,
          branchName: newName,
          parentBranch,
        };
      }
    }
  }

  if (result.exitCode === 0) {
    logger.debug(
      `[WEBHOOK] Created worktree ${name} at ${basePath}/${worktreeRelPath}`,
    );
    return {
      success: true,
      worktreePath: `${basePath}/${worktreeRelPath}`,
      branchName: name,
      parentBranch,
    };
  }

  return {
    success: false,
    worktreePath: "",
    branchName: "",
    parentBranch: "",
    error: result.stderr || "Failed to create worktree",
  };
}
