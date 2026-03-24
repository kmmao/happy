/**
 * Enhanced session WebSocket client with RPC support.
 *
 * Improvements over the original session.ts:
 * - RPC handler integration (bash, readFile, writeFile via RpcHandlerManager)
 * - keepAlive with thinking state
 * - updateMetadata / updateAgentState with OCC backoff
 * - Typed socket events
 *
 * All existing public API is preserved for backward compatibility.
 */

import { EventEmitter } from "node:events";
import { io, Socket } from "socket.io-client";
import { decodeBase64, encodeBase64, encrypt, decrypt } from "../encryption";
import { logger } from "../logger";
import { withBackoff } from "../utils/backoff";
import { RpcHandlerManager, createRpcHandlerManager } from "./rpc/RpcHandlerManager";
import { registerAgentHandlers } from "./rpc/registerHandlers";
import type { EncryptionVariant } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionClientOptions = {
  readonly sessionId: string;
  readonly encryptionKey: Uint8Array;
  readonly encryptionVariant: EncryptionVariant;
  readonly token: string;
  readonly serverUrl: string;
  readonly initialAgentState?: unknown | null;
  /** Working directory for RPC handlers (bash cwd, file operations). Defaults to process.cwd(). */
  readonly workingDirectory?: string;
  /** Set to false to disable automatic RPC handler registration. Default: true */
  readonly enableRpc?: boolean;
};

// ---------------------------------------------------------------------------
// SessionClient
// ---------------------------------------------------------------------------

export class SessionClient extends EventEmitter {
  readonly sessionId: string;
  readonly rpcHandlerManager: RpcHandlerManager;

  private readonly encryptionKey: Uint8Array;
  private readonly encryptionVariant: EncryptionVariant;
  private socket: Socket;
  private metadata: unknown | null = null;
  private metadataVersion = 0;
  private agentState: unknown | null = null;
  private agentStateVersion = 0;
  private aliveInterval: ReturnType<typeof setInterval> | null = null;
  private thinking = false;

  constructor(opts: SessionClientOptions) {
    super();
    this.sessionId = opts.sessionId;
    this.encryptionKey = opts.encryptionKey;
    this.encryptionVariant = opts.encryptionVariant;
    if (opts.initialAgentState !== undefined) {
      this.agentState = opts.initialAgentState;
    }

    // Prevent unhandled 'error' event from crashing the process
    this.on("error", () => {});

    // Initialize RPC handler manager
    this.rpcHandlerManager = createRpcHandlerManager({
      scopePrefix: `session:${opts.sessionId}`,
      encryptionKey: opts.encryptionKey,
      encryptionVariant: opts.encryptionVariant,
      logger: (msg, data) => logger.debug(msg, data),
    });

    // Register default RPC handlers unless disabled
    if (opts.enableRpc !== false) {
      const workDir = opts.workingDirectory ?? process.cwd();
      registerAgentHandlers(this.rpcHandlerManager, workDir, opts.sessionId);
    }

    this.socket = io(opts.serverUrl, {
      auth: {
        token: opts.token,
        clientType: "session-scoped" as const,
        sessionId: opts.sessionId,
      },
      path: "/v1/updates",
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ["websocket"],
      autoConnect: false,
    });

    this.setupSocketListeners();
    this.socket.connect();
  }

  // -----------------------------------------------------------------------
  // Public API (backward compatible)
  // -----------------------------------------------------------------------

  sendMessage(text: string, meta?: Record<string, unknown>): void {
    const content = {
      role: "user",
      content: { type: "text", text },
      meta: { sentFrom: "happy-agent", ...meta },
    };
    const encrypted = encodeBase64(
      encrypt(this.encryptionKey, this.encryptionVariant, content),
    );
    this.socket.emit("message", {
      sid: this.sessionId,
      message: encrypted,
    });
  }

  getMetadata(): unknown | null {
    return this.metadata;
  }

  getAgentState(): unknown | null {
    return this.agentState;
  }

  setThinking(thinking: boolean): void {
    this.thinking = thinking;
  }

