/**
 * Git status synchronization module
 * Provides real-time git repository status tracking using remote bash commands
 */

import { InvalidateSync } from "@/utils/sync";
import { sessionBash } from "./ops";
import { GitStatus } from "./storageTypes";
import { storage } from "./storage";
import {
  parseStatusSummary,
  getStatusCounts,
  isDirty,
} from "./git-parsers/parseStatus";
import {
  parseStatusSummaryV2,
  getStatusCountsV2,
  isDirtyV2,
  getCurrentBranchV2,
  getTrackingInfoV2,
} from "./git-parsers/parseStatusV2";
import { parseCurrentBranch } from "./git-parsers/parseBranch";
import { parseNumStat, mergeDiffSummaries } from "./git-parsers/parseDiff";
import {
  projectManager,
  createProjectKey,
  SubmoduleInfo,
} from "./projectManager";

const MAX_SUBMODULES = 20;
const SUBMODULE_PATHS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const SUBMODULE_REFRESH_INTERVAL = 30 * 1000; // 30 seconds

export class GitStatusSync {
  // Map project keys to sync instances
  private projectSyncMap = new Map<string, InvalidateSync>();
  // Map session IDs to project keys for cleanup
  private sessionToProjectKey = new Map<string, string>();
  // Cache submodule paths per project to avoid repeated .gitmodules parsing
  private submodulePathsCache = new Map<
    string,
    { paths: string[]; timestamp: number }
  >();
  // Cache child git repo paths for non-git parent directories
  private childRepoPathsCache = new Map<
    string,
    { paths: string[]; timestamp: number }
  >();

  /**
   * Get project key string for a session
   */
  private getProjectKeyForSession(sessionId: string): string | null {
    const session = storage.getState().sessions[sessionId];
    if (!session?.metadata?.machineId || !session?.metadata?.path) {
      return null;
    }
    return `${session.metadata.machineId}:${session.metadata.path}`;
  }

  /**
   * Get or create git status sync for a session (creates project-based sync)
   */
  getSync(sessionId: string): InvalidateSync {
    const projectKey = this.getProjectKeyForSession(sessionId);
    if (!projectKey) {
      // Return a no-op sync if no valid project
      return new InvalidateSync(async () => {});
    }

    // Map session to project key
    this.sessionToProjectKey.set(sessionId, projectKey);

    let sync = this.projectSyncMap.get(projectKey);
    if (!sync) {
      sync = new InvalidateSync(() =>
        this.fetchGitStatusForProject(sessionId, projectKey),
      );
      this.projectSyncMap.set(projectKey, sync);
    }
    return sync;
  }

  /**
   * Invalidate git status for a session (triggers refresh for the entire project)
   */
  invalidate(sessionId: string): void {
    const projectKey = this.sessionToProjectKey.get(sessionId);
    if (projectKey) {
      const sync = this.projectSyncMap.get(projectKey);
      if (sync) {
        sync.invalidate();
      }
    }
  }

  /**
   * Stop git status sync for a session
   */
  stop(sessionId: string): void {
    const projectKey = this.sessionToProjectKey.get(sessionId);
    if (projectKey) {
      this.sessionToProjectKey.delete(sessionId);

      // Check if any other sessions are using this project
      const hasOtherSessions = Array.from(
        this.sessionToProjectKey.values(),
      ).includes(projectKey);

      // Only stop the project sync if no other sessions are using it
      if (!hasOtherSessions) {
        const sync = this.projectSyncMap.get(projectKey);
        if (sync) {
          sync.stop();
          this.projectSyncMap.delete(projectKey);
        }
      }
    }
  }

  /**
   * Clear git status for a session when it's deleted
   * Similar to stop() but also clears any stored git status
   */
  clearForSession(sessionId: string): void {
    // First stop any active syncs
    this.stop(sessionId);

    // Clear git status from storage
    storage.getState().applyGitStatus(sessionId, null);
  }

