/**
 * TerminalManager — manages PTY sessions for the web terminal feature.
 *
 * Both "internal" shell PTYs (spawned on demand by the App's
 * `terminal-spawn` RPC) and "external" PTYs (the Claude TUI owned by
 * `claudePtyRuntime` in the session child) live in the same
 * `Map<terminalId, ManagedPty>`. Every consumer code path (write / resize /
 * close / listBySession) operates on the unified `ManagedPty` interface so
 * there are no parallel `if (external) … else …` branches.
 *
 * Internal PTYs use `node-pty` directly — earlier revisions wrapped a small
 * Python `pty.openpty()` script under `child_process.spawn` "to avoid native
 * dependencies", but the Claude PTY path already pulls `node-pty` in as a
 * dependency, so the workaround is gone and resize now uses real
 * `TIOCSWINSZ` + SIGWINCH (the inline `stty cols X rows Y\n` write was
 * fragile and visible in the user's shell).
 */

import { spawn as ptySpawn, type IPty } from "node-pty";
import { createId } from "@paralleldrive/cuid2";
import { logger } from "@/ui/logger";
import {
  TERMINAL_OUTPUT_CHUNK_BYTES,
  TERMINAL_REPLAY_BUFFER_BYTES,
  chunkStringSafe,
  createReplayBuffer,
} from "@kmmao/happy-wire";

export type TerminalOutputHandler = (terminalId: string, data: string) => void;
export type TerminalExitHandler = (terminalId: string, exitCode: number) => void;

/**
 * Unified PTY surface. Both shell terminals and Claude TUI attachments
 * implement this — `TerminalManager` only ever talks through it, so the
 * write/resize/close paths have a single branch.
 */
interface ManagedPty {
  readonly terminalId: string;
  readonly sessionId?: string;
  readonly kind: "internal" | "external";
  readonly createdAt: number;
  cols: number;
  rows: number;
  cwd: string;
  /** Most recent bytes for reconnect replay. */
  snapshot(): string;
  /** Append a chunk to the replay buffer (external attachments only — internal PTYs append themselves on `onData`). */
  appendOutput?(data: string): void;
  /** Write input to the PTY. Returns true if accepted. */
  write(data: string): boolean;
  /** Resize the PTY. Returns true if accepted. */
  resize(cols: number, rows: number): boolean;
  /**
   * Tear down the PTY. For internal terminals this kills the child
   * (SIGTERM with SIGKILL fallback); for external attachments this signals
   * a best-effort close to the upstream owner — the owner may ignore or
   * honor it.
   */
  close(): void;
}

/**
 * External PTY adapter — the Claude PTY runtime injects its already-running
 * PTY (terminalId = "claude:<sessionId>") into the same web-terminal wire
 * surface so the App can subscribe through the existing `terminal-spawn` RPC.
 *
 * The adapter does NOT own the PTY process — that lives in `claudePtyRuntime`.
 * TerminalManager only proxies write/resize/close.
 *
 * For backward compat with `attachExternal` callers we accept the legacy
 * shape (snapshot/write/resize/requestClose) and adapt it into a `ManagedPty`
 * internally.
 */
export interface ExternalPtyAttachment {
  readonly terminalId: string;
  readonly sessionId: string;
  readonly cols: number;
  readonly rows: number;
  readonly cwd: string;
  readonly createdAt: number;
  snapshot(): string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Best-effort close from the App side; PTY owner may ignore or honor it. */
  requestClose(): void;
}

const MAX_TERMINALS_PER_SESSION = 5;
const MAX_TERMINALS_GLOBAL = 20;
const MAX_OUTPUT_CHUNK = TERMINAL_OUTPUT_CHUNK_BYTES;
const MAX_OUTPUT_BUFFER = TERMINAL_REPLAY_BUFFER_BYTES;

/**
 * Per-session indices split by PTY kind. The external (Claude TUI) PTY is
 * part of the session lifecycle, not a user-visible shell — keeping it on
 * a separate set means it doesn't eat into the 5-shells-per-session quota
 * and `terminal-list` can return shells only, while a dedicated
 * `claude-pty-attach` RPC reaches the external one.
 */
