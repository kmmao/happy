import fs from "fs/promises";
import os from "os";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

import { ApiClient } from "@/api/api";
import { TrackedSession } from "./types";
import { MachineMetadata, DaemonState, Metadata } from "@/api/types";
import {
  SpawnSessionOptions,
  SpawnSessionResult,
} from "@/modules/common/registerCommonHandlers";
import { logger } from "@/ui/logger";
import { authAndSetupMachineIfNeeded } from "@/ui/auth";
import { configuration } from "@/configuration";
import { startCaffeinate, stopCaffeinate } from "@/utils/caffeinate";
import packageJson from "../../package.json";
import { getEnvironmentInfo } from "@/ui/doctor";
import { spawnHappyCLI } from "@/utils/spawnHappyCLI";
import {
  writeDaemonState,
  DaemonLocallyPersistedState,
  readDaemonState,
  acquireDaemonLock,
  releaseDaemonLock,
  readSettings,
  getActiveProfile,
  getEnvironmentVariables,
  validateProfileForAgent,
  getProfileEnvironmentVariables,
} from "@/persistence";

import {
  cleanupDaemonState,
  isDaemonRunningCurrentlyInstalledHappyVersion,
  stopDaemon,
} from "./controlClient";
import { startDaemonControlServer } from "./controlServer";
import { join } from "path";
import { projectPath } from "@/projectPath";
import {
  getTmuxUtilities,
  isTmuxAvailable,
  parseTmuxSessionIdentifier,
  formatTmuxSessionIdentifier,
} from "@/utils/tmux";
import { expandEnvironmentVariables } from "@/utils/expandEnvVars";
import { cleanupFixWorktree, getFixWorktreeInfo, getResearchRunInfo, forgetResearchRun } from "@/supervisor/handleSupervisorTrigger";
import { AutomationStore } from "@/automation/AutomationStore";
import { GuardianSessionRegistry } from "@/automation/GuardianSessionRegistry";
import { resolveGuardianSession } from "./resolveGuardianSession";
import { AutomationAuditStore } from "@/automation/AutomationAuditStore";
import { deriveAutomationAuditStats, deriveAutomationGuardianUsage } from "@/automation/AutomationAudit";
import { AutomationScheduler } from "@/automation/AutomationScheduler";
import { AgentLoopStore } from "@/automation/AgentLoopStore";
import { AgentLoopCoordinator } from "@/automation/AgentLoopCoordinator";
import { AgentLoopBootstrapStore } from "@/automation/AgentLoopBootstrapStore";
import { AgentLoopBootstrapCoordinator } from "@/automation/AgentLoopBootstrapCoordinator";
import { AutoDreamCoordinator } from "@/automation/AutoDreamCoordinator";
import { AutoDreamStore } from "@/automation/AutoDreamStore";
import { AgentLoopFileWatcher } from "@/automation/AgentLoopFileWatcher";
import { buildLoopEventFromCiTrigger, selectLoopsForCiBridge, selectLoopsForCiBridgeResolved } from "@/automation/AgentLoopCiBridge";
import { buildCiTriggerFromGitHubActionsWebhook } from "@/automation/GitHubActionsCiAdapter";
import { buildLoopEventsFromWebhook, selectLoopsForWebhookBridge } from "@/automation/AgentLoopWebhookBridge";
import { suggestAgentLoops as generateAgentLoopSuggestions } from "@/automation/AgentLoopSuggestion";
import { suggestAgentLoopsWithAI as generateAgentLoopSuggestionsWithAI } from "@/automation/AgentLoopSuggestionAI";
import { TrackedSessionRegistry } from "./TrackedSessionRegistry";
import type { AutomationAuditEvent, AutomationJob } from "@/automation/types";
import { diagnoseAndReportFixStatus } from "@/supervisor/diagnoseFixStatus";
import { detectTailscale, detectTailscaleServe } from "@/utils/tailscale";
import { TunnelManager, TailscaleProvider, UpnpProvider, CaddyProvider } from "@/tunnel";
import { createCodexHomeOverlay } from "@/codex-shared/codexHomeOverlay";
import { filterGuiEnvironmentVariables, isTrustedProfileEnvironment } from "./profileEnvironmentTrust";
import { normalizeResolvedRuntimeProfile } from "@kmmao/happy-wire";
import { detectCliInstallInfo } from "./cliInstallInfo";
import {
  getFilteredDaemonEnvironment,
  resolveStartupScriptEnvironment,
} from "./startupScriptEnvironment";
import {
  getExplicitProfileFallbackError,
  shouldIsolateProfileFromDaemonDefaults,
} from "./profileRuntimeGuard";


const execFileAsync = promisify(execFileCb);
const SESSION_WEBHOOK_TIMEOUT_MS = Math.max(
  15_000,
  Number.parseInt(process.env.HAPPY_SESSION_WEBHOOK_TIMEOUT_MS ?? "90000", 10) || 90_000,
);

// Prepare initial metadata
export const initialMachineMetadata: MachineMetadata = {
  host: os.hostname(),
  platform: os.platform(),
  happyCliVersion: packageJson.version,
  homeDir: os.homedir(),
  happyHomeDir: configuration.happyHomeDir,
  happyLibDir: projectPath(),
};

// Get environment variables for a profile, filtered for agent compatibility
async function getProfileEnvironmentVariablesForAgent(
  profileId: string,
  agentType: "claude" | "codex" | "gemini",
): Promise<Record<string, string>> {
  try {
    const settings = await readSettings();
    const profile = settings.profiles.find((p) => p.id === profileId);

    if (!profile) {
      logger.debug(`[DAEMON RUN] Profile ${profileId} not found`);
      return {};
    }

    // Check if profile is compatible with the agent
    if (!validateProfileForAgent(profile, agentType)) {
      logger.debug(
        `[DAEMON RUN] Profile ${profileId} not compatible with agent ${agentType}`,
      );
      return {};
    }

    // Get environment variables from profile (new schema)
    const envVars = getProfileEnvironmentVariables(profile);

    logger.debug(
      `[DAEMON RUN] Loaded ${Object.keys(envVars).length} environment variables from profile ${profileId} for agent ${agentType}`,
    );
    return envVars;
  } catch (error) {
    logger.debug(
      "[DAEMON RUN] Failed to get profile environment variables:",
      error,
    );
    return {};
  }
}

