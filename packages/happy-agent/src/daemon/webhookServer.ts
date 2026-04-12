/**
 * WebhookServer — lightweight HTTP server for receiving session-started
 * callbacks from spawned Happy CLI processes.
 *
 * When agent spawns a session, it passes HAPPY_DAEMON_HTTP_PORT to the
 * child process. The CLI POSTs to /session-started with {sessionId, metadata}.
 * The awaiter system resolves the spawn promise with the real sessionId.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http";
import { logger } from "../logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionStartedCallback = (
  sessionId: string,
  metadata: Record<string, unknown>,
  hostPid?: number,
) => void;

// ---------------------------------------------------------------------------
// WebhookServer
// ---------------------------------------------------------------------------

export class WebhookServer {
  private server: Server | null = null;
  private port = 0;
  private onSessionStarted: SessionStartedCallback | null = null;

  /**
   * Start the HTTP server on a random available port.
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on("error", (err) => {
        logger.debug(`[WEBHOOK-SERVER] Error: ${err.message}`);
        reject(err);
      });

      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (addr && typeof addr === "object") {
          this.port = addr.port;
          logger.debug(`[WEBHOOK-SERVER] Listening on 127.0.0.1:${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error("Failed to get server address"));
        }
      });
    });
  }

  /**
   * Set the callback for session-started events.
   */
  setSessionStartedHandler(handler: SessionStartedCallback): void {
    this.onSessionStarted = handler;
  }

  /**
   * Get the port the server is listening on.
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Stop the server.
   */
  shutdown(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      logger.debug("[WEBHOOK-SERVER] Shutdown");
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === "POST" && req.url === "/session-started") {
      this.handleSessionStarted(req, res);
      return;
    }

    // Health check
    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", port: this.port }));
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  }

  private handleSessionStarted(req: IncomingMessage, res: ServerResponse): void {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body) as {
          sessionId?: string;
          metadata?: Record<string, unknown>;
        };

        if (!parsed.sessionId || typeof parsed.sessionId !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId is required" }));
          return;
        }

        const hostPid = typeof parsed.metadata?.hostPid === "number"
          ? parsed.metadata.hostPid
          : undefined;

        logger.debug(`[WEBHOOK-SERVER] Session started: ${parsed.sessionId} (hostPid=${hostPid})`);

        this.onSessionStarted?.(
          parsed.sessionId,
          parsed.metadata ?? {},
          hostPid,
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch (err) {
        logger.debug(`[WEBHOOK-SERVER] Parse error: ${err}`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
  }
}