interface SessionPtyIndex {
  internal: Set<string>;
  external: Set<string>;
}

export class TerminalManager {
  private ptys = new Map<string, ManagedPty>();
  private sessionIndex = new Map<string, SessionPtyIndex>();
  private onOutput: TerminalOutputHandler | null = null;
  private onExit: TerminalExitHandler | null = null;

  setOutputHandler(handler: TerminalOutputHandler): void {
    this.onOutput = handler;
  }

  setExitHandler(handler: TerminalExitHandler): void {
    this.onExit = handler;
  }

  // ── External attachments (Claude PTY) ──────────────────────────────────

  /**
   * Register an externally-managed PTY (currently only the Claude TUI). The
   * App can reattach via `terminal-spawn` by passing either the matching
   * `terminalId` or `sessionId`. Returns a disposer for symmetric teardown.
   *
   * The replay buffer is owned by the adapter — callers no longer need to
   * thread a separate buffer-append callback through `forwardClaudePtyData`;
   * they just call `emitExternalOutput`.
   */
  attachExternal(attachment: ExternalPtyAttachment): () => void {
    if (this.ptys.has(attachment.terminalId)) {
      logger.debug(
        `[TERMINAL] attachExternal called twice for ${attachment.terminalId} — replacing`,
      );
    }
    const managed = wrapExternalAttachment(attachment);
    this.ptys.set(attachment.terminalId, managed);
    this.indexSession(attachment.sessionId, attachment.terminalId, "external");
    logger.debug(
      `[TERMINAL] External PTY attached: ${attachment.terminalId} (session ${attachment.sessionId})`,
    );
    return () => this.detachExternal(attachment.terminalId);
  }

  detachExternal(terminalId: string): void {
    const pty = this.ptys.get(terminalId);
    if (!pty || pty.kind !== "external") return;
    this.ptys.delete(terminalId);
    this.unindexSession(pty.sessionId, terminalId, "external");
    logger.debug(`[TERMINAL] External PTY detached: ${terminalId}`);
  }

  /**
   * Look up the external (Claude TUI) PTY currently attached to a session,
   * if any. Used by the `claude-pty-attach` RPC so the App's dedicated
   * Claude tab can mirror the running Claude process without going through
   * `terminal-spawn` (which would otherwise have to special-case external
   * PTYs and risk colliding with shell spawn requests).
   *
   * By convention only one external PTY is attached per session.
   */
  getExternalForSession(sessionId: string): ManagedPty | undefined {
    const index = this.sessionIndex.get(sessionId);
    if (!index) return undefined;
    for (const id of index.external) {
      const pty = this.ptys.get(id);
      if (pty) return pty;
    }
    return undefined;
  }

  /**
   * Broadcast a chunk of output from an external PTY through the shared
   * `terminal-output` socket event. Updates the attachment's replay buffer
   * in passing so reconnects see the latest screen.
   */
  emitExternalOutput(terminalId: string, data: string): void {
    const pty = this.ptys.get(terminalId);
    if (!pty || pty.kind !== "external") return;
    pty.appendOutput?.(data);
    if (!this.onOutput) return;
    for (const chunk of chunkStringSafe(data, MAX_OUTPUT_CHUNK)) {
      this.onOutput(terminalId, chunk);
    }
  }

  /** Mirror exit semantics for external PTYs over the existing wire. */
  emitExternalExit(terminalId: string, exitCode: number): void {
    this.detachExternal(terminalId);
    this.onExit?.(terminalId, exitCode);
  }

  // ── Internal shell PTYs ────────────────────────────────────────────────

