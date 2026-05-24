/**
 * claudePtyReverseServer — per-session HTTP endpoint that lets the daemon
 * forward App→PTY traffic back into the Claude TUI.
 *
 * Why a tiny dedicated server?
 * ----------------------------
 * The daemon owns the App-facing terminal wire (`terminal-input`/`-resize`
 * /`-close` socket events), but the actual Claude PTY lives in the per-session
 * child. Until this server existed, the App could only observe the PTY —
 * any input arriving on the daemon was silently dropped because the daemon
 * had no IPC channel back to the child. Now each session opens an
 * `http://127.0.0.1:<random>` endpoint, the URL is included in the
 * `claude-pty/attach` POST, and the daemon's `attachClaudePty` stores it so
 * `apiMachine`'s external-attachment `write`/`resize`/`requestClose` paths
 * can POST straight to it.
 *
 * Why not reuse `startHookServer` (Claude hooks)?
 * -----------------------------------------------
 * The hook server has a different lifetime — it stays up for the whole
 * `runClaude` loop (across PTY restarts on resume/compact), whereas reverse
 * input must be torn down with the specific PTY it routes to. Keeping the
 * two servers separate also keeps each server's request surface narrow,
 * so neither risks accidentally exposing the other's contract.
 *
 * Security
 * --------
 * Binds 127.0.0.1 only — no LAN exposure. There is no auth: any process
 * on the same loopback that discovers the random port can drive the PTY.
 * That's the same trust model as `HAPPY_DAEMON_CONTROL_URL`, which the
 * daemon already exposes; both rely on local-user-only access.
 */

import { createServer, IncomingMessage, Server } from "node:http";
import { logger } from "@/ui/logger";

export interface ClaudePtyReverseHandlers {
  /** Forward keystrokes from the App's xterm.js into the PTY's stdin. */
  input(data: string): void;
  /** Forward a resize from the App into the PTY. */
  resize(cols: number, rows: number): void;
  /**
   * Best-effort close from the App. Implementation may choose to no-op
   * (we don't kill the underlying Claude TUI just because someone closed
   * the App tab) or to send a graceful quit; the server only delivers
   * the signal.
   */
  close(): void;
}

export interface ClaudePtyReverseServer {
  /** Loopback URL without trailing slash. Pass to daemon via `bridgeAttach`. */
  readonly baseUrl: string;
  /** Stop the listener. Does not affect the PTY. Idempotent. */
  stop(): Promise<void>;
}

// Inputs from the App are already chunked at TERMINAL_OUTPUT_CHUNK_BYTES (8 KB)
// upstream; this cap is a sanity bound on a single POST to keep noisy clients
// from buffering megabytes in the parser.
const MAX_BODY_BYTES = 256 * 1024;
const READ_TIMEOUT_MS = 5000;

export async function startClaudePtyReverseServer(
  handlers: ClaudePtyReverseHandlers,
): Promise<ClaudePtyReverseServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer(async (req, res) => {
      // Only POST is interesting; the daemon never GETs this endpoint.
      if (req.method !== "POST") {
        res.writeHead(404).end("not found");
        return;
      }

      let body: Record<string, unknown>;
      try {
        body = (await readJsonBody(req)) ?? {};
      } catch (err) {
        logger.debug(
          `[claudePtyReverseServer] body read failed for ${req.url}: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (!res.headersSent) {
          res.writeHead(400).end("bad request");
        }
        return;
      }

      try {
        switch (req.url) {
          case "/input": {
            const data = typeof body.data === "string" ? body.data : null;
            if (data === null) {
              res.writeHead(400).end("data required");
              return;
            }
            handlers.input(data);
            break;
          }
          case "/resize": {
            const cols = numberFrom(body.cols);
            const rows = numberFrom(body.rows);
            if (!cols || !rows) {
              res.writeHead(400).end("cols/rows required");
              return;
            }
            handlers.resize(cols, rows);
            break;
          }
          case "/close": {
            handlers.close();
            break;
          }
          default:
            res.writeHead(404).end("not found");
            return;
        }
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
      } catch (err) {
        // Handler exceptions must not crash the server — log and 500 so the
        // daemon can decide whether to retry or detach the terminal.
        logger.debug(
          `[claudePtyReverseServer] handler ${req.url} threw: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (!res.headersSent) {
          res.writeHead(500).end("handler error");
        }
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to acquire reverse-server address"));
        return;
      }
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      logger.debug(`[claudePtyReverseServer] Started on ${baseUrl}`);

      resolve({
        baseUrl,
        stop: () =>
          new Promise<void>((r) => {
            server.close(() => {
              logger.debug("[claudePtyReverseServer] Stopped");
              r();
            });
          }),
      });
    });

    server.on("error", (err) => {
      logger.debug(`[claudePtyReverseServer] server error: ${err.message}`);
      reject(err);
    });
  });
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise<Record<string, unknown> | null>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => {
        req.destroy();
        reject(new Error("body read timeout"));
      });
    }, READ_TIMEOUT_MS);

    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        finish(() => {
          req.destroy();
          reject(new Error("body too large"));
        });
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      finish(() => {
        const txt = Buffer.concat(chunks).toString("utf-8");
        if (txt.length === 0) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(txt);
          if (parsed && typeof parsed === "object") {
            resolve(parsed as Record<string, unknown>);
          } else {
            resolve(null);
          }
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });

    req.on("error", (err) => {
      finish(() => reject(err));
    });
  });
}

function numberFrom(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return n > 0 ? n : null;
}
