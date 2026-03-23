import { randomUUID } from "expo-crypto";
import { Platform } from "react-native";
import type {
  OpenClawGatewayConfig,
  OpenClawFrame,
  OpenClawConnectParams,
  OpenClawHelloOk,
  OpenClawSession,
  OpenClawChatMessage,
  OpenClawChatHistoryResult,
  OpenClawSessionsListResult,
  OpenClawChatSendResult,
  OpenClawClientId,
  OpenClawClientMode,
} from "./openclawTypes";
import {
  loadOrCreateDeviceIdentity,
  loadDeviceAuthToken,
  storeDeviceAuthToken,
  buildDeviceAuthPayload,
  signPayload,
  getPublicKeyBase64Url,
} from "./deviceIdentity";
import { log } from '@/log';

const PROTOCOL_VERSION = 3;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type OpenClawConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "pairing_required"
  | "error";

export type OpenClawEventHandler = (event: string, payload: unknown) => void;
export type OpenClawStatusHandler = (
  status: OpenClawConnectionStatus,
  error?: string,
  details?: { pairingRequestId?: string },
) => void;

/**
 * OpenClawSocket - Raw WebSocket client for OpenClaw Gateway
 *
 * Implements the gateway protocol (req/res/event frames)
 * for direct communication with a user's local or remote gateway.
 * Uses device identity for secure authentication with pairing flow.
 */
class OpenClawSocketClass {
  private ws: WebSocket | null = null;
  private config: OpenClawGatewayConfig | null = null;
  private pending = new Map<string, PendingRequest>();
  private status: OpenClawConnectionStatus = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private mainSessionKey: string | null = null;
  private serverHost: string | null = null;
  private pairingRequestId: string | null = null;
  private deviceId: string | null = null;
  private connectNonce: string | null = null;
  private connectSent = false;

  // Listeners
  private statusListeners = new Set<OpenClawStatusHandler>();
  private eventListeners = new Set<OpenClawEventHandler>();

  // Public getters
  getStatus(): OpenClawConnectionStatus {
    return this.status;
  }
  getMainSessionKey(): string | null {
    return this.mainSessionKey;
  }
  getServerHost(): string | null {
    return this.serverHost;
  }
  isConnected(): boolean {
    return this.status === "connected";
  }
  getConfig(): OpenClawGatewayConfig | null {
    return this.config;
  }
  getPairingRequestId(): string | null {
    return this.pairingRequestId;
  }
  getDeviceId(): string | null {
    return this.deviceId;
  }

  /**
   * Connect to an OpenClaw gateway
   */
  connect(config: OpenClawGatewayConfig) {
    this.config = config;
    this.pairingRequestId = null;
    this.doConnect();
  }

  /**
   * Disconnect from gateway
   */
  disconnect() {
    this.config = null;
    this.clearReconnectTimer();
    this.closeSocket();
    this.updateStatus("disconnected");
    this.mainSessionKey = null;
    this.serverHost = null;
    this.pairingRequestId = null;
  }

  /**
   * Retry connection (e.g., after pairing is approved)
   */
  retryConnect() {
    if (this.config) {
      this.pairingRequestId = null;
      this.doConnect();
    }
  }

  /**
   * Register a status change listener
   */
  onStatusChange(handler: OpenClawStatusHandler): () => void {
    this.statusListeners.add(handler);
    handler(this.status, undefined, {
      pairingRequestId: this.pairingRequestId ?? undefined,
    });
    return () => this.statusListeners.delete(handler);
  }

  /**
   * Register an event listener (for chat events, etc.)
   */
  onEvent(handler: OpenClawEventHandler): () => void {
    this.eventListeners.add(handler);
    return () => this.eventListeners.delete(handler);
  }

