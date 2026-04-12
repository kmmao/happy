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
import { detectTailscale, detectTailscaleServe, type TailscaleInfo } from "../utils/tailscale";
import type { TunnelManager } from "../tunnel";
import {
  spawnSession, stopSession,
  type SpawnSessionOptions, type SpawnSessionResult,
} from "../daemon/spawnSession";
import { getAllTrackedSessions } from "../daemon/trackedSessions";
import {
  handleWebhookTrigger, handleSupervisorTrigger, handleTaskTrigger,
  type WebhookTriggerData, type SupervisorTriggerData, type TaskTriggerData,
} from "../daemon/triggerHandlers";
import type { AutomationScheduler } from "../daemon/scheduler";
import type { AgentLoopCoordinator, CreateLoopInput } from "../daemon/loopCoordinator";
import type { AutomationAuditStore, AuditQuery } from "../daemon/auditStore";

const TAILSCALE_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Strongly-typed ephemeral event from server. */
export type EphemeralEvent =
  | {
      type: "activity";
      id: string;
      active: boolean;
      activeAt: number;
      thinking: boolean;
    }
  | {
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
    }
  | {
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
    }
  | {
      type: "task-trigger";
      taskId: string;
      prompt: string;
      directory: string;
      priority: string;
      projectId?: string;
      resultToken?: string;
      skillContents?: Array<{ name: string; content: string }>;
    };

export type MachineClientOptions = {
  readonly token: string;
  readonly machine: Machine;
  readonly serverUrl: string;
  /** Agent package version for DaemonState reporting. */
  readonly agentVersion?: string;
  /** Working directory for RPC handlers. Defaults to process.cwd(). */
  readonly workingDirectory?: string;
  /** Handler for ephemeral events from server. */
  readonly onEphemeral?: (data: EphemeralEvent) => void;
};

// ---------------------------------------------------------------------------
// MachineClient
// ---------------------------------------------------------------------------

export class MachineClient {
  readonly machine: Machine;
  readonly rpcHandlerManager: RpcHandlerManager;

  private socket!: Socket;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private tailscaleRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private lastTailscaleInfo: TailscaleInfo | null = null;
  private tunnelManager: TunnelManager | null = null;
  private readonly token: string;
  private readonly serverUrl: string;
  private readonly agentVersion: string;
  private readonly startTime = Date.now();
  private readonly onEphemeral?: (data: EphemeralEvent) => void;
  private automationEnabled = false;
  private automationServerUrl = "";
  private automationAuthToken = "";
  private scheduler: AutomationScheduler | null = null;
  private loopCoordinator: AgentLoopCoordinator | null = null;
  private auditStore: AutomationAuditStore | null = null;

  constructor(opts: MachineClientOptions) {
    this.token = opts.token;
    this.machine = opts.machine;
    this.serverUrl = opts.serverUrl;
    this.agentVersion = opts.agentVersion ?? "unknown";
    this.onEphemeral = opts.onEphemeral;

    // Initialize RPC handler manager scoped to this machine
    this.rpcHandlerManager = new RpcHandlerManager({
      scopePrefix: opts.machine.id,
      encryptionKey: opts.machine.encryptionKey,
      encryptionVariant: opts.machine.encryptionVariant,
      logger: (msg, data) => logger.debug(msg, data),
    });

    // Register common RPC handlers (bash, readFile, writeFile, listDirectory, etc.)
    const workDir = opts.workingDirectory ?? process.cwd();
    registerAgentHandlers(this.rpcHandlerManager, workDir, opts.machine.id);

    // Register machine-scoped RPC handlers (spawn/stop session)
    this.registerMachineHandlers();
  }

  // -----------------------------------------------------------------------
  // Machine-scoped RPC handlers
  // -----------------------------------------------------------------------

