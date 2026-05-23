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
 * relay one-way (PTY → daemon) over the daemon's local control HTTP server.
 *
 * The bridge is best-effort: if `HAPPY_DAEMON_CONTROL_URL` is absent (CLI was
 * launched without a daemon parent), every call no-ops with a debug log. The
 * fire-and-forget POSTs deliberately swallow errors — losing a chunk degrades
 * the App's raw-terminal observation but must never disturb the PTY itself.
 *
 * The reverse direction (App input → PTY) is intentionally NOT wired in v1.
 * Users type into the chat composer; the "Open Raw Terminal" view is
 * observation-only. The daemon's external attachment write/resize/close hooks
 * log + drop those calls so we don't silently route an arbitrary App stream
 * into the user's TUI.
 */

import { logger } from "@/ui/logger";

const DAEMON_CONTROL_ENV = "HAPPY_DAEMON_CONTROL_URL";

/** Build a Claude-prefixed terminalId for the daemon registry. Mirrors {@link import("./claudePtyRouter").claudeTerminalIdFor}. */
export function buildClaudeTerminalId(happySessionId: string): string {
  return `claude:${happySessionId}`;
}

async function post(path: string, body: unknown): Promise<void> {
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

export interface ClaudePtyBridgeAttachInput {
  terminalId: string;
  sessionId: string;
  cols: number;
  rows: number;
  cwd: string;
}

/** Register the Claude PTY with the daemon so App spawn/list RPCs can find it. */
export function bridgeAttach(input: ClaudePtyBridgeAttachInput): Promise<void> {
  return post("/claude-pty/attach", input);
}

/** Deregister; safe to call multiple times — daemon side is idempotent. */
export function bridgeDetach(terminalId: string): Promise<void> {
  return post("/claude-pty/detach", { terminalId });
}

/**
 * Forward a chunk of PTY output. Chunks are bounded by the upstream router
 * (8KB) and the daemon enforces a 64KB cap, so callers don't need to chunk.
 */
export function bridgeData(terminalId: string, data: string): Promise<void> {
  return post("/claude-pty/data", { terminalId, data });
}

/** Forward PTY exit so the App tears down its xterm.js instance. */
export function bridgeExit(terminalId: string, exitCode: number): Promise<void> {
  return post("/claude-pty/exit", { terminalId, exitCode });
}

/** True when the parent daemon's control HTTP base URL was injected. */
export function bridgeAvailable(): boolean {
  return Boolean(process.env[DAEMON_CONTROL_ENV]);
}
