/**
 * Machine WebSocket client — trimmed from CLI's ApiMachineClient.
 *
 * Core capabilities retained:
 * - Machine-scoped Socket.IO connection
 * - RPC handler registration (via RpcHandlerManager)
 * - keepAlive heartbeat
 * - updateMetadata / updateDaemonState with OCC backoff
 * - Ephemeral event handling (webhook/supervisor triggers)
 *
 * Removed (CLI-only):
 * - Webhook/supervisor status emit + pending queues
 * - Fix kill handler
 * - CLI-specific logging (debugLargeJson)
 */

import { io, Socket } from "socket.io-client";
import { logger } from "../logger";
import { withBackoff } from "../utils/backoff";
import { encodeBase64, decodeBase64, encrypt, decrypt } from "../encryption";
import { RpcHandlerManager } from "./rpc/RpcHandlerManager";
import { registerAgentHandlers } from "./rpc/registerHandlers";
import type { Machine, MachineMetadata, DaemonState } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MachineClientOptions = {
  readonly token: string;
  readonly machine: Machine;
  readonly serverUrl: string;
  /** Working directory for RPC handlers. Defaults to process.cwd(). */
  readonly workingDirectory?: string;
  /** Handler for ephemeral events from server. */
  readonly onEphemeral?: (data: { type: string; [key: string]: unknown }) => void;
};

// ---------------------------------------------------------------------------
// MachineClient
// ---------------------------------------------------------------------------

export class MachineClient {
  readonly machine: Machine;
  readonly rpcHandlerManager: RpcHandlerManager;

  private socket!: Socket;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private readonly token: string;
  private readonly serverUrl: string;
  private readonly onEphemeral?: (data: { type: string; [key: string]: unknown }) => void;

  constructor(opts: MachineClientOptions) {
    this.token = opts.token;
    this.machine = opts.machine;
    this.serverUrl = opts.serverUrl;
    this.onEphemeral = opts.onEphemeral;

    // Initialize RPC handler manager scoped to this machine
    this.rpcHandlerManager = new RpcHandlerManager({
      scopePrefix: opts.machine.id,
      encryptionKey: opts.machine.encryptionKey,
      encryptionVariant: opts.machine.encryptionVariant,
      logger: (msg, data) => logger.debug(msg, data),
    });

    // Register common RPC handlers (bash, readFile, writeFile, listDirectory)
    const workDir = opts.workingDirectory ?? process.cwd();
    registerAgentHandlers(this.rpcHandlerManager, workDir, opts.machine.id);
  }

  // -----------------------------------------------------------------------
  // Connection
  // -----------------------------------------------------------------------

