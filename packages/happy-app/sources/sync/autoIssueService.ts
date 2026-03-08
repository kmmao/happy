/**
 * Auto Issue Service — Application-level background service for auto-triggering
 * Claude Code sessions when issues with matching labels are detected.
 *
 * Runs independently of any UI component. Periodically:
 * 1. Collects unique project directories from all active sessions (deduped by machineId:path)
 * 2. For each unique project, detects repo info and checks gitHost auto-issue config
 * 3. Fetches issues via issueStore (reuses existing FETCH_COOLDOWN deduplication)
 * 4. Matches issues against label + author whitelist
 * 5. Launches worktree sessions for matching issues
 *
 * Lifecycle: started in sync.#init(), paused when app backgrounds, resumed on foreground.
 */

import { AppState, type AppStateStatus } from "react-native";
import { storage } from "@/sync/storage";
import { issueStore } from "@/sync/issueStore";
import { issueSessionStore } from "@/sync/issueSessionStore";
import { buildIssueKey } from "@/sync/issueSessionTypes";
import { findGitHostMapping } from "@/sync/issueUtils";
import { launchIssueSession } from "@/utils/launchIssueSession";
import { log } from "@/log";
import type { AggregatedIssue, GitHostMapping, Issue } from "@/sync/issueTypes";

const POLL_INTERVAL = 60_000; // 60 seconds

interface UniqueProject {
  readonly projectKey: string;
  readonly sessionId: string;
  readonly machineId: string;
  readonly path: string;
}

/**
 * Extract hostname from a Git remote URL.
 * Handles SSH (git@host:...) and HTTPS (https://host/...) formats.
 */
