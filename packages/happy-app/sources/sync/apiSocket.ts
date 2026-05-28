import { io, Socket } from "socket.io-client";
import { TokenStorage } from "@/auth/tokenStorage";
import { Encryption } from "./encryption/encryption";
import { createListeners } from "@/utils/listeners";

//
// Types
//

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface SyncSocketConfig {
  endpoint: string;
  token: string;
}

export interface SyncSocketState {
  isConnected: boolean;
  connectionStatus: ConnectionStatus;
  lastError: Error | null;
}

export type SyncSocketListener = (state: SyncSocketState) => void;

//
// Main Class
//

class ApiSocket {
  // State
  private socket: Socket | null = null;
  private config: SyncSocketConfig | null = null;
  private encryption: Encryption | null = null;
  private messageHandlers: Map<string, (data: any) => void> = new Map();
  private ephemeral = createListeners<any>();
  private reconnected = createListeners();
  private status = createListeners<ConnectionStatus>({ initial: "disconnected" });
  private currentStatus: ConnectionStatus = "disconnected";

  //
  // Initialization
  //

  initialize(config: SyncSocketConfig, encryption: Encryption) {
    this.config = config;
    this.encryption = encryption;
    this.connect();
  }

  //
  // Connection Management
  //

  connect() {
    if (!this.config || this.socket) {
      return;
    }

    this.updateStatus("connecting");

    this.socket = io(this.config.endpoint, {
      path: "/v1/updates",
      auth: {
        token: this.config.token,
        clientType: "user-scoped" as const,
      },
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 500, // Reduced from 1000ms for faster recovery
      reconnectionDelayMax: 3000, // Reduced from 5000ms for faster recovery
      reconnectionAttempts: Infinity,
    });

    this.setupEventHandlers();
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.updateStatus("disconnected");
  }

  //
  // Listener Management
  //

  onReconnected = (listener: () => void) => {
    return this.reconnected.subscribe(listener);
  };

  onStatusChange = (listener: (status: ConnectionStatus) => void) => {
    // The registry replays the current status to a new subscriber immediately.
    return this.status.subscribe(listener);
  };

  //
  // Message Handling
  //

  onMessage(event: string, handler: (data: any) => void) {
    this.messageHandlers.set(event, handler);
    return () => this.messageHandlers.delete(event);
  }

  offMessage(event: string, _handler: (data: any) => void) {
    this.messageHandlers.delete(event);
  }

  /** Register an additional ephemeral listener — supports multiple concurrent listeners. */
  addEphemeralListener(handler: (data: any) => void): () => void {
    return this.ephemeral.subscribe(handler);
  }

  /**
   * Per-method RPC timeout. Long-running operations (bash, ripgrep, directory trees)
   * get 5 minutes; everything else gets 30 seconds.
   */
  private getRpcTimeout(method: string): number {
    const LONG_TIMEOUT = 300_000; // 5 minutes
    const longRunningMethods = [
      "bash",
      "upgrade-self",
      "doctor-clean",
      "ripgrep",
      "difftastic",
      "getDirectoryTree",
      "writeFile",
      "listGitRepos",
      "listRemoteGitRepos",
      "createRemoteWebhook",
      "deleteRemoteWebhook",
      // AI-powered methods that call external APIs and can be slow
      "loop-suggest-ai",
      "loop-suggest",
    ];
    return longRunningMethods.includes(method) ? LONG_TIMEOUT : 30_000;
  }

  /**
   * Execute an RPC call with automatic retry on "RPC method not available".
   * This handles the transient window after server restart / CLI reconnection
   * where the daemon socket is connected but RPC methods haven't been re-registered yet.
   *
   * Retries up to 3 times with exponential backoff: 1s → 2s → 4s.
   * Only retries on "RPC method not available"; all other errors are thrown immediately.
   */
  private async rpcCallWithRetry<R>(
    fn: () => Promise<R>,
    method: string,
  ): Promise<R> {
    const MAX_RETRIES = 3;
    const BASE_DELAY = 1000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const isRetryable =
          error instanceof Error &&
          error.message === "RPC method not available";

        if (!isRetryable || attempt === MAX_RETRIES) {
          throw error;
        }

        const delay = BASE_DELAY * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error(`RPC call '${method}' failed after retries`);
  }

