/**
 * Pre-flight sync: pull latest code, handle conflicts, detect changes,
 * and trigger deploy/release when server or CLI packages are affected.
 *
 * Runs before supervisor analysis/research sessions to ensure the
 * codebase is up-to-date and infrastructure matches the latest code.
 */

import { execFile } from "child_process";
import { logger } from "@/ui/logger";

function execFileAsync(
  file: string,
  args: readonly string[],
  cwd: string,
  timeout = 60_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { cwd, timeout, maxBuffer: 10 * 1024 * 1024 },
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

export interface PreflightResult {
  readonly success: boolean;
  readonly pulled: boolean;
  readonly changedFiles: readonly string[];
  readonly deployedPackages: readonly string[];
  readonly error?: string;
}

export type PreflightProgressCallback = (step: string) => void;

/**
 * Detect which monorepo packages have changed between two commits.
 */
function detectChangedPackages(
  changedFiles: readonly string[],
): readonly string[] {
  const packages = new Set<string>();
  for (const file of changedFiles) {
    if (file.startsWith("packages/happy-server/")) {
      packages.add("happy-server");
    }
    if (file.startsWith("packages/happy-cli/")) {
      packages.add("happy-cli");
    }
  }
  return [...packages];
}

/**
 * Run pre-flight sync for a repository before supervisor analysis.
 *
 * Steps:
 * 1. Stash uncommitted changes (if any)
 * 2. Fetch + rebase from origin
 * 3. On conflict: attempt auto-resolve via Claude, abort if fails
 * 4. Detect changed files and affected packages
 * 5. Deploy/release affected infrastructure packages
 * 6. Restore stashed changes
 */
export async function runPreflightSync(
  repoPath: string,
  onProgress?: PreflightProgressCallback,
): Promise<PreflightResult> {
  const progress = onProgress ?? (() => {});
  let stashed = false;
  let oldHead = "";

  try {
    // 0. Check if this is a git repo on a branch
    progress("checking");
    const branchResult = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      repoPath,
    );
    if (branchResult.exitCode !== 0 || branchResult.stdout.trim() === "HEAD") {
      logger.debug("[PREFLIGHT] Not on a branch (detached HEAD), skipping pull");
      return { success: true, pulled: false, changedFiles: [], deployedPackages: [] };
    }
    const branch = branchResult.stdout.trim();

    // 1. Record current HEAD
    const headResult = await execFileAsync(
      "git",
      ["rev-parse", "HEAD"],
      repoPath,
    );
    oldHead = headResult.stdout.trim();

    // 2. Stash uncommitted changes
    progress("stashing");
    const statusResult = await execFileAsync(
      "git",
      ["status", "--porcelain"],
      repoPath,
    );
    if (statusResult.stdout.trim().length > 0) {
      const stashResult = await execFileAsync(
        "git",
        ["stash", "push", "-m", "preflight-auto-stash"],
        repoPath,
      );
      if (stashResult.exitCode === 0) {
        stashed = true;
        logger.debug("[PREFLIGHT] Stashed local changes");
      }
    }

    // 3. Fetch from origin
    progress("fetching");
    const fetchResult = await execFileAsync(
      "git",
      ["fetch", "origin", branch],
      repoPath,
      30_000,
    );
    if (fetchResult.exitCode !== 0) {
      logger.debug(`[PREFLIGHT] Fetch failed: ${fetchResult.stderr}`);
      await restoreStash(repoPath, stashed);
      return {
        success: false,
        pulled: false,
        changedFiles: [],
        deployedPackages: [],
        error: `Git fetch failed: ${fetchResult.stderr.trim()}`,
      };
    }

    // 4. Check if we're behind
    const behindResult = await execFileAsync(
      "git",
      ["rev-list", "--count", `HEAD..origin/${branch}`],
      repoPath,
    );
    const behindCount = parseInt(behindResult.stdout.trim(), 10) || 0;
    if (behindCount === 0) {
      logger.debug("[PREFLIGHT] Already up-to-date");
      await restoreStash(repoPath, stashed);
      return { success: true, pulled: false, changedFiles: [], deployedPackages: [] };
    }

    logger.debug(`[PREFLIGHT] ${behindCount} commit(s) behind origin/${branch}`);

    // 5. Rebase onto origin
    progress("pulling");
    const rebaseResult = await execFileAsync(
      "git",
      ["rebase", `origin/${branch}`],
      repoPath,
      120_000,
    );

    if (rebaseResult.exitCode !== 0) {
      // Rebase conflict — attempt Claude-assisted resolution
      logger.debug("[PREFLIGHT] Rebase conflict detected, attempting resolution");
      progress("resolving-conflicts");

      const resolved = await attemptConflictResolution(repoPath);
      if (!resolved) {
        // Abort rebase and restore
        await execFileAsync("git", ["rebase", "--abort"], repoPath);
        await restoreStash(repoPath, stashed);
        return {
          success: false,
          pulled: false,
          changedFiles: [],
          deployedPackages: [],
          error: "Git rebase conflict could not be auto-resolved. Please resolve manually.",
        };
      }
    }

    // 6. Detect changed files
    const newHead = (
      await execFileAsync("git", ["rev-parse", "HEAD"], repoPath)
    ).stdout.trim();

    const diffResult = await execFileAsync(
      "git",
      ["diff", "--name-only", `${oldHead}..${newHead}`],
      repoPath,
    );
    const changedFiles = diffResult.stdout
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);

    logger.debug(`[PREFLIGHT] ${changedFiles.length} file(s) changed after pull`);

    // 7. Detect affected packages and deploy
    const affectedPackages = detectChangedPackages(changedFiles);
    const deployedPackages: string[] = [];

    if (affectedPackages.length > 0) {
      progress("deploying");
      logger.debug(
        `[PREFLIGHT] Affected packages: ${affectedPackages.join(", ")}`,
      );

      for (const pkg of affectedPackages) {
        const deployed = await deployPackage(repoPath, pkg, progress);
        if (deployed) {
          deployedPackages.push(pkg);
        }
      }
    }

    // 8. Restore stashed changes
    await restoreStash(repoPath, stashed);

    return {
      success: true,
      pulled: true,
      changedFiles,
      deployedPackages,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.debug(`[PREFLIGHT] Unexpected error: ${msg}`);
    await restoreStash(repoPath, stashed);
    return {
      success: false,
      pulled: false,
      changedFiles: [],
      deployedPackages: [],
      error: `Preflight sync error: ${msg}`,
    };
  }
}

