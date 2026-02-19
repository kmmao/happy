/**
 * Git file-level operations (stage, unstage, discard, gitignore, commit)
 * Provides functions for managing individual file changes in git repositories
 */

import { sessionBash } from "./ops";
import { storage } from "./storage";
import { gitStatusSync } from "./gitStatusSync";
import type { GitFileStatus } from "./gitStatusFiles";

export interface GitFileOpResult {
  readonly success: boolean;
  readonly error?: string;
}

function resolveRepoPath(sessionId: string, repoPath?: string): string | null {
  const session = storage.getState().sessions[sessionId];
  const sessionPath = session?.metadata?.path;
  if (!sessionPath) return null;
  return repoPath ? `${sessionPath}/${repoPath}` : sessionPath;
}

/**
 * Escape a file path for safe use in shell commands.
 * Wraps in single quotes and escapes embedded single quotes.
 */
function shellEscape(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/**
 * Stage files (git add)
 */
export async function gitStageFiles(
  sessionId: string,
  filePaths: readonly string[],
  repoPath?: string,
): Promise<GitFileOpResult> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) {
    return { success: false, error: "Session path not found" };
  }

  const escaped = filePaths.map(shellEscape).join(" ");
  const result = await sessionBash(sessionId, {
    command: `git add -- ${escaped} 2>&1`,
    cwd,
    timeout: 15000,
  });

  if (!result.success || result.exitCode !== 0) {
    return {
      success: false,
      error:
        result.stdout.trim() ||
        result.stderr.trim() ||
        result.error ||
        "Stage failed",
    };
  }

  await gitStatusSync.invalidateAndAwait(sessionId);
  return { success: true };
}

/**
 * Unstage files (git restore --staged)
 */
export async function gitUnstageFiles(
  sessionId: string,
  filePaths: readonly string[],
  repoPath?: string,
): Promise<GitFileOpResult> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) {
    return { success: false, error: "Session path not found" };
  }

  const escaped = filePaths.map(shellEscape).join(" ");
  const result = await sessionBash(sessionId, {
    command: `git restore --staged -- ${escaped} 2>&1`,
    cwd,
    timeout: 15000,
  });

  if (!result.success || result.exitCode !== 0) {
    return {
      success: false,
      error:
        result.stdout.trim() ||
        result.stderr.trim() ||
        result.error ||
        "Unstage failed",
    };
  }

  await gitStatusSync.invalidateAndAwait(sessionId);
  return { success: true };
}

/**
 * Discard file changes.
 * Tracked files: git restore
 * Untracked files: rm
 */
export async function gitDiscardFiles(
  sessionId: string,
  files: readonly GitFileStatus[],
  repoPath?: string,
): Promise<GitFileOpResult> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) {
    return { success: false, error: "Session path not found" };
  }

  const tracked = files.filter((f) => f.status !== "untracked");
  const untracked = files.filter((f) => f.status === "untracked");

  // Restore tracked files
  if (tracked.length > 0) {
    const escaped = tracked.map((f) => shellEscape(f.fullPath)).join(" ");
    const result = await sessionBash(sessionId, {
      command: `git restore -- ${escaped} 2>&1`,
      cwd,
      timeout: 15000,
    });

    if (!result.success || result.exitCode !== 0) {
      return {
        success: false,
        error:
          result.stdout.trim() ||
          result.stderr.trim() ||
          result.error ||
          "Discard failed",
      };
    }
  }

  // Remove untracked files
  if (untracked.length > 0) {
    const escaped = untracked.map((f) => shellEscape(f.fullPath)).join(" ");
    const result = await sessionBash(sessionId, {
      command: `rm -f -- ${escaped} 2>&1`,
      cwd,
      timeout: 15000,
    });

    if (!result.success || result.exitCode !== 0) {
      return {
        success: false,
        error:
          result.stdout.trim() ||
          result.stderr.trim() ||
          result.error ||
          "Failed to remove untracked files",
      };
    }
  }

  await gitStatusSync.invalidateAndAwait(sessionId);
  return { success: true };
}

/**
 * Add file patterns to .gitignore
 */
export async function gitIgnoreFiles(
  sessionId: string,
  filePaths: readonly string[],
  repoPath?: string,
): Promise<GitFileOpResult> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) {
    return { success: false, error: "Session path not found" };
  }

  // Build the content to append (one pattern per line)
  const patterns = filePaths.join("\n");
  const escaped = shellEscape(patterns);

  const result = await sessionBash(sessionId, {
    command: `printf '%s\\n' ${escaped} >> .gitignore 2>&1`,
    cwd,
    timeout: 10000,
  });

  if (!result.success || result.exitCode !== 0) {
    return {
      success: false,
      error:
        result.stdout.trim() ||
        result.stderr.trim() ||
        result.error ||
        "Failed to update .gitignore",
    };
  }

  await gitStatusSync.invalidateAndAwait(sessionId);
  return { success: true };
}

/**
 * Commit staged changes
 */
export async function gitCommit(
  sessionId: string,
  message: string,
  repoPath?: string,
): Promise<GitFileOpResult> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) {
    return { success: false, error: "Session path not found" };
  }

  const escapedMessage = shellEscape(message);
  const result = await sessionBash(sessionId, {
    command: `git commit -m ${escapedMessage} 2>&1`,
    cwd,
    timeout: 30000,
  });

  if (!result.success || result.exitCode !== 0) {
    return {
      success: false,
      error:
        result.stdout.trim() ||
        result.stderr.trim() ||
        result.error ||
        "Commit failed",
    };
  }

  await gitStatusSync.invalidateAndAwait(sessionId);
  return { success: true };
}

/**
 * Stage all changes (git add -A)
 */
export async function gitStageAll(
  sessionId: string,
  repoPath?: string,
): Promise<GitFileOpResult> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) {
    return { success: false, error: "Session path not found" };
  }

  const result = await sessionBash(sessionId, {
    command: "git add -A 2>&1",
    cwd,
    timeout: 15000,
  });

  if (!result.success || result.exitCode !== 0) {
    return {
      success: false,
      error:
        result.stdout.trim() ||
        result.stderr.trim() ||
        result.error ||
        "Stage all failed",
    };
  }

  await gitStatusSync.invalidateAndAwait(sessionId);
  return { success: true };
}

/**
 * Unstage all changes (git reset HEAD)
 */
export async function gitUnstageAll(
  sessionId: string,
  repoPath?: string,
): Promise<GitFileOpResult> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) {
    return { success: false, error: "Session path not found" };
  }

  const result = await sessionBash(sessionId, {
    command: "git reset HEAD 2>&1",
    cwd,
    timeout: 15000,
  });

  if (!result.success || result.exitCode !== 0) {
    return {
      success: false,
      error:
        result.stdout.trim() ||
        result.stderr.trim() ||
        result.error ||
        "Unstage all failed",
    };
  }

  await gitStatusSync.invalidateAndAwait(sessionId);
  return { success: true };
}