  connect(): void {
    logger.debug(`[MACHINE] Connecting to ${this.serverUrl}`);

    this.socket = io(this.serverUrl, {
      transports: ["websocket"],
      auth: {
        token: this.token,
        clientType: "machine-scoped" as const,
        machineId: this.machine.id,
      },
      path: "/v1/updates",
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    this.socket.on("connect", () => {
      logger.debug("[MACHINE] Connected to server");

      // Register RPC handlers
      this.rpcHandlerManager.onSocketConnect(this.socket);

      // Start keepAlive heartbeat
      this.startKeepAlive();
    });

    this.socket.on("disconnect", () => {
      logger.debug("[MACHINE] Disconnected from server");
      this.rpcHandlerManager.onSocketDisconnect();
      this.stopKeepAlive();
    });

    // Handle incoming RPC requests
    this.socket.on(
      "rpc-request",
      async (
        data: { method: string; params: string },
        callback: (response: string) => void,
      ) => {
        logger.debug("[MACHINE] Received RPC request:", data.method);
        callback(await this.rpcHandlerManager.handleRequest(data));
      },
    );

    // Handle machine update events
    this.socket.on("update", (data: { body: { t: string; machineId?: string; metadata?: { value: string; version: number }; daemonState?: { value: string; version: number } } }) => {
      const body = data?.body;
      if (body?.t === "update-machine" && body.machineId === this.machine.id) {
        if (body.metadata && body.metadata.version > this.machine.metadataVersion) {
          (this.machine as any).metadata = decrypt(
            this.machine.encryptionKey,
            this.machine.encryptionVariant,
            decodeBase64(body.metadata.value),
          );
          (this.machine as any).metadataVersion = body.metadata.version;
        }
        if (body.daemonState && body.daemonState.version > this.machine.daemonStateVersion) {
          (this.machine as any).daemonState = decrypt(
            this.machine.encryptionKey,
            this.machine.encryptionVariant,
            decodeBase64(body.daemonState.value),
          );
          (this.machine as any).daemonStateVersion = body.daemonState.version;
        }
      }
    });

    // Handle ephemeral events
    if (this.onEphemeral) {
      this.socket.on("ephemeral", (data: { type: string; [key: string]: unknown }) => {
        logger.debug("[MACHINE] Received ephemeral event:", data.type);
        this.onEphemeral?.(data);
      });
    }

    this.socket.on("connect_error", (error: Error) => {
      logger.debug(`[MACHINE] Connection error: ${error.message}`);
    });
  }

  // -----------------------------------------------------------------------
  // OCC updates
  // -----------------------------------------------------------------------

  async updateMachineMetadata(
    handler: (metadata: MachineMetadata | null) => MachineMetadata,
  ): Promise<void> {
    await withBackoff(async () => {
      const updated = handler(this.machine.metadata);
      const answer: any = await new Promise((resolve) => {
        this.socket.emit(
          "machine-update-metadata" as any,
          {
            machineId: this.machine.id,
            metadata: encodeBase64(
              encrypt(this.machine.encryptionKey, this.machine.encryptionVariant, updated),
            ),
            expectedVersion: this.machine.metadataVersion,
          },
          resolve,
        );
      });

      if (answer.result === "success") {
        (this.machine as any).metadata = decrypt(
          this.machine.encryptionKey,
          this.machine.encryptionVariant,
          decodeBase64(answer.metadata),
        ) as MachineMetadata;
        (this.machine as any).metadataVersion = answer.version;
      } else if (answer.result === "version-mismatch") {
        (this.machine as any).metadataVersion = answer.version;
        (this.machine as any).metadata = decrypt(
          this.machine.encryptionKey,
          this.machine.encryptionVariant,
          decodeBase64(answer.metadata),
        );
        throw new Error("Metadata version mismatch");
      }
    }, { maxRetries: 3, label: "updateMachineMetadata" });
  }

  async updateDaemonState(
    handler: (state: DaemonState | null) => DaemonState,
  ): Promise<void> {
    await withBackoff(async () => {
      const updated = handler(this.machine.daemonState);
      const answer: any = await new Promise((resolve) => {
        this.socket.emit(
          "machine-update-state" as any,
          {
            machineId: this.machine.id,
            daemonState: encodeBase64(
              encrypt(this.machine.encryptionKey, this.machine.encryptionVariant, updated),
            ),
            expectedVersion: this.machine.daemonStateVersion,
          },
          resolve,
        );
      });

      if (answer.result === "success") {
        (this.machine as any).daemonState = decrypt(
          this.machine.encryptionKey,
          this.machine.encryptionVariant,
          decodeBase64(answer.daemonState),
        );
        (this.machine as any).daemonStateVersion = answer.version;
      } else if (answer.result === "version-mismatch") {
        (this.machine as any).daemonStateVersion = answer.version;
        (this.machine as any).daemonState = decrypt(
          this.machine.encryptionKey,
          this.machine.encryptionVariant,
          decodeBase64(answer.daemonState),
        );
        throw new Error("Daemon state version mismatch");
      }
    }, { maxRetries: 3, label: "updateDaemonState" });
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  shutdown(): void {
    logger.debug("[MACHINE] Shutting down");
    this.stopKeepAlive();
    this.rpcHandlerManager.onSocketDisconnect();
    this.socket?.close();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      this.socket.emit("machine-alive" as any, {
        machineId: this.machine.id,
        time: Date.now(),
      });
    }, 20_000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }
}
