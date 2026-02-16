/**
 * Git branch data fetching and parsing
 * Provides local and remote branch information with tracking details
 */

import { sessionBash } from "./ops";
import { storage } from "./storage";

function resolveRepoPath(sessionId: string, repoPath?: string): string | null {
  const session = storage.getState().sessions[sessionId];
  const sessionPath = session?.metadata?.path;
  if (!sessionPath) return null;
  return repoPath ? `${sessionPath}/${repoPath}` : sessionPath;
}

export type BranchType = "local" | "remote";

export interface GitBranch {
  readonly name: string;
  readonly shortHash: string;
  readonly isCurrent: boolean;
  readonly type: BranchType;
  readonly upstream: string | null;
  readonly aheadCount: number;
  readonly behindCount: number;
}

export interface GitBranchList {
  readonly local: readonly GitBranch[];
  readonly remote: readonly GitBranch[];
  readonly current: string | null;
}

function parseTrackInfo(track: string): { ahead: number; behind: number } {
  let ahead = 0;
  let behind = 0;

  const aheadMatch = track.match(/ahead (\d+)/);
  if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);

  const behindMatch = track.match(/behind (\d+)/);
  if (behindMatch) behind = parseInt(behindMatch[1], 10);

  return { ahead, behind };
}

function parseBranchFormat(output: string): GitBranchList {
  if (!output.trim()) {
    return { local: [], remote: [], current: null };
  }

  let current: string | null = null;
  const local: GitBranch[] = [];
  const remote: GitBranch[] = [];

  for (const line of output.trim().split("\n")) {
    const parts = line.split("\0");
    if (parts.length < 5) continue;

    const isCurrent = parts[0] === "*";
    const name = parts[1];
    const shortHash = parts[2];
    const upstream = parts[3] || null;
    const trackInfo = parseTrackInfo(parts[4] || "");

    if (isCurrent) current = name;

    // Skip HEAD pointer entries like "origin/HEAD"
    if (name.endsWith("/HEAD")) continue;

    const isRemote = name.startsWith("origin/") || name.includes("/");
    // Check if it's a remote tracking branch (starts with a remote name)
    const isRemoteBranch =
      name.startsWith("origin/") ||
      name.startsWith("upstream/") ||
      (name.includes("/") && !isCurrent);

    const branch: GitBranch = {
      name,
      shortHash,
      isCurrent,
      type: isRemoteBranch ? "remote" : "local",
      upstream,
      aheadCount: trackInfo.ahead,
      behindCount: trackInfo.behind,
    };

    if (isRemoteBranch) {
      remote.push(branch);
    } else {
      local.push(branch);
    }
  }

  return { local, remote, current };
}

function parseBranchVerbose(output: string): GitBranchList {
  if (!output.trim()) {
    return { local: [], remote: [], current: null };
  }

  let current: string | null = null;
  const local: GitBranch[] = [];
  const remote: GitBranch[] = [];

  for (const line of output.trim().split("\n")) {
    const isCurrent = line.startsWith("*");
    const trimmed = line.replace(/^[* ] /, "");

    // Parse: "branch-name    hash commit message [upstream: ahead N, behind M]"
    const match = trimmed.match(/^(\S+)\s+([a-f0-9]+)\s/);
    if (!match) continue;

    const name = match[1];
    const shortHash = match[2];

    if (isCurrent) current = name;
    if (name.endsWith("/HEAD")) continue;

    const trackMatch = trimmed.match(/\[(.+?)\]/);
    const trackInfo = trackMatch
      ? parseTrackInfo(trackMatch[1])
      : { ahead: 0, behind: 0 };

    const upstreamMatch = trackMatch?.[1]?.match(/^([^:]+)/);
    const upstream = upstreamMatch ? upstreamMatch[1] : null;

    const isRemoteBranch =
      name.startsWith("remotes/") ||
      name.startsWith("origin/") ||
      name.startsWith("upstream/");

    const branch: GitBranch = {
      name: name.replace(/^remotes\//, ""),
      shortHash,
      isCurrent,
      type: isRemoteBranch ? "remote" : "local",
      upstream,
      aheadCount: trackInfo.ahead,
      behindCount: trackInfo.behind,
    };

    if (isRemoteBranch) {
      remote.push(branch);
    } else {
      local.push(branch);
    }
  }

  return { local, remote, current };
}

export async function fetchGitBranches(
  sessionId: string,
  repoPath?: string,
): Promise<GitBranchList> {
  const cwd = resolveRepoPath(sessionId, repoPath);
  if (!cwd) {
    return { local: [], remote: [], current: null };
  }

  // Try --format first (git >= 2.13)
  const result = await sessionBash(sessionId, {
    command: `git branch -a --format="%(HEAD)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track)"`,
    cwd,
    timeout: 10000,
  });

  if (result.success && result.stdout.trim()) {
    return parseBranchFormat(result.stdout);
  }

  // Fallback to verbose mode
  const fallback = await sessionBash(sessionId, {
    command: "git branch -a -vv",
    cwd,
    timeout: 10000,
  });

  if (!fallback.success || !fallback.stdout.trim()) {
    return { local: [], remote: [], current: null };
  }

  return parseBranchVerbose(fallback.stdout);
}
