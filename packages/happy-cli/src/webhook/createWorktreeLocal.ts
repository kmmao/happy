/**
 * Create a Git worktree locally (no RPC, uses child_process).
 * Ported from happy-app's createWorktree.ts for CLI-side webhook handling.
 */

import { execFile } from "child_process";
import { logger } from "@/ui/logger";

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

function execFileAsync(
  file: string,
  args: readonly string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { cwd, timeout: 30_000 },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error
            ? typeof error.code === "number"
              ? error.code
              : 1
            : 0,
        });
      },
    );
  });
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
    await execFileAsync(
      "git",
      ["worktree", "remove", worktreeRelPath, "--force"],
      basePath,
    );
  } catch {
    /* best-effort */
  }
  try {
    await execFileAsync("git", ["branch", "-D", branchName], basePath);
  } catch {
    /* best-effort */
  }
}

export async function createWorktreeLocal(
  basePath: string,
  issueNumber?: number,
): Promise<CreateWorktreeResult> {
  const randomPart = generateWorktreeName();
  const name = issueNumber != null
    ? `issue-${issueNumber}-${randomPart}`
    : randomPart;

  // Check if it's a git repository
  const gitCheck = await execFileAsync(
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

  // Get current branch name (parent branch for the worktree)
  const branchResult = await execFileAsync(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    basePath,
  );
  let parentBranch: string;
  if (branchResult.exitCode === 0 && branchResult.stdout.trim()) {
    parentBranch = branchResult.stdout.trim();
  } else {
    // Fallback: detect remote default branch
    const defaultResult = await execFileAsync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
      basePath,
    );
    parentBranch =
      defaultResult.exitCode === 0
        ? defaultResult.stdout.trim().replace("origin/", "")
        : "main";
  }

  // Create the worktree with new branch
  const worktreeRelPath = `.dev/worktree/${name}`;
  let result = await execFileAsync(
    "git",
    ["worktree", "add", "-b", name, worktreeRelPath],
    basePath,
  );

  // If worktree/branch exists, try with numbered suffixes
  if (result.exitCode !== 0 && result.stderr.includes("already exists")) {
    for (let i = 2; i <= 4; i++) {
      const newName = `${name}-${i}`;
      const newRelPath = `.dev/worktree/${newName}`;
      result = await execFileAsync(
        "git",
        ["worktree", "add", "-b", newName, newRelPath],
        basePath,
      );

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
