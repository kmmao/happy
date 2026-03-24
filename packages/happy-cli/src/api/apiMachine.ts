/**
 * WebSocket client for machine/daemon communication with Happy server
 * Similar to ApiSessionClient but for machine-scoped connections
 */

import { io, Socket } from "socket.io-client";
import { logger } from "@/ui/logger";
import { configuration } from "@/configuration";
import {
  MachineMetadata,
  DaemonState,
  Machine,
  Update,
  UpdateMachineBody,
} from "./types";
import {
  registerCommonHandlers,
  SpawnSessionOptions,
  SpawnSessionResult,
} from "../modules/common/registerCommonHandlers";
import { encodeBase64, decodeBase64, encrypt, decrypt } from "./encryption";
import { backoff } from "@/utils/time";
import { RpcHandlerManager } from "./rpc/RpcHandlerManager";
import { detectTailscale, detectTailscaleServe, type TailscaleInfo } from "@/utils/tailscale";
import type { TunnelManager } from "@/tunnel";


interface ServerToDaemonEvents {
  update: (data: Update) => void;
  "rpc-request": (
    data: { method: string; params: string },
    callback: (response: string) => void,
  ) => void;
  "rpc-registered": (data: { method: string }) => void;
  "rpc-unregistered": (data: { method: string }) => void;
  "rpc-error": (data: { type: string; error: string }) => void;
  ephemeral: (data: { type: string; [key: string]: any }) => void;
  auth: (data: { success: boolean; user: string }) => void;
  error: (data: { message: string }) => void;
}

interface DaemonToServerEvents {
  "machine-alive": (data: { machineId: string; time: number }) => void;

  "machine-update-metadata": (
    data: {
      machineId: string;
      metadata: string; // Encrypted MachineMetadata
      expectedVersion: number;
    },
    cb: (
      answer:
        | {
            result: "error";
          }
        | {
            result: "version-mismatch";
            version: number;
            metadata: string;
          }
        | {
            result: "success";
            version: number;
            metadata: string;
          },
    ) => void,
  ) => void;

  "machine-update-state": (
    data: {
      machineId: string;
      daemonState: string; // Encrypted DaemonState
      expectedVersion: number;
    },
    cb: (
      answer:
        | {
            result: "error";
          }
        | {
            result: "version-mismatch";
            version: number;
            daemonState: string;
          }
        | {
            result: "success";
            version: number;
            daemonState: string;
          },
    ) => void,
  ) => void;

  "rpc-register": (data: { method: string }) => void;
  "rpc-unregister": (data: { method: string }) => void;
  "rpc-call": (
    data: { method: string; params: any },
    callback: (response: { ok: boolean; result?: any; error?: string }) => void,
  ) => void;
  "webhook-status": (data: {
    webhookEventId: string;
    status: "dispatched" | "completed" | "failed";
    sessionId?: string;
    errorMessage?: string;
  }) => void;
  "supervisor-run-status": (data: SupervisorRunStatusData) => void;
  "supervisor-fix-status": (data: SupervisorFixStatusData) => void;

}

type MachineRpcHandlers = {
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  stopSession: (sessionId: string) => boolean;
  requestShutdown: () => void;
};

export type WebhookTriggerData = {
  type: "webhook-trigger";
  webhookEventId: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  issueAuthor: string;
  issueLabels: string[];
  issueUrl: string;
  repoUrl: string;
  repoPath: string;
  provider: string;
  apiToken?: string;
};

