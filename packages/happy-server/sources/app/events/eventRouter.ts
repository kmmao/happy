import { Socket } from "socket.io";
import { log } from "@/utils/log";
import { recipientMatches } from "./recipientMatcher";
import { GitHubProfile } from "@/app/api/types";
import type { SessionMessageContent } from "@kmmao/happy-wire";
import type { ResolvedRuntimeProfile } from "@kmmao/happy-wire";
// Note: PR 1.f moved the 15 build*Update functions (and their AccountProfile /
// getPublicUrl / privacyKit imports) into syncUpdate.ts as private helpers.
// The remaining build*Ephemeral functions in this file have no need for them.

// === CONNECTION TYPES ===

export interface SessionScopedConnection {
  connectionType: "session-scoped";
  socket: Socket;
  userId: string;
  sessionId: string;
}

export interface UserScopedConnection {
  connectionType: "user-scoped";
  socket: Socket;
  userId: string;
}

export interface MachineScopedConnection {
  connectionType: "machine-scoped";
  socket: Socket;
  userId: string;
  machineId: string;
}

export type ClientConnection =
  | SessionScopedConnection
  | UserScopedConnection
  | MachineScopedConnection;

// === RECIPIENT FILTER TYPES ===

export type RecipientFilter =
  | { type: "all-interested-in-session"; sessionId: string }
  | { type: "user-scoped-only" }
  | { type: "machine-scoped-only"; machineId: string } // For update-machine: sends to user-scoped + only the specific machine
  | { type: "all-user-authenticated-connections" };

// === UPDATE EVENT TYPES (Persistent) ===

export type UpdateEvent =
  | {
      type: "new-message";
      sessionId: string;
      message: {
        id: string;
        seq: number;
        content: SessionMessageContent;
        localId: string | null;
        createdAt: number;
        updatedAt: number;
      };
    }
  | {
      type: "new-session";
      sessionId: string;
      seq: number;
      metadata: string;
      metadataVersion: number;
      agentState: string | null;
      agentStateVersion: number;
      dataEncryptionKey: string | null;
      active: boolean;
      activeAt: number;
      createdAt: number;
      updatedAt: number;
    }
  | {
      type: "update-session";
      sessionId: string;
      metadata?:
        | {
            value: string | null;
            version: number;
          }
        | null
        | undefined;
      agentState?:
        | {
            value: string | null;
            version: number;
          }
        | null
        | undefined;
      preferences?:
        | {
            value: string | null;
            version: number;
          }
        | null
        | undefined;
    }
  | {
      type: "update-account";
      userId: string;
      settings?:
        | {
            value: string | null;
            version: number;
          }
        | null
        | undefined;
      github?: GitHubProfile | null | undefined;
    }
  | {
      type: "new-machine";
      machineId: string;
      seq: number;
      metadata: string;
      metadataVersion: number;
      daemonState: string | null;
      daemonStateVersion: number;
      dataEncryptionKey: string | null;
      active: boolean;
      activeAt: number;
      createdAt: number;
      updatedAt: number;
    }
  | {
      type: "update-machine";
      machineId: string;
      metadata?: {
        value: string;
        version: number;
      };
      daemonState?: {
        value: string;
        version: number;
      };
      activeAt?: number;
    }
  | {
      type: "new-artifact";
      artifactId: string;
      seq: number;
      header: string;
      headerVersion: number;
      body: string;
      bodyVersion: number;
      dataEncryptionKey: string | null;
      createdAt: number;
      updatedAt: number;
    }
  | {
      type: "update-artifact";
      artifactId: string;
      header?: {
        value: string;
        version: number;
      };
      body?: {
        value: string;
        version: number;
      };
    }
  | {
      type: "delete-artifact";
      artifactId: string;
    }
  | {
      type: "delete-session";
      sessionId: string;
    }
  | {
      type: "relationship-updated";
      uid: string;
      status: "none" | "requested" | "pending" | "friend" | "rejected";
      timestamp: number;
    }
  | {
      type: "new-feed-post";
      id: string;
      body: any;
      cursor: string;
      createdAt: number;
    }
  | {
      type: "kv-batch-update";
      changes: Array<{
        key: string;
        value: string | null; // null indicates deletion
        version: number; // -1 for deleted keys
      }>;
    }
  | {
      type: "new-project";
      projectId: string;
      machineId: string;
      path: string;
      repoUrl: string | null;
      metadata: string | null;
      metadataVersion: number;
      archived: boolean;
      createdAt: number;
      updatedAt: number;
    }
  | {
      type: "update-project";
      projectId: string;
      metadata?: {
        value: string | null;
        version: number;
      };
      archived?: boolean;
    }
  | {
      type: "delete-project";
      projectId: string;
    }
  | {
      // ADR-0022 Phase 3b — generic AgentLoop definition created or
      // mutated server-side. Mirrors the supervisor-loop "row changed"
      // signal but for the unified agent-loops endpoint.
      type: "agent-loop-updated";
      loop: Record<string, any>;
    }
  | {
      type: "agent-loop-deleted";
      loopId: string;
      projectId: string;
    };

