/**
 * Create a Git worktree locally (no RPC, uses child_process).
 * Ported from happy-app's createWorktree.ts for CLI-side webhook handling.
 */

import { exec } from "child_process";
import { logger } from "@/ui/logger";

const adjectives = [
  "clever", "happy", "swift", "bright", "calm",
  "bold", "quiet", "brave", "wise", "eager",
  "gentle", "quick", "sharp", "smooth", "fresh",
];

const nouns = [
  "ocean", "forest", "cloud", "star", "river",
  "mountain", "valley", "bridge", "beacon", "harbor",
  "garden", "meadow", "canyon", "island", "desert",
];

function generateWorktreeName(): string {
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}`;
}

function execAsync(
  command: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        exitCode: error?.code ?? (error ? 1 : 0),
      });
    });
  });
}

export interface CreateWorktreeResult {
  readonly success: boolean;
  readonly worktreePath: string;
  readonly branchName: string;
  readonly parentBranch: string;
  readonly error?: string;
}

export async function createWorktreeLocal(
  basePath: string,
): Promise<CreateWorktreeResult> {
  const name = generateWorktreeName();

  // Check if it's a git repository
  const gitCheck = await execAsync("git rev-parse --git-dir", basePath);
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
  const branchResult = await execAsync(
    "git rev-parse --abbrev-ref HEAD",
    basePath,
  );
  const parentBranch =
    branchResult.exitCode === 0 ? branchResult.stdout.trim() : "main";

  // Create the worktree with new branch
  const worktreeRelPath = `.dev/worktree/${name}`;
  let result = await execAsync(
    `git worktree add -b ${name} ${worktreeRelPath}`,
    basePath,
  );

  // If worktree/branch exists, try with numbered suffixes
  if (result.exitCode !== 0 && result.stderr.includes("already exists")) {
    for (let i = 2; i <= 4; i++) {
      const newName = `${name}-${i}`;
      const newRelPath = `.dev/worktree/${newName}`;
      result = await execAsync(
        `git worktree add -b ${newName} ${newRelPath}`,
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
