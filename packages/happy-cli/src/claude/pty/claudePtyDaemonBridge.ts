/**
 * claudePtyDaemonBridge — session-child → daemon HTTP shim that surfaces the
 * Claude TUI PTY through the daemon's existing TerminalManager.
 *
 * Background
 * ----------
 * The App-facing terminal wire (`terminal-spawn`/`terminal-output`/`terminal-input`
 * etc.) lives on the daemon's machine socket. The Claude PTY itself, however,
 * runs inside the per-session child process so the session can drive it
 * directly. To wire the two without IPC plumbing for every byte direction, we
 * relay over the daemon's local control HTTP server.
 *
 * The bridge is best-effort: if `HAPPY_DAEMON_CONTROL_URL` is absent (CLI was
 * launched without a daemon parent), every call no-ops with a debug log.
 *
 * Backpressure
 * ------------
 * v1 was fire-and-forget POSTs with no ordering guarantee — a slow daemon
 * could let the in-flight set grow unbounded and silently reorder chunks
 * (terminal ANSI sequences MUST stay in order). v2 keeps a per-terminalId
 * FIFO and posts serially:
 *
 *   - `bridgeData` appends to a coalescing buffer; if no POST is in flight we
 *     kick off `drainQueue` which keeps draining until empty.
 *   - When the queued bytes exceed BACKPRESSURE_DROP_BYTES (4 MB) we drop the
 *     OLDEST data (slice from the front) and log a single warning per session.
 *     Dropping oldest preserves the most recent screen — what reconnect users
 *     actually see — and stays cheap.
 *   - `bridgeExit` flushes the queue before posting the exit so the App never
 *     misses the final bytes Claude printed before quitting.
 */

import { logger } from "@/ui/logger";
import {
  claudePtyTerminalId,
  TERMINAL_REPLAY_BUFFER_BYTES,
} from "@kmmao/happy-wire";

const DAEMON_CONTROL_ENV = "HAPPY_DAEMON_CONTROL_URL";

/**
 * High-water mark for per-terminal queued bytes. Above this, oldest data is
 * sliced off. Sized at 4 MB so a chatty `find /` or `cat large_file` can
 * keep up across a few seconds of daemon stall before any data is dropped.
 */
const BACKPRESSURE_DROP_BYTES = 4 * 1024 * 1024;

/**
 * Per-data-POST upper bound — mirrors the daemon's body validator limit so
 * a single POST is never rejected for size. Larger queues just take more
 * round-trips to drain.
 */
const MAX_POST_BYTES = TERMINAL_REPLAY_BUFFER_BYTES;

/**
 * Build a Claude-prefixed terminalId for the daemon registry. Thin re-export
 * of the shared wire helper so the CLI surface stays unchanged for existing
 * callers while the format lives in one place.
 */
export const buildClaudeTerminalId = claudePtyTerminalId;

interface OutgoingQueue {
  pending: string;
  inFlight: Promise<void> | null;
  droppedBytes: number;
  warnedDropped: boolean;
}

const queues = new Map<string, OutgoingQueue>();

function ensureQueue(terminalId: string): OutgoingQueue {
  let q = queues.get(terminalId);
  if (!q) {
    q = { pending: "", inFlight: null, droppedBytes: 0, warnedDropped: false };
    queues.set(terminalId, q);
  }
  return q;
}