export async function startDaemon(): Promise<void> {
  // We don't have cleanup function at the time of server construction
  // Control flow is:
  // 1. Create promise that will resolve when shutdown is requested
  // 2. Setup signal handlers to resolve this promise with the source of the shutdown
  // 3. Once our setup is complete - if all goes well - we await this promise
  // 4. When it resolves we can cleanup and exit
  //
  // In case the setup malfunctions - our signal handlers will not properly
  // shut down. We will force exit the process with code 1.
  let requestShutdown: (
    source: "happy-app" | "happy-cli" | "os-signal" | "exception",
    errorMessage?: string,
  ) => void;
  let resolvesWhenShutdownRequested = new Promise<{
    source: "happy-app" | "happy-cli" | "os-signal" | "exception";
    errorMessage?: string;
  }>((resolve) => {
    requestShutdown = (source, errorMessage) => {
      logger.debug(
        `[DAEMON RUN] Requesting shutdown (source: ${source}, errorMessage: ${errorMessage})`,
      );

      // Fallback - in case startup malfunctions - we will force exit the process with code 1
      setTimeout(async () => {
        logger.debug(
          "[DAEMON RUN] Startup malfunctioned, forcing exit with code 1",
        );

        // Give time for logs to be flushed
        await new Promise((resolve) => setTimeout(resolve, 100));

        process.exit(1);
      }, 1_000);

      // Start graceful shutdown
      resolve({ source, errorMessage });
    };
  });

  // Setup signal handlers (use once() to prevent accumulation on restart)
  process.once("SIGINT", () => {
    logger.debug("[DAEMON RUN] Received SIGINT");
    requestShutdown("os-signal");
  });

  process.once("SIGTERM", () => {
    logger.debug("[DAEMON RUN] Received SIGTERM");
    requestShutdown("os-signal");
  });

  process.once("uncaughtException", (error) => {
    logger.debug("[DAEMON RUN] FATAL: Uncaught exception", error);
    logger.debug(`[DAEMON RUN] Stack trace: ${error.stack}`);
    requestShutdown("exception", error.message);
  });

  process.once("unhandledRejection", (reason, promise) => {
    logger.debug("[DAEMON RUN] FATAL: Unhandled promise rejection", reason);
    logger.debug(`[DAEMON RUN] Rejected promise:`, promise);
    const error =
      reason instanceof Error
        ? reason
        : new Error(`Unhandled promise rejection: ${reason}`);
    logger.debug(`[DAEMON RUN] Stack trace: ${error.stack}`);
    requestShutdown("exception", error.message);
  });

  process.once("exit", (code) => {
    logger.debug(`[DAEMON RUN] Process exiting with code: ${code}`);
  });

  process.once("beforeExit", (code) => {
    logger.debug(`[DAEMON RUN] Process about to exit with code: ${code}`);
  });

  logger.debug("[DAEMON RUN] Starting daemon process...");
  logger.debugLargeJson("[DAEMON RUN] Environment", getEnvironmentInfo());

  // Check if already running
  // Check if running daemon version matches current CLI version
  const runningDaemonVersionMatches =
    await isDaemonRunningCurrentlyInstalledHappyVersion();
  if (!runningDaemonVersionMatches) {
    logger.debug(
      "[DAEMON RUN] Daemon version mismatch detected, restarting daemon with current CLI version",
    );
    await stopDaemon();
  } else {
    logger.debug(
      "[DAEMON RUN] Daemon version matches, keeping existing daemon",
    );
    logger.debug("Daemon already running with matching version");
    process.exit(0);
  }

  // Acquire exclusive lock (proves daemon is running)
  const daemonLockHandle = await acquireDaemonLock(5, 200);
  if (!daemonLockHandle) {
    logger.debug(
      "[DAEMON RUN] Daemon lock file already held, another daemon is running",
    );
    process.exit(0);
  }

  // At this point we should be safe to startup the daemon:
  // 1. Not have a stale daemon state
  // 2. Should not have another daemon process running

  try {
    // Start caffeinate
    const caffeinateStarted = startCaffeinate();
    if (caffeinateStarted) {
      logger.debug("[DAEMON RUN] Sleep prevention enabled");
    }

    // Ensure auth and machine registration BEFORE anything else
    const { credentials, machineId } = await authAndSetupMachineIfNeeded();
    logger.debug("[DAEMON RUN] Auth and machine setup complete");

    // Setup state - key by PID
    const pidToTrackedSession = new Map<number, TrackedSession>();

    // Session spawning awaiter system
    const pidToAwaiter = new Map<number, (session: TrackedSession) => void>();
    const guardianSessionRegistry = new GuardianSessionRegistry(
      join(configuration.happyHomeDir, "guardian-sessions.json"),
    );
    await guardianSessionRegistry.load();
    const automationAuditStore = new AutomationAuditStore(
      join(configuration.happyHomeDir, "automation-audit-log.json"),
    );
    await automationAuditStore.load();
    const trackedSessionRegistry = new TrackedSessionRegistry(
      join(configuration.happyHomeDir, "tracked-sessions.json"),
    );
    await trackedSessionRegistry.load();

    const formatDurationMs = (value: number) => {
      if (value < 60_000) {
        return `${Math.round(value / 1_000)}s`;
      }
      if (value < 3_600_000) {
        return `${Math.round(value / 60_000)}m`;
      }
      return `${(value / 3_600_000).toFixed(1)}h`;
    };

    let scheduleAutomationStatePublish = () => {};

    const recordAutomationAuditEvent = async (
      event: Omit<AutomationAuditEvent, "id" | "occurredAt"> & { occurredAt?: number },
    ) => {
      await automationAuditStore.append({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        occurredAt: event.occurredAt ?? Date.now(),
        ...event,
      });
      scheduleAutomationStatePublish();
    };

    const findTrackedSessionByHappySessionId = (sessionId: string) => {
      for (const entry of pidToTrackedSession.values()) {
        if (entry.happySessionId === sessionId) {
          return entry;
        }
      }
      return undefined;
    };

    const requestTrackedSessionTermination = (
      pid: number,
      session: TrackedSession,
      options: {
        reason: string;
        terminalStatus?: "completed" | "failed" | "cancelled";
        terminalError?: string;
      },
    ): boolean => {
      session.terminationRequestedAt = Date.now();
      session.terminationReason = options.reason;
      void recordAutomationAuditEvent({
        kind: options.reason.startsWith("watchdog:") ? "watchdog_stopped" : "session_stop_requested",
        sessionId: session.happySessionId,
        projectId: session.automationContext?.projectId,
        runId: session.automationContext?.runId,
        loopId: session.automationContext?.loopId,
        trigger: session.automationContext?.trigger,
        dedupeKey: session.automationContext?.dedupeKey,
        status: options.terminalStatus,
        message: options.terminalError ?? options.reason,
      });
      if (session.happySessionId && options.terminalStatus) {
        void automationScheduler?.markJobTerminalBySession(
          session.happySessionId,
          options.terminalStatus,
          options.terminalError,
        );
      }

      if (session.tmuxSessionId) {
        const [tmuxSession] = session.tmuxSessionId.split(":");
        const { execFile: execFileCb } = require("child_process");
        execFileCb("tmux", ["kill-session", "-t", tmuxSession], (err: any) => {
          if (err) {
            logger.debug(
              `[DAEMON RUN] Failed to kill tmux session ${tmuxSession}: ${err.message}`,
            );
            try {
              process.kill(pid, "SIGTERM");
            } catch (killError) {
              logger.debug(
                `[DAEMON RUN] Failed to kill fallback PID ${pid}:`,
                killError,
              );
            }
          }
        });
        return true;
      }

      if (session.startedBy === "daemon" && session.childProcess) {
        try {
          session.childProcess.kill("SIGTERM");
          return true;
        } catch (error) {
          logger.debug(
            `[DAEMON RUN] Failed to kill session ${session.happySessionId ?? `PID-${pid}`}:`,
            error,
          );
          return false;
        }
      }

      try {
        process.kill(pid, "SIGTERM");
        return true;
      } catch (error) {
        logger.debug(`[DAEMON RUN] Failed to kill external session PID ${pid}:`, error);
        return false;
      }
    };

    const runAutomationWatchdog = async () => {
      if (!automationScheduler) {
        return;
      }

      const maxRuntimeMs = parseInt(
        process.env.HAPPY_AUTOMATION_WATCHDOG_MAX_RUNTIME_MS ?? `${45 * 60_000}`,
      );
      const maxInactivityMs = parseInt(
        process.env.HAPPY_AUTOMATION_WATCHDOG_MAX_INACTIVITY_MS ?? `${10 * 60_000}`,
      );
      if (maxRuntimeMs <= 0 || maxInactivityMs <= 0) {
        return;
      }

      const now = Date.now();
      for (const job of automationScheduler.getJobsSnapshot()) {
        const isSupervisor = job.kind === "supervisor";
        const isTask = job.kind === "task";
        if (
          (!isSupervisor && !isTask) ||
          job.status !== "running" ||
          (isSupervisor && job.payload.trigger === "fix") ||
          !job.sessionId
        ) {
          continue;
        }

        const trackedSession = findTrackedSessionByHappySessionId(job.sessionId);
        if (!trackedSession) {
          continue;
        }

        const runtimeSince = trackedSession.recoveredAt ?? trackedSession.startedAt ?? job.dispatchedAt ?? job.createdAt;
        const activitySince =
          trackedSession.lastActivityAt ??
          trackedSession.lastOutputAt ??
          trackedSession.recoveredAt ??
          trackedSession.startedAt ??
          job.dispatchedAt ??
          job.createdAt;
        const runtimeMs = now - runtimeSince;
        const inactivityMs = now - activitySince;
        const inactivityExceeded = !trackedSession.recoveredFromIndex && inactivityMs > maxInactivityMs;
        if (runtimeMs <= maxRuntimeMs && !inactivityExceeded) {
          continue;
        }

        const failureReason = runtimeMs > maxRuntimeMs
          ? `Automation watchdog aborted session after ${formatDurationMs(runtimeMs)} of runtime`
          : `Automation watchdog aborted session after ${formatDurationMs(inactivityMs)} of inactivity`;
        logger.warn(
          `[DAEMON RUN] Automation watchdog stopping ${job.kind} session ${job.sessionId} for job ${job.id}: ${failureReason}`,
        );
        if (isSupervisor) {
          await guardianSessionRegistry.forgetSession(job.sessionId).catch((error) => {
            logger.debug(`[DAEMON RUN] Failed to forget guardian session ${job.sessionId}: ${error}`);
          });
        }
        requestTrackedSessionTermination(
          trackedSession.pid,
          trackedSession,
          {
            reason: `watchdog:${job.id}`,
            terminalStatus: "failed",
            terminalError: failureReason,
          },
        );
      }
    };

    // Helper functions
    const getCurrentChildren = () => Array.from(pidToTrackedSession.values());

    const rememberTrackedSession = (session: TrackedSession) => {
      // Schema v2 allows persisting spawn-only pending entries (daemon has
      // spawned a child and knows its spawnId, but the child has not yet
      // posted /session-started with its happySessionId). Require at least
      // one stable identity.
      if (!session.happySessionId && !session.spawnId) {
        return;
      }
      void trackedSessionRegistry.rememberTrackedSession(session).catch((error) => {
        const identity = session.happySessionId ?? `spawn:${session.spawnId}`;
        logger.debug(`[DAEMON RUN] Failed to persist tracked session ${identity}: ${error}`);
      });
    };

    const forgetTrackedSession = (sessionId?: string) => {
      if (!sessionId) {
        return;
      }
      void trackedSessionRegistry.forgetSession(sessionId).catch((error) => {
        logger.debug(`[DAEMON RUN] Failed to forget persisted tracked session ${sessionId}: ${error}`);
      });
    };

    const resolveLikelyRecoverableHappyPid = async (persisted: { pid: number; startedAt?: number; tmuxSessionId?: string }): Promise<number | null> => {
      if (process.platform === "win32") {
        return null;
      }

      const candidatePids: number[] = [];
      const pushCandidate = (pid?: number | null) => {
        if (!pid || !Number.isFinite(pid) || pid <= 0 || candidatePids.includes(pid)) {
          return;
        }
        candidatePids.push(pid);
      };

      pushCandidate(persisted.pid);

      if (persisted.tmuxSessionId) {
        const tmuxInfo = await getTmuxUtilities().getSessionInfoFromString(persisted.tmuxSessionId).catch(() => null);
        if (!tmuxInfo) {
          return null;
        }

        const panePid = await getTmuxUtilities().getPanePidFromSessionIdentifier(persisted.tmuxSessionId).catch(() => null);
        pushCandidate(panePid);
      }

      for (const candidatePid of candidatePids) {
        try {
          process.kill(candidatePid, 0);
        } catch {
          continue;
        }

        try {
          const { stdout } = await execFileAsync("ps", ["-p", String(candidatePid), "-o", "etimes=,command="]);
          const line = stdout.trim();
          const match = line.match(/^(\d+)\s+(.*)$/);
          const elapsedSeconds = match ? Number(match[1]) : 0;
          const command = match ? match[2].trim() : line;
          if (!/(\bhappy\b|index\.mjs|dist_next\/index\.mjs|dist\/index\.mjs)/i.test(command)) {
            continue;
          }
          if (persisted.startedAt) {
            const minimumExpectedAgeSeconds = Math.max(0, Math.floor((Date.now() - persisted.startedAt) / 1000) - 300);
            if (elapsedSeconds < minimumExpectedAgeSeconds) {
              logger.debug(`[DAEMON RUN] PID ${candidatePid} looks newer than persisted session record; refusing reattach`);
              continue;
            }
          }
          return candidatePid;
        } catch (error) {
          logger.debug(`[DAEMON RUN] Failed to inspect PID ${candidatePid} for recovery: ${error}`);
        }
      }

      return null;
    };

    const recoverTrackedSessionsFromIndex = async (): Promise<Set<string>> => {
      const recoveredSessionIds = new Set<string>();
      for (const persisted of trackedSessionRegistry.getAll()) {
        const persistedSessionId = persisted.happySessionId;
        if (pidToTrackedSession.has(persisted.pid)) {
          if (persistedSessionId) {
            recoveredSessionIds.add(persistedSessionId);
          }
          continue;
        }

        const recoveredPid = await resolveLikelyRecoverableHappyPid(persisted);
        if (!recoveredPid) {
          // For task sessions, do not force a terminal status during daemon restart.
          // Scheduler recovery will requeue non-terminal jobs when possible, which
          // avoids spurious "failed" caused only by CLI process restarts/upgrades.
          if (persistedSessionId) {
            await trackedSessionRegistry.forgetSession(persistedSessionId).catch(() => {});
          } else if (persisted.spawnId) {
            await trackedSessionRegistry.forgetSpawn(persisted.spawnId).catch(() => {});
          }
          continue;
        }

        // Pending entries (spawnId only, no session id yet) cannot be re-keyed
        // into pidToTrackedSession with meaningful state — the child still
        // owns the source of truth and will re-register via /session-started.
        // Leave the persisted pending entry alone.
        if (!persistedSessionId) {
          continue;
        }

        const existingRecoveredSession = pidToTrackedSession.get(recoveredPid);
        if (existingRecoveredSession?.happySessionId === persistedSessionId) {
          recoveredSessionIds.add(persistedSessionId);
          continue;
        }

        const recoveredAt = Date.now();
        const trackedSession: TrackedSession = {
          startedBy: persisted.startedBy,
          pid: recoveredPid,
          spawnId: persisted.spawnId,
          happySessionId: persistedSessionId,
          startedAt: persisted.startedAt,
          lastActivityAt: persisted.lastActivityAt,
          lastOutputAt: persisted.lastOutputAt,
          lastHeartbeatAt: persisted.lastHeartbeatAt,
          activity: persisted.activity,
          automationContext: persisted.automationContext,
          tmuxSessionId: persisted.tmuxSessionId,
          directoryCreated: persisted.directoryCreated,
          message: persisted.message,
          recoveredFromIndex: true,
          recoveredAt,
        };
        pidToTrackedSession.set(recoveredPid, trackedSession);
        await trackedSessionRegistry.rememberTrackedSession(trackedSession).catch((error) => {
          logger.debug(`[DAEMON RUN] Failed to refresh persisted tracked session ${persistedSessionId}: ${error}`);
        });
        recoveredSessionIds.add(persistedSessionId);
        void recordAutomationAuditEvent({
          kind: "session_reattached",
          sessionId: persisted.happySessionId,
          projectId: persisted.automationContext?.projectId,
          runId: persisted.automationContext?.runId,
          loopId: persisted.automationContext?.loopId,
          trigger: persisted.automationContext?.trigger,
          dedupeKey: persisted.automationContext?.dedupeKey,
          status: "running",
          message: `Reattached live session on PID ${recoveredPid}${persisted.pid !== recoveredPid ? ` (previous PID ${persisted.pid})` : ""}${persisted.tmuxSessionId ? ` (${persisted.tmuxSessionId})` : ""}`,
        });
        logger.debug(
          `[DAEMON RUN] Reattached persisted session ${persisted.happySessionId} on PID ${recoveredPid}${persisted.pid !== recoveredPid ? ` (previous PID ${persisted.pid})` : ""}`,
        );
      }
      return recoveredSessionIds;
    };

    // Handle webhook from happy session reporting itself
    const onHappySessionWebhook = (
      sessionId: string,
      sessionMetadata: Metadata,
      reportedSpawnId?: string,
    ) => {
      logger.debugLargeJson(`[DAEMON RUN] Session reported`, sessionMetadata);

      const pid = sessionMetadata.hostPid;
      if (!pid) {
        logger.debug(
          `[DAEMON RUN] Session webhook missing hostPid for sessionId: ${sessionId}`,
        );
        return;
      }

      logger.debug(
        `[DAEMON RUN] Session webhook: ${sessionId}, PID: ${pid}, started by: ${sessionMetadata.startedBy || "unknown"}${reportedSpawnId ? `, spawnId: ${reportedSpawnId}` : ""}`,
      );
      logger.debug(
        `[DAEMON RUN] Current tracked sessions before webhook: ${Array.from(pidToTrackedSession.keys()).join(", ")}`,
      );

      // Primary match: in-memory pid map (normal daemon-spawn → webhook path).
      let existingSession = pidToTrackedSession.get(pid);

      // Fallback match: daemon crashed between spawn and /session-started, so
      // the in-memory map is empty but the pending entry persisted in
      // tracked-sessions.json keyed by spawnId. Reconstruct the TrackedSession
      // so automationContext / startedAt / directoryCreated survive the
      // crash-and-restart, and this child isn't mislabeled as externally-started.
      if (!existingSession && reportedSpawnId) {
        const persisted = trackedSessionRegistry.getBySpawnId(reportedSpawnId);
        if (persisted) {
          existingSession = {
            startedBy: persisted.startedBy,
            pid,
            spawnId: persisted.spawnId,
            startedAt: persisted.startedAt,
            lastActivityAt: persisted.lastActivityAt,
            lastOutputAt: persisted.lastOutputAt,
            automationContext: persisted.automationContext,
            tmuxSessionId: persisted.tmuxSessionId,
            directoryCreated: persisted.directoryCreated,
            message: persisted.message,
            recoveredFromIndex: true,
            recoveredAt: Date.now(),
          };
          pidToTrackedSession.set(pid, existingSession);
          logger.debug(
            `[DAEMON RUN] Recovered pending spawn ${reportedSpawnId} from registry on webhook (pid ${pid})`,
          );
        }
      }

      if (existingSession && existingSession.startedBy === "daemon") {
        // Defensive: child should echo back the exact spawnId we injected via
        // HAPPY_SPAWN_ID env var. Mismatch suggests env propagation broke
        // (shell wrapper clobbered env, process re-exec'd with fresh env, etc.).
        // Keep daemon's authoritative spawnId and warn — do not trust the child.
        if (
          reportedSpawnId &&
          existingSession.spawnId &&
          reportedSpawnId !== existingSession.spawnId
        ) {
          logger.debug(
            `[DAEMON RUN] Spawn id mismatch for PID ${pid}: daemon=${existingSession.spawnId}, child reported=${reportedSpawnId}. Keeping daemon's spawnId.`,
          );
        } else if (reportedSpawnId && !existingSession.spawnId) {
          // Old daemon restart + new child — backfill spawnId from webhook.
          existingSession.spawnId = reportedSpawnId;
        }

        // Update daemon-spawned session with reported data
        existingSession.happySessionId = sessionId;
        existingSession.happySessionMetadataFromLocalWebhook = sessionMetadata;
        existingSession.lastActivityAt = Date.now();
        existingSession.recoveredFromIndex = false;
        existingSession.recoveredAt = undefined;
        logger.debug(
          `[DAEMON RUN] Updated daemon-spawned session ${sessionId} with metadata`,
        );

        // Resolve any awaiter for this PID
        const awaiter = pidToAwaiter.get(pid);
        if (awaiter) {
          pidToAwaiter.delete(pid);
          awaiter(existingSession);
          logger.debug(`[DAEMON RUN] Resolved session awaiter for PID ${pid}`);
        }
        rememberTrackedSession(existingSession);
      } else if (!existingSession) {
        // New session started externally. Rare to get a spawnId here — would
        // only happen if HAPPY_SPAWN_ID was set outside the daemon's own spawn
        // path (e.g. user-set manually). Record it anyway for consistency.
        const trackedSession: TrackedSession = {
          startedBy: "happy directly - likely by user from terminal",
          spawnId: reportedSpawnId,
          happySessionId: sessionId,
          happySessionMetadataFromLocalWebhook: sessionMetadata,
          pid,
          startedAt: Date.now(),
          lastActivityAt: Date.now(),
        };
        pidToTrackedSession.set(pid, trackedSession);
        logger.debug(
          `[DAEMON RUN] Registered externally-started session ${sessionId}`,
        );
        rememberTrackedSession(trackedSession);
      }
    };

    // Periodic liveness + activity signal from child — stronger than
    // kill(pid, 0) because a wedged event loop cannot post.
    const onSessionHeartbeat = (params: {
      pid: number;
      happySessionId?: string;
      spawnId?: string;
      activity?: "idle" | "thinking" | "executing" | "blocked";
    }): { known: boolean; keepAlive: boolean } => {
      const existing = pidToTrackedSession.get(params.pid);
      if (!existing) {
        logger.debug(
          `[DAEMON RUN] Heartbeat from unknown PID ${params.pid}${params.spawnId ? ` (spawnId=${params.spawnId})` : ""}`,
        );
        return { known: false, keepAlive: true };
      }
      const now = Date.now();
      existing.lastHeartbeatAt = now;
      existing.lastActivityAt = now;
      if (params.activity) {
        existing.activity = params.activity;
      }
      // Daemon asked for termination via diagnostics kill; signal the child to
      // exit gracefully. kill(pid, SIGTERM) still runs independently, this is
      // just a cooperative nudge.
      const keepAlive = !existing.terminationRequestedAt;
      void rememberTrackedSession(existing);
      return { known: true, keepAlive };
    };

    // Spawn a new session (sessionId reserved for future --resume functionality)
    const spawnSession = async (
      options: SpawnSessionOptions,
    ): Promise<SpawnSessionResult> => {
      logger.debugLargeJson("[DAEMON RUN] Spawning session", options);

      const {
        directory,
        sessionId,
        machineId,
        approvedNewDirectoryCreation = true,
        happySessionId,
        forkSourceId,
        automationContext,
        runtimeProfile: requestedRuntimeProfile,
      } = options;
      const runtimeProfile = normalizeResolvedRuntimeProfile(
        requestedRuntimeProfile,
      );
      let directoryCreated = false;

      if (requestedRuntimeProfile && !runtimeProfile) {
        return {
          type: "error",
          errorMessage: "Runtime profile payload is invalid or unsupported",
        };
      }

      try {
        await fs.access(directory);
        logger.debug(`[DAEMON RUN] Directory exists: ${directory}`);
      } catch (error) {
        logger.debug(
          `[DAEMON RUN] Directory doesn't exist, creating: ${directory}`,
        );

        // Check if directory creation is approved
        if (!approvedNewDirectoryCreation) {
          logger.debug(
            `[DAEMON RUN] Directory creation not approved for: ${directory}`,
          );
          return {
            type: "requestToApproveDirectoryCreation",
            directory,
          };
        }

        try {
          await fs.mkdir(directory, { recursive: true });
          logger.debug(
            `[DAEMON RUN] Successfully created directory: ${directory}`,
          );
          directoryCreated = true;
        } catch (mkdirError: any) {
          let errorMessage = `Unable to create directory at '${directory}'. `;

          // Provide more helpful error messages based on the error code
          if (mkdirError.code === "EACCES") {
            errorMessage += `Permission denied. You don't have write access to create a folder at this location. Try using a different path or check your permissions.`;
          } else if (mkdirError.code === "ENOTDIR") {
            errorMessage += `A file already exists at this path or in the parent path. Cannot create a directory here. Please choose a different location.`;
          } else if (mkdirError.code === "ENOSPC") {
            errorMessage += `No space left on device. Your disk is full. Please free up some space and try again.`;
          } else if (mkdirError.code === "EROFS") {
            errorMessage += `The file system is read-only. Cannot create directories here. Please choose a writable location.`;
          } else {
            errorMessage += `System error: ${mkdirError.message || mkdirError}. Please verify the path is valid and you have the necessary permissions.`;
          }

          logger.debug(
            `[DAEMON RUN] Directory creation failed: ${errorMessage}`,
          );
          return {
            type: "error",
            errorMessage,
          };
        }
      }

      let cleanupSessionResources: (() => Promise<void>) | undefined;
      try {
        // Build environment variables with explicit precedence layers:
        // Layer 1 (base): Authentication tokens - protected, cannot be overridden
        // Layer 2 (middle): Profile environment variables - GUI profile OR CLI local profile
        // Layer 3 (top): Auth tokens again to ensure they're never overridden

        // Layer 1: Resolve authentication token if provided
        const authEnv: Record<string, string> = {};
        if (options.token) {
          if (options.agent === "codex") {
            const codexHomeOverlay = await createCodexHomeOverlay({
              authJson: options.token,
              sourceHome: process.env.CODEX_HOME || join(os.homedir(), ".codex"),
            });
            authEnv.CODEX_HOME = codexHomeOverlay.path;
            cleanupSessionResources = codexHomeOverlay.cleanup;
          } else {
            // Assuming claude
            authEnv.CLAUDE_CODE_OAUTH_TOKEN = options.token;
          }
        }

        // Layer 2: Profile environment variables
        // Priority: GUI-provided profile > CLI local active profile > none
        // IMPORTANT: Distinguish between undefined (no profile selected) and {} (profile selected but empty)
        // When GUI explicitly provides environmentVariables (even empty {}), NEVER fallback to CLI local profile
        let profileEnv: Record<string, string> = {};
        const guiProfileProvided =
          runtimeProfile !== undefined ||
          options.environmentVariables !== undefined;

        // ── Trust check: Does the GUI provide a profileId? ──
        // If profileId is present, the request came from the App's profile system
        // (built-in or user-configured). The RPC channel is E2E encrypted, so only
        // authorized App users can send requests. Trust the profile and allow
        // operator-only env vars (ANTHROPIC_BASE_URL, etc.) to pass through.
        // Supervisor-triggered runs also qualify here because the server already
        // resolved the selected profile into env vars before asking the daemon to spawn.
        // Without either trust signal, ad-hoc env vars are still filtered for safety.
        const profileTrusted = isTrustedProfileEnvironment(options);
        if (profileTrusted) {
          logger.info(
            runtimeProfile?.profileId || options.profileId
              ? `[DAEMON RUN] Profile ${runtimeProfile?.profileId ?? options.profileId} provided — trusted runtime profile, operator-only env vars allowed`
              : `[DAEMON RUN] Trusted runtime profile env provided — operator-only env vars allowed`,
          );
        }

        // Layer 2a: Load profile API env vars from local settings when profileId is provided
        // This handles supervisor triggers where profileId is set but environmentVariables
        // only contains operational vars (HAPPY_INITIAL_PROMPT_FILE etc.), not API config.
        const runtimeProfileEnvCount = Object.keys(
          runtimeProfile?.environmentVariables ?? {},
        ).length;
        if (options.profileId && runtimeProfileEnvCount === 0) {
          try {
            const profileVars = await getProfileEnvironmentVariablesForAgent(
              options.profileId,
              options.agent || "claude",
            );
            const profileVarCount = Object.keys(profileVars).length;
            if (profileVarCount > 0) {
              profileEnv = profileVars;
              logger.info(
                `[DAEMON RUN] Loaded ${profileVarCount} env vars from profile ${options.profileId} (keys: ${Object.keys(profileVars).join(", ")})`,
              );
            } else {
              logger.debug(
                `[DAEMON RUN] Profile ${options.profileId} has no env vars (built-in or empty)`,
              );
            }
          } catch (error) {
            logger.debug(
              `[DAEMON RUN] Failed to load profile ${options.profileId} env vars:`,
              error,
            );
          }
        }

        if (guiProfileProvided) {
          // GUI explicitly provided environment variables (may be profile API vars or operational vars)
          // Security: Only strip operator-only keys when the daemon operator has already
          // set them in process.env AND the profile is NOT trusted (not in local settings).
          // Trusted profiles (configured by operator) are allowed to override operator-only vars.
          const raw = {
            ...(runtimeProfile?.environmentVariables ?? {}),
            ...(options.environmentVariables ?? {}),
          };
          const {
            environmentVariables: guiVars,
            stripped,
          } = filterGuiEnvironmentVariables(raw, options);
          if (stripped.length > 0) {
            logger.warn(
              `[DAEMON RUN] Security: Stripped ${stripped.length} operator-only env vars from GUI profile (daemon already has them, profile untrusted): ${stripped.join(", ")}`,
            );
          }
          // Merge: profile API vars first, then GUI-provided vars on top (GUI overrides)
          profileEnv = { ...profileEnv, ...guiVars };
          const varCount = Object.keys(profileEnv).length;
          logger.info(
            `[DAEMON RUN] Using merged profile environment variables (${varCount} vars)`,
          );
          logger.debug(
            `[DAEMON RUN] Merged env var keys: ${Object.keys(profileEnv).join(", ") || "(none)"}`,
          );
        } else {
          // No GUI profile provided — fallback to CLI local active profile
          try {
            const settings = await readSettings();
            if (settings.activeProfileId) {
              logger.debug(
                `[DAEMON RUN] No GUI profile provided, loading CLI local active profile: ${settings.activeProfileId}`,
              );

              // Get profile environment variables filtered for agent compatibility
              profileEnv = await getProfileEnvironmentVariablesForAgent(
                settings.activeProfileId,
                options.agent || "claude",
              );

              logger.debug(
                `[DAEMON RUN] Loaded ${Object.keys(profileEnv).length} environment variables from CLI local profile for agent ${options.agent || "claude"}`,
              );
              logger.debug(
                `[DAEMON RUN] CLI profile env var keys: ${Object.keys(profileEnv).join(", ")}`,
              );
            } else {
              logger.debug("[DAEMON RUN] No CLI local active profile set");
            }
          } catch (error) {
            logger.debug(
              "[DAEMON RUN] Failed to load CLI local profile environment variables:",
              error,
            );
            // Continue without profile env vars - this is not a fatal error
          }
        }

        const startupBashScript = runtimeProfile?.startupBashScript?.trim();
        const explicitProfileFallbackError = getExplicitProfileFallbackError({
          profileId: options.profileId,
          runtimeProfile,
          resolvedProfileEnv: profileEnv,
          startupBashScript,
        });
        if (explicitProfileFallbackError) {
          logger.warn(`[DAEMON RUN] ${explicitProfileFallbackError}`);
          return {
            type: "error",
            errorMessage: explicitProfileFallbackError,
          };
        }

        // Final merge: Profile vars first, then auth (auth takes precedence to protect authentication)
        let extraEnv = { ...profileEnv, ...authEnv };

        // If spawning Claude and profile did not set ANTHROPIC_MODEL, inherit from daemon's env
        // ONLY when no GUI profile was explicitly provided (to avoid overriding profile's model choice)
        // (e.g. daemon started via dev:local-server with .env.dev-local-server)
        if (
          !guiProfileProvided &&
          (options.agent === "claude" || !options.agent) &&
          !extraEnv.ANTHROPIC_MODEL &&
          process.env.ANTHROPIC_MODEL
        ) {
          extraEnv.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL;
          logger.debug(
            `[DAEMON RUN] Using ANTHROPIC_MODEL from daemon env: ${extraEnv.ANTHROPIC_MODEL}`,
          );
        }

        logger.debug(
          `[DAEMON RUN] Final environment variable keys (before expansion) (${Object.keys(extraEnv).length}): ${Object.keys(extraEnv).join(", ")}`,
        );

        // Expand ${VAR} references from daemon's process.env
        // This ensures variable substitution works in both tmux and non-tmux modes
        // Example: ANTHROPIC_AUTH_TOKEN="${Z_AI_AUTH_TOKEN}" → ANTHROPIC_AUTH_TOKEN="sk-real-key"
        extraEnv = expandEnvironmentVariables(extraEnv, process.env);
        logger.debug(
          `[DAEMON RUN] After variable expansion: ${Object.keys(extraEnv).join(", ")}`,
        );

        const filteredDaemonEnv = getFilteredDaemonEnvironment(process.env, {
          excludeOperatorOnlyVars: shouldIsolateProfileFromDaemonDefaults({
            profileId: options.profileId,
            runtimeProfile,
          }),
        });
        let sessionScopedEnv = { ...extraEnv };
        if (startupBashScript) {
          try {
            const startupScriptEnv = await resolveStartupScriptEnvironment({
              cwd: directory,
              startupBashScript,
              baseEnv: {
                ...filteredDaemonEnv,
                ...sessionScopedEnv,
              },
            });
            sessionScopedEnv = {
              ...sessionScopedEnv,
              ...startupScriptEnv,
              ...authEnv,
            };
            logger.info(
              `[DAEMON RUN] Applied startup bash script from runtime profile${runtimeProfile?.profileId ? ` ${runtimeProfile.profileId}` : ""}`,
            );
            if (Object.keys(startupScriptEnv).length > 0) {
              logger.debug(
                `[DAEMON RUN] Startup script updated env vars: ${Object.keys(startupScriptEnv).join(", ")}`,
              );
            }
          } catch (error) {
            const errorMessage = `Startup bash script failed: ${error instanceof Error ? error.message : String(error)}`;
            logger.warn(`[DAEMON RUN] ${errorMessage}`);
            return {
              type: "error",
              errorMessage,
            };
          }
        }

        // Daemon-generated spawn id — pre-registry key that's stable before the
        // child posts /session-started with its server-assigned happySessionId.
        // Injected as HAPPY_SPAWN_ID env var so any of the 4 runners can read
        // it uniformly without touching CLI arg parsing.
        const spawnId: string = randomUUID();
        const finalSessionEnv: Record<string, string> = {
          ...filteredDaemonEnv,
          ...sessionScopedEnv,
          HAPPY_SPAWN_ID: spawnId,
        };

        // Fail-fast validation: Check that any auth variables present are fully expanded
        // Only validate variables that are actually set (different agents need different auth)
        const potentialAuthVars = [
          "ANTHROPIC_AUTH_TOKEN",
          "CLAUDE_CODE_OAUTH_TOKEN",
          "OPENAI_API_KEY",
          "CODEX_HOME",
          "AZURE_OPENAI_API_KEY",
          "TOGETHER_API_KEY",
        ];
        const unexpandedAuthVars = potentialAuthVars.filter((varName) => {
          const value = finalSessionEnv[varName];
          // Only fail if variable IS SET and contains unexpanded ${VAR} references
          return value && typeof value === "string" && value.includes("${");
        });

        if (unexpandedAuthVars.length > 0) {
          // Extract the specific missing variable names from unexpanded references
          const missingVarDetails = unexpandedAuthVars.map((authVar) => {
            const value = finalSessionEnv[authVar];
            const unresolvedMatch = value?.match(
              /\$\{([A-Z_][A-Z0-9_]*)(:-[^}]*)?\}/,
            );
            const missingVar = unresolvedMatch ? unresolvedMatch[1] : "unknown";
            return `${authVar} references \${${missingVar}} which is not defined`;
          });

          const errorMessage =
            `Authentication will fail - environment variables not found in daemon: ${missingVarDetails.join("; ")}. ` +
            `Ensure these variables are set in the daemon's environment (not just your shell) before starting sessions.`;
          logger.warn(`[DAEMON RUN] ${errorMessage}`);
          return {
            type: "error",
            errorMessage,
          };
        }

        // Check if tmux is available and should be used
        const tmuxAvailable = await isTmuxAvailable();
        let useTmux = tmuxAvailable;

        // Get tmux session name from environment variables (now set by profile system)
        // Empty string means "use current/most recent session" (tmux default behavior)
        let tmuxSessionName: string | undefined = sessionScopedEnv.TMUX_SESSION_NAME;

        // If tmux is not available or session name is explicitly undefined, fall back to regular spawning
        // Note: Empty string is valid (means use current/most recent tmux session)
        if (!tmuxAvailable || tmuxSessionName === undefined) {
          useTmux = false;
          if (tmuxSessionName !== undefined) {
            logger.debug(
              `[DAEMON RUN] tmux session name specified but tmux not available, falling back to regular spawning`,
            );
          }
        }

        if (useTmux && tmuxSessionName !== undefined) {
          // Try to spawn in tmux session
          const sessionDesc = tmuxSessionName || "current/most recent session";
          logger.debug(
            `[DAEMON RUN] Attempting to spawn session in tmux: ${sessionDesc}`,
          );

          const tmux = getTmuxUtilities(tmuxSessionName);

          // Construct command for the CLI
          const cliPath = join(projectPath(), "dist", "index.mjs");
          // Determine agent command - support claude, codex, and gemini
          const agent =
            options.agent === "gemini"
              ? "gemini"
              : options.agent === "codex"
                ? "codex"
                : "claude";
          const resumeArg =
            sessionId && /^[0-9a-f-]+$/i.test(sessionId)
              ? ` --resume ${sessionId}`
              : "";
          const happySessionArg = happySessionId
            ? ` --happy-session-id ${happySessionId}`
            : "";
          const forkSourceArg = forkSourceId
            ? ` --happy-fork-source ${forkSourceId}`
            : "";
          // Build --claude-env args for tmux command so profile env vars survive
          // Claude Code SDK settings.json overrides
          const claudeEnvArgs = Object.entries(sessionScopedEnv)
            .map(([key, value]) => {
              // Escape single quotes in values for shell safety
              const escaped = value.replace(/'/g, "'\\''");
              return ` --claude-env '${key}=${escaped}'`;
            })
            .join("");
          const fullCommand = `node --no-warnings --no-deprecation ${cliPath} ${agent} --happy-starting-mode remote --started-by daemon${resumeArg}${happySessionArg}${forkSourceArg}${claudeEnvArgs}`;

          // Spawn in tmux with environment variables
          // IMPORTANT: Pass complete environment (process.env + extraEnv) because:
          // 1. tmux sessions need daemon's expanded auth variables (e.g., ANTHROPIC_AUTH_TOKEN)
          // 2. Regular spawn uses env: { ...process.env, ...extraEnv }
          // 3. tmux needs explicit environment via -e flags to ensure all variables are available
          const windowName = `happy-${Date.now()}-${agent}`;
          const tmuxResult = await tmux.spawnInTmux(
            [fullCommand],
            {
              sessionName: tmuxSessionName,
              windowName: windowName,
              cwd: directory,
            },
            finalSessionEnv,
          ); // Pass complete environment for tmux session

          if (tmuxResult.success) {
            logger.debug(
              `[DAEMON RUN] Successfully spawned in tmux session: ${tmuxResult.sessionId}, PID: ${tmuxResult.pid}`,
            );

            // Validate we got a PID from tmux
            if (!tmuxResult.pid) {
              throw new Error("Tmux window created but no PID returned");
            }

            // Create a tracked session for tmux windows - now we have the real PID!
            const trackedSession: TrackedSession = {
              startedBy: "daemon",
              spawnId,
              pid: tmuxResult.pid, // Real PID from tmux -P flag
              tmuxSessionId: tmuxResult.sessionId,
              startedAt: Date.now(),
              lastActivityAt: Date.now(),
              automationContext,
              directoryCreated,
              cleanup: cleanupSessionResources,
              message: directoryCreated
                ? `The path '${directory}' did not exist. We created a new folder and spawned a new session in tmux session '${tmuxSessionName}'. Use 'tmux attach -t ${tmuxSessionName}' to view the session.`
                : `Spawned new session in tmux session '${tmuxSessionName}'. Use 'tmux attach -t ${tmuxSessionName}' to view the session.`,
            };

            // Add to tracking map so webhook can find it later
            pidToTrackedSession.set(tmuxResult.pid, trackedSession);
            // Pre-register pending entry keyed by spawnId so crashes before
            // /session-started don't leave the daemon blind to this child.
            await trackedSessionRegistry.rememberTrackedSession(trackedSession).catch((error) => {
              logger.debug(`[DAEMON RUN] Failed to pre-register spawn ${spawnId}: ${error}`);
            });

            // Wait for webhook to populate session with happySessionId (exact same as regular flow)
            logger.debug(
              `[DAEMON RUN] Waiting for session webhook for PID ${tmuxResult.pid} (tmux)`,
            );

            return new Promise((resolve) => {
              // Set timeout for webhook (same as regular flow)
              const timeout = setTimeout(() => {
                pidToAwaiter.delete(tmuxResult.pid!);
                logger.debug(
                  `[DAEMON RUN] Session webhook timeout for PID ${tmuxResult.pid} (tmux)`,
                );
                resolve({
                  type: "error",
                  errorMessage: `Session webhook timeout for PID ${tmuxResult.pid} (tmux)`,
                });
              }, SESSION_WEBHOOK_TIMEOUT_MS);

              // Register awaiter for tmux session (exact same as regular flow)
              pidToAwaiter.set(tmuxResult.pid!, (completedSession) => {
                clearTimeout(timeout);
                logger.debug(
                  `[DAEMON RUN] Session ${completedSession.happySessionId} fully spawned with webhook (tmux)`,
                );
                resolve({
                  type: "success",
                  sessionId: completedSession.happySessionId!,
                });
              });
            });
          } else {
            logger.debug(
              `[DAEMON RUN] Failed to spawn in tmux: ${tmuxResult.error}, falling back to regular spawning`,
            );
            useTmux = false;
          }
        }

        // Regular process spawning (fallback or if tmux not available)
        if (!useTmux) {
          logger.debug(`[DAEMON RUN] Using regular process spawning`);

          // Construct arguments for the CLI - support claude, codex, and gemini
          let agentCommand: string;
          switch (options.agent) {
            case "claude":
            case undefined:
              agentCommand = "claude";
              break;
            case "codex":
              agentCommand = "codex";
              break;
            case "gemini":
              agentCommand = "gemini";
              break;
            default:
              return {
                type: "error",
                errorMessage: `Unsupported agent type: '${options.agent}'. Please update your CLI to the latest version.`,
              };
          }
          const args = [
            agentCommand,
            "--happy-starting-mode",
            "remote",
            "--started-by",
            "daemon",
          ];

          // Resume existing Claude Code session if sessionId provided
          if (sessionId && /^[0-9a-f-]+$/i.test(sessionId)) {
            args.push("--resume", sessionId);
            logger.debug(
              `[DAEMON RUN] Adding --resume ${sessionId} to spawn args`,
            );
          }

          // Reconnect to existing Happy session if happySessionId provided
          if (happySessionId) {
            args.push("--happy-session-id", happySessionId);
            logger.debug(
              `[DAEMON RUN] Adding --happy-session-id ${happySessionId} to spawn args`,
            );
          }

          // Mark fork sessions with source session ID for diagnostics
          if (forkSourceId) {
            args.push("--happy-fork-source", forkSourceId);
            logger.debug(
              `[DAEMON RUN] Adding --happy-fork-source ${forkSourceId} to spawn args`,
            );
          }

          // Pass profile env vars via --claude-env so they survive
          // Claude Code SDK settings.json overrides (SDK reads ~/.claude/settings.json
          // and may overwrite process.env values set by the profile)
          for (const [key, value] of Object.entries(sessionScopedEnv)) {
            args.push("--claude-env", `${key}=${value}`);
          }

          const happyProcess = spawnHappyCLI(args, {
            cwd: directory,
            detached: true, // Sessions stay alive when daemon stops
            stdio: ["ignore", "pipe", "pipe"], // Capture stdout/stderr for debugging
            env: finalSessionEnv,
          });

          happyProcess.stdout?.on("data", (data) => {
            const trackedSession = happyProcess.pid
              ? pidToTrackedSession.get(happyProcess.pid)
              : undefined;
            if (trackedSession) {
              trackedSession.lastOutputAt = Date.now();
              trackedSession.lastActivityAt = Date.now();
            }
            if (process.env.DEBUG) {
              logger.debug(`[DAEMON RUN] Child stdout: ${data.toString()}`);
            }
          });
          happyProcess.stderr?.on("data", (data) => {
            const trackedSession = happyProcess.pid
              ? pidToTrackedSession.get(happyProcess.pid)
              : undefined;
            if (trackedSession) {
              trackedSession.lastOutputAt = Date.now();
              trackedSession.lastActivityAt = Date.now();
            }
            if (process.env.DEBUG) {
              logger.debug(`[DAEMON RUN] Child stderr: ${data.toString()}`);
            }
          });

          if (!happyProcess.pid) {
            await cleanupSessionResources?.();
            logger.debug(
              "[DAEMON RUN] Failed to spawn process - no PID returned",
            );
            return {
              type: "error",
              errorMessage: "Failed to spawn Happy process - no PID returned",
            };
          }

          logger.debug(
            `[DAEMON RUN] Spawned process with PID ${happyProcess.pid}`,
          );

          const trackedSession: TrackedSession = {
            startedBy: "daemon",
            spawnId,
            pid: happyProcess.pid,
            childProcess: happyProcess,
            startedAt: Date.now(),
            lastActivityAt: Date.now(),
            automationContext,
            directoryCreated,
            cleanup: cleanupSessionResources,
            message: directoryCreated
              ? `The path '${directory}' did not exist. We created a new folder and spawned a new session there.`
              : undefined,
          };

          pidToTrackedSession.set(happyProcess.pid, trackedSession);
          // Pre-register pending entry keyed by spawnId so crashes before
          // /session-started don't leave the daemon blind to this child.
          await trackedSessionRegistry.rememberTrackedSession(trackedSession).catch((error) => {
            logger.debug(`[DAEMON RUN] Failed to pre-register spawn ${spawnId}: ${error}`);
          });

          happyProcess.on("exit", (code, signal) => {
            logger.debug(
              `[DAEMON RUN] Child PID ${happyProcess.pid} exited with code ${code}, signal ${signal}`,
            );
            if (happyProcess.pid) {
              onChildExited(happyProcess.pid, code, signal);
            }
          });

          happyProcess.on("error", (error) => {
            logger.debug(`[DAEMON RUN] Child process error:`, error);
            if (happyProcess.pid) {
              onChildExited(happyProcess.pid, null, null);
            }
          });

          // Wait for webhook to populate session with happySessionId
          logger.debug(
            `[DAEMON RUN] Waiting for session webhook for PID ${happyProcess.pid}`,
          );

          return new Promise((resolve) => {
            // Set timeout for webhook
            const timeout = setTimeout(() => {
              pidToAwaiter.delete(happyProcess.pid!);
              logger.debug(
                `[DAEMON RUN] Session webhook timeout for PID ${happyProcess.pid}`,
              );
              resolve({
                type: "error",
                errorMessage: `Session webhook timeout for PID ${happyProcess.pid}`,
              });
              // 15 second timeout - I have seen timeouts on 10 seconds
              // even though session was still created successfully in ~2 more seconds
            }, SESSION_WEBHOOK_TIMEOUT_MS);

            // Register awaiter
            pidToAwaiter.set(happyProcess.pid!, (completedSession) => {
              clearTimeout(timeout);
              logger.debug(
                `[DAEMON RUN] Session ${completedSession.happySessionId} fully spawned with webhook`,
              );
              resolve({
                type: "success",
                sessionId: completedSession.happySessionId!,
              });
            });
          });
        }

        // This should never be reached, but TypeScript requires a return statement
        return {
          type: "error",
          errorMessage: "Unexpected error in session spawning",
        };
      } catch (error) {
        await cleanupSessionResources?.();
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.debug("[DAEMON RUN] Failed to spawn session:", error);
        return {
          type: "error",
          errorMessage: `Failed to spawn session: ${errorMessage}`,
        };
      }
    };

    // Stop a session by sessionId or PID fallback
    const stopSession = (sessionId: string): boolean => {
      logger.debug(`[DAEMON RUN] Attempting to stop session ${sessionId}`);

      for (const [pid, session] of pidToTrackedSession.entries()) {
        if (
          session.happySessionId === sessionId ||
          (sessionId.startsWith("PID-") &&
            pid === parseInt(sessionId.replace("PID-", "")))
        ) {
          const stopped = requestTrackedSessionTermination(pid, session, {
            reason: "user-stop",
            terminalStatus: "cancelled",
            terminalError: "Cancelled from daemon session stop",
          });
          if (stopped) {
            logger.debug(`[DAEMON RUN] Termination requested for session ${sessionId}`);
          }
          return stopped;
        }
      }

      logger.debug(`[DAEMON RUN] Session ${sessionId} not found`);
      return false;
    };

    // Handle child process exit
    const onChildExited = (pid: number, code?: number | null, signal?: NodeJS.Signals | null) => {
      logger.debug(
        `[DAEMON RUN] Removing exited process PID ${pid} from tracking`,
      );
      const session = pidToTrackedSession.get(pid);
      pidToTrackedSession.delete(pid);
      pidToAwaiter.delete(pid);

      if (!session) {
        return;
      }

      if (session.cleanup) {
        void session.cleanup().catch((error) => {
          logger.debug(
            `[DAEMON RUN] Failed to cleanup daemon session resources for PID ${pid}:`,
            error,
          );
        });
      }

      const terminationWasRequested = session.terminationRequestedAt != null;
      const terminalStatus = session.terminationReason?.startsWith("watchdog:")
        ? "failed"
        : terminationWasRequested || signal === "SIGTERM" || signal === "SIGINT"
          ? "cancelled"
          : code != null && code !== 0
            ? "failed"
            : "completed";
      const terminalError = terminalStatus === "failed"
        ? session.terminationReason?.startsWith("watchdog:")
          ? session.terminationReason
          : `Session exited with code ${code ?? "unknown"}${signal ? ` (signal ${signal})` : ""}`
        : undefined;
      if (session.happySessionId) {
        void automationScheduler?.markJobTerminalBySession(
          session.happySessionId,
          terminalStatus,
          terminalError,
        );
      } else if (session.automationContext?.dedupeKey) {
        // Fallback for delayed/missing local webhook: still finalize automation state.
        void automationScheduler?.markJobTerminalByDedupeKey(
          session.automationContext.dedupeKey,
          terminalStatus,
          terminalError,
        );
        if (session.automationContext.kind === "task") {
          void recordAutomationAuditEvent({
            kind: "task_terminal_dedupe_fallback",
            dedupeKey: session.automationContext.dedupeKey,
            projectId: session.automationContext.projectId,
            trigger: session.automationContext.trigger ?? "task",
            status: terminalStatus,
            message:
              terminalError
              ?? `pid=${pid} exited without happySessionId; terminal via dedupeKey`,
          });
        }
      }
      if (!session.happySessionId) {
        return;
      }
      void agentLoopCoordinator?.onJobTerminal({
        loopId: session.automationContext?.kind === "agent_loop" ? session.automationContext?.loopId : undefined,
        status: terminalStatus,
        sessionId: session.happySessionId,
        errorMessage: terminalError,
      });
      void recordAutomationAuditEvent({
        kind: "job_terminal",
        sessionId: session.happySessionId,
        projectId: session.automationContext?.projectId,
        runId: session.automationContext?.runId,
        loopId: session.automationContext?.loopId,
        trigger: session.automationContext?.trigger,
        dedupeKey: session.automationContext?.dedupeKey,
        status: terminalStatus,
        message: terminalError,
      });
      void guardianSessionRegistry.forgetSession(session.happySessionId).catch((error) => {
        logger.debug(`[DAEMON RUN] Failed to forget guardian session ${session.happySessionId}: ${error}`);
      });
      forgetTrackedSession(session.happySessionId);

      const fixInfo = getFixWorktreeInfo(session.happySessionId);
      if (fixInfo) {
        setTimeout(() => {
          diagnoseAndReportFixStatus({
            sessionId: session.happySessionId!,
            repoPath: fixInfo.repoPath,
            branchName: fixInfo.branchName,
            parentBranch: fixInfo.parentBranch,
            actionId: fixInfo.actionId,
            projectId: fixInfo.projectId,
            fixMode: fixInfo.fixMode,
            emitFixStatus: (data) => emitSupervisorFixStatus(data),
          }).catch((err) => {
            logger.debug(`[DAEMON RUN] Fix status diagnosis failed: ${err}`);
          }).finally(() => {
            cleanupFixWorktree(session.happySessionId!).catch((err) => {
              logger.warn(`[DAEMON RUN] Fix worktree cleanup failed for session ${session.happySessionId}: ${err.message}`);
            });
          });
        }, 3_000);
      } else {
        cleanupFixWorktree(session.happySessionId).catch((err) => {
          logger.warn(`[DAEMON RUN] Fix worktree cleanup failed for session ${session.happySessionId}: ${err.message}`);
        });
      }

      // Fallback for research/analysis runs: the session reports completion via an
      // HTTP callback (curl inside Claude). That path updates the server DB but never
      // notifies the daemon's local AutomationScheduler, leaving the local job stuck
      // as "running". Emit the daemon-side status after a short delay so the local
      // job is finalised. The server ignores the emit if the run is already terminal.
      const researchInfo = getResearchRunInfo(session.happySessionId);
      if (researchInfo) {
        forgetResearchRun(session.happySessionId);
        const researchFinalStatus = terminalStatus === "cancelled" ? "cancelled" : terminalStatus;
        setTimeout(() => {
          logger.debug(
            `[DAEMON RUN] Emitting fallback ${researchFinalStatus} for research run ${researchInfo.runId} (session ${session.happySessionId})`,
          );
          emitSupervisorRunStatus({
            runId: researchInfo.runId,
            projectId: researchInfo.projectId,
            status: researchFinalStatus,
            errorMessage: terminalStatus === "failed" ? (terminalError ?? "Session exited with error") : undefined,
          });
        }, 5_000);
      }
    };

    const emptyAutomationCounts = () => ({
      queued: 0,
      dispatching: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    });

    let automationScheduler: AutomationScheduler | null = null;
    let agentLoopCoordinator: AgentLoopCoordinator | null = null;
    let agentLoopBootstrapCoordinator: AgentLoopBootstrapCoordinator | null = null;
    let agentLoopFileWatcher: AgentLoopFileWatcher | null = null;
    let autoDreamCoordinator: AutoDreamCoordinator | null = null;
    const getAutomationStatusSnapshot = () => {
      const jobs = automationScheduler?.getJobsSnapshot() ?? [];
      const trackedSessionsBySessionId = new Map(
        Array.from(pidToTrackedSession.values())
          .filter((session): session is TrackedSession & { happySessionId: string } => Boolean(session.happySessionId))
          .map((session) => [session.happySessionId, session]),
      );
      const guardians = guardianSessionRegistry.getSnapshot().map((guardian) => {
        const tracked = trackedSessionsBySessionId.get(guardian.sessionId);
        return {
          ...guardian,
          attached: Boolean(tracked),
          recovered: tracked?.recoveredFromIndex,
        };
      });
      const jobsWithRecovery = jobs.map((job) => ({
        ...job,
        recovered: job.sessionId ? trackedSessionsBySessionId.get(job.sessionId)?.recoveredFromIndex : undefined,
      }));
      const allAuditEvents = automationAuditStore.getAll();
      const recentAuditEvents = allAuditEvents.slice(0, 50);
      const guardianUsage = deriveAutomationGuardianUsage(allAuditEvents, guardians);
      const auditStats = deriveAutomationAuditStats(allAuditEvents, guardians);
      const counts = jobs.reduce<Record<string, number>>((acc, job) => {
        acc[job.status] = (acc[job.status] ?? 0) + 1;
        return acc;
      }, emptyAutomationCounts());
      return { counts, jobs: jobsWithRecovery, guardians, guardianUsage, auditStats, recentAuditEvents };
    };
    const getAutomationStateSummary = () => {
      const { counts, jobs, guardians, guardianUsage, auditStats, recentAuditEvents } = getAutomationStatusSnapshot();
      const allLoops = agentLoopCoordinator?.listLoopsSync() ?? [];
      return {
        updatedAt: Date.now(),
        counts: {
          queued: counts.queued ?? 0,
          dispatching: counts.dispatching ?? 0,
          running: counts.running ?? 0,
          completed: counts.completed ?? 0,
          failed: counts.failed ?? 0,
          cancelled: counts.cancelled ?? 0,
        },
        recentJobs: jobs
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 10)
          .map(({ payload, ...job }) => job),
        guardians,
        guardianUsage,
        auditStats,
        recentAuditEvents: recentAuditEvents.slice(0, 20),
        loops: allLoops.map((loop) => ({
          id: loop.id,
          name: loop.name,
          directory: loop.directory,
          enabled: loop.enabled,
          intervalMs: loop.intervalMs,
          cronExpression: loop.cronExpression,
          iteration: loop.iteration,
          nextRunAt: loop.nextRunAt,
          runtimeState: loop.runtimeState,
          phase: loop.phase,
          lastTriggerSource: loop.lastTriggerSource,
          lastBriefSummary: loop.lastBriefSummary,
          lastError: loop.lastError,
          agent: loop.agent,
        })),
        bootstrapProfiles: (agentLoopBootstrapCoordinator?.listProfilesSync() ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          rootDirectory: p.rootDirectory,
          intervalMs: p.intervalMs,
          enabled: p.enabled,
          status: p.status,
          statusUpdatedAt: p.statusUpdatedAt,
          lastRunAt: p.lastRunAt,
          lastRepoCount: p.lastRepoCount,
          lastSuggestionCount: p.lastSuggestionCount,
          lastError: p.lastError,
        })),
        autoDreamProfiles: (autoDreamCoordinator?.listProfilesSync() ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          rootDirectory: p.rootDirectory,
          intervalMs: p.intervalMs,
          enabled: p.enabled,
          nextRunAt: p.nextRunAt,
          status: p.status,
          stage: p.stage,
          statusUpdatedAt: p.statusUpdatedAt,
          lastRunAt: p.lastRunAt,
          lastMemoryFiles: p.lastMemoryFiles,
          lastError: p.lastError,
        })),
      };
    };

    // Start control server
    const { port: controlPort, stop: stopControlServer } =
      await startDaemonControlServer({
        getChildren: getCurrentChildren,
        stopSession,
        spawnSession,
        requestShutdown: () => requestShutdown("happy-cli"),
        onHappySessionWebhook,
        onSessionHeartbeat,
        getAutomationStatus: () => getAutomationStatusSnapshot(),
        cancelAutomationJob: async (jobId) => {
          if (!automationScheduler) {
            return {
              success: false,
              errorMessage: "Automation scheduler is not ready",
            };
          }
          return automationScheduler.cancelJob(jobId);
        },
        retryAutomationJob: async (jobId) => {
          if (!automationScheduler) {
            return {
              success: false,
              errorMessage: "Automation scheduler is not ready",
            };
          }
          return automationScheduler.retryJob(jobId);
        },
        clearAutomationJobs: async () => {
          if (!automationScheduler) {
            return {
              success: false,
              errorMessage: "Automation scheduler is not ready",
            };
          }
          return automationScheduler.clearTerminalJobs();
        },
        clearAutomationGuardians: async (params) => {
          try {
            if (params?.clearAll) {
              await guardianSessionRegistry.clear();
              await recordAutomationAuditEvent({ kind: "guardian_cleared", message: "Cleared all guardian sessions" });
            } else if (params?.key) {
              await guardianSessionRegistry.forgetKey(params.key);
              await recordAutomationAuditEvent({ kind: "guardian_cleared", guardianKey: params.key, sessionId: params.sessionId, message: `Cleared guardian ${params.key}` });
            } else if (params?.sessionId) {
              await guardianSessionRegistry.forgetSession(params.sessionId);
              await recordAutomationAuditEvent({ kind: "guardian_cleared", sessionId: params.sessionId, message: `Cleared guardian session ${params.sessionId}` });
            } else {
              return { success: false, errorMessage: "No guardian clear target provided" };
            }
            scheduleAutomationStatePublish();
            return { success: true };
          } catch (error) {
            return { success: false, errorMessage: error instanceof Error ? error.message : String(error) };
          }
        },
        clearAutomationAudit: async () => {
          try {
            await automationAuditStore.clear();
            scheduleAutomationStatePublish();
            return { success: true };
          } catch (error) {
            return { success: false, errorMessage: error instanceof Error ? error.message : String(error) };
          }
        },
        setKillswitch: async (enabled: boolean) => {
          agentLoopCoordinator?.setKilled(enabled);
          automationScheduler?.setKilled(enabled);
          // Persist killed state in daemon state
          await apiMachine.updateDaemonState((state: DaemonState | null) => ({
            ...state,
            status: state?.status ?? "running",
            killed: enabled,
          }));
          logger.debug(`[DAEMON RUN] Killswitch ${enabled ? "activated" : "deactivated"}`);
          return { success: true, killed: enabled };
        },
        getKillswitch: () => ({
          killed: agentLoopCoordinator?.killed ?? false,
        }),
        listAgentLoops: async () => {
          return agentLoopCoordinator?.listLoops() ?? [];
        },
        getAgentLoop: async (loopId) => {
          return agentLoopCoordinator?.getLoop(loopId);
        },
        createAgentLoop: async (input) => {
          if (!agentLoopCoordinator) {
            return { success: false, errorMessage: "Agent loop coordinator is not ready" };
          }
          const result = await agentLoopCoordinator.createLoop(input);
          scheduleAutomationStatePublish();
          return result;
        },
        updateAgentLoop: async (loopId, input) => {
          if (!agentLoopCoordinator) {
            return { success: false, errorMessage: "Agent loop coordinator is not ready" };
          }
          const result = await agentLoopCoordinator.updateLoop(loopId, input);
          scheduleAutomationStatePublish();
          return result;
        },
        pauseAgentLoop: async (loopId) => {
          if (!agentLoopCoordinator) {
            return { success: false, errorMessage: "Agent loop coordinator is not ready" };
          }
          const result = await agentLoopCoordinator.pauseLoop(loopId);
          scheduleAutomationStatePublish();
          return result;
        },
        resumeAgentLoop: async (loopId) => {
          if (!agentLoopCoordinator) {
            return { success: false, errorMessage: "Agent loop coordinator is not ready" };
          }
          const result = await agentLoopCoordinator.resumeLoop(loopId);
          scheduleAutomationStatePublish();
          return result;
        },
        runAgentLoopNow: async (loopId) => {
          if (!agentLoopCoordinator) {
            return { success: false, errorMessage: "Agent loop coordinator is not ready" };
          }
          const result = await agentLoopCoordinator.runNow(loopId);
          scheduleAutomationStatePublish();
          return result;
        },
        removeAgentLoop: async (loopId) => {
          if (!agentLoopCoordinator) {
            return { success: false, errorMessage: "Agent loop coordinator is not ready" };
          }
          await guardianSessionRegistry.forgetKey(`agent-loop:${loopId}`).catch(() => {});
          const result = await agentLoopCoordinator.removeLoop(loopId);
          scheduleAutomationStatePublish();
          return result;
        },
        emitAgentLoopEvent: async (loopId, input) => {
          if (!agentLoopCoordinator) {
            return { success: false, errorMessage: "Agent loop coordinator is not ready" };
          }
          const result = await agentLoopCoordinator.emitEvent(loopId, input);
          scheduleAutomationStatePublish();
          return result;
        },
        emitGitHubActionsWebhook: async (input) => {
          if (!agentLoopCoordinator) {
            return { success: false, errorMessage: "Agent loop coordinator is not ready" };
          }
          try {
            let repoPath = input.repoPath;
            if (!repoPath && input.targetLoopId) {
              const loop = await agentLoopCoordinator.getLoop(input.targetLoopId);
              repoPath = loop?.directory;
            }
            const payload = buildCiTriggerFromGitHubActionsWebhook({
              eventName: input.eventName,
              payload: input.payload,
              repoPath,
              targetLoopId: input.targetLoopId,
            });
            if (!payload) {
              return { success: false, errorMessage: "Unsupported or invalid GitHub Actions webhook payload" };
            }
            const loops = await agentLoopCoordinator.listLoops();
            const matchingLoops = await selectLoopsForCiBridgeResolved(loops, payload);
            for (const loop of matchingLoops) {
              const event = buildLoopEventFromCiTrigger(payload);
              const result = await agentLoopCoordinator.emitEvent(loop.id, event);
              if (!result.success) {
                logger.debug(`[DAEMON RUN] Failed to bridge github-actions webhook into loop ${loop.id}: ${result.errorMessage ?? "unknown error"}`);
              }
            }
            scheduleAutomationStatePublish();
            return { success: true };
          } catch (error) {
            return { success: false, errorMessage: error instanceof Error ? error.message : String(error) };
          }
        },
        emitCiTrigger: async (input) => {
          if (!agentLoopCoordinator) {
            return { success: false, errorMessage: "Agent loop coordinator is not ready" };
          }
          try {
            const payload = { type: "ci-trigger" as const, ...input };
            const loops = await agentLoopCoordinator.listLoops();
            const matchingLoops = await selectLoopsForCiBridgeResolved(loops, payload);
            for (const loop of matchingLoops) {
              const event = buildLoopEventFromCiTrigger(payload);
              const result = await agentLoopCoordinator.emitEvent(loop.id, event);
              if (!result.success) {
                logger.debug(`[DAEMON RUN] Failed to bridge ci-trigger into loop ${loop.id}: ${result.errorMessage ?? "unknown error"}`);
              }
            }
            scheduleAutomationStatePublish();
            return { success: true };
          } catch (error) {
            return { success: false, errorMessage: error instanceof Error ? error.message : String(error) };
          }
        },
        suggestAgentLoops: async (input) => {
          return generateAgentLoopSuggestions(input, await agentLoopCoordinator?.listLoops() ?? []);
        },
        suggestAgentLoopsWithAI: async (input) => {
          return generateAgentLoopSuggestionsWithAI(input, await agentLoopCoordinator?.listLoops() ?? []);
        },
        listAgentLoopBootstrapProfiles: async () => {
          return agentLoopBootstrapCoordinator?.listProfiles() ?? [];
        },
        getAgentLoopBootstrapProfile: async (profileIdValue) => {
          return agentLoopBootstrapCoordinator?.getProfile(profileIdValue);
        },
        createAgentLoopBootstrapProfile: async (input) => {
          if (!agentLoopBootstrapCoordinator) {
            return { success: false, errorMessage: "Bootstrap coordinator is not ready" };
          }
          const result = await agentLoopBootstrapCoordinator.createProfile(input);
          scheduleAutomationStatePublish();
          return result;
        },
        updateAgentLoopBootstrapProfile: async (profileIdValue, input) => {
          if (!agentLoopBootstrapCoordinator) {
            return { success: false, errorMessage: "Bootstrap coordinator is not ready" };
          }
          const result = await agentLoopBootstrapCoordinator.updateProfile(profileIdValue, input);
          scheduleAutomationStatePublish();
          return result;
        },
        pauseAgentLoopBootstrapProfile: async (profileIdValue) => {
          if (!agentLoopBootstrapCoordinator) {
            return { success: false, errorMessage: "Bootstrap coordinator is not ready" };
          }
          const result = await agentLoopBootstrapCoordinator.pauseProfile(profileIdValue);
          scheduleAutomationStatePublish();
          return result;
        },
        resumeAgentLoopBootstrapProfile: async (profileIdValue) => {
          if (!agentLoopBootstrapCoordinator) {
            return { success: false, errorMessage: "Bootstrap coordinator is not ready" };
          }
          const result = await agentLoopBootstrapCoordinator.resumeProfile(profileIdValue);
          scheduleAutomationStatePublish();
          return result;
        },
        runAgentLoopBootstrapProfileNow: async (profileIdValue) => {
          if (!agentLoopBootstrapCoordinator) {
            return { success: false, errorMessage: "Bootstrap coordinator is not ready" };
          }
          const result = await agentLoopBootstrapCoordinator.runNow(profileIdValue);
          scheduleAutomationStatePublish();
          return result;
        },
        removeAgentLoopBootstrapProfile: async (profileIdValue) => {
          if (!agentLoopBootstrapCoordinator) {
            return { success: false, errorMessage: "Bootstrap coordinator is not ready" };
          }
          const result = await agentLoopBootstrapCoordinator.removeProfile(profileIdValue);
          scheduleAutomationStatePublish();
          return result;
        },
        listAutoDreamProfiles: async () => autoDreamCoordinator?.listProfiles() ?? [],
        getAutoDreamProfile: async (profileIdValue) => autoDreamCoordinator?.getProfile(profileIdValue),
        createAutoDreamProfile: async (input) => {
          if (!autoDreamCoordinator) return { success: false, errorMessage: "Auto-Dream coordinator is not ready" };
          const result = await autoDreamCoordinator.createProfile(input);
          scheduleAutomationStatePublish();
          return result;
        },
        updateAutoDreamProfile: async (profileIdValue, input) => {
          if (!autoDreamCoordinator) return { success: false, errorMessage: "Auto-Dream coordinator is not ready" };
          const result = await autoDreamCoordinator.updateProfile(profileIdValue, input);
          scheduleAutomationStatePublish();
          return result;
        },
        pauseAutoDreamProfile: async (profileIdValue) => {
          if (!autoDreamCoordinator) return { success: false, errorMessage: "Auto-Dream coordinator is not ready" };
          const result = await autoDreamCoordinator.pauseProfile(profileIdValue);
          scheduleAutomationStatePublish();
          return result;
        },
        resumeAutoDreamProfile: async (profileIdValue) => {
          if (!autoDreamCoordinator) return { success: false, errorMessage: "Auto-Dream coordinator is not ready" };
          const result = await autoDreamCoordinator.resumeProfile(profileIdValue);
          scheduleAutomationStatePublish();
          return result;
        },
        runAutoDreamProfileNow: async (profileIdValue) => {
          if (!autoDreamCoordinator) return { success: false, errorMessage: "Auto-Dream coordinator is not ready" };
          const result = await autoDreamCoordinator.runNow(profileIdValue);
          scheduleAutomationStatePublish();
          return result;
        },
        removeAutoDreamProfile: async (profileIdValue) => {
          if (!autoDreamCoordinator) return { success: false, errorMessage: "Auto-Dream coordinator is not ready" };
          const result = await autoDreamCoordinator.removeProfile(profileIdValue);
          scheduleAutomationStatePublish();
          return result;
        },
      });

    // Write initial daemon state (no lock needed for state file)
    const fileState: DaemonLocallyPersistedState = {
      pid: process.pid,
      httpPort: controlPort,
      startTime: new Date().toLocaleString(),
      startedWithCliVersion: packageJson.version,
      daemonLogPath: logger.logFilePath,
    };
    writeDaemonState(fileState);
    logger.debug("[DAEMON RUN] Daemon state written");

    // Detect Tailscale (non-blocking, 3s timeout each)
    const tailscaleBase = await detectTailscale();
    const tailscaleServes = tailscaleBase.status === "connected"
      ? await detectTailscaleServe()
      : [];
    const tailscaleInfo = { ...tailscaleBase, serves: tailscaleServes };
    logger.debug(`[DAEMON RUN] Tailscale: ${tailscaleInfo.status}, serves: ${tailscaleServes.length}`);

    // Detect all tunnel providers
    const tunnelManager = new TunnelManager([new TailscaleProvider(), new UpnpProvider(), new CaddyProvider()]);
    const tunnelState = await tunnelManager.detectAll();
    logger.debug(`[DAEMON RUN] Tunnels: ${tunnelState.providers.length} providers, ${tunnelState.providers.reduce((n, p) => n + p.entries.length, 0)} entries`);
    const cliInstall = await detectCliInstallInfo();
    logger.debug(`[DAEMON RUN] CLI install source: ${cliInstall.source}, self-upgrade: ${cliInstall.canSelfUpgrade}`);

    // Prepare initial daemon state
    const initialDaemonState: DaemonState = {
      status: "offline",
      pid: process.pid,
      httpPort: controlPort,
      startTime: Date.now(),
      startedAt: Date.now(),
      startedWithCliVersion: packageJson.version,
      tailscale: tailscaleInfo,
      tunnels: tunnelState,
      automation: getAutomationStateSummary(),
      cliInstall,
    };

    // Create API client
    const api = await ApiClient.create(credentials);

    // Get or create machine
    const machine = await api.getOrCreateMachine({
      machineId,
      metadata: initialMachineMetadata,
      daemonState: initialDaemonState,
    });
    logger.debug(`[DAEMON RUN] Machine registered: ${machine.id}`);

    // Create realtime machine session
    const apiMachine = api.machineSyncClient(machine);
    apiMachine.setTailscaleInfo(tailscaleInfo);
    apiMachine.setTunnelManager(tunnelManager);

    // Set RPC handlers
    // Heartbeat silence threshold — 4.5× the 20 s heartbeat interval. Anything
    // longer than this without a heartbeat is assumed to be wedged / zombified.
    const STALE_HEARTBEAT_MS = 90_000;

    const listStaleSessions = async () => {
      const now = Date.now();
      const stale: Array<{
        pid: number;
        happySessionId?: string;
        spawnId?: string;
        startedAt?: number;
        lastHeartbeatAt?: number;
        lastActivityAt?: number;
        tmuxSessionId?: string;
        reason: "dead" | "silent";
        silentMs?: number;
      }> = [];
      for (const [pid, session] of pidToTrackedSession) {
        let dead = false;
        try {
          process.kill(pid, 0);
        } catch {
          dead = true;
        }
        if (dead) {
          stale.push({
            pid,
            happySessionId: session.happySessionId,
            spawnId: session.spawnId,
            startedAt: session.startedAt,
            lastHeartbeatAt: session.lastHeartbeatAt,
            lastActivityAt: session.lastActivityAt,
            tmuxSessionId: session.tmuxSessionId,
            reason: "dead",
          });
          continue;
        }
        if (
          session.lastHeartbeatAt &&
          now - session.lastHeartbeatAt > STALE_HEARTBEAT_MS
        ) {
          stale.push({
            pid,
            happySessionId: session.happySessionId,
            spawnId: session.spawnId,
            startedAt: session.startedAt,
            lastHeartbeatAt: session.lastHeartbeatAt,
            lastActivityAt: session.lastActivityAt,
            tmuxSessionId: session.tmuxSessionId,
            reason: "silent",
            silentMs: now - session.lastHeartbeatAt,
          });
        }
      }
      return { stale, checkedAt: now, thresholdMs: STALE_HEARTBEAT_MS };
    };

    const cleanStaleSessions = async (params: { pids: number[] }) => {
      let killed = 0;
      const errors: Array<{ pid: number; error: string }> = [];
      for (const pid of params.pids) {
        const session = pidToTrackedSession.get(pid);
        // Safety: only kill pids we know about. Prevents this RPC from being
        // used to kill arbitrary processes on the machine.
        if (!session) {
          errors.push({ pid, error: "pid not tracked by daemon" });
          continue;
        }
        // Mark for graceful exit so any in-flight heartbeat from this child
        // sees keepAlive=false and can clean up before SIGTERM lands.
        session.terminationRequestedAt = Date.now();
        try {
          process.kill(pid, "SIGTERM");
          killed += 1;
        } catch (error) {
          // EPERM or ESRCH — process already dead or unkillable; still clean
          // up our registry entry below.
          errors.push({
            pid,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        // Drop from in-memory + persisted registry regardless of kill outcome.
        pidToTrackedSession.delete(pid);
        if (session.happySessionId) {
          await trackedSessionRegistry
            .forgetSession(session.happySessionId)
            .catch(() => {});
        } else if (session.spawnId) {
          await trackedSessionRegistry
            .forgetSpawn(session.spawnId)
            .catch(() => {});
        }
      }
      return { killed, errors };
    };

    apiMachine.setRPCHandlers({
      spawnSession,
      stopSession,
      requestShutdown: () => requestShutdown("happy-app"),
      getAutomationStatus: () => getAutomationStatusSnapshot(),
      cancelAutomationJob: async (jobId) => {
        if (!automationScheduler) {
          return { success: false, errorMessage: "Automation scheduler is not ready" };
        }
        return automationScheduler.cancelJob(jobId);
      },
      retryAutomationJob: async (jobId) => {
        if (!automationScheduler) {
          return { success: false, errorMessage: "Automation scheduler is not ready" };
        }
        return automationScheduler.retryJob(jobId);
      },
      clearAutomationJobs: async () => {
        if (!automationScheduler) {
          return { success: false, errorMessage: "Automation scheduler is not ready" };
        }
        return automationScheduler.clearTerminalJobs();
      },
      clearAutomationGuardians: async (params) => {
        try {
          if (params?.clearAll) {
            await guardianSessionRegistry.clear();
            await recordAutomationAuditEvent({ kind: "guardian_cleared", message: "Cleared all guardian sessions" });
          } else if (params?.key) {
            await guardianSessionRegistry.forgetKey(params.key);
            await recordAutomationAuditEvent({ kind: "guardian_cleared", guardianKey: params.key, sessionId: params.sessionId, message: `Cleared guardian ${params.key}` });
          } else if (params?.sessionId) {
            await guardianSessionRegistry.forgetSession(params.sessionId);
            await recordAutomationAuditEvent({ kind: "guardian_cleared", sessionId: params.sessionId, message: `Cleared guardian session ${params.sessionId}` });
          } else {
            return { success: false, errorMessage: "No guardian clear target provided" };
          }
          scheduleAutomationStatePublish();
          return { success: true };
        } catch (error) {
          return { success: false, errorMessage: error instanceof Error ? error.message : String(error) };
        }
      },
      clearAutomationAudit: async () => {
        try {
          await automationAuditStore.clear();
          scheduleAutomationStatePublish();
          return { success: true };
        } catch (error) {
          return { success: false, errorMessage: error instanceof Error ? error.message : String(error) };
        }
      },
      setKillswitch: async (enabled: boolean) => {
        agentLoopCoordinator?.setKilled(enabled);
        automationScheduler?.setKilled(enabled);
        await apiMachine.updateDaemonState((state: DaemonState | null) => ({
          ...state,
          status: state?.status ?? "running",
          killed: enabled,
        }));
        logger.debug(`[DAEMON RUN] Killswitch ${enabled ? "activated" : "deactivated"} (via socket)`);
        return { success: true, killed: enabled };
      },
      getKillswitch: () => ({
        killed: agentLoopCoordinator?.killed ?? false,
      }),
      listAgentLoops: async () => {
        return agentLoopCoordinator?.listLoops() ?? [];
      },
      getAgentLoop: async (loopId) => {
        return agentLoopCoordinator?.getLoop(loopId);
      },
      createAgentLoop: async (input) => {
        if (!agentLoopCoordinator) {
          return { success: false, errorMessage: "Agent loop coordinator is not ready" };
        }
        const result = await agentLoopCoordinator.createLoop(input);
        scheduleAutomationStatePublish();
        return result;
      },
      updateAgentLoop: async (loopId, input) => {
        if (!agentLoopCoordinator) {
          return { success: false, errorMessage: "Agent loop coordinator is not ready" };
        }
        const result = await agentLoopCoordinator.updateLoop(loopId, input);
        scheduleAutomationStatePublish();
        return result;
      },
      pauseAgentLoop: async (loopId) => {
        if (!agentLoopCoordinator) {
          return { success: false, errorMessage: "Agent loop coordinator is not ready" };
        }
        const result = await agentLoopCoordinator.pauseLoop(loopId);
        scheduleAutomationStatePublish();
        return result;
      },
      resumeAgentLoop: async (loopId) => {
        if (!agentLoopCoordinator) {
          return { success: false, errorMessage: "Agent loop coordinator is not ready" };
        }
        const result = await agentLoopCoordinator.resumeLoop(loopId);
        scheduleAutomationStatePublish();
        return result;
      },
      runAgentLoopNow: async (loopId) => {
        if (!agentLoopCoordinator) {
          return { success: false, errorMessage: "Agent loop coordinator is not ready" };
        }
        const result = await agentLoopCoordinator.runNow(loopId);
        scheduleAutomationStatePublish();
        return result;
      },
      removeAgentLoop: async (loopId) => {
        if (!agentLoopCoordinator) {
          return { success: false, errorMessage: "Agent loop coordinator is not ready" };
        }
        await guardianSessionRegistry.forgetKey(`agent-loop:${loopId}`).catch(() => {});
        const result = await agentLoopCoordinator.removeLoop(loopId);
        scheduleAutomationStatePublish();
        return result;
      },
      emitAgentLoopEvent: async (loopId, input) => {
        if (!agentLoopCoordinator) {
          return { success: false, errorMessage: "Agent loop coordinator is not ready" };
        }
        const result = await agentLoopCoordinator.emitEvent(loopId, input);
        scheduleAutomationStatePublish();
        return result;
      },
      suggestAgentLoops: async (input) => {
        return generateAgentLoopSuggestions(input, await agentLoopCoordinator?.listLoops() ?? []);
      },
      listAgentLoopBootstrapProfiles: async () => {
        return agentLoopBootstrapCoordinator?.listProfiles() ?? [];
      },
      getAgentLoopBootstrapProfile: async (profileIdValue) => {
        return agentLoopBootstrapCoordinator?.getProfile(profileIdValue);
      },
      createAgentLoopBootstrapProfile: async (input) => {
        if (!agentLoopBootstrapCoordinator) {
          return { success: false, errorMessage: "Bootstrap coordinator is not ready" };
        }
        const result = await agentLoopBootstrapCoordinator.createProfile(input);
        scheduleAutomationStatePublish();
        return result;
      },
      updateAgentLoopBootstrapProfile: async (profileIdValue, input) => {
        if (!agentLoopBootstrapCoordinator) {
          return { success: false, errorMessage: "Bootstrap coordinator is not ready" };
        }
        const result = await agentLoopBootstrapCoordinator.updateProfile(profileIdValue, input);
        scheduleAutomationStatePublish();
        return result;
      },
      pauseAgentLoopBootstrapProfile: async (profileIdValue) => {
        if (!agentLoopBootstrapCoordinator) {
          return { success: false, errorMessage: "Bootstrap coordinator is not ready" };
        }
        const result = await agentLoopBootstrapCoordinator.pauseProfile(profileIdValue);
        scheduleAutomationStatePublish();
        return result;
      },
      resumeAgentLoopBootstrapProfile: async (profileIdValue) => {
        if (!agentLoopBootstrapCoordinator) {
          return { success: false, errorMessage: "Bootstrap coordinator is not ready" };
        }
        const result = await agentLoopBootstrapCoordinator.resumeProfile(profileIdValue);
        scheduleAutomationStatePublish();
        return result;
      },
      runAgentLoopBootstrapProfileNow: async (profileIdValue) => {
        if (!agentLoopBootstrapCoordinator) {
          return { success: false, errorMessage: "Bootstrap coordinator is not ready" };
        }
        const result = await agentLoopBootstrapCoordinator.runNow(profileIdValue);
        scheduleAutomationStatePublish();
        return result;
      },
      removeAgentLoopBootstrapProfile: async (profileIdValue) => {
        if (!agentLoopBootstrapCoordinator) {
          return { success: false, errorMessage: "Bootstrap coordinator is not ready" };
        }
        const result = await agentLoopBootstrapCoordinator.removeProfile(profileIdValue);
        scheduleAutomationStatePublish();
        return result;
      },
      listAutoDreamProfiles: async () => autoDreamCoordinator?.listProfiles() ?? [],
      getAutoDreamProfile: async (profileIdValue) => autoDreamCoordinator?.getProfile(profileIdValue),
      createAutoDreamProfile: async (input) => {
        if (!autoDreamCoordinator) return { success: false, errorMessage: "Auto-Dream coordinator is not ready" };
        const result = await autoDreamCoordinator.createProfile(input);
        scheduleAutomationStatePublish();
        return result;
      },
      updateAutoDreamProfile: async (profileIdValue, input) => {
        if (!autoDreamCoordinator) return { success: false, errorMessage: "Auto-Dream coordinator is not ready" };
        const result = await autoDreamCoordinator.updateProfile(profileIdValue, input);
        scheduleAutomationStatePublish();
        return result;
      },
      pauseAutoDreamProfile: async (profileIdValue) => {
        if (!autoDreamCoordinator) return { success: false, errorMessage: "Auto-Dream coordinator is not ready" };
        const result = await autoDreamCoordinator.pauseProfile(profileIdValue);
        scheduleAutomationStatePublish();
        return result;
      },
      resumeAutoDreamProfile: async (profileIdValue) => {
        if (!autoDreamCoordinator) return { success: false, errorMessage: "Auto-Dream coordinator is not ready" };
        const result = await autoDreamCoordinator.resumeProfile(profileIdValue);
        scheduleAutomationStatePublish();
        return result;
      },
      runAutoDreamProfileNow: async (profileIdValue) => {
        if (!autoDreamCoordinator) return { success: false, errorMessage: "Auto-Dream coordinator is not ready" };
        const result = await autoDreamCoordinator.runNow(profileIdValue);
        scheduleAutomationStatePublish();
        return result;
      },
      removeAutoDreamProfile: async (profileIdValue) => {
        if (!autoDreamCoordinator) return { success: false, errorMessage: "Auto-Dream coordinator is not ready" };
        const result = await autoDreamCoordinator.removeProfile(profileIdValue);
        scheduleAutomationStatePublish();
        return result;
      },
      listStaleSessions,
      cleanStaleSessions,
    });

    // Provide active session IDs to the client so it can re-sync with the server on reconnect.
    apiMachine.setSessionSyncProvider(() =>
      Array.from(pidToTrackedSession.values())
        .map((s) => s.happySessionId)
        .filter((id): id is string => Boolean(id))
    );

    // Provide a cleanup handler that gracefully terminates all child processes
    // if the server has been unreachable for too long (default 5 min).
    apiMachine.setDisconnectCleanupHandler(() => {
      for (const [pid, session] of pidToTrackedSession.entries()) {
        requestTrackedSessionTermination(pid, session, {
          reason: "server-disconnect-timeout",
          terminalStatus: "failed",
          terminalError: "Server disconnected for too long; session terminated",
        });
      }
    });

    // Connect to server
    apiMachine.connect();

    // Brief ring buffer — keeps last 20 briefs for DaemonState push
    const MAX_RECENT_BRIEFS = 20;
    const recentBriefs: Array<{
      loopId: string;
      loopName?: string;
      status: "completed" | "failed" | "cancelled";
      summary: string;
      detail: string;
      generatedAt: number;
      sessionId?: string;
    }> = [];
    const addBrief = (brief: {
      loopId: string;
      loopName?: string;
      status: "completed" | "failed" | "cancelled";
      summary: string;
      detail: string;
      generatedAt: number;
      sessionId?: string;
    }) => {
      recentBriefs.unshift(brief);
      if (recentBriefs.length > MAX_RECENT_BRIEFS) {
        recentBriefs.length = MAX_RECENT_BRIEFS;
      }
      scheduleAutomationStatePublish();
    };

    let automationPublishTimer: NodeJS.Timeout | null = null;
    const publishAutomationState = async () => {
      try {
        await apiMachine.updateDaemonState((state: DaemonState | null) => ({
          ...state,
          status: state?.status ?? "running",
          automation: getAutomationStateSummary(),
          recentBriefs: recentBriefs.length > 0 ? [...recentBriefs] : undefined,
        }));
      } catch (error) {
        logger.debug("[DAEMON RUN] Failed to publish automation state", error);
      }
    };
    scheduleAutomationStatePublish = () => {
      if (automationPublishTimer) {
        return;
      }
      automationPublishTimer = setTimeout(() => {
        automationPublishTimer = null;
        void publishAutomationState();
      }, 250);
    };

    const emitWebhookStatus = (statusData: {
      webhookEventId: string;
      status: "dispatched" | "completed" | "failed";
      sessionId?: string;
      errorMessage?: string;
    }) => {
      apiMachine.emitWebhookStatus(statusData);
      if (statusData.status === "completed" && statusData.sessionId) {
        void recordAutomationAuditEvent({
          kind: "job_session_started",
          dedupeKey: `webhook:${statusData.webhookEventId}`,
          sessionId: statusData.sessionId,
          trigger: "webhook",
          status: "running",
        });
      }
      if (statusData.status === "failed") {
        void automationScheduler?.markJobTerminalByDedupeKey(
          "webhook:" + statusData.webhookEventId,
          "failed",
          statusData.errorMessage,
        );
      }
    };
    const emitSupervisorRunStatus = (statusData: {
      runId: string;
      projectId: string;
      status: "queued" | "running" | "completed" | "failed" | "cancelled";
      sessionId?: string;
      actionsCount?: number;
      issuesCreated?: number;
      errorMessage?: string;
      currentDimension?: string;
      dimensionIndex?: number;
      totalDimensions?: number;
      actions?: readonly {
        severity: "critical" | "high" | "medium" | "low";
        category: string;
        title: string;
        description: string;
        suggestedFix?: string;
      }[];
    }) => {
      apiMachine.emitSupervisorRunStatus(statusData);
      if (statusData.status === "running" && statusData.sessionId) {
        void recordAutomationAuditEvent({
          kind: "job_session_started",
          dedupeKey: `supervisor:${statusData.runId}`,
          sessionId: statusData.sessionId,
          projectId: statusData.projectId,
          runId: statusData.runId,
          status: statusData.status,
        });
      }
      if (statusData.status === "completed" || statusData.status === "failed" || statusData.status === "cancelled") {
        void automationScheduler?.markJobTerminalByDedupeKey(
          "supervisor:" + statusData.runId,
          statusData.status,
          statusData.errorMessage,
        );
      }
    };
    const emitSupervisorFixStatus = (statusData: {
      actionId: string;
      projectId: string;
      fixStatus: "queued" | "running" | "completed" | "failed" | "cancelled" | "analyzed";
      fixSessionId?: string;
    }) => {
      apiMachine.emitSupervisorFixStatus(statusData);
      if (statusData.fixStatus === "completed" || statusData.fixStatus === "failed" || statusData.fixStatus === "cancelled" || statusData.fixStatus === "analyzed") {
        void automationScheduler?.markJobTerminalByDedupeKey(
          "supervisor:" + statusData.actionId,
          statusData.fixStatus === "failed" ? "failed" : statusData.fixStatus === "cancelled" ? "cancelled" : "completed",
        );
      }
    };

    const automationStore = new AutomationStore(
      join(configuration.happyHomeDir, "automation-jobs.json"),
    );
    const recoveredRunningSessionIds = await recoverTrackedSessionsFromIndex();

    automationScheduler = new AutomationScheduler({
      store: automationStore,
      runnerDeps: {
        webhook: {
          spawnSession,
          emitWebhookStatus,
        },
        supervisor: {
          spawnSession,
          emitSupervisorRunStatus,
          emitSupervisorFixStatus,
          serverUrl: configuration.serverUrl,
          resolveGuardianSessionId: (data) => {
            const rawResolved = guardianSessionRegistry.resolveForSupervisor(data);
            const guardianKey = data.loopId ? `loop:${data.loopId}` : `project:${data.projectId}`;
            const resolved = resolveGuardianSession({
              candidateSessionId: rawResolved,
              isSessionTracked: (sessionId) => Boolean(findTrackedSessionByHappySessionId(sessionId)),
              forgetSession: (sessionId) => {
                void guardianSessionRegistry.forgetSession(sessionId).catch((error) => {
                  logger.debug(`[DAEMON RUN] Failed to forget stale guardian session ${sessionId}: ${error}`);
                });
              },
              onStaleSession: (sessionId) => {
                void recordAutomationAuditEvent({
                  kind: "guardian_cleared",
                  projectId: data.projectId,
                  runId: data.runId,
                  loopId: data.loopId,
                  trigger: data.trigger,
                  sessionId,
                  guardianKey,
                  guardianSessionId: sessionId,
                  message: `Forgot stale guardian session ${sessionId}`,
                });
              },
            });
            if (resolved) {
              void recordAutomationAuditEvent({
                kind: "guardian_reused",
                projectId: data.projectId,
                runId: data.runId,
                loopId: data.loopId,
                trigger: data.trigger,
                sessionId: resolved,
                guardianKey,
                guardianSessionId: resolved,
                message: `Reused guardian session ${resolved}`,
              });
            }
            return resolved;
          },
          rememberGuardianSession: (data, sessionId) => {
            const guardianKey = data.loopId ? `loop:${data.loopId}` : `project:${data.projectId}`;
            void recordAutomationAuditEvent({
              kind: "guardian_remembered",
              projectId: data.projectId,
              runId: data.runId,
              loopId: data.loopId,
              trigger: data.trigger,
              sessionId,
              guardianKey,
              guardianSessionId: sessionId,
              message: `Remembered guardian session ${sessionId}`,
            });
            return guardianSessionRegistry.rememberForSupervisor(data, sessionId);
          },
        },
        agentLoop: {
          spawnSession,
          resolveGuardianSessionId: (data) => {
            const guardianKey = `agent-loop:${data.loopId}`;
            const rawResolved = guardianSessionRegistry.resolveByKey(guardianKey);
            const resolved = resolveGuardianSession({
              candidateSessionId: rawResolved,
              isSessionTracked: (sessionId) => Boolean(findTrackedSessionByHappySessionId(sessionId)),
              forgetSession: (sessionId) => {
                void guardianSessionRegistry.forgetSession(sessionId).catch((error) => {
                  logger.debug(`[DAEMON RUN] Failed to forget stale agent-loop guardian session ${sessionId}: ${error}`);
                });
              },
              onStaleSession: (sessionId) => {
                void recordAutomationAuditEvent({
                  kind: "guardian_cleared",
                  projectId: data.projectId,
                  loopId: data.loopId,
                  trigger: `agent_loop:${data.trigger}`,
                  sessionId,
                  guardianKey,
                  guardianSessionId: sessionId,
                  message: `Forgot stale agent-loop guardian session ${sessionId}`,
                });
              },
            });
            if (resolved) {
              void recordAutomationAuditEvent({
                kind: "guardian_reused",
                projectId: data.projectId,
                loopId: data.loopId,
                trigger: `agent_loop:${data.trigger}`,
                sessionId: resolved,
                guardianKey,
                guardianSessionId: resolved,
                message: `Reused agent loop guardian session ${resolved}`,
              });
            }
            return resolved;
          },
          rememberGuardianSession: (data, sessionId) => {
            const guardianKey = `agent-loop:${data.loopId}`;
            void recordAutomationAuditEvent({
              kind: "guardian_remembered",
              projectId: data.projectId,
              loopId: data.loopId,
              trigger: `agent_loop:${data.trigger}`,
              sessionId,
              guardianKey,
              guardianSessionId: sessionId,
              message: `Remembered agent loop guardian session ${sessionId}`,
            });
            return guardianSessionRegistry.rememberByKey({
              key: guardianKey,
              projectId: data.projectId,
              loopId: data.loopId,
              sessionId,
            });
          },
          onSessionStarted: (data, sessionId) => {
            void recordAutomationAuditEvent({
              kind: "job_session_started",
              dedupeKey: `agent-loop:${data.loopId}:${data.iteration}`,
              sessionId,
              projectId: data.projectId,
              loopId: data.loopId,
              trigger: `agent_loop:${data.trigger}`,
              status: "running",
              message: data.loopName ?? undefined,
            });
            return agentLoopCoordinator?.onJobSessionStarted(data.loopId, sessionId);
          },
        },
        task: {
          spawnSession,
          serverUrl: configuration.serverUrl,
          recordTaskAudit: (event) => {
            void recordAutomationAuditEvent(event);
          },
          onTaskStatusChange: (taskId, status, sessionId, errorMessage) => {
            try {
              apiMachine?.taskStatus(taskId, status, sessionId, errorMessage);
            } catch (err) {
              logger.debug(`[TASK] Failed to report status for ${taskId}: ${err}`);
            }
          },
        },
      },
      onChange: () => scheduleAutomationStatePublish(),
      onTaskStatusReport: (taskId, status, sessionId, errorMessage, outcome) => {
        try {
          apiMachine?.taskStatus(taskId, status, sessionId, errorMessage, outcome);
        } catch (err) {
          logger.debug(`[TASK] Failed to report task status for ${taskId}: ${err}`);
        }
      },
    });
    const automationRecovery = await automationScheduler.start(recoveredRunningSessionIds);
    const agentLoopStore = new AgentLoopStore(
      join(configuration.happyHomeDir, "agent-loops.json"),
    );
    agentLoopFileWatcher = new AgentLoopFileWatcher({
      emitEvent: async (loopId, input) => {
        if (!agentLoopCoordinator) {
          return;
        }
        const result = await agentLoopCoordinator.emitEvent(loopId, input);
        if (!result.success) {
          logger.debug(`[AGENT LOOP WATCH] event skipped for ${loopId}: ${result.errorMessage ?? "unknown error"}`);
        }
      },
      logger: (message) => logger.debug(message),
    });
    agentLoopCoordinator = new AgentLoopCoordinator({
      store: agentLoopStore,
      scheduler: automationScheduler,
      onChange: (loops) => {
        agentLoopFileWatcher?.sync(loops);
        scheduleAutomationStatePublish();
      },
      recordAuditEvent: (event) => recordAutomationAuditEvent(event),
      sendPushNotification: async ({ title, body, data }) => {
        try {
          api.push().sendToAllDevices(title, body, {
            source: "agent-loop",
            ...(data ?? {}),
          });
        } catch (error) {
          logger.debug(`[DAEMON RUN] Failed to send loop push notification: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      onBriefGenerated: (brief) => addBrief(brief),
    });
    await agentLoopCoordinator.start();
    const agentLoopBootstrapStore = new AgentLoopBootstrapStore(
      join(configuration.happyHomeDir, "agent-loop-bootstrap-profiles.json"),
    );
    agentLoopBootstrapCoordinator = new AgentLoopBootstrapCoordinator({
      store: agentLoopBootstrapStore,
      agentLoopCoordinator,
      onChange: () => scheduleAutomationStatePublish(),
    });
    await agentLoopBootstrapCoordinator.start();
    const autoDreamStore = new AutoDreamStore(
      join(configuration.happyHomeDir, "auto-dream-profiles.json"),
    );
    autoDreamCoordinator = new AutoDreamCoordinator({
      store: autoDreamStore,
      onChange: () => scheduleAutomationStatePublish(),
      onTranscriptsFound: (turns) => {
        try { apiMachine.emitTranscriptKnowledge(turns); } catch { /* best-effort */ }
      },
    });
    await autoDreamCoordinator.start();
    scheduleAutomationStatePublish();
    setTimeout(() => {
      void publishAutomationState();
    }, 1_000);
    logger.debug(
      `[DAEMON RUN] Automation scheduler started (requeued=${automationRecovery.requeued}, retainedTerminal=${automationRecovery.retainedTerminal}, reattachedRunning=${automationRecovery.reattachedRunning})`,
    );

    // Set up webhook trigger handler
    apiMachine.setWebhookHandler((data) => {
      void (async () => {
        if (agentLoopCoordinator) {
          const loops = await agentLoopCoordinator.listLoops();
          const matchingLoops = selectLoopsForWebhookBridge(loops, data);
          if (matchingLoops.length > 0) {
            const events = buildLoopEventsFromWebhook(data);
            await Promise.all(matchingLoops.flatMap((loop) => events.map(async (event) => {
              const result = await agentLoopCoordinator!.emitEvent(loop.id, event);
              if (!result.success) {
                logger.debug(`[DAEMON RUN] Failed to bridge webhook into loop ${loop.id}: ${result.errorMessage ?? "unknown error"}`);
              }
            })));
          }
        }

        await automationScheduler!
          .enqueueWebhook(data)
          .then((result) => {
            if (!result.deduped) {
              void recordAutomationAuditEvent({
                kind: "job_enqueued",
                jobId: result.job.id,
                dedupeKey: result.job.dedupeKey,
                status: result.job.status,
                message: result.job.label,
              });
            }
          });
      })().catch((error) => {
        logger.debug(`[DAEMON RUN] Failed to enqueue webhook job: ${error}`);
      });
    });

    apiMachine.setCiHandler((data: import("@/api/apiMachine").CiTriggerData) => {
      void (async () => {
        if (agentLoopCoordinator) {
          const loops = await agentLoopCoordinator.listLoops();
          const matchingLoops = selectLoopsForCiBridge(loops, data);
          if (matchingLoops.length > 0) {
            const event = buildLoopEventFromCiTrigger(data);
            await Promise.all(matchingLoops.map(async (loop) => {
              const result = await agentLoopCoordinator!.emitEvent(loop.id, event);
              if (!result.success) {
                logger.debug(`[DAEMON RUN] Failed to bridge ci-trigger into loop ${loop.id}: ${result.errorMessage ?? "unknown error"}`);
              }
            }));
          }
        }
      })().catch((error) => {
        logger.debug(`[DAEMON RUN] Failed to handle ci-trigger: ${error}`);
      });
    });

    // Set up supervisor trigger handler
    apiMachine.setSupervisorHandler((data) => {
      void automationScheduler!
        .enqueueSupervisor(data)
        .then((result) => {
          if (!result.deduped) {
            void recordAutomationAuditEvent({
              kind: "job_enqueued",
              jobId: result.job.id,
              dedupeKey: result.job.dedupeKey,
              projectId: result.job.projectId,
              runId: result.job.runId,
              loopId: result.job.loopId,
              trigger: data.trigger,
              status: result.job.status,
              message: result.job.label,
            });
          }
        })
        .catch((error) => {
          logger.debug(`[DAEMON RUN] Failed to enqueue supervisor job: ${error}`);
        });
    });

    // Set up task trigger handler: enqueue task jobs from server
    apiMachine.setTaskHandler((data) => {
      void automationScheduler!
        .enqueueTask({
          type: "task-trigger",
          taskId: data.taskId,
          prompt: data.prompt,
          directory: data.directory,
          priority: data.priority as "urgent" | "user" | "background",
          projectId: data.projectId,
          resultToken: data.resultToken,
          skillContents: data.skillContents,
          agentType: data.agentType,
          modelOverride: data.modelOverride,
          profileId: data.profileId,
          runtimeProfile: data.runtimeProfile,
        })
        .then((result) => {
          if (!result.deduped) {
            void recordAutomationAuditEvent({
              kind: "job_enqueued",
              jobId: result.job.id,
              dedupeKey: result.job.dedupeKey,
              projectId: result.job.projectId,
              trigger: "task",
              status: result.job.status,
              message: result.job.label,
            });
          }
        })
        .catch((error) => {
          logger.debug(`[DAEMON RUN] Failed to enqueue task job: ${error}`);
        });
    });

    // Set up task cancel handler: abort running sessions when App cancels a task
    apiMachine.setTaskCancelHandler((data) => {
      logger.debug(`[DAEMON RUN] Received task-cancel for task ${data.taskId} (session: ${data.sessionId ?? "none"})`);

      // If a sessionId is provided, kill the running session directly
      if (data.sessionId) {
        const trackedSession = findTrackedSessionByHappySessionId(data.sessionId);
        if (trackedSession) {
          requestTrackedSessionTermination(trackedSession.pid, trackedSession, {
            reason: "task-cancel",
            terminalStatus: "cancelled",
            terminalError: "Task cancelled by user",
          });
          return;
        }
      }

      // Fallback: find a queued job matching taskId and cancel it
      const jobs = automationScheduler?.getJobsSnapshot() ?? [];
      for (const job of jobs) {
        if (job.kind === "task" && (job.payload as import("@/automation/types").TaskTriggerData).taskId === data.taskId) {
          void automationScheduler?.cancelJob(job.id).then((result) => {
            logger.debug(`[DAEMON RUN] Cancelled queued task job ${job.id}: ${result.success ? "ok" : result.errorMessage}`);
          });
          break;
        }
      }
    });

    // Finalise local AutomationJob when the server receives the HTTP callback.
    // The HTTP path (Claude → Server curl) bypasses the daemon, so without this
    // the AutomationScheduler stays stuck at "running" for Guardian sessions.
    apiMachine.setSupervisorRunCompleteHandler(({ runId, status }) => {
      logger.debug(
        `[DAEMON RUN] supervisor-run-complete: run=${runId} status=${status}`,
      );
      void automationScheduler?.markJobTerminalByDedupeKey(
        "supervisor:" + runId,
        status,
      );
    });

    // Set up fix-kill handler: terminate fix sessions after completion/failure
    apiMachine.setFixKillHandler((data) => {
      logger.debug(
        `[DAEMON RUN] Received fix-kill-session for session ${data.fixSessionId} (status: ${data.fixStatus})`,
      );

      // Find the tracked session by happySessionId
      for (const [pid, session] of pidToTrackedSession.entries()) {
        if (session.happySessionId === data.fixSessionId) {
          void automationScheduler?.markJobTerminalBySession(
            data.fixSessionId,
            data.fixStatus === "failed"
              ? "failed"
              : data.fixStatus === "cancelled"
                ? "cancelled"
                : "completed",
          );
          logger.debug(
            `[DAEMON RUN] Killing fix session PID ${pid} (session ${data.fixSessionId})`,
          );
          // Kill the tmux session if applicable, otherwise kill the process
          requestTrackedSessionTermination(pid, session, {
            reason: `fix-kill:${data.fixStatus}`,
            terminalStatus:
              data.fixStatus === "failed"
                ? "failed"
                : data.fixStatus === "cancelled"
                  ? "cancelled"
                  : "completed",
          });
          break;
        }
      }
    });

    // Every 60 seconds:
    // 1. Prune stale sessions
    // 2. Check if daemon needs update
    // 3. If outdated, restart with latest version
    // 4. Write heartbeat
    const heartbeatIntervalMs = parseInt(
      process.env.HAPPY_DAEMON_HEARTBEAT_INTERVAL || "60000",
    );
    let heartbeatRunning = false;
    const restartOnStaleVersionAndHeartbeat = setInterval(async () => {
      if (heartbeatRunning) {
        return;
      }
      heartbeatRunning = true;

      if (process.env.DEBUG) {
        logger.debug(
          `[DAEMON RUN] Health check started at ${new Date().toLocaleString()}`,
        );
      }

      await runAutomationWatchdog();

      // Prune stale sessions
      for (const [pid, session] of pidToTrackedSession.entries()) {
        try {
          process.kill(pid, 0);
        } catch (error) {
          logger.debug(
            `[DAEMON RUN] Removing stale session with PID ${pid} (process no longer exists)`,
          );
          onChildExited(pid, null, session.terminationRequestedAt ? "SIGTERM" : null);
        }
      }

      // Check if daemon needs update
      // If version on disk is different from the one in package.json - we need to restart
      // BIG if - does this get updated from underneath us on npm upgrade?
      const projectVersion = JSON.parse(
        await fs.readFile(join(projectPath(), "package.json"), "utf-8"),
      ).version;
      if (projectVersion !== configuration.currentCliVersion) {
        logger.debug(
          "[DAEMON RUN] Daemon is outdated, triggering self-restart with latest version, clearing heartbeat interval",
        );

        clearInterval(restartOnStaleVersionAndHeartbeat);

        // Spawn new daemon through the CLI with retry logic.
        // During a build (rm -rf dist && pkgroll), dist/index.mjs is temporarily
        // missing. Retry with backoff so we don't die before the build finishes.
        const maxSpawnAttempts = 30;
        const spawnRetryDelayMs = 2_000;
        let spawned = false;

        for (let attempt = 1; attempt <= maxSpawnAttempts; attempt++) {
          try {
            spawnHappyCLI(["daemon", "start"], {
              detached: true,
              stdio: "ignore",
            });
            spawned = true;
            logger.debug(
              `[DAEMON RUN] Successfully spawned new daemon on attempt ${attempt}`,
            );
            break;
          } catch (error) {
            logger.debug(
              `[DAEMON RUN] Failed to spawn new daemon (attempt ${attempt}/${maxSpawnAttempts}), dist/ may be rebuilding`,
              error,
            );
            if (attempt < maxSpawnAttempts) {
              await new Promise((resolve) =>
                setTimeout(resolve, spawnRetryDelayMs),
              );
            }
          }
        }

        if (!spawned) {
          logger.debug(
            "[DAEMON RUN] Exhausted all spawn attempts. Exiting — a manual restart will be needed.",
          );
        }

        // Give the new daemon time to start and kill us
        logger.debug(
          "[DAEMON RUN] Hanging for a bit - waiting for CLI to kill us because we are running outdated version of the code",
        );
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        process.exit(0);
      }

      // Before wrecklessly overriting the daemon state file, we should check if we are the ones who own it
      // Race condition is possible, but thats okay for the time being :D
      const daemonState = await readDaemonState();
      if (daemonState && daemonState.pid !== process.pid) {
        logger.debug(
          "[DAEMON RUN] Somehow a different daemon was started without killing us. We should kill ourselves.",
        );
        requestShutdown(
          "exception",
          "A different daemon was started without killing us. We should kill ourselves.",
        );
      }

      // Heartbeat
      try {
        const updatedState: DaemonLocallyPersistedState = {
          pid: process.pid,
          httpPort: controlPort,
          startTime: fileState.startTime,
          startedWithCliVersion: packageJson.version,
          lastHeartbeat: new Date().toLocaleString(),
          daemonLogPath: fileState.daemonLogPath,
        };
        writeDaemonState(updatedState);
        if (process.env.DEBUG) {
          logger.debug(
            `[DAEMON RUN] Health check completed at ${updatedState.lastHeartbeat}`,
          );
        }
      } catch (error) {
        logger.debug("[DAEMON RUN] Failed to write heartbeat", error);
      }

      heartbeatRunning = false;
    }, heartbeatIntervalMs); // Every 60 seconds in production
    if (restartOnStaleVersionAndHeartbeat) {
      (restartOnStaleVersionAndHeartbeat as NodeJS.Timeout).unref?.();
    }

    // Setup signal handlers
    const cleanupAndShutdown = async (
      source: "happy-app" | "happy-cli" | "os-signal" | "exception",
      errorMessage?: string,
    ) => {
      logger.debug(
        `[DAEMON RUN] Starting proper cleanup (source: ${source}, errorMessage: ${errorMessage})...`,
      );

      // Clear health check interval
      if (restartOnStaleVersionAndHeartbeat) {
        clearInterval(restartOnStaleVersionAndHeartbeat);
        logger.debug("[DAEMON RUN] Health check interval cleared");
      }

      // Update daemon state before shutting down
      await apiMachine.updateDaemonState((state: DaemonState | null) => ({
        ...state,
        status: "shutting-down",
        shutdownRequestedAt: Date.now(),
        shutdownSource: source,
      }));

      // Give time for metadata update to send
      await new Promise((resolve) => setTimeout(resolve, 100));

      if (automationPublishTimer) {
        clearTimeout(automationPublishTimer);
        automationPublishTimer = null;
      }

      // Cleanup with Promise.allSettled to prevent one failure from blocking others
      const logRejected = (label: string, results: PromiseSettledResult<unknown>[]) => {
        for (const r of results) {
          if (r.status === "rejected") {
            logger.warn(`[DAEMON RUN] ${label} cleanup failed:`, r.reason);
          }
        }
      };

      await Promise.race([
        (async () => {
          // Group 1: Stop automation subsystems (independent, safe to parallelize)
          const group1 = await Promise.allSettled([
            agentLoopFileWatcher?.stop(),
            agentLoopBootstrapCoordinator?.stop(),
            agentLoopCoordinator?.stop(),
            automationScheduler?.stop(),
          ]);
          logRejected("automation", group1);

          // Synchronous shutdown - wrap in try-catch
          try {
            apiMachine.shutdown();
          } catch (e) {
            logger.warn("[DAEMON RUN] apiMachine shutdown failed:", e);
          }

          // Group 2: Infrastructure cleanup (independent, safe to parallelize)
          const group2 = await Promise.allSettled([
            stopControlServer(),
            cleanupDaemonState(),
            stopCaffeinate(),
            releaseDaemonLock(daemonLockHandle),
          ]);
          logRejected("infrastructure", group2);
        })(),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)), // 10s total timeout
      ]);

      logger.debug("[DAEMON RUN] Cleanup completed, exiting process");
      process.exit(0);
    };

    logger.debug(
      "[DAEMON RUN] Daemon started successfully, waiting for shutdown request",
    );

    // Wait for shutdown request
    const shutdownRequest = await resolvesWhenShutdownRequested;
    await cleanupAndShutdown(
      shutdownRequest.source,
      shutdownRequest.errorMessage,
    );
  } catch (error) {
    logger.debug(
      "[DAEMON RUN][FATAL] Failed somewhere unexpectedly - exiting with code 1",
      error,
    );
    process.exit(1);
  }
}