  private registerMachineHandlers(): void {
    // spawn-happy-session: Start a new Happy CLI session on this machine
    this.rpcHandlerManager.registerHandler<SpawnSessionOptions, SpawnSessionResult>(
      "spawn-happy-session",
      async (data) => {
        logger.debug("[MACHINE] spawn-happy-session request:", data.directory);
        return spawnSession(data);
      },
    );

    // stop-session: Stop a running session by PID
    this.rpcHandlerManager.registerHandler<
      { pid: number },
      { stopped: boolean; error?: string }
    >("stop-session", async (data) => {
      logger.debug("[MACHINE] stop-session request:", data.pid);
      return stopSession(data.pid);
    });

    // list-tracked-sessions: List all active tracked sessions
    this.rpcHandlerManager.registerHandler<
      Record<string, never>,
      { sessions: Array<{ pid: number; directory: string; startedAt: number; happySessionId?: string }> }
    >("list-tracked-sessions", async () => {
      const sessions = getAllTrackedSessions().map((s) => ({
        pid: s.pid,
        directory: s.directory,
        startedAt: s.startedAt,
        happySessionId: s.happySessionId,
      }));
      return { sessions };
    });
  }

  private registerLoopHandlers(): void {
    const coord = this.loopCoordinator!;

    this.rpcHandlerManager.registerHandler<
      CreateLoopInput,
      { loop: { id: string; name: string; state: string } }
    >("create-loop", async (data) => {
      const loop = coord.createLoop(data);
      return { loop: { id: loop.id, name: loop.name, state: loop.state } };
    });

    this.rpcHandlerManager.registerHandler<
      Record<string, never>,
      { loops: Array<{ id: string; name: string; state: string; iteration: number; intervalMs: number }> }
    >("list-loops", async () => {
      return { loops: coord.listLoops() };
    });

    this.rpcHandlerManager.registerHandler<
      { loopId: string },
      { success: boolean }
    >("pause-loop", async (data) => {
      return { success: coord.pauseLoop(data.loopId) };
    });

    this.rpcHandlerManager.registerHandler<
      { loopId: string },
      { success: boolean }
    >("resume-loop", async (data) => {
      return { success: coord.resumeLoop(data.loopId) };
    });

    this.rpcHandlerManager.registerHandler<
      { loopId: string },
      { success: boolean }
    >("delete-loop", async (data) => {
      return { success: coord.deleteLoop(data.loopId) };
    });
  }