async function postRaw(path: string, body: unknown): Promise<void> {
  const base = process.env[DAEMON_CONTROL_ENV];
  if (!base) return;
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.debug(
        `[claudePtyDaemonBridge] POST ${path} → ${res.status} ${res.statusText}`,
      );
    }
  } catch (err) {
    logger.debug(
      `[claudePtyDaemonBridge] POST ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Drain pending bytes for `terminalId` in a single chain — caller already
 * checked `inFlight` is null. New `bridgeData` calls during the drain just
 * grow `q.pending`; this loop picks them up before the next iteration.
 */
async function drainQueue(terminalId: string, q: OutgoingQueue): Promise<void> {
  while (q.pending.length > 0) {
    const payload = q.pending.slice(0, MAX_POST_BYTES);
    q.pending = q.pending.slice(payload.length);
    const promise = postRaw("/claude-pty/data", { terminalId, data: payload });
    q.inFlight = promise;
    try {
      await promise;
    } finally {
      q.inFlight = null;
    }
  }
  // Drained — surface a single summary if we had to drop data while behind.
  if (q.droppedBytes > 0 && !q.warnedDropped) {
    q.warnedDropped = true;
    logger.debug(
      `[claudePtyDaemonBridge] dropped ${q.droppedBytes}B of older output for ${terminalId} due to backpressure (daemon lag)`,
    );
  }
}

function enqueueData(terminalId: string, data: string): void {
  if (data.length === 0) return;
  const q = ensureQueue(terminalId);
  q.pending += data;
  if (q.pending.length > BACKPRESSURE_DROP_BYTES) {
    const overflow = q.pending.length - BACKPRESSURE_DROP_BYTES;
    q.pending = q.pending.slice(overflow);
    q.droppedBytes += overflow;
    // Re-arm the warning if the queue went idle and now grew again.
    q.warnedDropped = false;
  }
  if (!q.inFlight) {
    // Fire-and-forget the drain promise — `postRaw` swallows errors, and the
    // loop manages its own inFlight handle so re-entrant enqueue calls
    // observe the busy state correctly.
    void drainQueue(terminalId, q);
  }
}

async function flushAndDrop(terminalId: string): Promise<void> {
  const q = queues.get(terminalId);
  if (!q) return;
  // If a drain is mid-flight, await it; then drain whatever is left.
  while (q.inFlight || q.pending.length > 0) {
    if (q.inFlight) {
      try {
        await q.inFlight;
      } catch {
        // postRaw swallows internally, but the promise may still reject
        // under unusual scenarios — ignore so detach proceeds.
      }
    }
    if (q.pending.length > 0) {
      await drainQueue(terminalId, q);
    }
  }
  queues.delete(terminalId);
}

export interface ClaudePtyBridgeAttachInput {
  terminalId: string;
  sessionId: string;
  cols: number;
  rows: number;
  cwd: string;
  /**
   * Loopback URL of the session-local reverse HTTP server (POST `/input`,
   * `/resize`, `/close`). When present, the daemon's
   * `apiMachine.attachClaudePty` records it so App→PTY traffic can be
   * forwarded back into the Claude TUI. Omit to keep the attachment
   * observation-only (legacy behavior).
   */
  reverseUrl?: string;
}

/** Register the Claude PTY with the daemon so App spawn/list RPCs can find it. */
export function bridgeAttach(input: ClaudePtyBridgeAttachInput): Promise<void> {
  return postRaw("/claude-pty/attach", input);
}

/**
 * Deregister; safe to call multiple times — daemon side is idempotent. Awaits
 * pending data drain first so the App never misses the tail of a noisy
 * command before the terminal goes away.
 */
export async function bridgeDetach(terminalId: string): Promise<void> {
  await flushAndDrop(terminalId);
  await postRaw("/claude-pty/detach", { terminalId });
}

/**
 * Forward a chunk of PTY output. Enqueued for serial POST; oldest data is
 * dropped if the per-terminal queue exceeds {@link BACKPRESSURE_DROP_BYTES}.
 * Returns synchronously — the actual HTTP work happens in the background.
 */
export function bridgeData(terminalId: string, data: string): void {
  enqueueData(terminalId, data);
}

/**
 * Forward PTY exit. Awaits the queue drain first so the App's "terminal
 * closed" event arrives strictly after every byte the terminal produced.
 */
export async function bridgeExit(terminalId: string, exitCode: number): Promise<void> {
  await flushAndDrop(terminalId);
  await postRaw("/claude-pty/exit", { terminalId, exitCode });
}

/** True when the parent daemon's control HTTP base URL was injected. */
export function bridgeAvailable(): boolean {
  return Boolean(process.env[DAEMON_CONTROL_ENV]);
}

/**
 * Test-only — clears all queued state. Production callers never invoke this;
 * tests use it to keep cross-test isolation in the bridge module.
 */
export function _resetBridgeForTests(): void {
  queues.clear();
}
