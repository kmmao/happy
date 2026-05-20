/**
 * Session webhook and heartbeat handlers for the daemon, extracted from startDaemon.ts.
 * Handles /session-started webhooks from child processes and periodic heartbeats.
 */

import { TrackedSession } from "./types";
import { Metadata } from "@/api/types";
import { logger } from "@/ui/logger";
import { TrackedSessionRegistry } from "./TrackedSessionRegistry";

// ---------------------------------------------------------------------------
// Context types
// ---------------------------------------------------------------------------

export type SessionWebhookContext = {
  pidToTrackedSession: Map<number, TrackedSession>;
  pidToAwaiter: Map<number, (session: TrackedSession) => void>;
  trackedSessionRegistry: TrackedSessionRegistry;
};

export type SessionHeartbeatContext = {
  pidToTrackedSession: Map<number, TrackedSession>;
  trackedSessionRegistry: TrackedSessionRegistry;
};

// ---------------------------------------------------------------------------
// Inline persist helper (mirrors rememberTrackedSession in startDaemon.ts)
// ---------------------------------------------------------------------------

function persistTrackedSession(
  trackedSessionRegistry: TrackedSessionRegistry,
  session: TrackedSession,
): void {
  if (!session.happySessionId && !session.spawnId) {
    return;
  }
  void trackedSessionRegistry.rememberTrackedSession(session).catch((error) => {
    const identity = session.happySessionId ?? `spawn:${session.spawnId}`;
    logger.debug(`[DAEMON RUN] Failed to persist tracked session ${identity}: ${error}`);
  });
}

// ---------------------------------------------------------------------------
// Session webhook handler
// ---------------------------------------------------------------------------

/**
 * Handle the webhook from a happy session reporting itself (via /session-started).
 * Matches the child process to an existing tracked record (daemon-spawned) or
 * creates a new externally-started session entry.
 */
export function onHappySessionWebhook(
  ctx: SessionWebhookContext,
  sessionId: string,
  sessionMetadata: Metadata,
  reportedSpawnId?: string,
): void {
  const { pidToTrackedSession, pidToAwaiter, trackedSessionRegistry } = ctx;
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
    persistTrackedSession(trackedSessionRegistry, existingSession);
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
    persistTrackedSession(trackedSessionRegistry, trackedSession);
  }
}

// ---------------------------------------------------------------------------
// Session heartbeat handler
// ---------------------------------------------------------------------------

/**
 * Handle a periodic liveness + activity signal from a child process.
 * Stronger than kill(pid, 0) because a wedged event loop cannot post.
 * Returns whether the session is known and should keep running.
 */
export function onSessionHeartbeat(
  ctx: SessionHeartbeatContext,
  params: {
    pid: number;
    happySessionId?: string;
    spawnId?: string;
    activity?: "idle" | "thinking" | "executing" | "blocked";
  },
): { known: boolean; keepAlive: boolean } {
  const { pidToTrackedSession, trackedSessionRegistry } = ctx;
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
  persistTrackedSession(trackedSessionRegistry, existing);
  return { known: true, keepAlive };
}