function extractHostFromRemoteUrl(remoteUrl: string): string | undefined {
  const sshMatch = remoteUrl.match(/@([^:/]+)[:/]/);
  if (sshMatch) return sshMatch[1];
  const httpsMatch = remoteUrl.match(/\/\/([^/]+)\//);
  if (httpsMatch) return httpsMatch[1];
  return undefined;
}

function toAggregatedIssue(
  issue: Issue,
  projectKey: string,
  repoInfo: { owner: string; repo: string },
): AggregatedIssue {
  return {
    ...issue,
    projectKey,
    repoLabel: `${repoInfo.owner}/${repoInfo.repo}`,
  };
}

class AutoIssueService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private appStateSubscription: ReturnType<
    typeof AppState.addEventListener
  > | null = null;

  /**
   * Start the background polling service.
   * Called from sync.#init().
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    log.log("🔄 AutoIssueService: starting");

    // Subscribe to issueStore changes for immediate matching
    this.subscribeToIssueStore();

    // Delay the first tick to allow gitStatus sync to complete first.
    // Without this, the first tick fires before remoteUrl is available
    // and silently fails to detect repoInfo for all projects.
    setTimeout(() => {
      if (!this.running) return;
      void this.tick();
    }, 10_000);
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL);

    // Pause/resume on app state changes
    this.appStateSubscription = AppState.addEventListener(
      "change",
      this.handleAppState,
    );
  }

  /**
   * Stop the background service.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    log.log("🔄 AutoIssueService: stopping");

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.unsubscribeIssueStore) {
      this.unsubscribeIssueStore();
      this.unsubscribeIssueStore = null;
    }
    if (this.matchDebounceTimer) {
      clearTimeout(this.matchDebounceTimer);
      this.matchDebounceTimer = null;
    }
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }

  /**
   * Trigger an immediate check (e.g. on app foreground resume).
   */
  triggerNow(): void {
    if (!this.running) return;
    void this.tick();
  }

  // ── Internal ──────────────────────────────────────────────

  private unsubscribeIssueStore: (() => void) | null = null;

  private handleAppState = (state: AppStateStatus): void => {
    if (state === "active") {
      // Resume polling
      if (!this.timer) {
        void this.tick();
        this.timer = setInterval(() => void this.tick(), POLL_INTERVAL);
      }
    } else {
      // Pause polling when backgrounded
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }
  };

  /**
   * Subscribe to issueStore so we match issues as soon as they're fetched,
   * not just on the next tick.
   */
  private matchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  private subscribeToIssueStore(): void {
    this.unsubscribeIssueStore = issueStore.subscribe(() => {
      // Debounce to avoid repeated matching when multiple projects refresh
      if (this.matchDebounceTimer) clearTimeout(this.matchDebounceTimer);
      this.matchDebounceTimer = setTimeout(() => {
        this.matchDebounceTimer = null;
        this.matchAndLaunch();
      }, 500);
    });
  }

  /**
   * Periodic tick: refresh issues for all unique projects that have
   * auto-issue enabled.
   */
  private async tick(): Promise<void> {
    const { gitHosts } = storage.getState().settings;

    // Quick check: any host with auto-issue enabled?
    const hasAnyAutoConfig = gitHosts.some(
      (h) => h.autoIssueEnabled && h.autoIssueLabel,
    );
    if (!hasAnyAutoConfig) return;

    // Ensure issueSessionStore is loaded (prevents KV optimistic lock conflicts)
    if (!issueSessionStore.getState().isLoaded) {
      try {
        await issueSessionStore.getState().loadLinks();
      } catch {
        log.log(
          "🔄 AutoIssueService tick: failed to load issueSessionStore, skipping",
        );
        return;
      }
    }

    const projects = this.collectUniqueProjects();
    if (projects.length === 0) {
      log.log("🔄 AutoIssueService tick: no projects with sessions found");
      return;
    }

    log.log(
      `🔄 AutoIssueService tick: ${projects.length} unique project(s) to check`,
    );

    // For each unique project, detect repo info (if not already detected)
    // and refresh issues
    const projectKeys: string[] = [];
    const repoPathByKey: Record<string, string | undefined> = {};

    for (const project of projects) {
      const { projectKey, sessionId } = project;
      projectKeys.push(projectKey);
      repoPathByKey[projectKey] = undefined; // root project, no subpath

      // Ensure repoInfo is detected (reads gitStatus remoteUrl from storage)
      this.ensureRepoInfoDetected(projectKey, gitHosts);
    }

    if (projectKeys.length === 0) return;

    // Log repoInfo detection summary
    const storeState = issueStore.getState();
    const detected = projectKeys.filter((k) => {
      const info = storeState.repoInfoByProject[k];
      return info && info.provider !== "unknown";
    });
    log.log(
      `🔄 AutoIssueService tick: repoInfo detected for ${detected.length}/${projectKeys.length} projects`,
    );
    if (detected.length < projectKeys.length) {
      const missing = projectKeys.filter((k) => !detected.includes(k));
      log.log(
        `🔄 AutoIssueService tick: missing repoInfo for: ${missing.join(", ")}`,
      );
    }

    // Pick any sessionId that can execute commands (first available)
    const sessionId = projects[0].sessionId;

    // Refresh issues (issueStore's FETCH_COOLDOWN handles deduplication)
    // Only refresh when UI filter is "open" — if user is viewing closed issues,
    // refreshAllIssues would replace open issues with closed ones in the store.
    const currentFilterState = issueStore.getState().filters.state;
    if (currentFilterState === "open") {
      try {
        await issueStore
          .getState()
          .refreshAllIssues(projectKeys, sessionId, repoPathByKey);
        log.log(
          `🔄 AutoIssueService tick: refreshed issues for ${projectKeys.length} project(s)`,
        );
      } catch (error) {
        log.log(`🔄 AutoIssueService: refreshAllIssues error: ${error}`);
      }
    } else {
      log.log(
        `🔄 AutoIssueService tick: skipping refresh (UI filter="${currentFilterState}")`,
      );
    }
  }

  /**
   * Collect unique project directories from all active sessions.
   * Deduplicates by machineId:path so multiple sessions pointing to
   * the same directory only result in one issue check.
   */
  private collectUniqueProjects(): readonly UniqueProject[] {
    const sessions = storage.getState().sessions;
    const seen = new Set<string>();
    const result: UniqueProject[] = [];

    for (const session of Object.values(sessions)) {
      if (!session.metadata?.machineId || !session.metadata?.path) continue;

      // Skip worktree sessions — they are child sessions spawned by this
      // service and must NOT be scanned for issues (their path differs from
      // the parent repo, which would create a different projectKey and cause
      // infinite session spawning).
      if (session.metadata.worktree?.isWorktree) continue;

      const projectKey = `${session.metadata.machineId}:${session.metadata.path}`;
      if (seen.has(projectKey)) continue;
      seen.add(projectKey);

      result.push({
        projectKey,
        sessionId: session.id,
        machineId: session.metadata.machineId,
        path: session.metadata.path,
      });
    }

    return result;
  }

  /**
   * Ensure issueStore has repoInfo for this project by reading
   * the gitStatus remoteUrl from storage.
   */
  private ensureRepoInfoDetected(
    projectKey: string,
    gitHosts: readonly GitHostMapping[],
  ): void {
    // Already detected?
    const existing = issueStore.getState().repoInfoByProject[projectKey];
    if (existing && existing.provider !== "unknown") {
      log.log(
        `🔄 AutoIssueService repoInfo: ${projectKey} — already detected (${existing.provider}: ${existing.owner}/${existing.repo})`,
      );
      return;
    }

    // Try to get remoteUrl from project git status
    const [machineId, path] = projectKey.split(":", 2);
    const sessions = storage.getState().sessions;
    let matchingSessions = 0;

    // Find any session with this machineId:path that has gitStatus
    for (const session of Object.values(sessions)) {
      if (
        session.metadata?.machineId !== machineId ||
        session.metadata?.path !== path
      )
        continue;

      matchingSessions++;

      const gitStatus = storage
        .getState()
        .getSessionProjectGitStatus(session.id);
      if (!gitStatus?.remoteUrl) {
        // Fall back to session-level git status
        const sessionGitStatus =
          storage.getState().sessionGitStatus[session.id];
        if (sessionGitStatus?.remoteUrl) {
          log.log(
            `🔄 AutoIssueService repoInfo: ${projectKey} — found remoteUrl via sessionGitStatus: ${sessionGitStatus.remoteUrl}`,
          );
          issueStore
            .getState()
            .detectRepoInfo(projectKey, sessionGitStatus.remoteUrl, gitHosts);
          return;
        }
        log.log(
          `🔄 AutoIssueService repoInfo: ${projectKey} — session ${session.id.slice(0, 8)} has no remoteUrl (projectGitStatus=${!!gitStatus}, sessionGitStatus=${!!sessionGitStatus})`,
        );
        continue;
      }

      log.log(
        `🔄 AutoIssueService repoInfo: ${projectKey} — found remoteUrl via projectGitStatus: ${gitStatus.remoteUrl}`,
      );
      issueStore
        .getState()
        .detectRepoInfo(projectKey, gitStatus.remoteUrl, gitHosts);
      return;
    }

    log.log(
      `🔄 AutoIssueService repoInfo: ${projectKey} — FAILED to detect (${matchingSessions} sessions checked, none had remoteUrl)`,
    );
  }

  /**
   * Check all fetched issues against auto-issue config and launch
   * sessions for matching ones.
   */
  private matchAndLaunch(): void {
    const { gitHosts } = storage.getState().settings;

    const hasAnyAutoConfig = gitHosts.some(
      (h) => h.autoIssueEnabled && h.autoIssueLabel,
    );
    if (!hasAnyAutoConfig) return;

    // Wait for issueSessionStore to be loaded before matching —
    // otherwise findByIssueKey returns null for existing links and
    // causes duplicate launches / KV optimistic lock failures.
    if (!issueSessionStore.getState().isLoaded) {
      log.log(
        "🔄 AutoIssueService matchAndLaunch: issueSessionStore not loaded yet, skipping",
      );
      return;
    }

    const storeState = issueStore.getState();
    const projects = this.collectUniqueProjects();

    for (const project of projects) {
      const { projectKey, machineId, path } = project;

      const issues = storeState.issuesByProject[projectKey];
      if (!issues || issues.length === 0) continue;

      const repoInfo = storeState.repoInfoByProject[projectKey];
      if (!repoInfo || repoInfo.provider === "unknown") {
        log.log(
          `🔄 AutoIssueService match: ${projectKey} — no repoInfo detected yet`,
        );
        continue;
      }

      // Extract host from remoteUrl and find matching gitHosts config
      const host = extractHostFromRemoteUrl(repoInfo.remoteUrl);
      if (!host) {
        log.log(
          `🔄 AutoIssueService match: ${projectKey} — cannot extract host from ${repoInfo.remoteUrl}`,
        );
        continue;
      }

      const mapping = findGitHostMapping(host, gitHosts);
      if (
        !mapping?.autoIssueEnabled ||
        !mapping?.autoIssueLabel ||
        !mapping.autoIssueAllowedAuthors?.length
      ) {
        log.log(
          `🔄 AutoIssueService match: ${projectKey} — host "${host}" has no auto-issue config (mapping=${mapping ? `enabled=${mapping.autoIssueEnabled}, label=${mapping.autoIssueLabel}, authors=${mapping.autoIssueAllowedAuthors?.length ?? 0}` : "none"})`,
        );
        continue;
      }

      const labelLower = mapping.autoIssueLabel.toLowerCase();
      const allowedSet = new Set(
        mapping.autoIssueAllowedAuthors.map((a) => a.toLowerCase()),
      );

      log.log(
        `🔄 AutoIssueService match: ${projectKey} — scanning ${issues.length} issues (label="${labelLower}", authors=${[...allowedSet].join(",")})`,
      );

      for (const issue of issues) {
        const issueTag = `#${issue.number} "${issue.title}"`;

        if (issue.state !== "open") {
          log.log(
            `🔄 AutoIssueService skip: ${issueTag} — state="${issue.state}" (not open)`,
          );
          continue;
        }

        const hasLabel = issue.labels.some(
          (l) => l.name.toLowerCase() === labelLower,
        );
        if (!hasLabel) {
          log.log(
            `🔄 AutoIssueService skip: ${issueTag} — no "${labelLower}" label (has: ${issue.labels.map((l) => l.name).join(", ") || "none"})`,
          );
          continue;
        }

        if (!allowedSet.has(issue.author.toLowerCase())) {
          log.log(
            `🔄 AutoIssueService skip: ${issueTag} — author "${issue.author}" not in allowlist`,
          );
          continue;
        }

        const issueKey = buildIssueKey(projectKey, issue.number);

        const existingLink = issueSessionStore
          .getState()
          .findByIssueKey(issueKey);
        if (existingLink) {
          // Any existing link (processing/completed/failed/cancelled) means
          // this issue was already handled — never re-generate.
          log.log(
            `🔄 AutoIssueService skip: ${issueTag} — existing link (status="${existingLink.status}")`,
          );
          continue;
        }

        const aggIssue = toAggregatedIssue(issue, projectKey, repoInfo);

        log.log(
          `🔄 AutoIssueService: launching session for issue #${issue.number} in ${projectKey}`,
        );

        void launchIssueSession({
          issue: aggIssue,
          machineId,
          repoPath: path,
        });
      }
    }
  }
}

export const autoIssueService = new AutoIssueService();