  spawn(options: {
    shell?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
    sessionId?: string;
    /** If provided, reattach to this specific PTY (internal or external). */
    terminalId?: string;
  }): {
    success: boolean;
    terminalId?: string;
    recentOutput?: string;
    isExisting?: boolean;
    error?: string;
  } {
    // Reattach path — works for both internal and external since they
    // implement the same surface.
    const existing = this.resolveExisting(options.terminalId, options.sessionId);
    if (existing) {
      if (options.cols && options.rows) {
        existing.resize(options.cols, options.rows);
      }
      // Reattach (isExisting=true) — spawn is idempotent per
      // (terminalId, sessionId). Surfaced explicitly because clients
      // that don't honor `isExisting` can mistake it for a fresh spawn
      // and produce duplicate UI tabs (see SidePanelTerminalTab).
      const matchedBy = options.terminalId && this.ptys.get(options.terminalId) === existing
        ? "terminalId"
        : "sessionId";
      logger.debug(
        `[TERMINAL] Reattach (isExisting=true) ${existing.terminalId} ` +
        `(kind=${existing.kind}, matchedBy=${matchedBy}, ` +
        `reqTerminalId=${options.terminalId ?? "-"}, reqSessionId=${options.sessionId ?? "-"})`,
      );
      return {
        success: true,
        terminalId: existing.terminalId,
        recentOutput: existing.snapshot(),
        isExisting: true,
      };
    }

    if (options.sessionId) {
      // Only internal shell PTYs count against the per-session quota — the
      // external Claude TUI is part of the session lifecycle, not a user
      // shell. See SessionPtyIndex above.
      const index = this.sessionIndex.get(options.sessionId);
      if (index && index.internal.size >= MAX_TERMINALS_PER_SESSION) {
        return {
          success: false,
          error: `Maximum ${MAX_TERMINALS_PER_SESSION} terminals per session reached`,
        };
      }
    }

    if (this.ptys.size >= MAX_TERMINALS_GLOBAL) {
      return {
        success: false,
        error: `Maximum ${MAX_TERMINALS_GLOBAL} terminals reached`,
      };
    }

    const id = createId();
    const shell = options.shell || process.env.SHELL || "/bin/sh";
    const cwd = options.cwd || process.env.HOME || "/";
    const cols = options.cols || 80;
    const rows = options.rows || 24;

    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        COLUMNS: String(cols),
        LINES: String(rows),
        // Let user startup scripts skip self-wrapping with `script`/`tmux`.
        HAPPY_TERMINAL: process.env.HAPPY_TERMINAL ?? "1",
      };