// === EPHEMERAL EVENT TYPES (Transient) ===

export type EphemeralEvent =
  | {
      type: "activity";
      id: string;
      active: boolean;
      activeAt: number;
      thinking?: boolean;
    }
  | {
      type: "machine-activity";
      id: string;
      active: boolean;
      activeAt: number;
    }
  | {
      type: "rpc-ready";
      scope: "machine" | "session";
      id: string; // machineId or sessionId
      ready: boolean;
    }
  | {
      type: "usage";
      id: string;
      key: string;
      tokens: Record<string, number>;
      cost: Record<string, number>;
      timestamp: number;
    }
  | {
      type: "machine-status";
      machineId: string;
      online: boolean;
      timestamp: number;
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
      runtimeProfile?: ResolvedRuntimeProfile;
    }
  | {
      type: "webhook-issue-linked";
      issueNumber: number;
      issueTitle: string;
      issueBody: string;
      issueAuthor: string;
      issueLabels: string[];
      issueUrl: string;
      repoUrl: string;
      repoPath: string;
      machineId: string;
      sessionId: string;
    }
  | {
      type: "webhook-pr-merged";
      prNumber: number;
      prUrl: string;
      issueNumber: number;
      sessionId: string;
      machineId: string;
      repoPath: string;
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
      fixAction?: {
        title: string;
        description: string;
        suggestedFix: string | null;
        category: string;
        severity: string;
        issueNumber?: number;
      };
      fixStrategy?: string;
      maxConcurrentAnalysis?: number;
      maxConcurrentFix?: number;
    }
  | {
      type: "supervisor-status";
      runId: string;
      projectId: string;
      status: string;
      artifactId?: string;
      errorMessage?: string;
    }
  | {
      type: "supervisor-fix-kill-session";
      fixSessionId: string;
      projectId: string;
      fixStatus: string;
    }
  | {
      type: "supervisor-loop-status";
      loopId: string;
      projectId: string;
      status: string;
      currentIteration: number;
      maxIterations: number;
      currentPhase: string;
      totalCostUsd: number;
      totalActionsFound: number;
      totalActionsFixed: number;
      currentHealthScore: number | null;
      initialHealthScore: number | null;
      exitReason: string | null;
      consecutiveFailures: number;
    }
  | {
      type: "supervisor-loop-brief";
      loopId: string;
      projectId: string;
      status: string;
      exitReason: string | null;
      generatedAt: number;
      currentIteration: number;
      maxIterations: number;
      initialHealthScore: number | null;
      currentHealthScore: number | null;
      healthDelta: number | null;
      totalActionsFound: number;
      totalActionsFixed: number;
      consecutiveFailures: number;
      totalCostUsd: number;
      costCapUsd: number | null;
      summary: string;
    }
  | {
      type: "auto-loop-fired";
      projectId: string;
      loopId: string;
      healthScore: number;
      threshold: number;
      firedAt: number;
    }
  | {
      type: "knowledge-count";
      id: string;
      count: number;
    }
  | {
      type: "knowledge-access-update";
      sessionId: string;
      at: number;
      hit?: number;
      miss?: number;
      evicted?: number;
    }
  | {
      type: "task-log";
      sessionId: string;
      taskId: string;
      outputFile: string;
      chunk: string;
      offset: number;
    }
  | {
      type: "task-trigger";
      taskId: string;
      prompt: string;
      directory: string;
      priority: string;
      projectId?: string;
      skillContents?: Array<{ name: string; content: string }>;
    }
  | {
      type: "task-status-changed";
      taskId: string;
      machineId: string;
      status: string;
      sessionId?: string;
      errorMessage?: string;
      completedAt?: number;
      triggerType?: string;
    }
  | {
      type: "inbox-new-item";
      item: {
        id: string;
        category: string;
        eventType: string;
        severity: string;
        title: string;
        body?: string;
        read: boolean;
        referenceUrl?: string;
        refType?: string;
        refId?: string;
        groupKey?: string;
        createdAt: number;
      };
    }
  | {
      type: "inbox-unread-count";
      count: number;
    }
  | {
      type: "session-event-created";
      event: {
        id: string;
        sessionId: string;
        eventType: string;
        summary: string;
        detail?: Record<string, unknown>;
        createdAt: number;
      };
    }
  | {
      type: "terminal-output";
      machineId: string;
      terminalId: string;
      data: string;
    }
  | {
      type: "terminal-exit";
      machineId: string;
      terminalId: string;
      exitCode: number;
    }
  | {
      type: "terminal-input";
      machineId: string;
      terminalId: string;
      data: string;
    }
  | {
      type: "task-cancel";
      taskId: string;
      sessionId?: string;
    }
  | {
      type: "supervisor-run-complete";
      runId: string;
      projectId: string;
      status: "completed" | "failed";
    }
  | {
      type: "session-terminate";
      sessionId: string;
      reason: "timeout" | "deleted" | "archived" | "cancelled";
    }
  | {
      type: "inter-agent-message";
      fromSessionId: string;
      toSessionId: string;
      message: string;
      sentAt: number;
    }
  | {
      type: "world-event-created";
      event: {
        id: string;
        eventType: string;
        title: string;
        summary: string;
        occurredAt: number;
        severity: "info" | "warning" | "critical";
        source: {
          type: "project" | "machine" | "session" | "trigger" | "agent" | "system";
          projectId?: string | null;
          projectPath?: string | null;
          machineId?: string | null;
          sessionId?: string | null;
        };
        originalId: string;
        parentTaskId?: string | null;
      };
    }
  | {
      type: "preview-candidate-reported";
      sessionId: string;
      candidate: {
          id: string;
          sessionId: string;
          state: string;
          protocol: string;
          host: string;
          port: number;
          path?: string;
          devServerType?: string;
          reportedAt: number;
      };
    }
  | {
      type: "preview-connection-updated";
      sessionId: string;
      connection: {
          tunnelId: string;
          candidateId: string;
          sessionId: string;
          publicUrl: string;
          status: string;
          createdAt: number;
          leaseExpiresAt: number;
          idleTimeoutMs: number;
          lastActiveAt: number;
      } | null;
    }
  // ADR-0022 Phase 3b — generic AgentLoop runtime events. trigger routes
  // machine-scoped (server → daemon), status/brief route user-scoped
  // (daemon/server → App).
  | {
      type: "agent-loop-trigger";
      loopId: string;
      projectId: string;
      machineId: string;
      iteration: number;
      prompt: string;
      directory: string;
      agent: string;
      continuityKey?: string;
      profileId?: string | null;
      runtimeProfile?: ResolvedRuntimeProfile;
      genericConfig?: Record<string, unknown>;
      callbackToken: string;
      maxDurationMinutes?: number;
    }
  | {
      type: "agent-loop-status";
      loopId: string;
      projectId: string;
      status: string;
      iteration?: number;
      nextRunAt?: number | null;
      activeSessionId?: string | null;
      lastError?: string | null;
      lastBriefSummary?: string | null;
      updatedAt: number;
    }
  | {
      type: "agent-loop-brief";
      loopId: string;
      projectId: string;
      iteration: number;
      sessionId?: string | null;
      headline: string;
      iterationStatus: string;
      generatedAt: number;
    }