  /**
   * Fetch git status for a project using any session in that project
   */
  private async fetchGitStatusForProject(
    sessionId: string,
    projectKey: string,
  ): Promise<void> {
    try {
      // Check if we have a session with valid metadata
      const session = storage.getState().sessions[sessionId];
      if (!session?.metadata?.path) {
        return;
      }

      // First check if we're in a git repository
      const gitCheckResult = await sessionBash(sessionId, {
        command: "git rev-parse --is-inside-work-tree",
        cwd: session.metadata.path,
        timeout: 5000,
      });

      if (!gitCheckResult.success || gitCheckResult.exitCode !== 0) {
        // Not a git repository - but may contain child git projects
        storage.getState().applyGitStatus(sessionId, null);

        if (session.metadata?.machineId) {
          const pk = createProjectKey(
            session.metadata.machineId,
            session.metadata.path,
          );
          projectManager.updateProjectGitStatus(pk, null);

          // Discover child git repos in subdirectories
          await this.fetchChildGitReposIfNeeded(
            sessionId,
            session.metadata.path,
            pk,
          );
        }
        return;
      }

      // Get git status in porcelain v2 format (includes branch info)
      // --untracked-files=all ensures we get individual files, not directories
      const statusResult = await sessionBash(sessionId, {
        command:
          "git status --porcelain=v2 --branch --show-stash --untracked-files=all",
        cwd: session.metadata.path,
        timeout: 10000,
      });

      if (!statusResult.success) {
        console.error("Failed to get git status:", statusResult.error);
        return;
      }

      // Get git diff statistics for unstaged changes
      const diffStatResult = await sessionBash(sessionId, {
        command: "git diff --numstat",
        cwd: session.metadata.path,
        timeout: 10000,
      });

      // Get git diff statistics for staged changes
      const stagedDiffStatResult = await sessionBash(sessionId, {
        command: "git diff --cached --numstat",
        cwd: session.metadata.path,
        timeout: 10000,
      });

      // Parse the git status output with diff statistics
      const gitStatus = this.parseGitStatusV2(
        statusResult.stdout,
        diffStatResult.success ? diffStatResult.stdout : "",
        stagedDiffStatResult.success ? stagedDiffStatResult.stdout : "",
      );

      // Apply to storage (this also updates the project git status via the modified applyGitStatus)
      storage.getState().applyGitStatus(sessionId, gitStatus);

      // Additionally, update the project directly for efficiency
      if (session.metadata?.machineId) {
        const pk = createProjectKey(
          session.metadata.machineId,
          session.metadata.path,
        );
        projectManager.updateProjectGitStatus(pk, gitStatus);

        // Fetch submodule statuses (conditionally to avoid excessive calls)
        await this.fetchSubmodulesIfNeeded(
          sessionId,
          session.metadata.path,
          pk,
        );
      }
    } catch (error) {
      console.error(
        "Error fetching git status for session",
        sessionId,
        ":",
        error,
      );
      // Don't apply error state, just skip this update
    }
  }

  /**
   * Fetch submodule statuses only when needed (first load or stale)
   */
  private async fetchSubmodulesIfNeeded(
    sessionId: string,
    projectPath: string,
    projectKey: { machineId: string; path: string },
  ): Promise<void> {
    const project = projectManager.getProjectForSession(sessionId);
    const shouldRefresh =
      !project?.submodules ||
      !project.submodulesLastUpdatedAt ||
      Date.now() - project.submodulesLastUpdatedAt > SUBMODULE_REFRESH_INTERVAL;

    if (!shouldRefresh) {
      return;
    }

    try {
      const submodulePaths = await this.getSubmodulePathsCached(
        sessionId,
        projectPath,
      );

      if (submodulePaths.length === 0) {
        projectManager.updateProjectSubmodules(projectKey, []);
        return;
      }

      // Fetch all submodule statuses in parallel
      const results = await Promise.all(
        submodulePaths.map((subPath) =>
          this.fetchSingleSubmoduleStatus(sessionId, projectPath, subPath),
        ),
      );

      const submodules: SubmoduleInfo[] = results.filter(
        (r): r is SubmoduleInfo => r !== null,
      );

      projectManager.updateProjectSubmodules(projectKey, submodules);
    } catch (error) {
      console.error("Error fetching submodule statuses:", error);
    }
  }

