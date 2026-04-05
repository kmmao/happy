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
  process: ChildProcess;
  cols: number;
  rows: number;
  shell: string;
  cwd: string;
  createdAt: number;
}

export type TerminalOutputHandler = (terminalId: string, data: string) => void;
export type TerminalExitHandler = (terminalId: string, exitCode: number) => void;

const MAX_TERMINALS = 5;
const MAX_OUTPUT_CHUNK = 8 * 1024; // 8KB per chunk

export class TerminalManager {
  private terminals = new Map<string, TerminalSession>();
  private onOutput: TerminalOutputHandler | null = null;
  private onExit: TerminalExitHandler | null = null;

  setOutputHandler(handler: TerminalOutputHandler): void {
    this.onOutput = handler;
  }

  setExitHandler(handler: TerminalExitHandler): void {
    this.onExit = handler;
  }

  spawn(options: {
    shell?: string;
    cwd?: string;
    cols?: number;
    rows?: number;
  }): { success: boolean; terminalId?: string; error?: string } {
    if (this.terminals.size >= MAX_TERMINALS) {
      return { success: false, error: `Maximum ${MAX_TERMINALS} terminals reached` };
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
        process: child,
        cols,
        rows,
        shell,
        cwd,
        createdAt: Date.now(),
      };

      this.terminals.set(id, session);

      // Stream stdout
      child.stdout?.on("data", (data: Buffer) => {
        if (this.onOutput) {
          const text = data.toString("utf-8");
          // Split into chunks if too large
          for (let i = 0; i < text.length; i += MAX_OUTPUT_CHUNK) {
            this.onOutput(id, text.slice(i, i + MAX_OUTPUT_CHUNK));
          }
        }
      });

      // Stream stderr (merge into output)
      child.stderr?.on("data", (data: Buffer) => {
        if (this.onOutput) {
          const text = data.toString("utf-8");
          for (let i = 0; i < text.length; i += MAX_OUTPUT_CHUNK) {
            this.onOutput(id, text.slice(i, i + MAX_OUTPUT_CHUNK));
          }
        }
      });

      child.on("exit", (code) => {
        logger.debug(`[TERMINAL] Terminal ${id} exited with code ${code}`);
        this.terminals.delete(id);
        if (this.onExit) {
          this.onExit(id, code ?? -1);
        }
      });

      child.on("error", (err) => {
        logger.debug(`[TERMINAL] Terminal ${id} error: ${err.message}`);
        this.terminals.delete(id);
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
    const session = this.terminals.get(terminalId);
    if (!session || !session.process.stdin?.writable) {
      return false;
    }
    session.process.stdin.write(data);
    return true;
  }

  resize(terminalId: string, cols: number, rows: number): boolean {
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

  close(terminalId: string): boolean {
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
    return true;
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
