/**
 * Git history data fetching and parsing
 * Provides commit history with file-level change details
 */

import { sessionBash } from "./ops";
import { storage } from "./storage";

const PAGE_SIZE = 20;

function resolveRepoPath(sessionId: string, repoPath?: string): string | null {
  const session = storage.getState().sessions[sessionId];
  const sessionPath = session?.metadata?.path;
  if (!sessionPath) return null;
  return repoPath ? `${sessionPath}/${repoPath}` : sessionPath;
}

export interface GitCommit {
  readonly hash: string;
  readonly shortHash: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly timestamp: number;
  readonly message: string;
}

export interface GitCommitFile {
  readonly fileName: string;
  readonly filePath: string;
  readonly fullPath: string;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly isBinary: boolean;
}

export interface GitHistoryPage {
  readonly commits: readonly GitCommit[];
  readonly hasMore: boolean;
}

function parseGitLog(output: string): GitCommit[] {
  if (!output.trim()) return [];

  return output
    .trim()
    .split("\n")
    .map((line) => {
      const parts = line.split("\0");
      if (parts.length < 6) return null;

      return {
        hash: parts[0],
        shortHash: parts[1],
        authorName: parts[2],
        authorEmail: parts[3],
        timestamp: parseInt(parts[4], 10),
        message: parts[5],
      };
    })
    .filter((c): c is GitCommit => c !== null);
}

function parseCommitFiles(output: string): GitCommitFile[] {
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
    .filter((f): f is GitCommitFile => f !== null);
}

export async function fetchGitHistory(
  sessionId: string,
  skip: number = 0,
  repoPath?: string,
): Promise<GitHistoryPage> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) {
    return { commits: [], hasMore: false };
  }

  const result = await sessionBash(sessionId, {
    command: `git log --format="%H%x00%h%x00%an%x00%ae%x00%at%x00%s" -n ${PAGE_SIZE + 1} --skip=${skip}`,
    cwd,
    timeout: 15000,
  });

  if (!result.success || !result.stdout.trim()) {
    return { commits: [], hasMore: false };
  }

  const parsed = parseGitLog(result.stdout);
  const hasMore = parsed.length > PAGE_SIZE;

  return {
    commits: hasMore ? parsed.slice(0, PAGE_SIZE) : parsed,
    hasMore,
  };
}

export async function fetchCommitFiles(
  sessionId: string,
  commitHash: string,
  repoPath?: string,
): Promise<GitCommitFile[]> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) return [];

  const result = await sessionBash(sessionId, {
    command: `git diff-tree --no-commit-id -r --numstat ${commitHash}`,
    cwd,
    timeout: 10000,
  });

  if (!result.success || !result.stdout.trim()) return [];

  return parseCommitFiles(result.stdout);
}