  /**
   * The minimal encryption surface an RPC scope must provide. Both
   * SessionEncryption and MachineEncryption satisfy it, so the RPC pipeline
   * below works against either without knowing which scope it's serving.
   */
  private async encryptedRPC<R, A>(
    encryption: {
      encryptRaw(data: any): Promise<string>;
      decryptRaw(encrypted: string): Promise<any | null>;
    },
    target: string,
    method: string,
    params: A,
  ): Promise<R> {
    return this.rpcCallWithRetry(async () => {
      if (!this.socket || !this.socket.connected) {
        throw new Error("RPC method not available");
      }

      let result: { ok: boolean; result?: string; error?: string };
      try {
        result = await this.socket.timeout(
          this.getRpcTimeout(method),
        ).emitWithAck("rpc-call", {
          method: `${target}:${method}`,
          params: await encryption.encryptRaw(params),
        });
      } catch (e) {
        if (e instanceof Error && e.message === "operation has timed out") {
          throw new Error(`RPC call '${method}' timed out`);
        }
        throw new Error(
          `RPC call '${method}' failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      if (result.ok) {
        return (await encryption.decryptRaw(result.result!)) as R;
      }
      throw new Error(result.error || `RPC call '${method}' failed`);
    }, method);
  }

  /**
   * RPC call for sessions - uses session-specific encryption
   */
  async sessionRPC<R, A>(
    sessionId: string,
    method: string,
    params: A,
  ): Promise<R> {
    const sessionEncryption = this.encryption!.getSessionEncryption(sessionId);
    if (!sessionEncryption) {
      throw new Error(`Session encryption not found for ${sessionId}`);
    }
    return this.encryptedRPC<R, A>(sessionEncryption, sessionId, method, params);
  }

  /**
   * RPC call for machines - uses legacy/global encryption (for now)
   */
  async machineRPC<R, A>(
    machineId: string,
    method: string,
    params: A,
  ): Promise<R> {
    const machineEncryption = this.encryption!.getMachineEncryption(machineId);
    if (!machineEncryption) {
      throw new Error(`Machine encryption not found for ${machineId}`);
    }
    return this.encryptedRPC<R, A>(machineEncryption, machineId, method, params);
  }

  send(event: string, data: any) {
    this.socket!.emit(event, data);
    return true;
  }

  async emitWithAck<T = any>(event: string, data: any): Promise<T> {
    if (!this.socket) {
      throw new Error("Socket not connected");
    }
    return await this.socket.emitWithAck(event, data);
  }

  //
  // HTTP Requests
  //

  async request(path: string, options?: RequestInit): Promise<Response> {
    if (!this.config) {
      throw new Error("SyncSocket not initialized");
    }

    const credentials = await TokenStorage.getCredentials();
    if (!credentials) {
      throw new Error("No authentication credentials");
    }

    const url = `${this.config.endpoint}${path}`;
    const headers = {
      Authorization: `Bearer ${credentials.token}`,
      ...options?.headers,
    };

    return fetch(url, {
      ...options,
      headers,
    });
  }

  //
  // Token Management
  //

  updateToken(newToken: string) {
    if (this.config && this.config.token !== newToken) {
      this.config.token = newToken;

      if (this.socket) {
        this.disconnect();
        this.connect();
      }
    }
  }

  //
  // Private Methods
  //

  private updateStatus(status: ConnectionStatus) {
    if (this.currentStatus !== status) {
      this.currentStatus = status;
      this.status.emit(status);
    }
  }

  private setupEventHandlers() {
    if (!this.socket) return;

    // Connection events
    this.socket.on("connect", () => {
      this.updateStatus("connected");
      if (!this.socket?.recovered) {
        this.reconnected.emit();
      }
    });

    this.socket.on("disconnect", (reason) => {
      this.updateStatus("disconnected");
    });

    // Error events
    this.socket.on("connect_error", (error) => {
      this.updateStatus("error");
    });

    this.socket.on("error", (error) => {
      this.updateStatus("error");
    });

    // Message handling
    this.socket.onAny((event, data) => {
      const handler = this.messageHandlers.get(event);
      if (handler) {
        handler(data);
      }
      if (event === "ephemeral") {
        this.ephemeral.emit(data);
      }
    });
  }
}

//
// Singleton Export
//

export const apiSocket = new ApiSocket();