/**
 * Attempt to auto-resolve rebase conflicts using Claude.
 * Spawns a short Claude session to resolve the conflict files.
 * Returns true if all conflicts are resolved and rebase can continue.
 */
async function attemptConflictResolution(
  repoPath: string,
): Promise<boolean> {
  // List conflicting files
  const conflictResult = await execFileAsync(
    "git",
    ["diff", "--name-only", "--diff-filter=U"],
    repoPath,
  );
  const conflictFiles = conflictResult.stdout
    .trim()
    .split("\n")
    .filter((f) => f.length > 0);

  if (conflictFiles.length === 0) {
    return false;
  }

  logger.debug(
    `[PREFLIGHT] ${conflictFiles.length} conflicting file(s): ${conflictFiles.join(", ")}`,
  );

  // Use Claude CLI in non-interactive mode to resolve conflicts
  const resolvePrompt = [
    "You are resolving git rebase conflicts. The following files have conflicts:",
    ...conflictFiles.map((f) => `  - ${f}`),
    "",
    "For each file:",
    "1. Read the file and find the conflict markers (<<<<<<< HEAD, =======, >>>>>>>)",
    "2. Analyze both sides and merge them intelligently",
    "3. Remove all conflict markers",
    "4. Save the resolved file",
    "5. Run: git add <file>",
    "",
    "After resolving ALL files, run: git rebase --continue",
    "",
    "If you cannot resolve a conflict safely, output CONFLICT_UNRESOLVABLE and stop.",
  ].join("\n");

  const claudeResult = await execFileAsync(
    "claude",
    ["-p", resolvePrompt, "--max-turns", "20"],
    repoPath,
    180_000, // 3 minutes
  );

  if (claudeResult.exitCode === 0) {
    // Check if rebase is still in progress (means --continue failed or wasn't run)
    const rebaseCheck = await execFileAsync(
      "git",
      ["rev-parse", "--git-path", "rebase-merge"],
      repoPath,
    );
    const rebaseDirCheck = await execFileAsync(
      "test",
      ["-d", rebaseCheck.stdout.trim()],
      repoPath,
    );
    if (rebaseDirCheck.exitCode === 0) {
      // Rebase still in progress — try to continue
      const continueResult = await execFileAsync(
        "git",
        ["rebase", "--continue"],
        repoPath,
        60_000,
      );
      if (continueResult.exitCode !== 0) {
        logger.debug("[PREFLIGHT] git rebase --continue failed after Claude resolution");
        return false;
      }
    }
    logger.debug("[PREFLIGHT] Conflicts resolved by Claude");
    return true;
  }

  // Check output for explicit unresolvable marker
  if (
    claudeResult.stdout.includes("CONFLICT_UNRESOLVABLE") ||
    claudeResult.stderr.includes("CONFLICT_UNRESOLVABLE")
  ) {
    logger.debug("[PREFLIGHT] Claude reported conflicts as unresolvable");
    return false;
  }

  logger.debug(
    `[PREFLIGHT] Claude conflict resolution failed (exit ${claudeResult.exitCode})`,
  );
  return false;
}