;

// === EVENT PAYLOAD TYPES ===

export interface UpdatePayload {
  id: string;
  seq: number;
  body: {
    t: UpdateEvent["type"];
    [key: string]: any;
  };
  createdAt: number;
}

export interface EphemeralPayload {
  type: EphemeralEvent["type"];
  [key: string]: any;
}

// === EVENT ROUTER CLASS ===

class EventRouter {
  private userConnections = new Map<string, Set<ClientConnection>>();

  // === CONNECTION MANAGEMENT ===

  addConnection(userId: string, connection: ClientConnection): void {
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(connection);
  }

  removeConnection(userId: string, connection: ClientConnection): void {
    const connections = this.userConnections.get(userId);
    if (connections) {
      connections.delete(connection);
      if (connections.size === 0) {
        this.userConnections.delete(userId);
      }
    }
  }

  getConnections(userId: string): Set<ClientConnection> | undefined {
    return this.userConnections.get(userId);
  }

  /**
   * Returns true if the user has at least one active *non-machine* socket
   * connection — i.e. a session-scoped or user-scoped connection from a real
   * client (mobile/web/desktop), not a CLI daemon.
   *
   * Used by push-dispatch suppression: if the user is already looking at the
   * App, we skip the Expo push because in-app realtime updates over socket
   * are sufficient. CLI/daemon machine sockets do not count — they receive
   * machine updates but cannot display chat notifications to a human.
   *
   * Note: this is a best-effort check based on connected sockets only. We
   * don't track foreground/background app-state yet — any non-machine socket
   * being connected is treated as "user is reachable in-app".
   */
  hasActiveNonMachineSocket(userId: string): boolean {
    const connections = this.userConnections.get(userId);
    if (!connections || connections.size === 0) return false;
    for (const c of connections) {
      if (c.connectionType !== "machine-scoped") return true;
    }
    return false;
  }

