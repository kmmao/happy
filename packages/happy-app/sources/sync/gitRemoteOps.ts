/**
 * Git remote operations (fetch, pull, push)
 * Provides functions for syncing with remote repositories
 */

import { sessionBash } from "./ops";
import { storage } from "./storage";
import { gitStatusSync } from "./gitStatusSync";

export interface GitRemoteOpResult {
  readonly success: boolean;
  readonly error?: string;
  readonly output?: string;
}

function resolveRepoPath(sessionId: string, repoPath?: string): string | null {
  const session = storage.getState().sessions[sessionId];
  const sessionPath = session?.metadata?.path;
  if (!sessionPath) return null;
  return repoPath ? `${sessionPath}/${repoPath}` : sessionPath;
}

export async function gitFetch(
  sessionId: string,
  repoPath?: string,
): Promise<GitRemoteOpResult> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) {
    return { success: false, error: "Session path not found" };
  }

  const result = await sessionBash(sessionId, {
    command: "git fetch 2>&1",
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
        "Fetch failed",
    };
  }

  await gitStatusSync.invalidateAndAwait(sessionId);
  return {
    success: true,
    output: result.stdout.trim() || undefined,
  };
}

export async function gitPull(
  sessionId: string,
  repoPath?: string,
): Promise<GitRemoteOpResult> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) {
    return { success: false, error: "Session path not found" };
  }

  const result = await sessionBash(sessionId, {
    command: "git pull 2>&1",
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
        "Pull failed",
    };
  }

  await gitStatusSync.invalidateAndAwait(sessionId);
  return {
    success: true,
    output: result.stdout.trim() || undefined,
  };
}

export async function gitPush(
  sessionId: string,
  repoPath?: string,
): Promise<GitRemoteOpResult> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) {
    return { success: false, error: "Session path not found" };
  }

  const result = await sessionBash(sessionId, {
    command: "git push 2>&1",
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
        "Push failed",
    };
  }

  await gitStatusSync.invalidateAndAwait(sessionId);
  return {
    success: true,
    output: result.stdout.trim() || undefined,
  };
}
