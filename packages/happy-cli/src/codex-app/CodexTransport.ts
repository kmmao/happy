import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadLineInterface } from "node:readline";
import { logger } from "@/ui/logger";

/**
 * Transport layer for the Codex app-server JSON-RPC channel.
 *
 * This decouples "how frames are shuttled and how the underlying channel lives
 * and dies" from CodexAppServerClient's protocol logic. Two implementations:
 *
 *  - StdioSpawnTransport: spawns and *owns* a `codex app-server` child process,
 *    talking newline-delimited JSON over its stdin/stdout. Closing it kills the
 *    owned process (SIGKILL).
 *  - WebSocketTransport: attaches to an externally-managed app-server endpoint
 *    over WebSocket using the exact same JSON-RPC frames. Closing it only drops
 *    the socket — it never kills a runtime Happy does not own.
 */

export type CodexTransportKind = "stdio" | "websocket";

export interface CodexTransportCloseInfo {
  code?: number | null;
  signal?: string | null;
  error?: Error;
}

export interface CodexTransport {
  readonly kind: CodexTransportKind;
  /** Establish the channel (spawn / connect) and begin delivering frames. */
  open(): Promise<void>;
  /** Send one serialized JSON-RPC frame (without a trailing newline). */
  send(frame: string): void;
  /** Register the handler invoked once per inbound JSON-RPC frame. */
  onMessage(handler: (frame: string) => void): void;
  /** Register the handler invoked once when the channel terminates. */
  onClose(handler: (info: CodexTransportCloseInfo) => void): void;
  /**
   * Tear down the channel. Stdio kills the owned child process; WebSocket only
   * closes the socket and leaves the externally-owned runtime running.
   */
  close(): Promise<void>;
}

export interface StdioSpawnOptions {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
}

export class StdioSpawnTransport implements CodexTransport {
  readonly kind = "stdio" as const;

  private process: ChildProcessWithoutNullStreams | null = null;
  private reader: ReadLineInterface | null = null;
  private messageHandler: ((frame: string) => void) | null = null;
  private closeHandler: ((info: CodexTransportCloseInfo) => void) | null = null;

  constructor(private readonly options: StdioSpawnOptions) {}

  onMessage(handler: (frame: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (info: CodexTransportCloseInfo) => void): void {
    this.closeHandler = handler;
  }

  async open(): Promise<void> {
    const child = spawn(this.options.command, this.options.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.options.env,
      cwd: this.options.cwd,
    });
    this.process = child;

    this.reader = createInterface({ input: child.stdout });
    this.reader.on("line", (line) => {
      this.messageHandler?.(line);
    });

    child.stderr.on("data", (data) => {
      logger.debug(`[CodexAppServer][stderr] ${data.toString()}`);
    });

    child.on("exit", (code, signal) => {
      this.closeHandler?.({ code, signal });
    });
  }

  send(frame: string): void {
    this.process?.stdin.write(`${frame}\n`);
  }

  async close(): Promise<void> {
    this.reader?.close();
    this.reader = null;

    if (this.process && !this.process.killed) {
      this.process.kill("SIGKILL");
    }
    this.process = null;
  }
}

export class WebSocketTransport implements CodexTransport {
  readonly kind = "websocket" as const;

  private socket: WebSocket | null = null;
  private messageHandler: ((frame: string) => void) | null = null;
  private closeHandler: ((info: CodexTransportCloseInfo) => void) | null = null;

  constructor(private readonly endpoint: string) {}

  onMessage(handler: (frame: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (info: CodexTransportCloseInfo) => void): void {
    this.closeHandler = handler;
  }

  async open(): Promise<void> {
    if (typeof WebSocket === "undefined") {
      throw new Error(
        "HAPPY_CODEX_ENDPOINT requires a runtime with a global WebSocket (Node 21+).",
      );
    }

    const socket = new WebSocket(this.endpoint);
    this.socket = socket;

    socket.addEventListener("message", (event) => {
      const data =
        typeof event.data === "string" ? event.data : String(event.data);
      // Endpoints may batch newline-delimited frames into one message; split to
      // mirror the line-oriented stdio protocol exactly.
      for (const line of data.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          this.messageHandler?.(trimmed);
        }
      }
    });

    socket.addEventListener("close", (event) => {
      this.closeHandler?.({ code: event.code });
    });

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(
          new Error(
            `Failed to connect to Codex app-server endpoint ${this.endpoint}`,
          ),
        );
      };
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    });
  }

  send(frame: string): void {
    this.socket?.send(frame);
  }

  async close(): Promise<void> {
    // Drop the socket only. The endpoint runtime is externally owned, so unlike
    // the stdio transport we never kill a process here.
    this.socket?.close();
    this.socket = null;
  }
}

/**
 * Resolve an optional external Codex app-server endpoint from the environment.
 * Mirrors the env-driven backend selection used elsewhere (HAPPY_CODEX_BACKEND).
 * When set, `happy codex` attaches to the endpoint instead of spawning its own
 * `codex app-server` child process.
 */
export function resolveCodexEndpoint(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.HAPPY_CODEX_ENDPOINT?.trim();
  return raw ? raw : null;
}
