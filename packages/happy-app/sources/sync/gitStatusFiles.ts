/**
 * Git status file-level functionality
 * Provides detailed git status with file-level changes and line statistics
 */

import { sessionBash } from "./ops";
import { storage } from "./storage";
import {
  parseStatusSummaryV2,
  getCurrentBranchV2,
} from "./git-parsers/parseStatusV2";
import { parseNumStat, createDiffStatsMap } from "./git-parsers/parseDiff";

const MAX_SUBMODULES = 20;

export interface GitFileStatus {
  fileName: string;
  filePath: string;
  fullPath: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  isStaged: boolean;
  linesAdded: number;
  linesRemoved: number;
  oldPath?: string; // For renamed files
}

export interface SubmoduleGitStatusFiles {
  path: string;
  initialized: boolean;
  branch: string | null;
  stagedFiles: GitFileStatus[];
  unstagedFiles: GitFileStatus[];
  totalStaged: number;
  totalUnstaged: number;
}

export interface GitStatusFiles {
  stagedFiles: GitFileStatus[];
  unstagedFiles: GitFileStatus[];
  branch: string | null;
  totalStaged: number;
  totalUnstaged: number;
  submodules?: SubmoduleGitStatusFiles[];
}

/**
 * Fetch detailed git status with file-level information
 */
export async function getGitStatusFiles(
  sessionId: string,
  repoPath?: string,
): Promise<GitStatusFiles | null> {
  try {
    // Check if we have a session with valid metadata
    const session = storage.getState().sessions[sessionId];
    if (!session?.metadata?.path) {
      return null;
    }

    const cwd = repoPath
      ? `${session.metadata.path}/${repoPath}`
      : session.metadata.path;

    // Get git status in porcelain v2 format (includes branch info and repo check)
    // --untracked-files=all ensures we get individual files, not directories
    const statusResult = await sessionBash(sessionId, {
      command: "git status --porcelain=v2 --branch --untracked-files=all",
      cwd,
      timeout: 10000,
    });

    if (!statusResult.success || statusResult.exitCode !== 0) {
      // Not a git repo - try discovering child git repos in subdirectories
      // Only for root repo, not sub-repos
      if (!repoPath) {
        return fetchChildGitRepoFiles(sessionId, session.metadata.path);
      }
      return null;
    }

    // Get combined diff statistics for both staged and unstaged changes
    const diffStatResult = await sessionBash(sessionId, {
      command:
        'git diff --numstat HEAD && echo "---STAGED---" && git diff --cached --numstat',
      cwd,
      timeout: 10000,
    });

    // Parse the results using v2 parser
    const statusOutput = statusResult.stdout;
    const diffOutput = diffStatResult.success ? diffStatResult.stdout : "";

    const mainResult = parseGitStatusFilesV2(statusOutput, diffOutput);

    // Fetch submodule file-level status only for root repo
    if (!repoPath) {
      const submodulePaths = await fetchSubmodulePaths(
        sessionId,
        session.metadata.path,
      );
      if (submodulePaths.length > 0) {
        mainResult.submodules = await Promise.all(
          submodulePaths.map((subPath) =>
            fetchSubmoduleFiles(sessionId, session.metadata!.path, subPath),
          ),
        );
      }
    }

    return mainResult;
  } catch (error) {
    console.error(
      "Error fetching git status files for session",
      sessionId,
      ":",
      error,
    );
    return null;
  }
}

/**
 * Get submodule paths via git submodule status
 */
async function fetchSubmodulePaths(
  sessionId: string,
  cwd: string,
): Promise<string[]> {
  const result = await sessionBash(sessionId, {
    command: "git submodule status",
    cwd,
    timeout: 10000,
  });

  if (!result.success || result.exitCode !== 0) {
    return [];
  }

  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^[+\-U ]?[0-9a-f]+\s+(\S+)/);
      return match ? match[1] : null;
    })
    .filter((p): p is string => p !== null)
    .slice(0, MAX_SUBMODULES);
}

/**
 * Fetch file-level git status for a single submodule
 */
const UNINITIALIZED_SUBMODULE: Omit<SubmoduleGitStatusFiles, "path"> = {
  initialized: false,
  branch: null,
  stagedFiles: [],
  unstagedFiles: [],
  totalStaged: 0,
  totalUnstaged: 0,
};

async function fetchSubmoduleFiles(
  sessionId: string,
  projectPath: string,
  submodulePath: string,
): Promise<SubmoduleGitStatusFiles> {
  try {
    const fullPath = `${projectPath}/${submodulePath}`;

    const statusResult = await sessionBash(sessionId, {
      command: "git status --porcelain=v2 --branch --untracked-files=all",
      cwd: fullPath,
      timeout: 10000,
    });

    if (!statusResult.success || statusResult.exitCode !== 0) {
      return { path: submodulePath, ...UNINITIALIZED_SUBMODULE };
    }

    const diffStatResult = await sessionBash(sessionId, {
      command:
        'git diff --numstat HEAD && echo "---STAGED---" && git diff --cached --numstat',
      cwd: fullPath,
      timeout: 10000,
    });

    const parsed = parseGitStatusFilesV2(
      statusResult.stdout,
      diffStatResult.success ? diffStatResult.stdout : "",
    );

    return {
      path: submodulePath,
      initialized: true,
      branch: parsed.branch,
      stagedFiles: parsed.stagedFiles,
      unstagedFiles: parsed.unstagedFiles,
      totalStaged: parsed.totalStaged,
      totalUnstaged: parsed.totalUnstaged,
    };
  } catch (error) {
    console.warn(
      `Failed to fetch submodule files for ${submodulePath}:`,
      error instanceof Error ? error.message : String(error),
    );
    return { path: submodulePath, ...UNINITIALIZED_SUBMODULE };
  }
}

