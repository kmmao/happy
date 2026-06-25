/**
 * Session recovery logic for the daemon, extracted from startDaemon.ts.
 * Handles resolving likely-recoverable PIDs and rebuilding in-memory session
 * state from the persisted TrackedSessionRegistry after a daemon restart.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import { TrackedSession } from "./types";
import { logger } from "@/ui/logger";
import { getTmuxUtilities } from "@/utils/tmux";
import { TrackedSessionRegistry } from "./TrackedSessionRegistry";
import type { AutomationAuditEvent } from "@/automation/types";

const execFileAsync = promisify(execFileCb);

// ---------------------------------------------------------------------------
// ps etime parser (cross-platform)
// ---------------------------------------------------------------------------

/**
 * Parse a `ps -o etime=` field to elapsed seconds.
 *
 * `etime` format is `[[DD-]HH:]MM:SS` and is supported by BOTH BSD ps (macOS)
 * and GNU ps (Linux). We deliberately avoid `etimes` (raw integer seconds)
 * because BSD ps rejects it with `ps: etimes: keyword not found`.
 *
 * Examples:
 *   "01:23"         →     83  (1m 23s)
 *   "12:34:56"      →  45296  (12h 34m 56s)
 *   "1-02:03:04"    →  93784  (1d 2h 3m 4s)
 *   "  5:00 "       →    300  (whitespace tolerated by caller)
 */
export function parsePsEtimeSeconds(input: string): number {
  const s = input.trim();
  if (!s) return 0;

  let days = 0;
  let rest = s;
  const dashIdx = s.indexOf("-");
  if (dashIdx >= 0) {
    days = Number(s.slice(0, dashIdx));
    rest = s.slice(dashIdx + 1);
    if (!Number.isFinite(days)) return 0;
  }

  const parts = rest.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;

  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 3) {
    [hours, minutes, seconds] = parts;
  } else if (parts.length === 2) {
    [minutes, seconds] = parts;
  } else if (parts.length === 1) {
    seconds = parts[0];
  } else {
    return 0;
  }

  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

export type SessionRecoveryContext = {
  pidToTrackedSession: Map<number, TrackedSession>;
  trackedSessionRegistry: TrackedSessionRegistry;
  recordAutomationAuditEvent: (
    event: Omit<AutomationAuditEvent, "id" | "occurredAt"> & { occurredAt?: number },
  ) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Resolve likely-recoverable PID
// ---------------------------------------------------------------------------

/**
 * Given a persisted { pid, startedAt?, tmuxSessionId? }, tries to find a
 * live process that is still the original happy CLI process.
 * Returns the live PID if recoverable (may differ from persisted.pid when
 * tmux reassigned the session), or null if the process cannot be safely
 * reattached.
 */
export async function resolveLikelyRecoverableHappyPid(
  persisted: { pid: number; startedAt?: number; tmuxSessionId?: string },
): Promise<number | null> {
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
    const tmuxInfo = await getTmuxUtilities()
      .getSessionInfoFromString(persisted.tmuxSessionId)
      .catch(() => null);
    if (!tmuxInfo) {
      return null;
    }
    const panePid = await getTmuxUtilities()
      .getPanePidFromSessionIdentifier(persisted.tmuxSessionId)
      .catch(() => null);
    pushCandidate(panePid);
  }

  for (const candidatePid of candidatePids) {
    try {
      process.kill(candidatePid, 0);
    } catch {
      continue;
    }

    try {
      // Use `etime` (not `etimes`) — `etime` is supported on both BSD ps
      // (macOS) and GNU ps (Linux). BSD ps rejects `etimes` with
      // "ps: etimes: keyword not found".
      const { stdout } = await execFileAsync("ps", [
        "-p",
        String(candidatePid),
        "-o",
        "etime=,command=",
      ]);
      const line = stdout.trim();
      const match = line.match(/^(\S+)\s+(.*)$/);
      const elapsedSeconds = match ? parsePsEtimeSeconds(match[1]) : 0;
      const command = match ? match[2].trim() : line;
      if (
        !/(\bhappy\b|index\.mjs|dist_next\/index\.mjs|dist\/index\.mjs)/i.test(command)
      ) {
        continue;
      }
      if (persisted.startedAt) {
        const minimumExpectedAgeSeconds = Math.max(
          0,
          Math.floor((Date.now() - persisted.startedAt) / 1000) - 300,
        );
        if (elapsedSeconds < minimumExpectedAgeSeconds) {
          logger.debug(
            `[DAEMON RUN] PID ${candidatePid} looks newer than persisted session record; refusing reattach`,
          );
          continue;
        }
      }
      return candidatePid;
    } catch (error) {
      logger.debug(
        `[DAEMON RUN] Failed to inspect PID ${candidatePid} for recovery: ${error}`,
      );
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Recover sessions from persisted registry
// ---------------------------------------------------------------------------

/**
 * Rebuilds in-memory session state (pidToTrackedSession) from the persisted
 * TrackedSessionRegistry after a daemon restart. Returns the set of
 * successfully recovered session IDs.
 */
export async function recoverTrackedSessionsFromIndex(
  ctx: SessionRecoveryContext,
): Promise<Set<string>> {
  const { pidToTrackedSession, trackedSessionRegistry, recordAutomationAuditEvent } = ctx;
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
    await trackedSessionRegistry
      .rememberTrackedSession(trackedSession)
      .catch((error) => {
        logger.debug(
          `[DAEMON RUN] Failed to refresh persisted tracked session ${persistedSessionId}: ${error}`,
        );
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
      message: `Reattached live session on PID ${recoveredPid}${
        persisted.pid !== recoveredPid ? ` (previous PID ${persisted.pid})` : ""
      }${persisted.tmuxSessionId ? ` (${persisted.tmuxSessionId})` : ""}`,
    });
    logger.debug(
      `[DAEMON RUN] Reattached persisted session ${persisted.happySessionId} on PID ${recoveredPid}${
        persisted.pid !== recoveredPid ? ` (previous PID ${persisted.pid})` : ""
      }`,
    );
  }

  return recoveredSessionIds;
}
