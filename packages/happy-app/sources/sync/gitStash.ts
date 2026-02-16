/**
 * Git stash data fetching and parsing
 * Provides stash list and file-level details
 */

import { sessionBash } from "./ops";
import { storage } from "./storage";

function resolveRepoPath(sessionId: string, repoPath?: string): string | null {
  const session = storage.getState().sessions[sessionId];
  const sessionPath = session?.metadata?.path;
  if (!sessionPath) return null;
  return repoPath ? `${sessionPath}/${repoPath}` : sessionPath;
}

export interface GitStashEntry {
  readonly index: number;
  readonly ref: string;
  readonly hash: string;
  readonly message: string;
  readonly timestamp: number;
}

export interface GitStashFile {
  readonly fileName: string;
  readonly filePath: string;
  readonly fullPath: string;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly isBinary: boolean;
}

function parseStashList(output: string): GitStashEntry[] {
  if (!output.trim()) return [];

  return output
    .trim()
    .split("\n")
    .map((line) => {
      const parts = line.split("\0");
      if (parts.length < 4) return null;

      const ref = parts[0];
      const indexMatch = ref.match(/stash@\{(\d+)\}/);
      if (!indexMatch) return null;

      return {
        index: parseInt(indexMatch[1], 10),
        ref,
        hash: parts[1],
        message: parts[2],
        timestamp: parseInt(parts[3], 10),
      };
    })
    .filter((s): s is GitStashEntry => s !== null);
}

function parseStashFiles(output: string): GitStashFile[] {
  if (!output.trim()) return [];

  return output
    .trim()
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!match) return null;

      const fullPath = match[3];
      const lastSlash = fullPath.lastIndexOf("/");
      const fileName =
        lastSlash >= 0 ? fullPath.slice(lastSlash + 1) : fullPath;
      const filePath = lastSlash >= 0 ? fullPath.slice(0, lastSlash) : "";
      const isBinary = match[1] === "-" || match[2] === "-";

      return {
        fileName,
        filePath,
        fullPath,
        linesAdded: isBinary ? 0 : parseInt(match[1], 10),
        linesRemoved: isBinary ? 0 : parseInt(match[2], 10),
        isBinary,
      };
    })
    .filter((f): f is GitStashFile => f !== null);
}

export async function fetchGitStashList(
  sessionId: string,
  repoPath?: string,
): Promise<GitStashEntry[]> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) return [];

  const result = await sessionBash(sessionId, {
    command: `git stash list --format="%gd%x00%H%x00%s%x00%at"`,
    cwd,
    timeout: 10000,
  });

  if (!result.success || !result.stdout.trim()) return [];

  return parseStashList(result.stdout);
}

export async function fetchStashFiles(
  sessionId: string,
  stashIndex: number,
  repoPath?: string,
): Promise<GitStashFile[]> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) return [];

  const result = await sessionBash(sessionId, {
    command: `git stash show --numstat "stash@{${stashIndex}}"`,
    cwd,
    timeout: 10000,
  });

  if (!result.success || !result.stdout.trim()) return [];

  return parseStashFiles(result.stdout);
}