      const child: IPty = ptySpawn(shell, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        // node-pty's d.ts insists on string-valued env; we filter undefined
        // upstream by virtue of spreading `process.env` which is already
        // `string | undefined` — cast to satisfy the type.
        env: env as { [key: string]: string },
      });

      const managed = createInternalPty({
        terminalId: id,
        sessionId: options.sessionId,
        cwd,
        cols,
        rows,
        shell,
        pty: child,
        emitOutput: (chunk) => {
          if (!this.onOutput) return;
          for (const piece of chunkStringSafe(chunk, MAX_OUTPUT_CHUNK)) {
            this.onOutput(id, piece);
          }
        },
        emitExit: (code) => {
          // Pull from map first so a re-entrant exit handler can't double-emit.
          if (this.ptys.delete(id)) {
            this.unindexSession(options.sessionId, id, "internal");
          }
          this.onExit?.(id, code);
        },
      });

      this.ptys.set(id, managed);
      this.indexSession(options.sessionId, id, "internal");
      logger.debug(
        `[TERMINAL] Spawned terminal ${id} (shell=${shell}, cwd=${cwd}, ${cols}x${rows}, pid=${child.pid})`,
      );
      return { success: true, terminalId: id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.debug(`[TERMINAL] Failed to spawn terminal: ${message}`);
      return { success: false, error: message };
    }
  }

  // ── Unified write/resize/close ─────────────────────────────────────────

  write(terminalId: string, data: string): boolean {
    const pty = this.ptys.get(terminalId);
    return pty ? pty.write(data) : false;
  }

  resize(terminalId: string, cols: number, rows: number): boolean {
    const pty = this.ptys.get(terminalId);
    return pty ? pty.resize(cols, rows) : false;
  }

  close(terminalId: string): boolean {
    const pty = this.ptys.get(terminalId);
    if (!pty) return false;
    if (pty.kind === "external") {
      // Don't tear down the upstream PTY — its lifecycle is owned elsewhere.
      pty.close();
      return true;
    }
    pty.close();
    // Internal PTY's own exit handler will remove it from the map; nothing
    // else to do here.
    return true;
  }

  /**
   * List PTYs attached to a session. The default ("internal") matches the
   * App's "Terminal" side panel, which only wants user shells. Pass
   * "external" to enumerate the Claude TUI attachment, or "all" if a caller
   * genuinely needs the union (currently nobody does).
   */
  listBySession(
    sessionId: string,
    kind: "internal" | "external" | "all" = "internal",
  ): Array<{ id: string; createdAt: number; cols: number; rows: number; cwd: string }> {
    const index = this.sessionIndex.get(sessionId);
    if (!index) return [];
    const result: Array<{ id: string; createdAt: number; cols: number; rows: number; cwd: string }> = [];
    const collect = (ids: Set<string>) => {
      for (const id of ids) {
        const pty = this.ptys.get(id);
        if (!pty) continue;
        result.push({
          id: pty.terminalId,
          createdAt: pty.createdAt,
          cols: pty.cols,
          rows: pty.rows,
          cwd: pty.cwd,
        });
      }
    };
    if (kind === "internal" || kind === "all") collect(index.internal);
    if (kind === "external" || kind === "all") collect(index.external);
    return result;
  }

  closeAll(): void {
    // Snapshot to a list first because close() mutates the map.
    for (const id of [...this.ptys.keys()]) {
      this.close(id);
    }
  }

  getActiveCount(): number {
    // Only internal terminals count against quotas / "active shells" — the
    // external Claude PTY is part of the session lifecycle, not a user shell.
    let count = 0;
    for (const pty of this.ptys.values()) {
      if (pty.kind === "internal") count++;
    }
    return count;
  }

  hasTerminal(terminalId: string): boolean {
    return this.ptys.has(terminalId);
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  /**
   * Resolve an existing PTY for a `terminal-spawn` reattach request.
   *
   * We deliberately do NOT fall back to "any pty under this session" when
   * only `sessionId` is given — that path used to short-circuit to the
   * external Claude TUI, which silently swallowed shell `+` clicks (the
   * App got `isExisting: true` for a terminalId it already had a tab for,
   * and the new shell was never spawned). The dedicated `claude-pty-attach`
   * RPC owns the Claude PTY reattach path now; `terminal-spawn` is shells
   * only, and a missing `terminalId` always means "create a new shell".
   *
   * Direct lookup by `terminalId` still works for both internal and
   * external PTYs — callers that genuinely want to reattach to the Claude
   * PTY through this RPC may pass the explicit `claude:<sessionId>` id.
   */
  private resolveExisting(
    terminalId: string | undefined,
    _sessionId: string | undefined,
  ): ManagedPty | undefined {
    if (!terminalId) return undefined;
    return this.ptys.get(terminalId);
  }

  private indexSession(
    sessionId: string | undefined,
    terminalId: string,
    kind: "internal" | "external",
  ): void {
    if (!sessionId) return;
    let index = this.sessionIndex.get(sessionId);
    if (!index) {
      index = { internal: new Set(), external: new Set() };
      this.sessionIndex.set(sessionId, index);
    }
    index[kind].add(terminalId);
  }

  private unindexSession(
    sessionId: string | undefined,
    terminalId: string,
    kind: "internal" | "external",
  ): void {
    if (!sessionId) return;
    const index = this.sessionIndex.get(sessionId);
    if (!index) return;
    index[kind].delete(terminalId);
    if (index.internal.size === 0 && index.external.size === 0) {
      this.sessionIndex.delete(sessionId);
    }
  }
}

// ── ManagedPty factories ────────────────────────────────────────────────

