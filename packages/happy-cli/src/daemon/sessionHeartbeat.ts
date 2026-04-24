import { logger } from "@/ui/logger";
import { notifyDaemonSessionHeartbeat } from "./controlClient";

/**
 * Child-side daemon heartbeat. Each daemon-tracked happy-cli child fires an
 * interval timer that posts to /session-heartbeat, letting the daemon
 * distinguish "process alive and pumping its event loop" from "process alive
 * but wedged" (which kill(pid, 0) cannot).
 *
 * Gracefully no-ops when the daemon is unreachable — heartbeat is advisory,
 * never fatal to the child.
 */

const DEFAULT_INTERVAL_MS = 20_000;

type Activity = "idle" | "thinking" | "executing" | "blocked";

export interface HeartbeatHandle {
  /** Stop the interval timer. Safe to call multiple times. */
  stop: () => void;
  /**
   * Update the reported activity. Takes effect on the next tick. Passing
   * `undefined` clears the activity hint.
   */
  setActivity: (activity: Activity | undefined) => void;
}

export interface HeartbeatOptions {
  /** Server-assigned session id. Omit for offline stub sessions. */
  happySessionId?: string;
  /** Daemon-injected spawn id from process.env.HAPPY_SPAWN_ID. */
  spawnId?: string;
  /** Polling interval in ms. Defaults to 20s. */
  intervalMs?: number;
  /** Called when daemon responds with `keepAlive: false`. Default: no-op. */
  onTerminationRequested?: () => void;
}

/**
 * Start the heartbeat loop. Returns a handle for activity updates and stop().
 *
 * Invariants:
 *   - At most one tick in flight at a time; if a tick is still waiting for a
 *     daemon response, the next scheduled tick is skipped.
 *   - An immediate first tick fires right after scheduling so the daemon
 *     starts seeing activity without a 20s blind window.
 *   - Daemon errors (network, 404, etc.) are logged at debug and do not halt
 *     the loop. The daemon is the authority — the child does not self-exit on
 *     persistent heartbeat failure.
 */
export function startSessionHeartbeat(
  options: HeartbeatOptions,
): HeartbeatHandle {
  const interval = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const pid = process.pid;
  let stopped = false;
  let tickInFlight = false;
  let currentActivity: Activity | undefined = undefined;

  const tick = async () => {
    if (stopped || tickInFlight) return;
    tickInFlight = true;
    try {
      const result = await notifyDaemonSessionHeartbeat(
        pid,
        options.happySessionId,
        options.spawnId,
        currentActivity,
      );
      if ("error" in result) {
        logger.debug(`[heartbeat] daemon unreachable: ${result.error}`);
        return;
      }
      if (!result.known) {
        logger.debug(
          `[heartbeat] daemon does not recognize this child (pid=${pid}, spawnId=${options.spawnId ?? "-"})`,
        );
      }
      if (!result.keepAlive) {
        logger.debug(
          `[heartbeat] daemon requested graceful exit for pid=${pid}`,
        );
        options.onTerminationRequested?.();
      }
    } catch (error) {
      logger.debug(
        `[heartbeat] tick threw: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      tickInFlight = false;
    }
  };

  // Fire immediately so the first heartbeat doesn't wait a full interval.
  void tick();

  const timer = setInterval(() => void tick(), interval);
  // Don't keep the event loop alive just for heartbeats — if everything else
  // has quit, let the process exit.
  timer.unref();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
    setActivity: (activity) => {
      currentActivity = activity;
    },
  };
}