export type SupervisorTriggerData = {
  type: "supervisor-trigger";
  projectId: string;
  runId: string;
  trigger: string;
  machineId: string;
  repoPath: string;
  mode?: string;
  dimensions?: string[];
  changedFiles?: string[];
  customRules?: string;
  fixAction?: {
    title: string;
    description: string;
    suggestedFix: string | null;
    category: string;
    severity: string;
    issueNumber?: number;
  };
  researchParams?: string;
  fixStrategy?: "direct" | "pr";
  /** Fix mode: "fix" (default) or "analyze-first" (analyze before fixing). */
  fixMode?: "fix" | "analyze-first";
  /** When true and fixMode is "analyze-first", auto-fix if analysis confirms the issue. */
  analyzeAutoFix?: boolean;
  /** Max concurrent analysis/research sessions (from project config). */
  maxConcurrentAnalysis?: number;
  /** Max concurrent fix worktree sessions (from project config). */
  maxConcurrentFix?: number;
  /** Max findings per analysis run. 0 or negative = unlimited. */
  maxFindings?: number;
  existingActions?: ReadonlyArray<{
    category: string;
    title: string;
    severity: string;
    approval: string;
    fixStatus: string | null;
  }>;
  /** Loop association — present when this run/fix is part of a loop. */
  loopId?: string;
  loopIteration?: number;
};

export type SupervisorRunStatusData = {
  runId: string;
  projectId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  sessionId?: string;
  actionsCount?: number;
  issuesCreated?: number;
  errorMessage?: string;
  currentDimension?: string;
  dimensionIndex?: number;
  totalDimensions?: number;
  actions?: readonly SupervisorActionData[];
};

export type SupervisorActionData = {
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  title: string;
  description: string;
  suggestedFix?: string;
};

export type SupervisorFixStatusData = {
  actionId: string;
  projectId: string;
  fixStatus: "queued" | "running" | "completed" | "failed" | "cancelled" | "analyzed";
  fixSessionId?: string;
};