function wrapExternalAttachment(att: ExternalPtyAttachment): ManagedPty {
  // External attachments now own their own replay buffer — callers used to
  // thread a buffer-append callback through `forwardClaudePtyData`; the
  // adapter does it transparently via `appendOutput` instead. The ANSI-
  // aware replay buffer drops history at clear-screen markers and never
  // splits an escape sequence on trim.
  const replay = createReplayBuffer({ limit: 4 * MAX_OUTPUT_BUFFER });
  const initial = att.snapshot();
  if (initial.length > 0) replay.append(initial);
  let cols = att.cols;
  let rows = att.rows;
  return {
    terminalId: att.terminalId,
    sessionId: att.sessionId,
    kind: "external",
    createdAt: att.createdAt,
    get cols() {
      return cols;
    },
    set cols(v) {
      cols = v;
    },
    get rows() {
      return rows;
    },
    set rows(v) {
      rows = v;
    },
    cwd: att.cwd,
    snapshot() {
      return replay.snapshot();
    },
    appendOutput(data) {
      replay.append(data);
    },
    write(data) {
      try {
        att.write(data);
        return true;
      } catch (err) {
        logger.debug(
          `[TERMINAL] external write failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
    },
    resize(newCols, newRows) {
      cols = newCols;
      rows = newRows;
      try {
        att.resize(newCols, newRows);
        return true;
      } catch (err) {
        logger.debug(
          `[TERMINAL] external resize failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
    },
    close() {
      try {
        att.requestClose();
      } catch (err) {
        logger.debug(
          `[TERMINAL] external close failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}

function createInternalPty(opts: {
  terminalId: string;
  sessionId: string | undefined;
  cwd: string;
  cols: number;
  rows: number;
  shell: string;
  pty: IPty;
  emitOutput: (chunk: string) => void;
  emitExit: (code: number) => void;
}): ManagedPty {
  const replay = createReplayBuffer({ limit: 4 * MAX_OUTPUT_BUFFER });
  let cols = opts.cols;
  let rows = opts.rows;
  let exited = false;
  const createdAt = Date.now();

  opts.pty.onData((data: string) => {
    replay.append(data);
    opts.emitOutput(data);
  });

  opts.pty.onExit(({ exitCode, signal }) => {
    if (exited) return;
    exited = true;
    logger.debug(
      `[TERMINAL] Terminal ${opts.terminalId} exited code=${exitCode} signal=${signal ?? "?"}`,
    );
    opts.emitExit(exitCode ?? -1);
  });

  return {
    terminalId: opts.terminalId,
    sessionId: opts.sessionId,
    kind: "internal",
    createdAt,
    get cols() {
      return cols;
    },
    set cols(v) {
      cols = v;
    },
    get rows() {
      return rows;
    },
    set rows(v) {
      rows = v;
    },
    cwd: opts.cwd,
    snapshot() {
      return replay.snapshot();
    },
    write(data) {
      if (exited) return false;
      try {
        opts.pty.write(data);
        return true;
      } catch (err) {
        logger.debug(
          `[TERMINAL] internal write failed for ${opts.terminalId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
    },
    resize(newCols, newRows) {
      if (exited || newCols <= 0 || newRows <= 0) return false;
      cols = newCols;
      rows = newRows;
      try {
        // node-pty issues TIOCSWINSZ + SIGWINCH internally; far more reliable
        // than the previous `stty cols X rows Y\n` write-to-stdin hack which
        // depended on the shell behaving and was visible to the user.
        opts.pty.resize(newCols, newRows);
        return true;
      } catch (err) {
        logger.debug(
          `[TERMINAL] internal resize failed for ${opts.terminalId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
    },
    close() {
      if (exited) return;
      try {
        opts.pty.kill("SIGTERM");
      } catch {
        // already dead
      }
      // Force-kill if it hangs. unref so the timer doesn't keep the daemon
      // alive on its own.
      const timer = setTimeout(() => {
        if (exited) return;
        try {
          opts.pty.kill("SIGKILL");
        } catch {
          // already dead
        }
      }, 3000);
      timer.unref?.();
    },
  };
}
