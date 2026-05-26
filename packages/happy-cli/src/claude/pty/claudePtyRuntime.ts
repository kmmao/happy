/**
 * claudePtyRuntime — thin wrapper around `node-pty` for the PTY migration.
 *
 * Owns the lifecycle of a single `claude` TUI child process:
 *   spawn  — launch claude with provided argv, cwd, env
 *   write  — push bytes to PTY stdin (user input from App composer)
 *   resize — propagate terminal size changes (xterm cols/rows)
 *   kill   — terminate the child (clean / SIGKILL fallback)
 *   onData — subscribe to stdout/stderr bytes (xterm renderer & ring buffer)
 *   onExit — subscribe to process exit
 *
 * Why a thin runtime layer
 * ------------------------
 * The router (`claudePtyRouter.ts`) bridges PTY data ↔ socket terminal
 * events; the higher-level integration (`claudeRemote.ts`) decides when
 * to spawn / kill / what flags to pass. Keeping the runtime mechanics
 * here makes both consumers easier to test in isolation.
 *
 * Test strategy
 * -------------
 * Tests target real spawnable binaries (`cat`, `echo`) so the runtime
 * mechanics get exercised without depending on `claude` being on PATH.
 * The router and the eventual `claudeRemote` integration get separate
 * tests on top of this layer.
 */

import { spawn as ptySpawn, type IPty } from "node-pty";
import { logger } from "@/ui/logger";

export interface ClaudePtyRuntimeOptions {
  /** Executable to spawn (defaults to `claude` on PATH). */
  command?: string;
  /** Argv passed to the executable. */
  args?: string[];
  /** Working directory for the child. */
  cwd?: string;
  /** Env vars for the child — caller is responsible for stripping `CLAUDECODE` etc. */
  env?: NodeJS.ProcessEnv;
  /** Initial terminal cols (default 80). */
  cols?: number;
  /** Initial terminal rows (default 24). */
  rows?: number;
  /** TERM env (default `xterm-256color`). */
  termName?: string;
}

export type ClaudePtyDataHandler = (data: string) => void;
export type ClaudePtyExitHandler = (event: { exitCode: number; signal?: number }) => void;

/**
 * Live PTY handle. Returned from `startClaudePty` — caller keeps a reference
 * for the duration of the claude session and disposes via `kill()` on
 * shutdown.
 *
 * Listeners attached via `onData` / `onExit` are detached automatically
 * when the underlying process exits. Calling `kill()` after exit is a
 * no-op; calling `write()` / `resize()` after exit is also a no-op (no
 * throw) so callers can ignore late events.
 */
export interface ClaudePtyHandle {
  /** Underlying node-pty process id (-1 if not yet spawned / already exited). */
  readonly pid: number;
  /** Current terminal columns. */
  readonly cols: number;
  /** Current terminal rows. */
  readonly rows: number;
  /** True after exit fires (or kill completes). */
  readonly exited: boolean;
  /**
   * Push bytes to PTY stdin. Returns true if the write was accepted by the
   * underlying PTY, false if the process is already exited or node-pty threw
   * (e.g. pipe was closed). Callers that route user prompts must inspect
   * this so the App can surface a "send failed" instead of silently dropping
   * the keystroke.
   */
  write(data: string): boolean;
  /** Resize the PTY. Returns true on success. */
  resize(cols: number, rows: number): boolean;
  /**
   * Stop the current turn by writing the Esc key (0x1b) to PTY stdin — the
   * Claude TUI's "esc to interrupt" key. NOT Ctrl-C: the TUI runs in raw mode
   * where Ctrl-C means "press again to exit", so it never stopped generation.
   * Returns true if the write was accepted.
   */
  interrupt(): boolean;
  /** Send signal and clean up. Falls back to SIGKILL after `graceMs`. */
  kill(signal?: NodeJS.Signals, graceMs?: number): void;
  /** Subscribe to PTY output bytes. Returns an unsubscribe fn. */
  onData(handler: ClaudePtyDataHandler): () => void;
  /** Subscribe to PTY exit. Returns an unsubscribe fn. */
  onExit(handler: ClaudePtyExitHandler): () => void;
}

/**
 * Spawn a `claude` (or any other) TUI process under a PTY.
 *
 * Throws if the binary is missing / `pty.spawn` rejects. Callers typically
 * surface that as a session-startup error rather than retry.
 */