const TAILSCALE_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export class ApiMachineClient {
  private socket!: Socket<ServerToDaemonEvents, DaemonToServerEvents>;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private tailscaleRefreshInterval: NodeJS.Timeout | null = null;
  private lastTailscaleInfo: TailscaleInfo | null = null;
  private tunnelManager: TunnelManager | null = null;
  private rpcHandlerManager: RpcHandlerManager;
  private webhookHandler: ((data: WebhookTriggerData) => void) | null = null;
  private supervisorHandler:
    | ((data: SupervisorTriggerData) => void)
    | null = null;

  private fixKillHandler:
    | ((data: { fixSessionId: string; projectId: string; fixStatus: string }) => void)
    | null = null;
  private pendingWebhookStatuses: Array<{
    webhookEventId: string;
    status: "dispatched" | "completed" | "failed";
    sessionId?: string;
    errorMessage?: string;
  }> = [];
  private pendingSupervisorStatuses: Array<SupervisorRunStatusData> = [];
  private pendingFixStatuses: Array<SupervisorFixStatusData> = [];


  constructor(
    private token: string,
    private machine: Machine,
  ) {
    // Initialize RPC handler manager
    this.rpcHandlerManager = new RpcHandlerManager({
      scopePrefix: this.machine.id,
      encryptionKey: this.machine.encryptionKey,
      encryptionVariant: this.machine.encryptionVariant,
      logger: (msg, data) => logger.debug(msg, data),
    });

    registerCommonHandlers(
      this.rpcHandlerManager,
      process.cwd(),
      this.machine.id,
    );
  }

  setRPCHandlers({
    spawnSession,
    stopSession,
    requestShutdown,
  }: MachineRpcHandlers) {
    // Register spawn session handler
    this.rpcHandlerManager.registerHandler(
      "spawn-happy-session",
      async (params: any) => {
        const {
          directory,
          sessionId,
          machineId,
          approvedNewDirectoryCreation,
          agent,
          token,
          environmentVariables,
          happySessionId,
        } = params || {};
        logger.debug(
          `[API MACHINE] Spawning session with params: ${JSON.stringify(params)}`,
        );

        if (!directory) {
          throw new Error("Directory is required");
        }

        const result = await spawnSession({
          directory,
          sessionId,
          machineId,
          approvedNewDirectoryCreation,
          agent,
          token,
          environmentVariables,
          happySessionId,
        });

        switch (result.type) {
          case "success":
            logger.debug(`[API MACHINE] Spawned session ${result.sessionId}`);
            return { type: "success", sessionId: result.sessionId };

          case "requestToApproveDirectoryCreation":
            logger.debug(
              `[API MACHINE] Requesting directory creation approval for: ${result.directory}`,
            );
            return {
              type: "requestToApproveDirectoryCreation",
              directory: result.directory,
            };

          case "error":
            throw new Error(result.errorMessage);
        }
      },
    );

    // Register stop session handler
    this.rpcHandlerManager.registerHandler("stop-session", (params: any) => {
      const { sessionId } = params || {};

      if (!sessionId) {
        throw new Error("Session ID is required");
      }

      const success = stopSession(sessionId);
      if (!success) {
        throw new Error("Session not found or failed to stop");
      }

      logger.debug(`[API MACHINE] Stopped session ${sessionId}`);
      return { message: "Session stopped" };
    });

    // Register stop daemon handler
    this.rpcHandlerManager.registerHandler("stop-daemon", () => {
      logger.debug("[API MACHINE] Received stop-daemon RPC request");

      // Trigger shutdown callback after a delay
      setTimeout(() => {
        logger.debug("[API MACHINE] Initiating daemon shutdown from RPC");
        requestShutdown();
      }, 100);

      return {
        message:
          "Daemon stop request acknowledged, starting shutdown sequence...",
      };
    });

    // Register tunnel RPC handlers
    this.rpcHandlerManager.registerHandler("tunnel-detect", async () => {
      if (!this.tunnelManager) return { success: false, error: "TunnelManager not available" };
      const state = await this.tunnelManager.detectAll();
      return { success: true, state };
    });

    this.rpcHandlerManager.registerHandler("tunnel-add", async (params: any) => {
      if (!this.tunnelManager) return { success: false, error: "TunnelManager not available" };
      const { provider, ...addParams } = params;
      if (!provider) return { success: false, error: "provider required" };
      const result = await this.tunnelManager.add(provider, addParams);
      // Refresh state after mutation
      if (result.success) {
        const tunnels = await this.tunnelManager.detectAll();
        this.updateDaemonState((state) => ({
          ...state,
          status: state?.status ?? "running",
          tunnels,
        }));
      }
      return result;
    });

    this.rpcHandlerManager.registerHandler("tunnel-remove", async (params: any) => {
      if (!this.tunnelManager) return { success: false, error: "TunnelManager not available" };
      const { provider, ...removeParams } = params;
      if (!provider) return { success: false, error: "provider required" };
      const result = await this.tunnelManager.remove(provider, removeParams);
      if (result.success) {
        const tunnels = await this.tunnelManager.detectAll();
        this.updateDaemonState((state) => ({
          ...state,
          status: state?.status ?? "running",
          tunnels,
        }));
      }
      return result;
    });
  }

  /**
   * Set handler for incoming webhook trigger events.
   * Called when Server dispatches a webhook-trigger ephemeral event to this machine.
   */
  setWebhookHandler(handler: (data: WebhookTriggerData) => void) {
    this.webhookHandler = handler;
  }

  /**
   * Set handler for incoming supervisor trigger events.
   * Called when Server dispatches a supervisor-trigger ephemeral event to this machine.
   */
  setSupervisorHandler(handler: (data: SupervisorTriggerData) => void) {
    this.supervisorHandler = handler;
  }

  /**
   * Set handler for fix-kill-session events.
   * Called when Server signals that a fix session should be terminated.
   */
  setFixKillHandler(handler: (data: { fixSessionId: string; projectId: string; fixStatus: string }) => void) {
    this.fixKillHandler = handler;
  }


  /**
   * Report webhook processing status back to server.
   * Queues the status if the socket is disconnected and flushes on reconnect.
   */
  emitWebhookStatus(data: {
    webhookEventId: string;
    status: "dispatched" | "completed" | "failed";
    sessionId?: string;
    errorMessage?: string;
  }) {
    if (!this.socket.connected) {
      logger.debug(
        `[WEBHOOK] Socket disconnected, queuing status for ${data.webhookEventId}`,
      );
      this.pendingWebhookStatuses.push(data);
      return;
    }
    this.socket.emit("webhook-status", data);
  }

  private flushPendingWebhookStatuses() {
    const pending = [...this.pendingWebhookStatuses];
    this.pendingWebhookStatuses = [];
    for (const item of pending) {
      this.socket.emit("webhook-status", item);
    }
  }

  /**
   * Report supervisor run status back to server.
   * Queues the status if the socket is disconnected and flushes on reconnect.
   */
  emitSupervisorRunStatus(data: SupervisorRunStatusData) {
    if (!this.socket.connected) {
      logger.debug(
        `[SUPERVISOR] Socket disconnected, queuing status for run ${data.runId}`,
      );
      this.pendingSupervisorStatuses.push(data);
      return;
    }
    this.socket.emit("supervisor-run-status", data);
  }

  private flushPendingSupervisorStatuses() {
    const pending = [...this.pendingSupervisorStatuses];
    this.pendingSupervisorStatuses = [];
    for (const item of pending) {
      this.socket.emit("supervisor-run-status", item);
    }
  }

  /**
   * Report supervisor fix status back to server.
   * Queues the status if the socket is disconnected and flushes on reconnect.
   */
  emitSupervisorFixStatus(data: SupervisorFixStatusData) {
    if (!this.socket.connected) {
      logger.debug(
        `[SUPERVISOR] Socket disconnected, queuing fix status for action ${data.actionId}`,
      );
      this.pendingFixStatuses.push(data);
      return;
    }
    this.socket.emit("supervisor-fix-status", data);
  }

  private flushPendingFixStatuses() {
    const pending = [...this.pendingFixStatuses];
    this.pendingFixStatuses = [];
    for (const item of pending) {
      this.socket.emit("supervisor-fix-status", item);
    }
  }


  /**
   * Update machine metadata
   * Currently unused, changes from the mobile client are more likely
   * for example to set a custom name.
   */
  async updateMachineMetadata(
    handler: (metadata: MachineMetadata | null) => MachineMetadata,
  ): Promise<void> {
    await backoff(async () => {
      const updated = handler(this.machine.metadata);

      const answer = await this.socket.emitWithAck("machine-update-metadata", {
        machineId: this.machine.id,
        metadata: encodeBase64(
          encrypt(
            this.machine.encryptionKey,
            this.machine.encryptionVariant,
            updated,
          ),
        ),
        expectedVersion: this.machine.metadataVersion,
      });

      if (answer.result === "success") {
        this.machine.metadata = decrypt(
          this.machine.encryptionKey,
          this.machine.encryptionVariant,
          decodeBase64(answer.metadata),
        );
        this.machine.metadataVersion = answer.version;
        logger.debug("[API MACHINE] Metadata updated successfully");
      } else if (answer.result === "version-mismatch") {
        if (answer.version > this.machine.metadataVersion) {
          this.machine.metadataVersion = answer.version;
          this.machine.metadata = decrypt(
            this.machine.encryptionKey,
            this.machine.encryptionVariant,
            decodeBase64(answer.metadata),
          );
        }
        throw new Error("Metadata version mismatch"); // Triggers retry
      }
    });
  }

  /**
   * Update daemon state (runtime info) - similar to session updateAgentState
   * Simplified without lock - relies on backoff for retry
   */
  async updateDaemonState(
    handler: (state: DaemonState | null) => DaemonState,
  ): Promise<void> {
    await backoff(async () => {
      const updated = handler(this.machine.daemonState);

      const answer = await this.socket.emitWithAck("machine-update-state", {
        machineId: this.machine.id,
        daemonState: encodeBase64(
          encrypt(
            this.machine.encryptionKey,
            this.machine.encryptionVariant,
            updated,
          ),
        ),
        expectedVersion: this.machine.daemonStateVersion,
      });

      if (answer.result === "success") {
        this.machine.daemonState = decrypt(
          this.machine.encryptionKey,
          this.machine.encryptionVariant,
          decodeBase64(answer.daemonState),
        );
        this.machine.daemonStateVersion = answer.version;
        logger.debug("[API MACHINE] Daemon state updated successfully");
      } else if (answer.result === "version-mismatch") {
        if (answer.version > this.machine.daemonStateVersion) {
          this.machine.daemonStateVersion = answer.version;
          this.machine.daemonState = decrypt(
            this.machine.encryptionKey,
            this.machine.encryptionVariant,
            decodeBase64(answer.daemonState),
          );
        }
        throw new Error("Daemon state version mismatch"); // Triggers retry
      }
    });
  }

  connect() {
    const serverUrl = configuration.serverUrl.replace(/^http/, "ws");
    logger.debug(`[API MACHINE] Connecting to ${serverUrl}`);

    this.socket = io(serverUrl, {
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
      logger.debug("[API MACHINE] Connected to server");

      // Update daemon state to running
      // We need to override previous state because the daemon (this process)
      // has restarted with new PID & port
      this.updateDaemonState((state) => ({
        ...state,
        status: "running",
        pid: process.pid,
        httpPort: this.machine.daemonState?.httpPort,
        startedAt: Date.now(),
        startedWithCliVersion: configuration.currentCliVersion,
        tailscale: this.lastTailscaleInfo ?? state?.tailscale,
        tunnels: this.tunnelManager?.getLastState() ?? state?.tunnels,
      }));

      // Register all handlers
      this.rpcHandlerManager.onSocketConnect(this.socket);

      // Flush any webhook statuses queued during disconnect
      this.flushPendingWebhookStatuses();
      this.flushPendingSupervisorStatuses();
      this.flushPendingFixStatuses();

      // Start keep-alive
      this.startKeepAlive();

      // Start periodic Tailscale refresh
      this.startTailscaleRefresh();
    });

    this.socket.on("disconnect", () => {
      logger.debug("[API MACHINE] Disconnected from server");
      this.rpcHandlerManager.onSocketDisconnect();
      this.stopKeepAlive();
      this.stopTailscaleRefresh();
    });

    // Single consolidated RPC handler
    this.socket.on(
      "rpc-request",
      async (
        data: { method: string; params: string },
        callback: (response: string) => void,
      ) => {
        logger.debugLargeJson(`[API MACHINE] Received RPC request:`, data);
        callback(await this.rpcHandlerManager.handleRequest(data));
      },
    );

    // Handle update events from server
    this.socket.on("update", (data: Update) => {
      // Machine clients should only care about machine updates
      if (
        data.body.t === "update-machine" &&
        (data.body as UpdateMachineBody).machineId === this.machine.id
      ) {
        // Handle machine metadata or daemon state updates from other clients (e.g., mobile app)
        const update = data.body as UpdateMachineBody;

        if (update.metadata) {
          logger.debug("[API MACHINE] Received external metadata update");
          this.machine.metadata = decrypt(
            this.machine.encryptionKey,
            this.machine.encryptionVariant,
            decodeBase64(update.metadata.value),
          );
          this.machine.metadataVersion = update.metadata.version;
        }

        if (update.daemonState) {
          logger.debug("[API MACHINE] Received external daemon state update");
          this.machine.daemonState = decrypt(
            this.machine.encryptionKey,
            this.machine.encryptionVariant,
            decodeBase64(update.daemonState.value),
          );
          this.machine.daemonStateVersion = update.daemonState.version;
        }
      } else {
        logger.debug(
          `[API MACHINE] Received unknown update type: ${(data.body as any).t}`,
        );
      }
    });

    // Handle ephemeral events (webhook triggers, supervisor triggers, etc.)
    this.socket.on("ephemeral", (data) => {
      if (data.type === "webhook-trigger" && this.webhookHandler) {
        logger.debug(
          `[API MACHINE] Received webhook-trigger for issue #${data.issueNumber}`,
        );
        this.webhookHandler(data as WebhookTriggerData);
      }
      if (data.type === "supervisor-trigger" && this.supervisorHandler) {
        logger.debug(
          `[API MACHINE] Received supervisor-trigger for project ${data.projectId}, run ${data.runId}`,
        );
        this.supervisorHandler(data as SupervisorTriggerData);
      }

      if (data.type === "supervisor-fix-kill-session" && this.fixKillHandler) {
        logger.debug(
          `[API MACHINE] Received fix-kill-session for session ${data.fixSessionId}`,
        );
        this.fixKillHandler(data as unknown as { fixSessionId: string; projectId: string; fixStatus: string });
      }
    });

    this.socket.on("connect_error", (error) => {
      logger.debug(`[API MACHINE] Connection error: ${error.message}`);
    });

    this.socket.io.on("error", (error: any) => {
      logger.debug("[API MACHINE] Socket error:", error);
    });
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      const payload = {
        machineId: this.machine.id,
        time: Date.now(),
      };
      if (process.env.DEBUG) {
        // too verbose for production
        logger.debugLargeJson(`[API MACHINE] Emitting machine-alive`, payload);
      }
      this.socket.emit("machine-alive", payload);
    }, 20000);
    logger.debug("[API MACHINE] Keep-alive started (20s interval)");
  }

  private stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
      logger.debug("[API MACHINE] Keep-alive stopped");
    }
  }

  /** Allow run.ts to seed the initial Tailscale info detected at startup. */
  setTailscaleInfo(info: TailscaleInfo) {
    this.lastTailscaleInfo = info;
  }

  /** Allow run.ts to attach TunnelManager for refresh & RPC. */
  setTunnelManager(manager: TunnelManager) {
    this.tunnelManager = manager;
  }

  private startTailscaleRefresh() {
    this.stopTailscaleRefresh();
    this.tailscaleRefreshInterval = setInterval(async () => {
      const info = await detectTailscale();
      const serves = info.status === "connected"
        ? await detectTailscaleServe()
        : [];
      const fullInfo: TailscaleInfo = { ...info, serves };
      const tsChanged = tailscaleChanged(this.lastTailscaleInfo, fullInfo);
      if (tsChanged) {
        logger.debug(
          `[API MACHINE] Tailscale changed: ${this.lastTailscaleInfo?.status} → ${fullInfo.status}, serves: ${serves.length}`,
        );
        this.lastTailscaleInfo = fullInfo;
      }
      // Always refresh tunnel state (Caddy config may change independently)
      const tunnels = this.tunnelManager ? await this.tunnelManager.detectAll() : undefined;
      if (tsChanged || tunnels) {
        this.updateDaemonState((state) => {
          if (!state) return { status: "running", tailscale: fullInfo, tunnels };
          return {
            ...state,
            ...(tsChanged ? { tailscale: fullInfo } : {}),
            ...(tunnels ? { tunnels } : {}),
          };
        });
      }
    }, TAILSCALE_REFRESH_MS);
    logger.debug("[API MACHINE] Tailscale refresh started (5m interval)");
  }

  private stopTailscaleRefresh() {
    if (this.tailscaleRefreshInterval) {
      clearInterval(this.tailscaleRefreshInterval);
      this.tailscaleRefreshInterval = null;
      logger.debug("[API MACHINE] Tailscale refresh stopped");
    }
  }

  shutdown() {
    logger.debug("[API MACHINE] Shutting down");
    this.stopKeepAlive();
    this.stopTailscaleRefresh();
    if (this.socket) {
      this.socket.close();
      logger.debug("[API MACHINE] Socket closed");
    }
  }
}

function tailscaleChanged(
  prev: TailscaleInfo | null,
  next: TailscaleInfo,
): boolean {
  if (!prev) return true;
  return (
    prev.status !== next.status ||
    prev.ipv4 !== next.ipv4 ||
    prev.ipv6 !== next.ipv6 ||
    prev.hostname !== next.hostname ||
    JSON.stringify(prev.serves) !== JSON.stringify(next.serves)
  );
}