/**
 * Deploy a specific package by running its release/deploy skill.
 */
async function deployPackage(
  repoPath: string,
  packageName: string,
  progress: PreflightProgressCallback,
): Promise<boolean> {
  logger.debug(`[PREFLIGHT] Deploying ${packageName}...`);
  progress(`deploying-${packageName}`);

  if (packageName === "happy-cli") {
    // Build + publish CLI + update local install
    const buildResult = await execFileAsync(
      "yarn",
      ["workspace", "@kmmao/happy-coder", "build"],
      repoPath,
      120_000,
    );
    if (buildResult.exitCode !== 0) {
      logger.debug(`[PREFLIGHT] CLI build failed: ${buildResult.stderr}`);
      return false;
    }

    const testResult = await execFileAsync(
      "yarn",
      ["workspace", "@kmmao/happy-coder", "test"],
      repoPath,
      180_000,
    );
    if (testResult.exitCode !== 0) {
      logger.debug(`[PREFLIGHT] CLI tests failed: ${testResult.stderr}`);
      return false;
    }

    // Publish to npm
    const publishResult = await execFileAsync(
      "npm",
      ["publish", "--access", "public", "--ignore-scripts"],
      `${repoPath}/packages/happy-cli`,
      60_000,
    );
    if (publishResult.exitCode !== 0) {
      // May fail if version not bumped — that's okay, just means no new release needed
      logger.debug(`[PREFLIGHT] CLI publish skipped or failed: ${publishResult.stderr}`);
      return false;
    }

    // Update local global install
    await execFileAsync(
      "npm",
      ["install", "-g", "./packages/happy-cli"],
      repoPath,
      120_000,
    );

    logger.debug("[PREFLIGHT] CLI deployed successfully");
    return true;
  }

  if (packageName === "happy-server") {
    // Rebuild and restart Docker server
    const composeResult = await execFileAsync(
      "docker",
      ["compose", "-f", "docker-compose.yml", "up", "-d", "--build", "server"],
      repoPath,
      300_000, // 5 minutes
    );
    if (composeResult.exitCode !== 0) {
      logger.debug(`[PREFLIGHT] Server deploy failed: ${composeResult.stderr}`);
      return false;
    }

    logger.debug("[PREFLIGHT] Server deployed successfully");
    return true;
  }

  return false;
}

async function restoreStash(
  repoPath: string,
  stashed: boolean,
): Promise<void> {
  if (!stashed) return;
  const result = await execFileAsync(
    "git",
    ["stash", "pop"],
    repoPath,
  );
  if (result.exitCode !== 0) {
    logger.debug(`[PREFLIGHT] Stash pop failed: ${result.stderr}`);
  } else {
    logger.debug("[PREFLIGHT] Restored stashed changes");
  }
}