export function startClaudePty(opts: ClaudePtyRuntimeOptions = {}): ClaudePtyHandle {
  const command = opts.command ?? "claude";
  const args = opts.args ?? [];
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  const env = sanitizeEnv(opts.env ?? process.env, cols, rows);

  logger.debug(
    `[claudePty] spawning command=${command} args=${args.length} cwd=${opts.cwd ?? "(default)"} ${cols}x${rows}`,
  );

  const child: IPty = ptySpawn(command, args, {
    name: opts.termName ?? "xterm-256color",
    cols,
    rows,
    cwd: opts.cwd,
    env: env as { [key: string]: string },
  });

  const dataHandlers = new Set<ClaudePtyDataHandler>();
  const exitHandlers = new Set<ClaudePtyExitHandler>();
  const state = {
    pid: child.pid ?? -1,
    cols,
    rows,
    exited: false,
  };
  // SIGKILL fallback timer armed by `kill()`. Tracked so repeated `kill()`
  // calls (e.g. caller abort + shutdown path) don't stack multiple timers,
  // and so we can clear it once the child exits on its own.
  let killTimer: ReturnType<typeof setTimeout> | null = null;

  // node-pty's onData fires once per chunk read from the PTY master.
  child.onData((data: string) => {
    if (state.exited) return;
    for (const handler of dataHandlers) {
      try {
        handler(data);
      } catch (err) {
        logger.debug(`[claudePty] data handler threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  // onExit fires once when the child process exits (or is killed).
  child.onExit(({ exitCode, signal }) => {
    state.exited = true;
    state.pid = -1;
    if (killTimer !== null) {
      clearTimeout(killTimer);
      killTimer = null;
    }
    logger.debug(`[claudePty] exited code=${exitCode} signal=${signal ?? ""}`);
    for (const handler of exitHandlers) {
      try {
        handler({ exitCode, signal });
      } catch (err) {
        logger.debug(`[claudePty] exit handler threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    dataHandlers.clear();
    exitHandlers.clear();
  });

  return {
    get pid() {
      return state.pid;
    },
    get cols() {
      return state.cols;
    },
    get rows() {
      return state.rows;
    },
    get exited() {
      return state.exited;
    },
    write(data) {
      if (state.exited) return false;
      try {
        child.write(data);
        return true;
      } catch (err) {
        logger.debug(`[claudePty] write failed: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    },
    resize(newCols, newRows) {
      if (state.exited) return false;
      if (newCols <= 0 || newRows <= 0) return false;
      try {
        child.resize(newCols, newRows);
        // Only record the new size once node-pty accepted it, so the
        // reported cols/rows never drift from the PTY's actual winsize
        // when a resize throws.
        state.cols = newCols;
        state.rows = newRows;
        return true;
      } catch (err) {
        logger.debug(`[claudePty] resize failed: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    },
    interrupt() {
      if (state.exited) return false;
      // Esc byte (0x1b) — NOT Ctrl-C. The Claude TUI runs its PTY in raw mode
      // (ISIG off), so Ctrl-C (0x03) is delivered as a literal keystroke, and
      // the TUI treats it as "press again to exit", not "stop generation" — so
      // sending \x03 left the turn running (the "stop button does nothing /
      // takes several taps" bug). Esc is the TUI's actual interrupt key (the
      // "esc to interrupt" hint shown during a turn). A lone \x1b resolves to a
      // bare Escape press once the TUI's escape-sequence timeout fires (nothing
      // follows it), exactly as a human pressing Esc. We never send SIGINT to
      // the process group, to keep the session alive.
      try {
        child.write("\x1b");
        return true;
      } catch (err) {
        logger.debug(`[claudePty] interrupt write failed: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    },
    kill(signal = "SIGTERM", graceMs = 3000) {
      if (state.exited) return;
      try {
        child.kill(signal);
      } catch {
        // already dead
      }
      // Force kill if it hangs. A SIGKILL fallback is already armed if kill()
      // was called before — don't stack a second timer.
      if (killTimer !== null) return;
      killTimer = setTimeout(() => {
        killTimer = null;
        if (state.exited) return;
        try {
          child.kill("SIGKILL");
        } catch {
          // already dead
        }
      }, graceMs);
      // Unref so this timer doesn't keep the process alive on its own.
      killTimer.unref?.();
    },
    onData(handler) {
      if (state.exited) return () => undefined;
      dataHandlers.add(handler);
      return () => {
        dataHandlers.delete(handler);
      };
    },
    onExit(handler) {
      if (state.exited) {
        // Already exited — fire synchronously to keep consumer code simple.
        // But do so on next tick so the caller's subscribe path completes
        // before the callback fires.
        queueMicrotask(() => handler({ exitCode: 0 }));
        return () => undefined;
      }
      exitHandlers.add(handler);
      return () => {
        exitHandlers.delete(handler);
      };
    },
  };
}

function sanitizeEnv(
  base: NodeJS.ProcessEnv,
  cols: number,
  rows: number,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };

  // Avoid nested-session detection from inside `claude` (it checks
  // `CLAUDECODE` to refuse re-entry).
  delete env.CLAUDECODE;

  // Encourage a colourful TUI on Web terminals (xterm.js supports
  // truecolor). The user's existing env wins if they set these.
  env.TERM = env.TERM ?? "xterm-256color";
  env.COLORTERM = env.COLORTERM ?? "truecolor";
  env.COLUMNS = String(cols);
  env.LINES = String(rows);
  // Marker so claude can detect it's running inside happy.
  env.HAPPY_TERMINAL = env.HAPPY_TERMINAL ?? "1";

  return env;
}
