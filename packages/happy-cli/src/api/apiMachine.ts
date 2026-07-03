/**
 * WebSocket client for machine/daemon communication with Happy server
 * Similar to ApiSessionClient but for machine-scoped connections
 */

import { io, Socket } from "socket.io-client";
import { logger } from "@/ui/logger";
import { configuration } from "@/configuration";
import {
  createSmartReconnect,
  type SmartReconnectHandle,
} from "@/utils/smartReconnect";
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
import type { AutomationJob, AutomationMutationResult } from "@/automation/types";
import type { AgentLoopDefinition } from "@/automation/AgentLoopStore";
import type { AgentLoopCreateInput, AgentLoopMutationResult, AgentLoopUpdateInput } from "@/automation/AgentLoopCoordinator";
import type { AgentLoopBootstrapCreateInput, AgentLoopBootstrapMutationResult, AgentLoopBootstrapUpdateInput } from "@/automation/AgentLoopBootstrapCoordinator";
import type { AgentLoopBootstrapProfile } from "@/automation/AgentLoopBootstrapStore";
import type { AutoDreamCreateInput, AutoDreamMutationResult, AutoDreamUpdateInput } from "@/automation/AutoDreamCoordinator";
import type { AutoDreamProfile } from "@/automation/AutoDreamStore";
import type { AgentLoopSuggestInput, AgentLoopSuggestion } from "@/automation/AgentLoopSuggestion";
import {
  type ResolvedRuntimeProfile,
  type AgentLoopTriggerEphemeral,
  type AgentLoopIterationReport,
} from "@kmmao/happy-wire";
import { createCipher, type Cipher } from "./encryption";
import { backoff } from "@/utils/time";
import { registerPreviewProxy, type PreviewCandidate } from "@/preview";
import { RpcHandlerManager } from "./rpc/RpcHandlerManager";
import { detectTailscale, detectTailscaleServe, type TailscaleInfo } from "@/utils/tailscale";
import type { TunnelManager } from "@/tunnel";
import { TerminalManager } from "@/terminal/TerminalManager";
import { generateAndSubmitRepoMap } from "@/knowledge";
import { buildMachineRpcRoutes } from "./machineRpcRoutes";



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

  // Sent immediately after (re-)connect to tell the server which sessions are
  // still running so it can restore their active flags after a server restart.
  "session-sync": (
    data: { sessionIds: string[] },
    callback?: (response: { ok: boolean; reactivated?: number; error?: string }) => void,
  ) => void;

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
  "task-status": (data: {
    taskId: string;
    status: string;
    sessionId?: string;
    errorMessage?: string;
  }) => void;
  "transcript-knowledge": (data: {
    turns: Array<{
      sessionId: string;
      entryType: string;
      title: string;
      content: string;
      request?: string;
      outcome?: string;
      tags: string[];
      confidence: string;
      model?: string;
      affectedFiles: string[];
    }>;
  }) => void;
  "session-event": (data: {
    sessionId: string;
    eventType: string;
    summary: string;
    detail?: Record<string, unknown>;
  }) => void;
  "terminal-output": (data: {
    machineId: string;
    terminalId: string;
    data: string;
  }) => void;
  "terminal-exit": (data: {
    machineId: string;
    terminalId: string;
    exitCode: number;
  }) => void;

  "session:message": (data: {
    fromSessionId: string;
    toSessionId: string;
    message: string;
  }) => void;

}