/**
 * Discover child git repos and return their file-level status
 * Used when the parent directory is NOT a git repo
 */
async function fetchChildGitRepoFiles(
  sessionId: string,
  projectPath: string,
): Promise<GitStatusFiles | null> {
  const findResult = await sessionBash(sessionId, {
    command:
      "find . -maxdepth 3 -name .git -type d 2>/dev/null | head -20 | sed 's|/\\.git$||' | sed 's|^\\./||'",
    cwd: projectPath,
    timeout: 10000,
  });

  if (!findResult.success || !findResult.stdout.trim()) {
    return null;
  }

  const childPaths = findResult.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(0, MAX_SUBMODULES);

  if (childPaths.length === 0) {
    return null;
  }

  const submodules = await Promise.all(
    childPaths.map((childPath) =>
      fetchSubmoduleFiles(sessionId, projectPath, childPath),
    ),
  );

  return {
    stagedFiles: [],
    unstagedFiles: [],
    branch: null,
    totalStaged: 0,
    totalUnstaged: 0,
    submodules,
  };
}

/**
 * Parse git status v2 and diff outputs into structured file data
 */
function parseGitStatusFilesV2(
  statusOutput: string,
  combinedDiffOutput: string,
): GitStatusFiles {
  // Parse status using v2 parser
  const statusSummary = parseStatusSummaryV2(statusOutput);
  const branchName = getCurrentBranchV2(statusSummary);

  // Parse combined diff statistics
  const [unstagedOutput = "", stagedOutput = ""] =
    combinedDiffOutput.split("---STAGED---");
  const unstagedDiff = parseNumStat(unstagedOutput.trim());
  const stagedDiff = parseNumStat(stagedOutput.trim());
  const unstagedStats = createDiffStatsMap(unstagedDiff);
  const stagedStats = createDiffStatsMap(stagedDiff);

  const stagedFiles: GitFileStatus[] = [];
  const unstagedFiles: GitFileStatus[] = [];

  for (const file of statusSummary.files) {
    const parts = file.path.split("/");
    const fileNameOnly = parts[parts.length - 1] || file.path;
    const filePathOnly = parts.slice(0, -1).join("/");

    // Create file status for staged changes
    if (file.index !== " " && file.index !== "." && file.index !== "?") {
      const status = getFileStatusV2(file.index);
      const stats = stagedStats[file.path] || {
        added: 0,
        removed: 0,
        binary: false,
      };

      stagedFiles.push({
        fileName: fileNameOnly,
        filePath: filePathOnly,
        fullPath: file.path,
        status,
        isStaged: true,
        linesAdded: stats.added,
        linesRemoved: stats.removed,
        oldPath: file.from,
      });
    }

    // Create file status for unstaged changes
    if (file.working_dir !== " " && file.working_dir !== ".") {
      const status = getFileStatusV2(file.working_dir);
      const stats = unstagedStats[file.path] || {
        added: 0,
        removed: 0,
        binary: false,
      };

      unstagedFiles.push({
        fileName: fileNameOnly,
        filePath: filePathOnly,
        fullPath: file.path,
        status,
        isStaged: false,
        linesAdded: stats.added,
        linesRemoved: stats.removed,
        oldPath: file.from,
      });
    }
  }

  // Add untracked files to unstaged
  for (const untrackedPath of statusSummary.not_added) {
    // Handle both files and directories (directories have trailing slash)
    const isDirectory = untrackedPath.endsWith("/");
    const cleanPath = isDirectory ? untrackedPath.slice(0, -1) : untrackedPath;
    const parts = cleanPath.split("/");
    const fileNameOnly = parts[parts.length - 1] || cleanPath;
    const filePathOnly = parts.slice(0, -1).join("/");

    // Skip directory entries since we're using --untracked-files=all
    // This is a fallback in case git still reports directories
    if (isDirectory) {
      console.warn(`Unexpected directory in untracked files: ${untrackedPath}`);
      continue;
    }

    unstagedFiles.push({
      fileName: fileNameOnly,
      filePath: filePathOnly,
      fullPath: cleanPath,
      status: "untracked",
      isStaged: false,
      linesAdded: 0,
      linesRemoved: 0,
    });
  }

  return {
    stagedFiles,
    unstagedFiles,
    branch: branchName,
    totalStaged: stagedFiles.length,
    totalUnstaged: unstagedFiles.length,
  };
}

/**
 * Convert git status character to readable status (v2 format)
 */
function getFileStatusV2(statusChar: string): GitFileStatus["status"] {
  switch (statusChar) {
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
    case "C":
      return "renamed";
    case "?":
      return "untracked";
    default:
      return "modified";
  }
}
