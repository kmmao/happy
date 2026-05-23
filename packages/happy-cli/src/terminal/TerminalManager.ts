/**
 * TerminalManager — manages PTY sessions for the web terminal feature.
 *
 * Each terminal is a child process with piped stdio.
 * node-pty would give a real PTY, but to avoid native dependencies
 * we use child_process.spawn with 'script' wrapper for pseudo-TTY support.
 */

import { spawn, ChildProcess } from "child_process";
import { createId } from "@paralleldrive/cuid2";
import { logger } from "@/ui/logger";

export interface TerminalSession {
  id: string;
  sessionId?: string; // owning Claude session — used for persistent reattach
  process: ChildProcess;
  cols: number;
  rows: number;
  shell: string;
  cwd: string;
  createdAt: number;
  outputBuffer: string; // rolling buffer of recent output for reattach replay
}

export type TerminalOutputHandler = (terminalId: string, data: string) => void;
export type TerminalExitHandler = (terminalId: string, exitCode: number) => void;

/**
 * External PTY adapter — used by Remote-mode Claude PTY runtime to inject its
 * already-running PTY (terminalId = "claude:<sessionId>") into the same
 * web-terminal wire surface. The App then reattaches to it through the existing
 * `terminal-spawn` RPC by passing the matching `sessionId` or `terminalId`.
 *
 * Lifecycle: register on Claude PTY spawn, deregister on PTY exit. The adapter
 * does NOT own the PTY process — that lives in `claudePtyRuntime`. TerminalManager
 * only proxies write/resize/close.
 */
export interface ExternalPtyAttachment {
  /** Stable id of the form `claude:<sessionId>`. */
  readonly terminalId: string;
  /** Owning Happy session id; used for `listBySession` and reattach by sessionId. */
  readonly sessionId: string;
  readonly cols: number;
  readonly rows: number;
  readonly cwd: string;
  readonly createdAt: number;
  /** Rolling-buffer replay for reconnect, sourced from `claudePtyRouter`. */
  snapshot(): string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Best-effort close from the App side; PTY owner may ignore or honor it. */
  requestClose(): void;
}

const MAX_TERMINALS_PER_SESSION = 5;
const MAX_TERMINALS_GLOBAL = 20;
const MAX_OUTPUT_CHUNK = 8 * 1024;  // 8KB per chunk
const MAX_OUTPUT_BUFFER = 64 * 1024; // 64KB replay buffer per terminal

export class TerminalManager {
  private terminals = new Map<string, TerminalSession>();
  private sessionIndex = new Map<string, string[]>(); // sessionId → terminalId[]
  // External attachments are keyed by terminalId; sessionLookup mirrors the
  // sessionId→terminalId mapping so `spawn({ sessionId })` can find them
  // without scanning. We keep these maps separate from `terminals` so the
  // shell-PTY lifecycle code paths stay untouched.
  private externalAttachments = new Map<string, ExternalPtyAttachment>();
  private externalSessionLookup = new Map<string, string>(); // sessionId → terminalId
  private onOutput: TerminalOutputHandler | null = null;
  private onExit: TerminalExitHandler | null = null;

  setOutputHandler(handler: TerminalOutputHandler): void {
    this.onOutput = handler;
  }

  setExitHandler(handler: TerminalExitHandler): void {
    this.onExit = handler;
  }

  /**
   * Register an externally-managed PTY (e.g. Claude TUI) under the wire's
   * terminal protocol. The App can then reattach via `terminal-spawn`
   * by passing either the matching `terminalId` or `sessionId`. Returns
   * a disposer for symmetric teardown.
   */
  attachExternal(attachment: ExternalPtyAttachment): () => void {
    if (this.externalAttachments.has(attachment.terminalId)) {
      logger.debug(
        `[TERMINAL] attachExternal called twice for ${attachment.terminalId} — replacing`,
      );
    }
    this.externalAttachments.set(attachment.terminalId, attachment);
    this.externalSessionLookup.set(attachment.sessionId, attachment.terminalId);
    logger.debug(
      `[TERMINAL] External PTY attached: ${attachment.terminalId} (session ${attachment.sessionId})`,
    );
    return () => this.detachExternal(attachment.terminalId);
  }