export type MachineRpcHandlers = {
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  stopSession: (sessionId: string) => boolean;
  requestShutdown: () => void;
  getAutomationStatus: () => {
    jobs: AutomationJob[];
    counts: Record<string, number>;
    guardians?: Array<{ key: string; projectId: string; loopId?: string; sessionId: string; updatedAt: number; lastRunId?: string; attached?: boolean; recovered?: boolean }>;
    guardianUsage?: Array<{ key: string; projectId?: string; loopId?: string; reuseCount: number; rememberCount: number; resetCount: number; lastUsedAt: number; currentSessionId?: string }>;
    auditStats?: { totalEvents: number; lastEventAt?: number; queuedCount: number; sessionStartedCount: number; terminalCompletedCount: number; terminalFailedCount: number; terminalCancelledCount: number; guardianReuseCount: number; guardianRememberCount: number; guardianResetCount: number; sessionReattachedCount: number; watchdogStopCount: number; stopRequestCount: number; policyGatedCount: number; downstreamEmitCount: number; guardianEligibleRunCount: number; guardianReuseRate: number; activeGuardianCount: number };
    recentAuditEvents?: Array<{ id: string; occurredAt: number; kind: string; jobId?: string; dedupeKey?: string; sessionId?: string; projectId?: string; runId?: string; loopId?: string; trigger?: string; status?: string; guardianKey?: string; guardianSessionId?: string; message?: string }>;
  };
  cancelAutomationJob: (jobId: string) => Promise<AutomationMutationResult>;
  retryAutomationJob: (jobId: string) => Promise<AutomationMutationResult>;
  removeAutomationJob: (jobId: string) => Promise<AutomationMutationResult>;
  clearAutomationJobs: () => Promise<AutomationMutationResult>;
  clearAutomationGuardians: (params?: { key?: string; sessionId?: string; clearAll?: boolean }) => Promise<{ success: boolean; errorMessage?: string }>;
  clearAutomationAudit: () => Promise<{ success: boolean; errorMessage?: string }>;
  setKillswitch: (enabled: boolean) => Promise<{ success: boolean; killed: boolean }>;
  getKillswitch: () => { killed: boolean };
  listAgentLoops: () => Promise<AgentLoopDefinition[]>;
  getAgentLoop: (loopId: string) => Promise<AgentLoopDefinition | undefined>;
  createAgentLoop: (input: AgentLoopCreateInput) => Promise<AgentLoopMutationResult>;
  updateAgentLoop: (loopId: string, input: AgentLoopUpdateInput) => Promise<AgentLoopMutationResult>;
  pauseAgentLoop: (loopId: string) => Promise<AgentLoopMutationResult>;
  resumeAgentLoop: (loopId: string) => Promise<AgentLoopMutationResult>;
  runAgentLoopNow: (loopId: string) => Promise<AgentLoopMutationResult>;
  removeAgentLoop: (loopId: string) => Promise<AgentLoopMutationResult>;
  emitAgentLoopEvent: (loopId: string, input: { source?: string; title: string; details?: string; autoRun?: boolean }) => Promise<AgentLoopMutationResult>;
  suggestAgentLoops: (input: AgentLoopSuggestInput) => Promise<AgentLoopSuggestion[]>;
  listAgentLoopBootstrapProfiles: () => Promise<AgentLoopBootstrapProfile[]>;
  getAgentLoopBootstrapProfile: (profileIdValue: string) => Promise<AgentLoopBootstrapProfile | undefined>;
  createAgentLoopBootstrapProfile: (input: AgentLoopBootstrapCreateInput) => Promise<AgentLoopBootstrapMutationResult>;
  updateAgentLoopBootstrapProfile: (profileIdValue: string, input: AgentLoopBootstrapUpdateInput) => Promise<AgentLoopBootstrapMutationResult>;
  pauseAgentLoopBootstrapProfile: (profileIdValue: string) => Promise<AgentLoopBootstrapMutationResult>;
  resumeAgentLoopBootstrapProfile: (profileIdValue: string) => Promise<AgentLoopBootstrapMutationResult>;
  runAgentLoopBootstrapProfileNow: (profileIdValue: string) => Promise<AgentLoopBootstrapMutationResult>;
  removeAgentLoopBootstrapProfile: (profileIdValue: string) => Promise<AgentLoopBootstrapMutationResult>;
  listAutoDreamProfiles: () => Promise<AutoDreamProfile[]>;
  getAutoDreamProfile: (profileIdValue: string) => Promise<AutoDreamProfile | undefined>;
  createAutoDreamProfile: (input: AutoDreamCreateInput) => Promise<AutoDreamMutationResult>;
  updateAutoDreamProfile: (profileIdValue: string, input: AutoDreamUpdateInput) => Promise<AutoDreamMutationResult>;
  pauseAutoDreamProfile: (profileIdValue: string) => Promise<AutoDreamMutationResult>;
  resumeAutoDreamProfile: (profileIdValue: string) => Promise<AutoDreamMutationResult>;
  runAutoDreamProfileNow: (profileIdValue: string) => Promise<AutoDreamMutationResult>;
  removeAutoDreamProfile: (profileIdValue: string) => Promise<AutoDreamMutationResult>;
  listTrackedSessions: () => TrackedSessionInfo[];
  listStaleSessions: () => Promise<StaleSessionsListResult>;
  cleanStaleSessions: (params: { pids: number[] }) => Promise<StaleSessionsCleanResult>;
};

export interface TrackedSessionInfo {
  pid: number;
  happySessionId?: string;
  spawnId?: string;
  startedAt?: number;
}

export interface StaleSessionInfo {
  pid: number;
  happySessionId?: string;
  spawnId?: string;
  startedAt?: number;
  lastHeartbeatAt?: number;
  lastActivityAt?: number;
  tmuxSessionId?: string;
  /** "dead" = process.kill(pid, 0) threw; "silent" = alive but no heartbeat for > threshold. */
  reason: "dead" | "silent";
  /** Time since last heartbeat, when `reason === "silent"`. */
  silentMs?: number;
}

export interface StaleSessionsListResult {
  stale: StaleSessionInfo[];
  checkedAt: number;
  /** Silence threshold used for detection, for UI display. */
  thresholdMs: number;
}

export interface StaleSessionsCleanResult {
  killed: number;
  errors: Array<{ pid: number; error: string }>;
}

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
  runtimeProfile?: unknown;
};

export type CiTriggerData = {
  type: "ci-trigger";
  eventId?: string;
  provider: string;
  repoPath: string;
  repoUrl: string;
  kind: "workflow_run" | "check_run" | "check_suite" | "generic";
  status: string;
  conclusion?: string;
  workflowName?: string;
  checkName?: string;
  branch?: string;
  sha?: string;
  title?: string;
  details?: string;
  targetLoopId?: string;
};

export type SupervisorTriggerData = {
  type: "supervisor-trigger";
  projectId: string;
  runId: string;
  trigger: string;
  machineId: string;
  repoPath: string;
  callbackToken?: string;
  mode?: string;
  dimensions?: string[];
  changedFiles?: string[];
  customRules?: string;
  customDimensions?: ReadonlyArray<{ key: string; title: string; prompt: string }>;
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
  /** Unified runtime profile resolved by App/Server before dispatch. */
  runtimeProfile?: ResolvedRuntimeProfile;
  /** Agent to use for this run. When absent, CLI infers from runtimeProfile. */
  agent?: string;
  /** PR metadata for PR-open-triggered review scans. */
  prContext?: {
    prNumber: number;
    prTitle: string;
    prDescription: string;
    prUrl: string;
    headBranch: string;
    baseBranch: string;
    author: string;
  };
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
  parentSessionId?: string;
};