  /**
   * Discover child git repos in non-git parent directories
   */
  private async fetchChildGitReposIfNeeded(
    sessionId: string,
    projectPath: string,
    projectKey: { machineId: string; path: string },
  ): Promise<void> {
    const project = projectManager.getProjectForSession(sessionId);
    const shouldRefresh =
      !project?.submodules ||
      !project.submodulesLastUpdatedAt ||
      Date.now() - project.submodulesLastUpdatedAt > SUBMODULE_REFRESH_INTERVAL;

    if (!shouldRefresh) {
      return;
    }

    try {
      const childPaths = await this.getChildGitRepoPathsCached(
        sessionId,
        projectPath,
      );

      if (childPaths.length === 0) {
        projectManager.updateProjectSubmodules(projectKey, []);
        return;
      }

      const results = await Promise.all(
        childPaths.map((childPath) =>
          this.fetchSingleSubmoduleStatus(sessionId, projectPath, childPath),
        ),
      );

      const submodules: SubmoduleInfo[] = results.filter(
        (r): r is SubmoduleInfo => r !== null,
      );

      projectManager.updateProjectSubmodules(projectKey, submodules);
    } catch (error) {
      console.error("Error fetching child git repo statuses:", error);
    }
  }

  /**
   * Get child git repo paths with caching (for non-git parent directories)
   */
  private async getChildGitRepoPathsCached(
    sessionId: string,
    projectPath: string,
  ): Promise<string[]> {
    const cached = this.childRepoPathsCache.get(projectPath);
    if (cached && Date.now() - cached.timestamp < SUBMODULE_PATHS_CACHE_TTL) {
      return cached.paths;
    }

    const result = await sessionBash(sessionId, {
      command:
        "find . -maxdepth 3 -name .git -type d 2>/dev/null | head -20 | sed 's|/\\.git$||' | sed 's|^\\./||'",
      cwd: projectPath,
      timeout: 10000,
    });

    if (!result.success || result.exitCode !== 0) {
      const paths: string[] = [];
      this.childRepoPathsCache.set(projectPath, {
        paths,
        timestamp: Date.now(),
      });
      return paths;
    }

    const paths = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .slice(0, MAX_SUBMODULES);

    this.childRepoPathsCache.set(projectPath, {
      paths,
      timestamp: Date.now(),
    });
    return paths;
  }