  /**
   * Find a machine-scoped socket connection by machineId across all users.
   * Used for routing proxy requests from the preview gateway to the correct CLI daemon.
   */
  findMachineSocket(machineId: string): Socket | null {
    for (const connections of this.userConnections.values()) {
      for (const connection of connections) {
        if (connection.connectionType === "machine-scoped" && connection.machineId === machineId) {
          return connection.socket;
        }
      }
    }
    return null;
  }

  // === EVENT EMISSION METHODS ===

  /**
   * @internal Transport-level SyncUpdate multicast sink. Do NOT call this
   * directly from action / route / handler code — call `emitSyncUpdate`
   * from `@/app/events/syncUpdate` instead, which owns the SyncUpdate
   * lifecycle (seq + id + recipient set + afterTx coordination) per
   * ADR-0023. The underscore + `Internal` suffix marks this method as
   * private to the seam; the only legitimate caller is `syncUpdate.ts`.
   *
   * Spec files may continue to stub this method via `vi.mock` to capture
   * emissions for assertions — those tests observe what reaches the
   * transport, which is exactly what this method represents.
   */
  _emitUpdateInternal(params: {
    userId: string;
    payload: UpdatePayload;
    recipientFilter?: RecipientFilter;
    skipSenderConnection?: ClientConnection;
  }): void {
    this.emit({
      userId: params.userId,
      eventName: "update",
      payload: params.payload,
      recipientFilter: params.recipientFilter || {
        type: "all-user-authenticated-connections",
      },
      skipSenderConnection: params.skipSenderConnection,
    });
  }

  /**
   * @internal Transport-level SyncEphemeral multicast sink. Do NOT call this
   * directly from action / route / handler code — call `emitSyncEphemeral`
   * from `@/app/events/syncEphemeral` instead, which owns the SyncEphemeral
   * lifecycle (recipient set + wire payload assembly) per ADR-0024. The
   * underscore + `Internal` suffix marks this method as private to the seam;
   * the only legitimate caller is `syncEphemeral.ts`.
   *
   * Spec files may continue to stub this method via `vi.mock` to capture
   * emissions for assertions — those tests observe what reaches the
   * transport, which is exactly what this method represents.
   */
  _emitEphemeralInternal(params: {
    userId: string;
    payload: EphemeralPayload;
    recipientFilter?: RecipientFilter;
    skipSenderConnection?: ClientConnection;
  }): void {
    this.emit({
      userId: params.userId,
      eventName: "ephemeral",
      payload: params.payload,
      recipientFilter: params.recipientFilter || {
        type: "all-user-authenticated-connections",
      },
      skipSenderConnection: params.skipSenderConnection,
    });
  }

  // === PRIVATE ROUTING LOGIC ===

  private shouldSendToConnection(
    connection: ClientConnection,
    filter: RecipientFilter,
  ): boolean {
    return recipientMatches(connection, filter);
  }

  private emit(params: {
    userId: string;
    eventName: "update" | "ephemeral";
    payload: any;
    recipientFilter: RecipientFilter;
    skipSenderConnection?: ClientConnection;
  }): void {
    const connections = this.userConnections.get(params.userId);
    if (!connections) {
      log(
        { module: "websocket", level: "warn" },
        `No connections found for user ${params.userId}`,
      );
      return;
    }

    for (const connection of connections) {
      // Skip message echo
      if (
        params.skipSenderConnection &&
        connection === params.skipSenderConnection
      ) {
        continue;
      }

      // Apply recipient filter
      if (!this.shouldSendToConnection(connection, params.recipientFilter)) {
        continue;
      }

      connection.socket.emit(params.eventName, params.payload);
    }
  }
}

export const eventRouter = new EventRouter();

// No payload constructors live here anymore. They moved into syncUpdate.ts
// (PR 1.f) and syncEphemeral.ts (PR 1.5.f). The wire type
// `relationship-updated` survives in UpdateEvent above for backward
// compatibility with any client that still listens for it, but no server-side
// code emits it; the orphan builder was deleted in PR 1.5.g cleanup.

/**
 * Ephemeral payload emitted when a SupervisorLoop completes (per ADR-0022).
 * The App's loop detail screen consumes this to render the "Latest Brief"
 * card without an extra HTTP round-trip; future push notifications will
 * read `summary` as the body. Distinct from `supervisor-loop-status` so
 * subscribers can opt into completion notifications without firehose
 * filtering on every iteration.
 */
/**
 * Ephemeral emitted when D-1 (autonomous loop discovery, per ADR-0022) fires
 * — i.e. a standalone SupervisorRun completion crossed the project's
 * configured threshold and we just started a supervisor-role AgentLoop on
 * the user's behalf. Lets the App surface a real-time toast so the user
 * knows the system acted, instead of having to discover the new loop on
 * their next visit. Separate from `supervisor-loop-brief` because that fires
 * at completion (the other end of the lifecycle).
 */