const TAILSCALE_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export class ApiMachineClient {
  private socket!: Socket<ServerToDaemonEvents, DaemonToServerEvents>;
  private reconnect: SmartReconnectHandle | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private tailscaleRefreshInterval: NodeJS.Timeout | null = null;
  private lastTailscaleInfo: TailscaleInfo | null = null;
  private tunnelManager: TunnelManager | null = null;
  private rpcHandlerManager: RpcHandlerManager;
  private readonly cipher: Cipher;
  private webhookHandler: ((data: WebhookTriggerData) => void) | null = null;
  private ciHandler: ((data: CiTriggerData) => void) | null = null;
  private supervisorHandler:
    | ((data: SupervisorTriggerData) => void)
    | null = null;

  private taskHandler: ((data: { type: string; taskId: string; prompt: string; directory: string; priority: string; projectId?: string; resultToken?: string; skillContents?: Array<{ name: string; content: string }> }) => void) | null = null;
  private taskCancelHandler: ((data: { taskId: string; sessionId?: string }) => void) | null = null;
  private fixKillHandler:
    | ((data: { fixSessionId: string; projectId: string; fixStatus: string }) => void)
    | null = null;
  private sessionTerminateHandler:
    | ((data: { sessionId: string; reason: string }) => void)
    | null = null;
  /**
   * Phase 2 sessionAdopt — server pushes this ephemeral after the user
   * binds an existing Session to an automation owner (loop / schedule)
   * via the App. The daemon stamps the sessionId into
   * GuardianSessionRegistry so the NEXT trigger reuses the Session
   * instead of spawning a fresh one. Best effort: if the daemon was
   * offline at adopt time, the server skips the push and the next
   * trigger will just spawn fresh (same behaviour as no adoption).
   */
  private sessionAdoptedHandler:
    | ((data: {
        sessionId: string;
        projectId: string;
        loopId?: string;
        guardianKey: string;
      }) => void)
    | null = null;
  private supervisorRunCompleteHandler:
    | ((data: { runId: string; projectId: string; status: "completed" | "failed" }) => void)
    | null = null;
  // ADR-0022 Phase 3b — server-driven generic AgentLoop iteration trigger.
  private agentLoopTriggerHandler:
    | ((data: AgentLoopTriggerEphemeral) => void)
    | null = null;
  private pendingWebhookStatuses: Array<{
    webhookEventId: string;
    status: "dispatched" | "completed" | "failed";
    sessionId?: string;
    errorMessage?: string;
  }> = [];
  private pendingSupervisorStatuses: Array<SupervisorRunStatusData> = [];
  private pendingFixStatuses: Array<SupervisorFixStatusData> = [];
  private pendingTaskStatuses: Array<{
    taskId: string;
    status: string;
    sessionId?: string;
    errorMessage?: string;
  }> = [];
  private terminalManager = new TerminalManager();

  // Disconnect cleanup: timer fires after prolonged disconnect to terminate orphaned child processes
  private disconnectCleanupTimer: NodeJS.Timeout | null = null;
  // Provided by run.ts — returns happySessionIds of currently-running sessions for reconnect sync
  private sessionSyncProvider: (() => string[]) | null = null;
  // Provided by run.ts — terminates all tracked child processes after prolonged server disconnect
  private disconnectCleanupHandler: (() => void) | null = null;

  // Preview proxy: cleanup function for the registered preview proxy handler
  private previewProxyCleanup: (() => void) | null = null;

  constructor(
    private token: string,
    private machine: Machine,
  ) {
    // Initialize cipher + RPC handler manager
    this.cipher = createCipher(this.machine.encryptionKey, this.machine.encryptionVariant);
    this.rpcHandlerManager = new RpcHandlerManager({
      scopePrefix: this.machine.id,
      cipher: this.cipher,
      logger: (msg, data) => logger.debug(msg, data),
    });

    registerCommonHandlers(
      this.rpcHandlerManager,
      process.cwd(),
      this.machine.id,
    );
  }

  setRPCHandlers(handlers: MachineRpcHandlers) {
    // The ~45 instance-state-free RPC routes (spawn/stop session,
    // automation, agent loops, bootstrap/dream profiles, stale-session
    // cleanup, killswitch, daemon lifecycle) are declared as data in
    // machineRpcRoutes.ts — one snapshot-testable table (ADR-0021: method
    // names are server-observable, the test pins the list). Only handlers
    // that need instance state (tunnelManager, terminalManager, PTY) are
    // registered inline below.
    for (const route of buildMachineRpcRoutes(handlers)) {
      this.rpcHandlerManager.registerHandler(route.method, route.handler);
    }

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

    // --- Terminal RPC handlers ---
    this.rpcHandlerManager.registerHandler("terminal-spawn", async (params: any) => {
      return this.terminalManager.spawn({
        shell: params?.shell,
        cwd: params?.cwd,
        cols: params?.cols,
        rows: params?.rows,
        sessionId: params?.sessionId,
        terminalId: params?.terminalId,
      });
    });

    this.rpcHandlerManager.registerHandler("terminal-list", async (params: any) => {
      const { sessionId } = params || {};
      if (!sessionId) return { success: false, error: "sessionId required" };
      // Shells only — the App's "Terminal" side panel must not see the
      // Claude TUI PTY mixed in. The dedicated "Claude" tab uses
      // `claude-pty-attach` below.
      const terminals = this.terminalManager.listBySession(sessionId, "internal");
      return { success: true, terminals };
    });

    /**
     * Claude PTY attach — reports the externally-attached Claude TUI PTY
     * for a session (if any) so the App's dedicated "Claude" side panel
     * tab can mirror it. Read-only; lifecycle stays with
     * `claudePtyRuntime` in the session child.
     */
    this.rpcHandlerManager.registerHandler("claude-pty-attach", async (params: any) => {
      const sessionId = params?.sessionId;
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        return { success: false, error: "sessionId required" };
      }
      const pty = this.terminalManager.getExternalForSession(sessionId);
      if (!pty) return { success: true, exists: false };
      return {
        success: true,
        exists: true,
        terminalId: pty.terminalId,
        cols: pty.cols,
        rows: pty.rows,
        cwd: pty.cwd,
        createdAt: pty.createdAt,
        snapshot: pty.snapshot(),
      };
    });

    this.rpcHandlerManager.registerHandler("terminal-resize", async (params: any) => {
      const { terminalId, cols, rows } = params || {};
      if (!terminalId) return { success: false, error: "terminalId required" };
      const ok = this.terminalManager.resize(terminalId, cols, rows);
      return { success: ok, error: ok ? undefined : "Terminal not found" };
    });

    this.rpcHandlerManager.registerHandler("terminal-close", async (params: any) => {
      const { terminalId } = params || {};
      if (!terminalId) return { success: false, error: "terminalId required" };
      const ok = this.terminalManager.close(terminalId);
      return { success: ok, error: ok ? undefined : "Terminal not found" };
    });

    this.rpcHandlerManager.registerHandler("terminal-closeAll", async () => {
      const count = this.terminalManager.getActiveCount();
      this.terminalManager.closeAll();
      return { success: true, closed: count };
    });

    // Machine-level repo map generator: triggered from App to force-refresh the
    // codebase structure snapshot stored in the project knowledge base.
    this.rpcHandlerManager.registerHandler("generate-repo-map", async (params: any) => {
      const { projectId } = params || {};
      if (!projectId || typeof projectId !== "string") {
        return { success: false, error: "projectId is required" };
      }
      const result = await generateAndSubmitRepoMap(
        process.cwd(),
        configuration.serverUrl,
        this.token,
        projectId,
        undefined,
        true, // force=true bypasses the "recent exists" check
      );
      return { success: result.submitted || result.skipped === true, ...result };
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
   * Set handler for incoming CI trigger events.
   * Called when Server dispatches a ci-trigger ephemeral event to this machine.
   */
  setCiHandler(handler: (data: CiTriggerData) => void) {
    this.ciHandler = handler;
  }

  /**
   * Set handler for incoming supervisor trigger events.
   * Called when Server dispatches a supervisor-trigger ephemeral event to this machine.
   */
  setSupervisorHandler(handler: (data: SupervisorTriggerData) => void) {
    this.supervisorHandler = handler;
  }

  setSupervisorRunCompleteHandler(
    handler: (data: { runId: string; projectId: string; status: "completed" | "failed" }) => void,
  ) {
    this.supervisorRunCompleteHandler = handler;
  }

  /**
   * ADR-0022 Phase 3b — register a handler for `agent-loop-trigger`
   * ephemerals emitted by the server's generic AgentLoop scheduler. The
   * handler is called once per iteration the server schedules; it
   * receives the full wire ephemeral including the per-iteration
   * `callbackToken` the daemon will present on the iteration HTTP
   * callback.
   */
  setAgentLoopTriggerHandler(handler: (data: AgentLoopTriggerEphemeral) => void) {
    this.agentLoopTriggerHandler = handler;
  }

  /**
   * ADR-0022 Phase 3b — POST the per-iteration report back to the server.
   * The bearer token comes from the matching `agent-loop-trigger`
   * ephemeral (see {@link setAgentLoopTriggerHandler}); the server
   * validates it via constant-time HMAC compare in agentLoopEngine.
   *
   * Returns `{ ok }` mirroring the existing fetch helpers — we deliberately
   * don't throw on non-2xx so the caller (RemoteAgentLoopController) can
   * log and move on without bubbling into terminal job handling.
   */
  async postAgentLoopIterationReport(opts: {
    projectId: string;
    loopId: string;
    bearerToken: string;
    body: AgentLoopIterationReport;
  }): Promise<{ ok: boolean; status?: number; error?: string }> {
    const url =
      `${configuration.serverUrl}/v1/projects/${encodeURIComponent(opts.projectId)}` +
      `/agent-loops/${encodeURIComponent(opts.loopId)}/iterations`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.bearerToken}`,
        },
        body: JSON.stringify(opts.body),
      });
      if (!resp.ok) {
        let errText: string | undefined;
        try {
          errText = await resp.text();
        } catch {
          errText = undefined;
        }
        return { ok: false, status: resp.status, error: errText };
      }
      return { ok: true, status: resp.status };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Set handler for incoming task trigger events.
   * Called when Server dispatches a task-trigger ephemeral event to this machine.
   */
  setTaskHandler(handler: (data: { type: string; taskId: string; prompt: string; directory: string; priority: string; projectId?: string; resultToken?: string; skillContents?: Array<{ name: string; content: string }>; agentType?: string | null; modelOverride?: string | null; modelMode?: string | null; effort?: string | null; profileId?: string; runtimeProfile?: ResolvedRuntimeProfile }) => void) {
    this.taskHandler = handler;
  }

  /**
   * Set handler for task-cancel events.
   * Called when Server signals that a running/dispatching task should be aborted.
   */
  setTaskCancelHandler(handler: (data: { taskId: string; sessionId?: string }) => void) {
    this.taskCancelHandler = handler;
  }

  /**
   * Set handler for fix-kill-session events.
   * Called when Server signals that a fix session should be terminated.
   */
  setFixKillHandler(handler: (data: { fixSessionId: string; projectId: string; fixStatus: string }) => void) {
    this.fixKillHandler = handler;
  }

  /**
   * Set handler for session-terminate events.
   * Called when Server signals that a session was archived or deleted and its process should stop.
   */
  setSessionTerminateHandler(handler: (data: { sessionId: string; reason: string }) => void) {
    this.sessionTerminateHandler = handler;
  }

  /**
   * Set handler for session-adopted ephemeral (Phase 2 sessionAdopt).
   * Startup wiring in startDaemon.ts hooks this to GuardianSessionRegistry.
   */
  setSessionAdoptedHandler(
    handler: (data: {
      sessionId: string;
      projectId: string;
      loopId?: string;
      guardianKey: string;
    }) => void,
  ) {
    this.sessionAdoptedHandler = handler;
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

  /**
   * Report task execution status back to server.
   * Queues the status if the socket is disconnected and flushes on reconnect.
   */
  taskStatus(
    taskId: string,
    status: string,
    sessionId?: string,
    errorMessage?: string,
    outcome?: "completed" | "failed" | "blocked",
  ) {
    const data = { taskId, status, sessionId, errorMessage, outcome };
    if (!this.socket.connected) {
      logger.debug(
        `[TASK] Socket disconnected, queuing status for task ${taskId}`,
      );
      this.pendingTaskStatuses.push(data);
      return;
    }
    this.socket.emit("task-status", data);
  }

  private flushPendingTaskStatuses() {
    const pending = [...this.pendingTaskStatuses];
    this.pendingTaskStatuses = [];
    for (const item of pending) {
      this.socket.emit("task-status", item);
    }
  }

  /**
   * Submit session transcript turns as knowledge entries.
   * Reuses the existing "submit-knowledge" socket event.
   * Fire-and-forget — server maps sessions to projects and stores entries.
   */
  emitTranscriptKnowledge(turns: Array<{
    sessionId: string;
    userMessage: string;
    assistantText: string;
    fileEdits: Array<{ path: string; type: string }>;
    toolCallCount: number;
    outputTokens: number;
    model: string;
  }>) {
    if (!this.socket.connected) return;
    const entries = turns.slice(0, 10).map((turn) => {
      const text = `${turn.userMessage} ${turn.assistantText}`.toLowerCase();
      const entryType = text.includes("fix") || text.includes("bug") ? "fix"
        : text.includes("decision") || text.includes("选型") ? "decision"
        : "discovery";
      const firstLine = turn.userMessage.split("\n")[0].trim().slice(0, 200) || "Session activity";
      return {
        sessionId: turn.sessionId,
        entryType,
        title: firstLine,
        content: turn.assistantText.slice(0, 2000),
        request: turn.userMessage.slice(0, 500),
        outcome: turn.fileEdits.length > 0
          ? `Modified ${turn.fileEdits.length} file(s): ${turn.fileEdits.map((f) => f.path).join(", ").slice(0, 500)}`
          : undefined,
        tags: [...new Set(turn.fileEdits.map((f) => f.path.split(".").pop()).filter(Boolean))].slice(0, 10) as string[],
        confidence: turn.outputTokens > 1000 ? "high" : "medium",
        model: turn.model,
        affectedFiles: turn.fileEdits.map((f) => f.path),
      };
    });
    this.socket.emit("transcript-knowledge", { turns: entries });
  }

  /**
   * Report a session timeline event. Fire-and-forget, no queueing.
   */
  sessionEvent(
    sessionId: string,
    eventType: string,
    summary: string,
    detail?: Record<string, unknown>,
  ) {
    if (!this.socket.connected) return;
    this.socket.emit("session-event", { sessionId, eventType, summary, detail });
  }

  sendInterAgentMessage(fromSessionId: string, toSessionId: string, message: string) {
    if (!this.socket.connected) return;
    this.socket.emit("session:message", { fromSessionId, toSessionId, message });
  }

  /**
   * Claude PTY bridge — session child processes own the Claude TUI PTY, but
   * the daemon owns the App-facing TerminalManager + machine socket. These
   * methods let the control-server callbacks plug per-session PTYs into the
   * existing terminal wire without exposing the manager itself.
   *
   * `attachClaudePty` registers an external attachment so `terminal-spawn` /
   * `terminal-list` RPCs see the Claude PTY alongside shell PTYs. The
   * attachment buffers the most recent bytes for reconnect replay.
   */
  attachClaudePty(input: {
    terminalId: string;
    sessionId: string;
    cols: number;
    rows: number;
    cwd: string;
    /**
     * Loopback URL of the per-session reverse HTTP server. When present, App
     * keystrokes / resizes / close-requests POST straight through to the
     * Claude PTY — the App's "Open Raw Claude Terminal" view becomes
     * interactive. When absent, the attachment is observation-only (legacy
     * behavior; happens with older session children that don't run the
     * reverse server).
     */
    reverseUrl?: string;
  }): void {
    if (input.reverseUrl) {
      this.claudePtyReverseUrls.set(input.terminalId, input.reverseUrl);
    }
    this.terminalManager.attachExternal({
      terminalId: input.terminalId,
      sessionId: input.sessionId,
      cols: input.cols,
      rows: input.rows,
      cwd: input.cwd,
      createdAt: Date.now(),
      // Empty initial snapshot — TerminalManager grows it via the
      // appendOutput hook on each emitExternalOutput call.
      snapshot: () => "",
      write: (data) => {
        this.postClaudePtyReverse(input.terminalId, "/input", { data });
      },
      resize: (cols, rows) => {
        this.postClaudePtyReverse(input.terminalId, "/resize", { cols, rows });
      },
      requestClose: () => {
        this.postClaudePtyReverse(input.terminalId, "/close", {});
      },
    });
  }

  detachClaudePty(terminalId: string): void {
    this.claudePtyReverseUrls.delete(terminalId);
    this.terminalManager.detachExternal(terminalId);
  }

  forwardClaudePtyData(terminalId: string, data: string): void {
    // Replay buffer maintenance now lives inside the external attachment —
    // a single call here both appends-to-buffer and fans-out the chunk.
    this.terminalManager.emitExternalOutput(terminalId, data);
  }

  forwardClaudePtyExit(terminalId: string, exitCode: number): void {
    this.claudePtyReverseUrls.delete(terminalId);
    this.terminalManager.emitExternalExit(terminalId, exitCode);
  }

  /**
   * terminalId → session-local reverse-server base URL. Populated by
   * `attachClaudePty` when the session child reports a URL; cleared on
   * detach / exit. POSTs use this to route App→PTY traffic without
   * threading another callback through `setRPCHandlers`.
   */
  private claudePtyReverseUrls = new Map<string, string>();

  /**
   * Fire-and-forget POST to the per-session reverse server. Failures are
   * logged at debug — App "send" UX already treats these as best-effort
   * (no ack today), and the alternative (retry / queue) would re-implement
   * the daemon-side backpressure already living in `claudePtyDaemonBridge`
   * for the opposite direction. If this becomes a real ordering issue we
   * will switch to a per-terminalId FIFO mirror of the bridge.
   */
  private postClaudePtyReverse(
    terminalId: string,
    path: "/input" | "/resize" | "/close",
    body: Record<string, unknown>,
  ): void {
    const base = this.claudePtyReverseUrls.get(terminalId);
    if (!base) return; // session child didn't expose a reverse channel
    void fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) {
          logger.debug(
            `[API MACHINE] claude-pty reverse POST ${path} for ${terminalId} → ${res.status}`,
          );
        }
      })
      .catch((err) => {
        logger.debug(
          `[API MACHINE] claude-pty reverse POST ${path} for ${terminalId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
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
        metadata: this.cipher.encrypt(updated),
        expectedVersion: this.machine.metadataVersion,
      });

      if (answer.result === "success") {
        const decrypted = this.cipher.decrypt(answer.metadata);
        this.machine.metadata = decrypted.ok ? decrypted.value : null;
        this.machine.metadataVersion = answer.version;
        logger.debug("[API MACHINE] Metadata updated successfully");
      } else if (answer.result === "version-mismatch") {
        if (answer.version > this.machine.metadataVersion) {
          this.machine.metadataVersion = answer.version;
          const decrypted = this.cipher.decrypt(answer.metadata);
          this.machine.metadata = decrypted.ok ? decrypted.value : null;
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

      const answer = await this.socket.timeout(10_000).emitWithAck("machine-update-state", {
        machineId: this.machine.id,
        daemonState: this.cipher.encrypt(updated),
        expectedVersion: this.machine.daemonStateVersion,
      });

      if (answer.result === "success") {
        const decrypted = this.cipher.decrypt(answer.daemonState);
        this.machine.daemonState = decrypted.ok ? decrypted.value : null;
        this.machine.daemonStateVersion = answer.version;
        logger.debug("[API MACHINE] Daemon state updated successfully");
      } else if (answer.result === "version-mismatch") {
        if (answer.version > this.machine.daemonStateVersion) {
          this.machine.daemonStateVersion = answer.version;
          const decrypted = this.cipher.decrypt(answer.daemonState);
          this.machine.daemonState = decrypted.ok ? decrypted.value : null;
        }
        throw new Error("Daemon state version mismatch"); // Triggers retry
      }
    });
  }

  /**
   * Sync todo.md entries to the server. Creates new tasks and updates status of existing ones.
   * Returns the updated serialized task list so the caller can re-write todo.md with new task IDs.
   */
  async syncTodoMdEntries(params: {
    machineId: string;
    projectId: string;
    entries: Array<{ taskId?: string; checked: boolean; text: string }>;
  }): Promise<{ tasks: Array<Record<string, unknown>>; created: number; updated: number } | null> {
    try {
      const resp = await fetch(`${configuration.serverUrl}/v1/tasks/sync-from-file`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(params),
      });
      if (!resp.ok) {
        logger.debug(`[TODO SYNC] sync-from-file returned ${resp.status}`);
        return null;
      }
      return (await resp.json()) as { tasks: Array<Record<string, unknown>>; created: number; updated: number };
    } catch (err) {
      logger.debug(`[TODO SYNC] sync-from-file error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Register preview proxy on the machine socket.
   *
   * Listens for `preview-start-proxy` from the server (sent after tunnel
   * creation) and activates `registerPreviewProxy` which handles
   * `preview-proxy-request` / `preview-ws-connect` events.
   */
  private registerPreviewProxyHandlers() {
    // Clean up any previous proxy
    this.previewProxyCleanup?.();
    this.previewProxyCleanup = null;

    // Listen for server telling us to start proxying
    this.socket.on("preview-start-proxy" as any, (data: { tunnelId: string; candidate: PreviewCandidate }) => {
      logger.debug(`[PREVIEW] Starting proxy for tunnel ${data.tunnelId} → ${data.candidate.host}:${data.candidate.port}`);
      // Clean up any previous proxy
      this.previewProxyCleanup?.();
      this.previewProxyCleanup = registerPreviewProxy(this.socket as any, data.candidate);
    });

    // Listen for server telling us to stop proxying
    this.socket.on("preview-stop-proxy" as any, () => {
      logger.debug("[PREVIEW] Stopping proxy");
      this.previewProxyCleanup?.();
      this.previewProxyCleanup = null;
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
      // Self-managed reconnection (see SmartReconnect) replaces socket.io's
      // built-in auto-reconnect, which otherwise revives zombie connections on
      // Power-Nap WiFi blips after lid-close.
      reconnection: false,
    });

    this.reconnect = createSmartReconnect({
      connect: () => this.socket.connect(),
      log: (message) => logger.debug(`[API MACHINE] reconnect: ${message}`),
    });

    this.socket.on("connect", () => {
      logger.debug("[API MACHINE] Connected to server; waiting for auth-ready");
      this.reconnect?.cancel();

      // Cancel any pending disconnect cleanup timer as soon as transport is back.
      if (this.disconnectCleanupTimer) {
        clearTimeout(this.disconnectCleanupTimer);
        this.disconnectCleanupTimer = null;
      }
    });

    this.socket.on("auth", (data) => {
      if (!data?.success) {
        logger.debug("[API MACHINE] Server auth-ready failed");
        return;
      }

      logger.debug("[API MACHINE] Authenticated server socket is ready");

      // Update daemon state to running. We intentionally wait for the server's
      // auth-ready event because the server registers socket listeners after
      // async token verification; emitting immediately on transport connect can
      // race and get dropped.
      void this.updateDaemonState((state) => ({
        ...state,
        status: "running",
        pid: process.pid,
        httpPort: this.machine.daemonState?.httpPort,
        startedAt: Date.now(),
        startedWithCliVersion: configuration.currentCliVersion,
        tailscale: this.lastTailscaleInfo ?? state?.tailscale,
        tunnels: this.tunnelManager?.getLastState() ?? state?.tunnels,
      }));

      // Register all handlers only after the server-side rpc listener exists.
      this.rpcHandlerManager.onSocketConnect(this.socket);

      // Set up terminal streaming handlers
      this.terminalManager.setOutputHandler((terminalId, data) => {
        this.socket.emit("terminal-output", {
          machineId: this.machine.id,
          terminalId,
          data,
        });
      });
      this.terminalManager.setExitHandler((terminalId, exitCode) => {
        this.socket.emit("terminal-exit", {
          machineId: this.machine.id,
          terminalId,
          exitCode,
        });
      });

      // Flush any webhook statuses queued during disconnect
      this.flushPendingWebhookStatuses();
      this.flushPendingSupervisorStatuses();
      this.flushPendingFixStatuses();
      this.flushPendingTaskStatuses();

      this.syncActiveSessions();

      // Register preview proxy handlers on machine socket.
      // The server sends preview-proxy-request events when a tunnel is active;
      // the handler fetches from the local dev server and streams back.
      this.registerPreviewProxyHandlers();

      // Start keep-alive
      this.startKeepAlive();

      // Start periodic Tailscale refresh
      this.startTailscaleRefresh();
    });

    this.socket.on("disconnect", () => {
      logger.debug("[API MACHINE] Disconnected from server");
      this.rpcHandlerManager.onSocketDisconnect();
      this.reconnect?.schedule();
      this.stopKeepAlive();
      this.stopTailscaleRefresh();
      this.terminalManager.closeAll();

      // After a prolonged disconnect, child processes can no longer report
      // results back to the server. Schedule a graceful cleanup so they don't
      // run indefinitely as orphans.
      const timeoutMs = parseInt(
        process.env.HAPPY_DISCONNECT_CLEANUP_TIMEOUT_MS ?? `${5 * 60_000}`,
      );
      if (timeoutMs > 0 && this.disconnectCleanupHandler) {
        const handler = this.disconnectCleanupHandler;
        this.disconnectCleanupTimer = setTimeout(() => {
          this.disconnectCleanupTimer = null;
          logger.warn(`[API MACHINE] Server unreachable for ${timeoutMs / 1000}s — terminating orphaned child sessions`);
          handler();
        }, timeoutMs);
      }
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
          const decrypted = this.cipher.decrypt(update.metadata.value);
          this.machine.metadata = decrypted.ok ? decrypted.value : null;
          this.machine.metadataVersion = update.metadata.version;
        }

        if (update.daemonState) {
          logger.debug("[API MACHINE] Received external daemon state update");
          const decrypted = this.cipher.decrypt(update.daemonState.value);
          this.machine.daemonState = decrypted.ok ? decrypted.value : null;
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
      if (data.type === "ci-trigger" && this.ciHandler) {
        logger.debug(
          `[API MACHINE] Received ci-trigger for repo ${data.repoPath}, kind ${data.kind}`,
        );
        this.ciHandler(data as CiTriggerData);
      }
      if (data.type === "supervisor-trigger" && this.supervisorHandler) {
        logger.debug(
          `[API MACHINE] Received supervisor-trigger for project ${data.projectId}, run ${data.runId}`,
        );
        this.supervisorHandler(data as SupervisorTriggerData);
      }

      if (data.type === "task-trigger" && this.taskHandler) {
        logger.debug(
          `[API MACHINE] Received task-trigger for task ${data.taskId}`,
        );
        this.taskHandler(data as { type: string; taskId: string; prompt: string; directory: string; priority: string; projectId?: string; resultToken?: string; skillContents?: Array<{ name: string; content: string }>; agentType?: string | null; modelOverride?: string | null; modelMode?: string | null; effort?: string | null; profileId?: string; runtimeProfile?: ResolvedRuntimeProfile });
      }

      if (data.type === "task-cancel" && this.taskCancelHandler) {
        logger.debug(
          `[API MACHINE] Received task-cancel for task ${data.taskId}`,
        );
        this.taskCancelHandler(data as unknown as { taskId: string; sessionId?: string });
      }

      if (data.type === "supervisor-fix-kill-session" && this.fixKillHandler) {
        logger.debug(
          `[API MACHINE] Received fix-kill-session for session ${data.fixSessionId}`,
        );
        this.fixKillHandler(data as unknown as { fixSessionId: string; projectId: string; fixStatus: string });
      }

      if (data.type === "session-terminate" && this.sessionTerminateHandler) {
        logger.debug(
          `[API MACHINE] Received session-terminate for session ${data.sessionId} (reason: ${data.reason})`,
        );
        this.sessionTerminateHandler(data as unknown as { sessionId: string; reason: string });
      }

      if (data.type === "session-adopted" && this.sessionAdoptedHandler) {
        logger.debug(
          `[API MACHINE] Received session-adopted for session ${data.sessionId} (guardianKey=${data.guardianKey})`,
        );
        this.sessionAdoptedHandler(
          data as unknown as {
            sessionId: string;
            projectId: string;
            loopId?: string;
            guardianKey: string;
          },
        );
      }

      if (data.type === "supervisor-run-complete" && this.supervisorRunCompleteHandler) {
        logger.debug(
          `[API MACHINE] Received supervisor-run-complete for run ${data.runId} status=${data.status}`,
        );
        this.supervisorRunCompleteHandler(data as unknown as { runId: string; projectId: string; status: "completed" | "failed" });
      }

      // ADR-0022 Phase 3b — server-driven generic AgentLoop iteration.
      // Wire ephemeral carries `t` discriminator on the server side; the
      // Socket.IO event dispatcher rewrites it to `type` so we match on the
      // App-side type the rest of this switch uses. The runtime shape
      // matches AgentLoopTriggerEphemeral 1:1 (modulo that rename).
      if (data.type === "agent-loop-trigger" && this.agentLoopTriggerHandler) {
        logger.debug(
          `[API MACHINE] Received agent-loop-trigger for loop ${data.loopId} iter ${data.iteration}`,
        );
        // Rebuild a wire-shaped object (server uses `t`, socket forwarded
        // `type`). The controller reads only the documented fields below.
        // `modelMode` and `effort` were added to the wire schema later and
        // must be threaded through here too — without them the daemon would
        // silently fall back to the Claude Code default model/effort
        // instead of honouring the per-loop override stored on the server.
        const ephemeral: AgentLoopTriggerEphemeral = {
          t: "agent-loop-trigger",
          loopId: data.loopId,
          projectId: data.projectId,
          machineId: data.machineId,
          iteration: data.iteration,
          prompt: data.prompt,
          directory: data.directory,
          agent: data.agent,
          continuityKey: data.continuityKey,
          profileId: data.profileId ?? null,
          runtimeProfile: data.runtimeProfile,
          modelMode: data.modelMode ?? null,
          effort: data.effort ?? null,
          genericConfig: data.genericConfig,
          callbackToken: data.callbackToken,
          maxDurationMinutes: data.maxDurationMinutes,
        };
        this.agentLoopTriggerHandler(ephemeral);
      }

      // Terminal input forwarding (from App via Server)
      if (data.type === "terminal-input" && data.terminalId && data.data) {
        this.terminalManager.write(data.terminalId, data.data);
      }
    });

    this.socket.on("connect_error", (error) => {
      logger.debug(`[API MACHINE] Connection error: ${error.message}`);
      this.reconnect?.schedule();
    });

    // Kick the reconnect loop immediately so that an initial connection
    // failure (before any connect/connect_error fires) is retried.
    this.reconnect?.schedule();

    this.socket.io.on("error", (error: any) => {
      logger.debug("[API MACHINE] Socket error:", error);
    });
  }

  private syncActiveSessions(): void {
    if (!this.sessionSyncProvider) {
      return;
    }

    const sessionIds = [...new Set(this.sessionSyncProvider())];
    if (sessionIds.length === 0) {
      return;
    }

    logger.debug(`[API MACHINE] Syncing ${sessionIds.length} active session(s) with server`);
    void backoff(async () => {
      const response = await this.socket
        .timeout(10_000)
        .emitWithAck("session-sync", { sessionIds });
      if (!response?.ok) {
        throw new Error(response?.error ?? "session-sync rejected");
      }
      logger.debug(`[API MACHINE] Server reactivated ${response.reactivated ?? 0} active session(s)`);
    }).catch((error) => {
      logger.debug(`[API MACHINE] Failed to sync active sessions: ${error instanceof Error ? error.message : String(error)}`);
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

  /** Called by run.ts so the client can report active sessions on reconnect. */
  setSessionSyncProvider(provider: () => string[]) {
    this.sessionSyncProvider = provider;
  }

  /**
   * Called by run.ts to register a cleanup handler that terminates all tracked
   * child processes when the server has been unreachable for too long.
   */
  setDisconnectCleanupHandler(handler: () => void) {
    this.disconnectCleanupHandler = handler;
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
    this.reconnect?.shutdown();
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