  /**
   * Get submodule paths with caching
   */
  private async getSubmodulePathsCached(
    sessionId: string,
    projectPath: string,
  ): Promise<string[]> {
    const cached = this.submodulePathsCache.get(projectPath);
    if (cached && Date.now() - cached.timestamp < SUBMODULE_PATHS_CACHE_TTL) {
      return cached.paths;
    }

    const result = await sessionBash(sessionId, {
      command: "git submodule status",
      cwd: projectPath,
      timeout: 10000,
    });

    if (!result.success || result.exitCode !== 0) {
      const paths: string[] = [];
      this.submodulePathsCache.set(projectPath, {
        paths,
        timestamp: Date.now(),
      });
      return paths;
    }

    // Parse output: each line is " <sha> <path> (<describe>)" or "+<sha> <path> (<describe>)"
    const paths = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        // Format: [+-U ]<sha1> <path> [(<describe>)]
        const match = line.match(/^[+\-U ]?[0-9a-f]+\s+(\S+)/);
        return match ? match[1] : null;
      })
      .filter((p): p is string => p !== null)
      .slice(0, MAX_SUBMODULES);

    this.submodulePathsCache.set(projectPath, {
      paths,
      timestamp: Date.now(),
    });
    return paths;
  }

  /**
   * Fetch git status for a single submodule
   */
  private async fetchSingleSubmoduleStatus(
    sessionId: string,
    projectPath: string,
    submodulePath: string,
  ): Promise<SubmoduleInfo | null> {
    try {
      const fullPath = `${projectPath}/${submodulePath}`;

      // Check if submodule is initialized
      const checkResult = await sessionBash(sessionId, {
        command: "git rev-parse --is-inside-work-tree",
        cwd: fullPath,
        timeout: 5000,
      });

      if (!checkResult.success || checkResult.exitCode !== 0) {
        // Submodule not initialized
        return { path: submodulePath, gitStatus: null };
      }

      // Fetch status and diffs in parallel
      const [statusResult, diffResult, stagedDiffResult] = await Promise.all([
        sessionBash(sessionId, {
          command:
            "git status --porcelain=v2 --branch --show-stash --untracked-files=all",
          cwd: fullPath,
          timeout: 10000,
        }),
        sessionBash(sessionId, {
          command: "git diff --numstat",
          cwd: fullPath,
          timeout: 10000,
        }),
        sessionBash(sessionId, {
          command: "git diff --cached --numstat",
          cwd: fullPath,
          timeout: 10000,
        }),
      ]);

      if (!statusResult.success) {
        return { path: submodulePath, gitStatus: null };
      }

      const gitStatus = this.parseGitStatusV2(
        statusResult.stdout,
        diffResult.success ? diffResult.stdout : "",
        stagedDiffResult.success ? stagedDiffResult.stdout : "",
      );

      return { path: submodulePath, gitStatus };
    } catch {
      return { path: submodulePath, gitStatus: null };
    }
  }

  /**
   * Parse git status porcelain v2 output into structured data
   */
  private parseGitStatusV2(
    porcelainV2Output: string,
    diffStatOutput: string = "",
    stagedDiffStatOutput: string = "",
  ): GitStatus {
    // Parse status using v2 parser
    const statusSummary = parseStatusSummaryV2(porcelainV2Output);
    const counts = getStatusCountsV2(statusSummary);
    const repoIsDirty = isDirtyV2(statusSummary);
    const branchName = getCurrentBranchV2(statusSummary);
    const trackingInfo = getTrackingInfoV2(statusSummary);

    // Parse diff statistics
    const unstagedDiff = parseNumStat(diffStatOutput);
    const stagedDiff = parseNumStat(stagedDiffStatOutput);
    const { stagedAdded, stagedRemoved, unstagedAdded, unstagedRemoved } =
      mergeDiffSummaries(stagedDiff, unstagedDiff);

    // Calculate totals
    const linesAdded = stagedAdded + unstagedAdded;
    const linesRemoved = stagedRemoved + unstagedRemoved;
    const linesChanged = linesAdded + linesRemoved;

    return {
      branch: branchName,
      isDirty: repoIsDirty,
      modifiedCount: counts.modified,
      untrackedCount: counts.untracked,
      stagedCount: counts.staged,
      stagedLinesAdded: stagedAdded,
      stagedLinesRemoved: stagedRemoved,
      unstagedLinesAdded: unstagedAdded,
      unstagedLinesRemoved: unstagedRemoved,
      linesAdded,
      linesRemoved,
      linesChanged,
      lastUpdatedAt: Date.now(),
      // V2-specific fields
      upstreamBranch: statusSummary.branch.upstream || null,
      aheadCount: trackingInfo?.ahead,
      behindCount: trackingInfo?.behind,
      stashCount: statusSummary.stashCount,
    };
  }

  /**
   * Parse git status porcelain output into structured data using simple-git parsers
   * (Legacy v1 fallback method - kept for compatibility)
   */
  private parseGitStatus(
    branchName: string | null,
    porcelainOutput: string,
    diffStatOutput: string = "",
    stagedDiffStatOutput: string = "",
  ): GitStatus {
    // Parse status using simple-git parser
    const statusSummary = parseStatusSummary(porcelainOutput);
    const counts = getStatusCounts(statusSummary);
    const repoIsDirty = isDirty(statusSummary);

    // Parse diff statistics
    const unstagedDiff = parseNumStat(diffStatOutput);
    const stagedDiff = parseNumStat(stagedDiffStatOutput);
    const { stagedAdded, stagedRemoved, unstagedAdded, unstagedRemoved } =
      mergeDiffSummaries(stagedDiff, unstagedDiff);

    // Calculate totals
    const linesAdded = stagedAdded + unstagedAdded;
    const linesRemoved = stagedRemoved + unstagedRemoved;
    const linesChanged = linesAdded + linesRemoved;

    return {
      branch: branchName || null,
      isDirty: repoIsDirty,
      modifiedCount: counts.modified,
      untrackedCount: counts.untracked,
      stagedCount: counts.staged,
      stagedLinesAdded: stagedAdded,
      stagedLinesRemoved: stagedRemoved,
      unstagedLinesAdded: unstagedAdded,
      unstagedLinesRemoved: unstagedRemoved,
      linesAdded,
      linesRemoved,
      linesChanged,
      lastUpdatedAt: Date.now(),
    };
  }
}

// Global singleton instance
export const gitStatusSync = new GitStatusSync();