  /**
   * Send a request to the gateway and wait for response
   */
  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = 15000,
  ): Promise<T> {
    if (!this.ws || this.status !== "connected") {
      throw new Error("Not connected to gateway");
    }

    const id = randomUUID();
    const frame = { type: "req", id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.ws!.send(JSON.stringify(frame));
    });
  }

  // ─────────────────────────────────────────────────────────────
  // High-level API methods
  // ─────────────────────────────────────────────────────────────

  /**
   * List all chat sessions
   */
  async listSessions(limit?: number): Promise<OpenClawSession[]> {
    const result = await this.request<OpenClawSessionsListResult>(
      "sessions.list",
      { includeGlobal: true, includeUnknown: false, limit },
    );
    return result.sessions ?? [];
  }

  /**
   * Create a new isolated session
   */
  async createSession(label?: string): Promise<{ sessionKey: string }> {
    return this.request<{ sessionKey: string }>("sessions.create", {
      label,
      isolated: true,
    });
  }

  /**
   * Get chat history for a session
   */
  async getHistory(sessionKey: string): Promise<OpenClawChatMessage[]> {
    const result = await this.request<OpenClawChatHistoryResult>(
      "chat.history",
      { sessionKey },
    );
    return result.messages ?? [];
  }

  /**
   * Send a message to a session
   */
  async sendMessage(
    sessionKey: string,
    message: string,
    options?: { thinking?: string; attachments?: unknown[] },
  ): Promise<OpenClawChatSendResult> {
    const result = await this.request<OpenClawChatSendResult>(
      "chat.send",
      {
        sessionKey,
        message,
        thinking: options?.thinking ?? "low",
        attachments: options?.attachments,
        timeoutMs: 30000,
        idempotencyKey: randomUUID(),
      },
      35000,
    );
    return result;
  }

  /**
   * Abort an in-progress run
   */
  async abortRun(sessionKey: string, runId?: string): Promise<void> {
    await this.request("chat.abort", { sessionKey, runId }, 10000);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.request<{ ok?: boolean }>(
        "health",
        undefined,
        5000,
      );
      return result.ok !== false;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Private implementation
  // ─────────────────────────────────────────────────────────────

  private doConnect() {
    if (!this.config) return;

    this.updateStatus("connecting");
    this.closeSocket();
    this.connectNonce = null;
    this.connectSent = false;

    const url = this.config.url;
    if (__DEV__) log.log(`[OpenClaw] Connecting to: ${url}`);

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      if (__DEV__) log.error("[OpenClaw] WebSocket create failed:", err);
      this.updateStatus("error", "Failed to create connection");
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      if (__DEV__)
        log.log("[OpenClaw] WebSocket opened, waiting for challenge...");
    };

    this.ws.onmessage = (event) => {
      const { data } = event;
      // Web WebSocket may deliver data as Blob instead of string
      if (typeof data === "string") {
        this.handleMessage(data);
      } else if (data instanceof Blob) {
        data.text().then((text) => this.handleMessage(text));
      } else if (data instanceof ArrayBuffer) {
        this.handleMessage(new TextDecoder().decode(data));
      }
    };

    this.ws.onerror = (event) => {
      if (__DEV__) log.error("[OpenClaw] WebSocket error:", event);
      if (this.status === "connecting") {
        this.updateStatus("error", "Connection failed");
      }
    };

    this.ws.onclose = (event) => {
      if (__DEV__)
        log.log(
          `[OpenClaw] WebSocket closed: code=${event.code} reason=${event.reason}`,
        );
      this.failAllPending(new Error("Connection closed"));
      if (this.config && this.status !== "pairing_required") {
        this.scheduleReconnect();
      }
    };
  }

  private async sendConnect() {
    if (!this.ws || !this.config || this.connectSent) return;
    this.connectSent = true;
    if (__DEV__) log.log("[OpenClaw] sendConnect() started");

    try {
      // Load device identity (creates one if doesn't exist)
      const identity = await loadOrCreateDeviceIdentity();
      this.deviceId = identity.deviceId;
      if (__DEV__)
        log.log(
          `[OpenClaw] Device ID: ${identity.deviceId.slice(0, 16)}...`,
        );

      // Load stored auth token if available
      const storedToken = await loadDeviceAuthToken();

      // Client IDs for each platform (protocol constants — do NOT rename)
      const clientId: OpenClawClientId =
        Platform.OS === "ios"
          ? "clawdbot-ios"
          : Platform.OS === "android"
            ? "clawdbot-android"
            : "webchat-ui";

      const clientMode: OpenClawClientMode = "ui";
      const role = "operator";
      const scopes = [
        "operator.admin",
        "operator.approvals",
        "operator.pairing",
      ];
      const signedAtMs = Date.now();

      // Determine auth token (config token takes priority, then stored device token)
      const authToken = this.config.token ?? storedToken?.token ?? undefined;

      // Build and sign device auth payload (with nonce if available)
      const payload = buildDeviceAuthPayload({
        deviceId: identity.deviceId,
        clientId,
        clientMode,
        role,
        scopes,
        signedAtMs,
        token: authToken ?? null,
        nonce: this.connectNonce,
      });
      const signature = await signPayload(identity.privateKey, payload);

      const params: OpenClawConnectParams = {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: clientId,
          displayName: "Happy",
          version: "1.0.0",
          platform: Platform.OS,
          mode: clientMode,
        },
        role,
        scopes,
        device: {
          id: identity.deviceId,
          publicKey: getPublicKeyBase64Url(identity.publicKey),
          signature,
          signedAt: signedAtMs,
          nonce: this.connectNonce ?? undefined,
        },
        auth: authToken
          ? { token: authToken }
          : this.config.password
            ? { password: this.config.password }
            : undefined,
      };

      // Send connect request
      const id = randomUUID();
      const frame = { type: "req", id, method: "connect", params };

      const resultPromise = new Promise<OpenClawHelloOk>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error("Connect timeout"));
        }, 10000);

        this.pending.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value as OpenClawHelloOk);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
      });

      if (__DEV__) log.log("[OpenClaw] Sending connect request...");
      this.ws.send(JSON.stringify(frame));

      const result = await resultPromise;
      if (__DEV__)
        log.log(
          "[OpenClaw] Connect response received:",
          JSON.stringify(result).slice(0, 200),
        );

      // Store device auth token if provided
      if (result.auth?.deviceToken) {
        await storeDeviceAuthToken({
          token: result.auth.deviceToken,
          role: result.auth.role ?? role,
          scopes: result.auth.scopes ?? scopes,
        });
      }

      this.mainSessionKey =
        result.snapshot?.sessionDefaults?.mainSessionKey ?? null;
      this.serverHost = result.server?.host ?? null;
      this.updateStatus("connected");
      if (__DEV__)
        log.log(`[OpenClaw] Connected! Server: ${this.serverHost}`);
    } catch (error) {
      if (__DEV__) log.error("[OpenClaw] Connect failed:", error);
      // Check if pairing is required
      const errorMsg = error instanceof Error ? error.message : "";
      if (errorMsg.includes("NOT_PAIRED")) {
        // Extract request ID from error details if available
        const match = errorMsg.match(/requestId['":\s]+([a-f0-9-]+)/i);
        this.pairingRequestId = match?.[1] ?? null;
        this.updateStatus("pairing_required", "Device pairing required", {
          pairingRequestId: this.pairingRequestId ?? undefined,
        });
        this.closeSocket();
        return;
      }

      this.updateStatus(
        "error",
        error instanceof Error ? error.message : "Connect failed",
      );
      this.closeSocket();
      this.scheduleReconnect();
    }
  }

  private handleMessage(data: string) {
    let frame: OpenClawFrame;
    try {
      frame = JSON.parse(data);
    } catch {
      if (__DEV__)
        log.error("[OpenClaw] Invalid JSON:", data.slice(0, 100));
      return;
    }

    if (__DEV__)
      log.log(
        `[OpenClaw] Frame: type=${frame.type} ${frame.type === "event" ? `event=${frame.event}` : `id=${frame.id} ok=${"ok" in frame ? frame.ok : "n/a"}`}`,
      );

    if (frame.type === "res") {
      // Response to a pending request
      const pending = this.pending.get(frame.id);
      if (pending) {
        this.pending.delete(frame.id);
        if (frame.ok) {
          pending.resolve(frame.payload);
        } else {
          const err = frame.error;
          if (__DEV__)
            log.error(
              `[OpenClaw] Request error: ${err?.code} ${err?.message}`,
            );
          pending.reject(
            new Error(
              `${err?.code ?? "ERROR"}: ${err?.message ?? "Request failed"}`,
            ),
          );
        }
      }
    } else if (frame.type === "event") {
      // Server-pushed event
      let payload = frame.payload;
      if (!payload && frame.payloadJSON) {
        try {
          payload = JSON.parse(frame.payloadJSON);
        } catch {
          // ignore
        }
      }

      // Handle connect.challenge event - receive nonce and send connect
      if (frame.event === "connect.challenge" && !this.connectSent) {
        const nonce = (payload as { nonce?: string } | undefined)?.nonce;
        if (nonce) {
          this.connectNonce = nonce;
        }
        this.sendConnect();
        return;
      }

      this.eventListeners.forEach((handler) => handler(frame.event, payload));
    }
  }

  private updateStatus(
    status: OpenClawConnectionStatus,
    error?: string,
    details?: { pairingRequestId?: string },
  ) {
    this.status = status;
    this.statusListeners.forEach((handler) => handler(status, error, details));
  }

  private closeSocket() {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }

  private failAllPending(error: Error) {
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private scheduleReconnect() {
    if (!this.config) return; // Intentionally disconnected

    this.clearReconnectTimer();
    this.updateStatus("disconnected");

    this.reconnectTimer = setTimeout(() => {
      this.doConnect();
    }, 3000);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// Singleton export
export const OpenClawSocket = new OpenClawSocketClass();
