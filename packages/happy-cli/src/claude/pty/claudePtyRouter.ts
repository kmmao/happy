/**
 * claudePtyRouter — bridges a `ClaudePtyHandle` ↔ the terminal wire events
 * (`terminal-input` / `terminal-output` / `terminal-exit`).
 *
 * Responsibilities
 * ----------------
 *  - Forward bytes emitted by the PTY (`onData`) to the App via the
 *    `terminal-output` socket event, in chunks bounded by MAX_OUTPUT_CHUNK
 *    so a single large burst doesn't blow up a single packet.
 *  - Forward keystrokes / paste events delivered as `terminal-input` to
 *    the PTY's stdin.
 *  - Maintain a rolling ring buffer (default 64KB) of recent output. When
 *    the App reattaches (e.g. after a network blip or page reload), the
 *    buffer is replayed so the user sees the latest screen without
 *    waiting for new traffic. This mirrors the V2 reconnect protocol
 *    documented in `docs/competition/superset/terminal-sync.md`.
 *  - Emit a `terminal-exit` event when the PTY exits so the App can
 *    tear down its xterm.js instance.
 *
 * `terminalId` convention
 * -----------------------
 * The router uses `terminalId = "claude:" + happySessionId`. This is a
 * deliberate fork from generic shell terminals (which use cuid2 ids):
 * the App can detect the prefix and decide whether to route input
 * through the chat composer or directly through the WebTerminal — but
 * neither side requires this discrimination, so we keep the prefix
 * purely as a debugging aid for now.
 */

import type {
  ClaudePtyDataHandler,
  ClaudePtyExitHandler,
  ClaudePtyHandle,
} from "./claudePtyRuntime";
import { logger } from "@/ui/logger";

const MAX_OUTPUT_CHUNK = 8 * 1024; // 8KB per socket emit
const DEFAULT_BUFFER_BYTES = 64 * 1024; // 64KB rolling buffer

/** Convention: the App subscribes to `terminal-output` for this id. */
export function claudeTerminalIdFor(sessionId: string): string {
  return `claude:${sessionId}`;
}

export interface ClaudePtyRouterOptions {
  /** Stable Happy session id this PTY belongs to. */
  sessionId: string;
  /** Underlying PTY handle from `startClaudePty`. */
  pty: ClaudePtyHandle;
  /** Emit `terminal-output` to the App. */
  onOutput: (data: { terminalId: string; data: string }) => void;
  /** Emit `terminal-exit` to the App. */
  onExit: (data: { terminalId: string; exitCode: number }) => void;
  /** Override the default 64KB replay buffer. */
  ringBufferBytes?: number;
}

export interface ClaudePtyRouter {
  readonly terminalId: string;
  /** Most-recent bytes (up to `ringBufferBytes`) for reconnect replay. */
  snapshot(): string;
  /** Forward keystrokes from the App's xterm.js to the PTY. */
  acceptInput(data: string): void;
  /** Forward a resize request from the App's xterm.js to the PTY. */
  acceptResize(cols: number, rows: number): void;
  /** Detach handlers without killing the PTY. */
  dispose(): void;
}

export function attachClaudePtyRouter(
  options: ClaudePtyRouterOptions,
): ClaudePtyRouter {
  const terminalId = claudeTerminalIdFor(options.sessionId);
  const limit = options.ringBufferBytes ?? DEFAULT_BUFFER_BYTES;
  let buffer = "";

  const appendToBuffer = (text: string) => {
    buffer += text;
    if (buffer.length > limit) {
      buffer = buffer.slice(buffer.length - limit);
    }
  };

  const handleData: ClaudePtyDataHandler = (data) => {
    appendToBuffer(data);
    // Chunked emit: prevents a single >MB burst from a noisy command
    // from saturating a single socket packet.
    for (let i = 0; i < data.length; i += MAX_OUTPUT_CHUNK) {
      const chunk = data.slice(i, i + MAX_OUTPUT_CHUNK);
      try {
        options.onOutput({ terminalId, data: chunk });
      } catch (err) {
        logger.debug(
          `[claudePtyRouter] onOutput threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  const handleExit: ClaudePtyExitHandler = ({ exitCode }) => {
    try {
      options.onExit({ terminalId, exitCode });
    } catch (err) {
      logger.debug(
        `[claudePtyRouter] onExit threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const unsubData = options.pty.onData(handleData);
  const unsubExit = options.pty.onExit(handleExit);

  return {
    terminalId,
    snapshot() {
      return buffer;
    },
    acceptInput(data) {
      options.pty.write(data);
    },
    acceptResize(cols, rows) {
      options.pty.resize(cols, rows);
    },
    dispose() {
      unsubData();
      unsubExit();
    },
  };
}