  private registerAuditHandlers(): void {
    const audit = this.auditStore!;

    this.rpcHandlerManager.registerHandler<
      AuditQuery,
      { events: Array<{ id: number; kind: string; timestamp: number; message?: string; jobId?: string; loopId?: string; errorMessage?: string }> }
    >("query-audit-log", async (data) => {
      return { events: audit.query(data) };
    });

    this.rpcHandlerManager.registerHandler<
      Record<string, never>,
      { summary: Record<string, number> }
    >("audit-summary", async () => {
      return { summary: audit.summarize() };
    });
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

      // Report initial state with Tailscale info
      this.updateDaemonState((state) => ({
        ...state,
        status: "running",
        pid: process.pid,
        startedAt: Date.now(),
        startTime: this.startTime,
        startedWithCliVersion: this.agentVersion,
        tailscale: this.lastTailscaleInfo ?? state?.tailscale,
      }));

      // Start keepAlive heartbeat
      this.startKeepAlive();

      // Start periodic Tailscale refresh
      this.startTailscaleRefresh();
    });

    this.socket.on("disconnect", () => {
      logger.debug("[MACHINE] Disconnected from server");
      this.rpcHandlerManager.onSocketDisconnect();
      this.stopKeepAlive();
      this.stopTailscaleRefresh();
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
    this.socket.on("ephemeral", (data: unknown) => {
      const event = data as EphemeralEvent;
      logger.debug("[MACHINE] Received ephemeral event:", event.type);
      this.onEphemeral?.(event);
      this.handleAutomationEvent(event);
    });

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
  // Socket event emitters
  // -----------------------------------------------------------------------

  /** Emit a session lifecycle event. */
  emitSessionEvent(sessionId: string, eventType: string, summary: string, detail?: Record<string, unknown>): void {
    this.socket?.emit("session-event" as any, { sessionId, eventType, summary, detail });
  }

  /** Report webhook processing status. */
  emitWebhookStatus(data: {
    webhookEventId: string;
    status: "dispatched" | "completed" | "failed";
    sessionId?: string;
    errorMessage?: string;
  }): void {
    this.socket?.emit("webhook-status" as any, data);
  }

  /** Report supervisor run status. */
  emitSupervisorRunStatus(data: {
    runId: string;
    projectId: string;
    status: "running" | "completed" | "failed";
    sessionId?: string;
    actionsCount?: number;
    issuesCreated?: number;
    errorMessage?: string;
  }): void {
    this.socket?.emit("supervisor-run-status" as any, data);
  }

  /** Submit a knowledge entry from a session. */
  emitSubmitKnowledge(sid: string, entry: {
    entryType: string;
    contributorType: string;
    action: string;
    title: string;
    content: string;
    request?: string;
    outcome?: string;
    tags: string[];
    confidence: string;
    model?: string;
    affectedFiles: string[];
  }): void {
    this.socket?.emit("submit-knowledge" as any, { sid, entry });
  }

  /** Fetch knowledge for a session. */
  emitFetchKnowledge(
    sid: string,
    mode: "auto" | "full" | "minimal",
    contextHints: string[] | undefined,
    callback: (response: {
      profile: {
        techStack: string[];
        architectureType?: string;
        knownPitfalls: string[];
        coreConventions: string[];
        lastUpdatedAt: number;
      } | null;
      entries: {
        id: string;
        entryType: string;
        title: string;
        content: string;
        tags: string[];
        confidence: string;
        createdAt: string;
      }[];
    }) => void,
  ): void {
    this.socket?.emit("fetch-knowledge" as any, { sid, mode, contextHints }, callback);
  }

  /** Stream task log chunk. */
  emitTaskLog(sid: string, taskId: string, outputFile: string, chunk: string, offset: number): void {
    this.socket?.emit("task-log" as any, { sid, taskId, outputFile, chunk, offset });
  }

  // -----------------------------------------------------------------------
  // Automation triggers
  // -----------------------------------------------------------------------

  /**
   * Enable automation handling — agent will process webhook, supervisor,
   * and task triggers from the server by spawning Happy CLI sessions.
   */
  enableAutomation(
    serverUrl: string,
    authToken: string,
    scheduler: AutomationScheduler,
    loopCoordinator?: AgentLoopCoordinator,
    auditStore?: AutomationAuditStore,
  ): void {
    this.automationEnabled = true;
    this.automationServerUrl = serverUrl;
    this.automationAuthToken = authToken;
    this.scheduler = scheduler;
    this.loopCoordinator = loopCoordinator ?? null;
    this.auditStore = auditStore ?? null;
    if (this.loopCoordinator) {
      this.registerLoopHandlers();
    }
    if (this.auditStore) {
      this.registerAuditHandlers();
    }
    logger.debug("[MACHINE] Automation enabled");
  }

  /** Internal dispatch for ephemeral events that need automation handling. */
  private handleAutomationEvent(event: EphemeralEvent): void {
    if (!this.automationEnabled || !this.scheduler) return;

    switch (event.type) {
      case "webhook-trigger":
        handleWebhookTrigger(
          event as WebhookTriggerData,
          this,
          this.automationServerUrl,
          this.automationAuthToken,
          this.scheduler,
        );
        break;
      case "supervisor-trigger":
        handleSupervisorTrigger(
          event as SupervisorTriggerData,
          this,
          this.automationServerUrl,
          this.automationAuthToken,
          this.scheduler,
        );
        break;
      case "task-trigger":
        handleTaskTrigger(
          event as TaskTriggerData,
          this.automationServerUrl,
          this.automationAuthToken,
          this.scheduler,
        );
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Seed initial Tailscale info detected before connect. */
  setTailscaleInfo(info: TailscaleInfo): void {
    this.lastTailscaleInfo = info;
  }

  /** Attach a TunnelManager for periodic tunnel state refresh. */
  setTunnelManager(manager: TunnelManager): void {
    this.tunnelManager = manager;
  }

  shutdown(): void {
    logger.debug("[MACHINE] Shutting down");
    this.stopKeepAlive();
    this.stopTailscaleRefresh();
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

  private startTailscaleRefresh(): void {
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
          `[MACHINE] Tailscale changed: ${this.lastTailscaleInfo?.status} → ${fullInfo.status}, serves: ${serves.length}`,
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
    logger.debug("[MACHINE] Tailscale refresh started (5m interval)");
  }

  private stopTailscaleRefresh(): void {
    if (this.tailscaleRefreshInterval) {
      clearInterval(this.tailscaleRefreshInterval);
      this.tailscaleRefreshInterval = null;
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