  detachExternal(terminalId: string): void {
    const att = this.externalAttachments.get(terminalId);
    if (!att) return;
    this.externalAttachments.delete(terminalId);
    if (this.externalSessionLookup.get(att.sessionId) === terminalId) {
      this.externalSessionLookup.delete(att.sessionId);
    }
    logger.debug(`[TERMINAL] External PTY detached: ${terminalId}`);
  }

  /**
   * Broadcast a chunk of output from an external PTY through the shared
   * `terminal-output` socket event. Used by `claudePtyRouter` so consumers
   * downstream (xterm.js in the App) don't need a separate wire path.
   */
  emitExternalOutput(terminalId: string, data: string): void {
    if (!this.onOutput) return;
    for (let i = 0; i < data.length; i += MAX_OUTPUT_CHUNK) {
      this.onOutput(terminalId, data.slice(i, i + MAX_OUTPUT_CHUNK));
    }
  }

  /** Mirror exit semantics for external PTYs over the existing wire. */
  emitExternalExit(terminalId: string, exitCode: number): void {
    this.detachExternal(terminalId);
    this.onExit?.(terminalId, exitCode);
  }

  spawn(options: {
    shell?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
    sessionId?: string;
    terminalId?: string; // if provided, reattach to this specific PTY
  }): { success: boolean; terminalId?: string; recentOutput?: string; isExisting?: boolean; error?: string } {
    // External attachment reattach — Claude TUI PTYs live in `claudePtyRuntime`
    // and only surface here as a thin adapter. Resolve them via terminalId
    // ("claude:<sessionId>") OR sessionId for the App's button entry.
    const externalById = options.terminalId
      ? this.externalAttachments.get(options.terminalId)
      : undefined;
    const externalBySession = !externalById && options.sessionId
      ? this.externalAttachments.get(
          this.externalSessionLookup.get(options.sessionId) ?? "",
        )
      : undefined;
    const external = externalById ?? externalBySession;
    if (external) {
      if (options.cols && options.rows) {
        external.resize(options.cols, options.rows);
      }
      return {
        success: true,
        terminalId: external.terminalId,
        recentOutput: external.snapshot(),
        isExisting: true,
      };
    }

    // Reattach to a specific shell terminal by ID
    if (options.terminalId) {
      const existing = this.terminals.get(options.terminalId);
      if (existing) {
        if (options.cols && options.rows) {
          this.resize(options.terminalId, options.cols, options.rows);
        }
        return {
          success: true,
          terminalId: options.terminalId,
          recentOutput: existing.outputBuffer,
          isExisting: true,
        };
      }
      // Terminal not found — fall through to create new
    }

    // Check per-session limit
    if (options.sessionId) {
      const sessionTerminals = this.sessionIndex.get(options.sessionId) ?? [];
      if (sessionTerminals.length >= MAX_TERMINALS_PER_SESSION) {
        return { success: false, error: `Maximum ${MAX_TERMINALS_PER_SESSION} terminals per session reached` };
      }
    }

    // Check global limit
    if (this.terminals.size >= MAX_TERMINALS_GLOBAL) {
      return { success: false, error: `Maximum ${MAX_TERMINALS_GLOBAL} terminals reached` };
    }

    const id = createId();
    const shell = options.shell || process.env.SHELL || "/bin/sh";
    const cwd = options.cwd || process.env.HOME || "/";
    const cols = options.cols || 80;
    const rows = options.rows || 24;

    try {
      const env = {
        ...process.env,
        TERM: "xterm-256color",
        COLUMNS: String(cols),
        LINES: String(rows),
      };

      let child: ChildProcess;

      {
        // Both macOS and Linux: 'script' calls tcgetattr() on stdin to save terminal
        // settings. When the daemon's stdin is a pipe/socket (not a TTY), this fails with
        // "Operation not supported on socket". Use Python3's pty.openpty() on all platforms
        // — it allocates a real PTY pair without requiring the parent to have a controlling
        // terminal, and works identically on macOS and Linux.
        const ptyScript = `
import os, sys, pty, select, struct, termios, fcntl, signal, traceback

def dbg(msg):
    sys.stdout.write(f"[happy-pty] {msg}\\r\\n")
    sys.stdout.flush()

try:
    shell = os.environ['PTY_SHELL']
    cols  = int(os.environ.get('PTY_COLS', '80'))
    rows  = int(os.environ.get('PTY_ROWS', '24'))

    master_fd, slave_fd = pty.openpty()
    dbg(f"openpty ok: master={master_fd} slave={slave_fd} shell={shell}")

    try:
        fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    except Exception as e:
        dbg(f"TIOCSWINSZ warn: {e}")

    pid = os.fork()
    # Install SIGTERM handler (parent only) so killing python3 also kills the shell child
    def _sigterm(sig, frame):
        try: os.kill(pid, signal.SIGTERM)
        except OSError: pass
        sys.exit(0)
    signal.signal(signal.SIGTERM, _sigterm)
    if pid == 0:
        # Child: set up controlling terminal and exec shell
        os.close(master_fd)
        try:
            os.setsid()
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        except Exception as e:
            pass  # non-fatal: PTY still usable without controlling terminal
        for fd in (0, 1, 2):
            os.dup2(slave_fd, fd)
        if slave_fd > 2:
            os.close(slave_fd)
        env = dict(os.environ)
        env.update({
            'TERM': 'xterm-256color',
            'COLORTERM': 'truecolor',
            'COLUMNS': str(cols),
            'LINES': str(rows),
            'HAPPY_TERMINAL': '1',  # let startup scripts skip re-wrapping with script
        })
        os.execve(shell, [shell], env)
        sys.exit(127)

    # Parent: relay between PTY master and our stdin/stdout pipes
    os.close(slave_fd)
    fin  = sys.stdin.fileno()
    fout = sys.stdout.fileno()

    while True:
        try:
            r, _, _ = select.select([master_fd, fin], [], [], 1.0)
        except (OSError, ValueError):
            break
        if master_fd in r:
            try:
                data = os.read(master_fd, 4096)
                os.write(fout, data)
            except OSError:
                break
        if fin in r:
            try:
                data = os.read(fin, 4096)
                if not data:
                    break
                os.write(master_fd, data)
            except OSError:
                break
        try:
            wpid, wstatus = os.waitpid(pid, os.WNOHANG)
            if wpid != 0:
                break
        except ChildProcessError:
            break

    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass

except Exception:
    sys.stdout.write("[happy-pty ERROR]\\r\\n")
    sys.stdout.write(traceback.format_exc().replace("\\n", "\\r\\n"))
    sys.stdout.flush()
    sys.exit(1)
`;

        child = spawn("python3", ["-c", ptyScript], {
          cwd,
          env: {
            ...env,
            PTY_SHELL: shell,
            PTY_COLS: String(cols),
            PTY_ROWS: String(rows),
          },
          stdio: ["pipe", "pipe", "pipe"],
        });
      }

      const session: TerminalSession = {
        id,
        sessionId: options.sessionId,
        process: child,
        cols,
        rows,
        shell,
        cwd,
        createdAt: Date.now(),
        outputBuffer: "",
      };

      this.terminals.set(id, session);
      if (options.sessionId) {
        const existing = this.sessionIndex.get(options.sessionId) ?? [];
        this.sessionIndex.set(options.sessionId, [...existing, id]);
      }

      const appendToBuffer = (text: string) => {
        session.outputBuffer += text;
        if (session.outputBuffer.length > MAX_OUTPUT_BUFFER) {
          session.outputBuffer = session.outputBuffer.slice(session.outputBuffer.length - MAX_OUTPUT_BUFFER);
        }
      };

      // Stream stdout
      child.stdout?.on("data", (data: Buffer) => {
        const text = data.toString("utf-8");
        appendToBuffer(text);
        if (this.onOutput) {
          for (let i = 0; i < text.length; i += MAX_OUTPUT_CHUNK) {
            this.onOutput(id, text.slice(i, i + MAX_OUTPUT_CHUNK));
          }
        }
      });

      // Stream stderr (merge into output)
      child.stderr?.on("data", (data: Buffer) => {
        const text = data.toString("utf-8");
        appendToBuffer(text);
        if (this.onOutput) {
          for (let i = 0; i < text.length; i += MAX_OUTPUT_CHUNK) {
            this.onOutput(id, text.slice(i, i + MAX_OUTPUT_CHUNK));
          }
        }
      });

      child.on("exit", (code) => {
        logger.debug(`[TERMINAL] Terminal ${id} exited with code ${code}`);
        this.terminals.delete(id);
        this.removeFromSessionIndex(session.sessionId, id);
        if (this.onExit) {
          this.onExit(id, code ?? -1);
        }
      });

      child.on("error", (err) => {
        logger.debug(`[TERMINAL] Terminal ${id} error: ${err.message}`);
        this.terminals.delete(id);
        this.removeFromSessionIndex(session.sessionId, id);
        if (this.onExit) {
          this.onExit(id, -1);
        }
      });

      logger.debug(`[TERMINAL] Spawned terminal ${id} (shell=${shell}, cwd=${cwd}, ${cols}x${rows})`);
      return { success: true, terminalId: id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.debug(`[TERMINAL] Failed to spawn terminal: ${message}`);
      return { success: false, error: message };
    }
  }

  write(terminalId: string, data: string): boolean {
    const external = this.externalAttachments.get(terminalId);
    if (external) {
      external.write(data);
      return true;
    }
    const session = this.terminals.get(terminalId);
    if (!session || !session.process.stdin?.writable) {
      return false;
    }
    session.process.stdin.write(data);
    return true;
  }

  resize(terminalId: string, cols: number, rows: number): boolean {
    const external = this.externalAttachments.get(terminalId);
    if (external) {
      external.resize(cols, rows);
      return true;
    }
    const session = this.terminals.get(terminalId);
    if (!session) {
      return false;
    }
    session.cols = cols;
    session.rows = rows;
    // Send SIGWINCH to the child process to signal resize
    // The 'script' wrapper should propagate this to the inner shell
    try {
      if (session.process.pid) {
        // Set env vars for subsequent commands
        this.write(terminalId, `stty cols ${cols} rows ${rows}\n`);
      }
    } catch {
      // Best-effort resize
    }
    return true;
  }

  private removeFromSessionIndex(sessionId: string | undefined, terminalId: string): void {
    if (!sessionId) return;
    const ids = this.sessionIndex.get(sessionId) ?? [];
    const updated = ids.filter((id) => id !== terminalId);
    if (updated.length === 0) {
      this.sessionIndex.delete(sessionId);
    } else {
      this.sessionIndex.set(sessionId, updated);
    }
  }

  close(terminalId: string): boolean {
    const external = this.externalAttachments.get(terminalId);
    if (external) {
      // Don't tear down the underlying Claude PTY here — its lifecycle is owned
      // by claudePtyRuntime. We just signal a close request; the runtime can
      // forward it to the TUI (e.g. by writing Ctrl-C) if that's appropriate.
      external.requestClose();
      return true;
    }
    const session = this.terminals.get(terminalId);
    if (!session) {
      return false;
    }
    try {
      session.process.kill("SIGTERM");
      // Force kill after 3 seconds
      setTimeout(() => {
        try { session.process.kill("SIGKILL"); } catch { /* already dead */ }
      }, 3000);
    } catch {
      // Already dead
    }
    this.terminals.delete(terminalId);
    this.removeFromSessionIndex(session.sessionId, terminalId);
    return true;
  }

  listBySession(sessionId: string): Array<{ id: string; createdAt: number; cols: number; rows: number; cwd: string }> {
    const ids = this.sessionIndex.get(sessionId) ?? [];
    const shellTerminals = ids
      .map((id) => this.terminals.get(id))
      .filter((s): s is TerminalSession => s !== undefined)
      .map((s) => ({ id: s.id, createdAt: s.createdAt, cols: s.cols, rows: s.rows, cwd: s.cwd }));

    // Include the external Claude PTY attachment for this session (if any)
    // so the App's session-aware terminal list surfaces the raw TUI alongside
    // shell terminals.
    const externalTerminalId = this.externalSessionLookup.get(sessionId);
    const external = externalTerminalId
      ? this.externalAttachments.get(externalTerminalId)
      : undefined;
    if (external) {
      shellTerminals.push({
        id: external.terminalId,
        createdAt: external.createdAt,
        cols: external.cols,
        rows: external.rows,
        cwd: external.cwd,
      });
    }
    return shellTerminals;
  }

  closeAll(): void {
    for (const [id] of this.terminals) {
      this.close(id);
    }
  }

  getActiveCount(): number {
    return this.terminals.size;
  }

  hasTerminal(terminalId: string): boolean {
    return this.terminals.has(terminalId);
  }
}