  waitForConnect(timeoutMs = 10_000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.socket.connected) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        this.removeListener("connected", onConnect);
        this.removeListener("connect_error", onError);
        reject(new Error("Timeout waiting for socket connection"));
      }, timeoutMs);
      const onConnect = () => {
        clearTimeout(timeout);
        this.removeListener("connect_error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        clearTimeout(timeout);
        this.removeListener("connected", onConnect);
        reject(err);
      };
      this.once("connected", onConnect);
      this.once("connect_error", onError);
    });
  }

  waitForIdle(timeoutMs = 300_000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const checkIdle = (): "archived" | boolean => {
        const meta = this.metadata as Record<string, unknown> | null;
        if (meta?.lifecycleState === "archived") return "archived";

        const state = this.agentState as Record<string, unknown> | null;
        if (!state) return false;

        const controlledByUser = state.controlledByUser === true;
        const requests = state.requests;
        const hasRequests =
          requests != null &&
          typeof requests === "object" &&
          !Array.isArray(requests) &&
          Object.keys(requests as Record<string, unknown>).length > 0;
        return !controlledByUser && !hasRequests;
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener("state-change", onStateChange);
        this.removeListener("disconnected", onDisconnect);
      };

      const result = checkIdle();
      if (result === "archived") {
        reject(new Error("Session is archived"));
        return;
      }
      if (result === true) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout waiting for agent to become idle"));
      }, timeoutMs);

      const onStateChange = () => {
        const r = checkIdle();
        if (r === "archived") {
          cleanup();
          reject(new Error("Session is archived"));
        } else if (r === true) {
          cleanup();
          resolve();
        }
      };

      const onDisconnect = () => {
        cleanup();
        reject(
          new Error(
            "Socket disconnected while waiting for agent to become idle",
          ),
        );
      };

      this.on("state-change", onStateChange);
      this.on("disconnected", onDisconnect);
    });
  }

  sendStop(): void {
    this.socket.emit("session-end", {
      sid: this.sessionId,
      time: Date.now(),
    });
  }

  close(): void {
    if (this.aliveInterval !== null) {
      clearInterval(this.aliveInterval);
      this.aliveInterval = null;
    }
    this.rpcHandlerManager.onSocketDisconnect();
    this.socket.close();
  }

  // -----------------------------------------------------------------------
  // New: OCC metadata/state updates
  // -----------------------------------------------------------------------

  async updateMetadata(newMetadata: unknown): Promise<void> {
    const encrypted = encodeBase64(
      encrypt(this.encryptionKey, this.encryptionVariant, newMetadata),
    );
    await withBackoff(
      () =>
        new Promise<void>((resolve, reject) => {
          this.socket.emit(
            "update-metadata",
            {
              sid: this.sessionId,
              expectedVersion: this.metadataVersion,
              metadata: encrypted,
            },
            (answer: { result: string; version?: number; metadata?: string }) => {
              if (answer.result === "success" && answer.version !== undefined) {
                this.metadataVersion = answer.version;
                this.metadata = newMetadata;
                resolve();
              } else if (answer.result === "version-mismatch" && answer.version !== undefined) {
                this.metadataVersion = answer.version;
                if (answer.metadata) {
                  this.metadata = decrypt(
                    this.encryptionKey,
                    this.encryptionVariant,
                    decodeBase64(answer.metadata),
                  );
                }
                reject(new Error("version-mismatch"));
              } else {
                reject(new Error(`update-metadata failed: ${answer.result}`));
              }
            },
          );
        }),
      { maxRetries: 3, label: "updateMetadata" },
    );
  }

  async updateAgentState(newState: unknown | null): Promise<void> {
    const encrypted = newState !== null
      ? encodeBase64(encrypt(this.encryptionKey, this.encryptionVariant, newState))
      : null;
    await withBackoff(
      () =>
        new Promise<void>((resolve, reject) => {
          this.socket.emit(
            "update-state",
            {
              sid: this.sessionId,
              expectedVersion: this.agentStateVersion,
              agentState: encrypted,
            },
            (answer: { result: string; version?: number; agentState?: string | null }) => {
              if (answer.result === "success" && answer.version !== undefined) {
                this.agentStateVersion = answer.version;
                this.agentState = newState;
                resolve();
              } else if (answer.result === "version-mismatch" && answer.version !== undefined) {
                this.agentStateVersion = answer.version;
                if (answer.agentState) {
                  this.agentState = decrypt(
                    this.encryptionKey,
                    this.encryptionVariant,
                    decodeBase64(answer.agentState),
                  );
                }
                reject(new Error("version-mismatch"));
              } else {
                reject(new Error(`update-state failed: ${answer.result}`));
              }
            },
          );
        }),
      { maxRetries: 3, label: "updateAgentState" },
    );
  }

  // -----------------------------------------------------------------------
  // Private: socket listeners
  // -----------------------------------------------------------------------

  private setupSocketListeners(): void {
    this.socket.on("connect", () => {
      this.emit("connected");

      // Register RPC handlers with the server
      this.rpcHandlerManager.onSocketConnect(this.socket);

      // Start keepalive heartbeat
      this.aliveInterval = setInterval(() => {
        this.socket.emit("session-alive", {
          sid: this.sessionId,
          time: Date.now(),
          thinking: this.thinking,
        });
      }, 20_000);
    });

    this.socket.on("disconnect", (reason: string) => {
      if (this.aliveInterval !== null) {
        clearInterval(this.aliveInterval);
        this.aliveInterval = null;
      }
      this.rpcHandlerManager.onSocketDisconnect();
      this.emit("disconnected", reason);
    });

    this.socket.on("connect_error", (error: Error) => {
      this.emit("connect_error", error);
    });

    // Handle incoming RPC requests
    this.socket.on("rpc-request", async (data: { method: string; params: string }, callback: (response: string) => void) => {
      try {
        const response = await this.rpcHandlerManager.handleRequest(data);
        callback(response);
      } catch (err) {
        logger.error("[RPC] Unhandled error in rpc-request handler", err);
      }
    });

    // Handle session updates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.socket.on("update", (data: any) => {
      try {
        const body = data?.body;
        if (!body) return;

        if (
          body.t === "new-message" &&
          body.message?.content?.t === "encrypted"
        ) {
          const msg = body.message;
          const decrypted = decrypt(
            this.encryptionKey,
            this.encryptionVariant,
            decodeBase64(msg.content.c),
          );
          if (decrypted === null) return;
          this.emit("message", {
            id: msg.id,
            seq: msg.seq,
            content: decrypted,
            localId: msg.localId,
            createdAt: msg.createdAt,
            updatedAt: msg.updatedAt,
          });
        } else if (body.t === "update-session") {
          if (body.metadata && body.metadata.version > this.metadataVersion) {
            this.metadata = decrypt(
              this.encryptionKey,
              this.encryptionVariant,
              decodeBase64(body.metadata.value),
            );
            this.metadataVersion = body.metadata.version;
          }
          if (
            body.agentState &&
            body.agentState.version > this.agentStateVersion
          ) {
            this.agentState = body.agentState.value
              ? decrypt(
                  this.encryptionKey,
                  this.encryptionVariant,
                  decodeBase64(body.agentState.value),
                )
              : null;
            this.agentStateVersion = body.agentState.version;
          }
          this.emit("state-change", {
            metadata: this.metadata,
            agentState: this.agentState,
          });
        }
      } catch (err) {
        this.emit("error", err);
      }
    });
  }
}
