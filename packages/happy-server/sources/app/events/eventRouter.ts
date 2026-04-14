import { Socket } from "socket.io";
import { log } from "@/utils/log";
import { GitHubProfile } from "@/app/api/types";
import { AccountProfile } from "@/types";
import { getPublicUrl } from "@/storage/files";
import type { SessionMessageContent, WorldSuggestionUpdated } from "@kmmao/happy-wire";

import * as privacyKit from "privacy-kit";

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
      type: "knowledge-count";
      id: string;
      count: number;
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
      type: "goal-created";
      goalId: string;
      projectId: string;
      title: string;
    }
  | {
      type: "goal-progress";
      goalId: string;
      projectId: string;
      status: string;
      progress: number;
    }
  | {
      type: "agent-message";
      messageId: string;
      projectId: string;
      fromRole: string;
      toRole: string | null;
      msgType: string;
    }
  | {
      type: "world-suggestion-updated";
      projectId: string;
      suggestionId: string;
      status: string;
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

  // === EVENT EMISSION METHODS ===

  emitUpdate(params: {
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

  emitEphemeral(params: {
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
    switch (filter.type) {
      case "all-interested-in-session":
        // Send to session-scoped with matching session + all user-scoped
        if (connection.connectionType === "session-scoped") {
          if (connection.sessionId !== filter.sessionId) {
            return false; // Wrong session
          }
        } else if (connection.connectionType === "machine-scoped") {
          return false; // Machines don't need session updates
        }
        // user-scoped always gets it
        return true;

      case "user-scoped-only":
        return connection.connectionType === "user-scoped";

      case "machine-scoped-only":
        // Send to user-scoped (mobile/web needs all machine updates) + only the specific machine
        if (connection.connectionType === "user-scoped") {
          return true;
        }
        if (connection.connectionType === "machine-scoped") {
          return connection.machineId === filter.machineId;
        }
        return false; // session-scoped doesn't need machine updates

      case "all-user-authenticated-connections":
        // Send to all connection types (default behavior)
        return true;

      default:
        return false;
    }
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

// === EVENT BUILDER FUNCTIONS ===

export function buildNewSessionUpdate(
  session: {
    id: string;
    seq: number;
    metadata: string;
    metadataVersion: number;
    agentState: string | null;
    agentStateVersion: number;
    dataEncryptionKey: Uint8Array | null;
    active: boolean;
    lastActiveAt: Date;
    createdAt: Date;
    updatedAt: Date;
    forkedFromSessionId?: string | null;
  },
  updateSeq: number,
  updateId: string,
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "new-session",
      id: session.id,
      seq: session.seq,
      metadata: session.metadata,
      metadataVersion: session.metadataVersion,
      agentState: session.agentState,
      agentStateVersion: session.agentStateVersion,
      dataEncryptionKey: session.dataEncryptionKey
        ? privacyKit.encodeBase64(new Uint8Array(session.dataEncryptionKey))
        : null,
      active: session.active,
      activeAt: session.lastActiveAt.getTime(),
      createdAt: session.createdAt.getTime(),
      updatedAt: session.updatedAt.getTime(),
      forkedFromSessionId: session.forkedFromSessionId ?? null,
    },
    createdAt: Date.now(),
  };
}

export function buildNewMessageUpdate(
  message: {
    id: string;
    seq: number;
    content: SessionMessageContent;
    localId: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  sessionId: string,
  updateSeq: number,
  updateId: string,
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "new-message",
      sid: sessionId,
      message: {
        id: message.id,
        seq: message.seq,
        content: message.content,
        localId: message.localId,
        createdAt: message.createdAt.getTime(),
        updatedAt: message.updatedAt.getTime(),
      },
    },
    createdAt: Date.now(),
  };
}

export function buildUpdateSessionUpdate(
  sessionId: string,
  updateSeq: number,
  updateId: string,
  metadata?: { value: string; version: number },
  agentState?: { value: string; version: number },
  preferences?: { value: string; version: number },
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "update-session",
      id: sessionId,
      metadata,
      agentState,
      preferences,
    },
    createdAt: Date.now(),
  };
}

export function buildDeleteSessionUpdate(
  sessionId: string,
  updateSeq: number,
  updateId: string,
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "delete-session",
      sid: sessionId,
    },
    createdAt: Date.now(),
  };
}

export function buildUpdateAccountUpdate(
  userId: string,
  profile: Partial<AccountProfile>,
  updateSeq: number,
  updateId: string,
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "update-account",
      id: userId,
      ...profile,
      avatar: profile.avatar
        ? { ...profile.avatar, url: getPublicUrl(profile.avatar.path) }
        : undefined,
    },
    createdAt: Date.now(),
  };
}

export function buildNewMachineUpdate(
  machine: {
    id: string;
    seq: number;
    metadata: string;
    metadataVersion: number;
    daemonState: string | null;
    daemonStateVersion: number;
    dataEncryptionKey: Uint8Array | null;
    active: boolean;
    lastActiveAt: Date;
    createdAt: Date;
    updatedAt: Date;
  },
  updateSeq: number,
  updateId: string,
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "new-machine",
      machineId: machine.id,
      seq: machine.seq,
      metadata: machine.metadata,
      metadataVersion: machine.metadataVersion,
      daemonState: machine.daemonState,
      daemonStateVersion: machine.daemonStateVersion,
      dataEncryptionKey: machine.dataEncryptionKey
        ? privacyKit.encodeBase64(new Uint8Array(machine.dataEncryptionKey))
        : null,
      active: machine.active,
      activeAt: machine.lastActiveAt.getTime(),
      createdAt: machine.createdAt.getTime(),
      updatedAt: machine.updatedAt.getTime(),
    },
    createdAt: Date.now(),
  };
}

export function buildUpdateMachineUpdate(
  machineId: string,
  updateSeq: number,
  updateId: string,
  metadata?: { value: string; version: number },
  daemonState?: { value: string; version: number },
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "update-machine",
      machineId,
      metadata,
      daemonState,
    },
    createdAt: Date.now(),
  };
}

export function buildSessionActivityEphemeral(
  sessionId: string,
  active: boolean,
  activeAt: number,
  thinking?: boolean,
  apiRetry?: {
    attempt: number;
    maxRetries: number;
    retryDelayMs: number;
    errorStatus: number | null;
  },
): EphemeralPayload {
  return {
    type: "activity",
    id: sessionId,
    active,
    activeAt,
    thinking: thinking || false,
    ...(apiRetry ? { apiRetry } : {}),
  };
}

export function buildMachineActivityEphemeral(
  machineId: string,
  active: boolean,
  activeAt: number,
): EphemeralPayload {
  return {
    type: "machine-activity",
    id: machineId,
    active,
    activeAt,
  };
}

export function buildRpcReadyEphemeral(
  scope: "machine" | "session",
  id: string,
  ready: boolean,
): EphemeralPayload {
  return {
    type: "rpc-ready",
    scope,
    id,
    ready,
  };
}

export function buildUsageEphemeral(
  sessionId: string,
  key: string,
  tokens: Record<string, number>,
  cost: Record<string, number>,
): EphemeralPayload {
  return {
    type: "usage",
    id: sessionId,
    key,
    tokens,
    cost,
    timestamp: Date.now(),
  };
}

export function buildMachineStatusEphemeral(
  machineId: string,
  online: boolean,
): EphemeralPayload {
  return {
    type: "machine-status",
    machineId,
    online,
    timestamp: Date.now(),
  };
}

export function buildNewArtifactUpdate(
  artifact: {
    id: string;
    seq: number;
    header: Uint8Array;
    headerVersion: number;
    body: Uint8Array;
    bodyVersion: number;
    dataEncryptionKey: Uint8Array;
    createdAt: Date;
    updatedAt: Date;
  },
  updateSeq: number,
  updateId: string,
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "new-artifact",
      artifactId: artifact.id,
      seq: artifact.seq,
      header: privacyKit.encodeBase64(new Uint8Array(artifact.header)),
      headerVersion: artifact.headerVersion,
      body: privacyKit.encodeBase64(new Uint8Array(artifact.body)),
      bodyVersion: artifact.bodyVersion,
      dataEncryptionKey: privacyKit.encodeBase64(new Uint8Array(artifact.dataEncryptionKey)),
      createdAt: artifact.createdAt.getTime(),
      updatedAt: artifact.updatedAt.getTime(),
    },
    createdAt: Date.now(),
  };
}

export function buildUpdateArtifactUpdate(
  artifactId: string,
  updateSeq: number,
  updateId: string,
  header?: { value: string; version: number },
  body?: { value: string; version: number },
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "update-artifact",
      artifactId,
      header,
      body,
    },
    createdAt: Date.now(),
  };
}

export function buildDeleteArtifactUpdate(
  artifactId: string,
  updateSeq: number,
  updateId: string,
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "delete-artifact",
      artifactId,
    },
    createdAt: Date.now(),
  };
}

export function buildRelationshipUpdatedEvent(
  data: {
    uid: string;
    status: "none" | "requested" | "pending" | "friend" | "rejected";
    timestamp: number;
  },
  updateSeq: number,
  updateId: string,
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "relationship-updated",
      ...data,
    },
    createdAt: Date.now(),
  };
}

export function buildNewFeedPostUpdate(
  feedItem: {
    id: string;
    body: any;
    cursor: string;
    createdAt: number;
  },
  updateSeq: number,
  updateId: string,
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "new-feed-post",
      id: feedItem.id,
      body: feedItem.body,
      cursor: feedItem.cursor,
      createdAt: feedItem.createdAt,
    },
    createdAt: Date.now(),
  };
}

export function buildKVBatchUpdateUpdate(
  changes: Array<{ key: string; value: string | null; version: number }>,
  updateSeq: number,
  updateId: string,
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "kv-batch-update",
      changes,
    },
    createdAt: Date.now(),
  };
}

export function buildNewProjectUpdate(
  project: {
    id: string;
    machineId: string;
    path: string;
    repoUrl: string | null;
    metadata: string | null;
    metadataVersion: number;
    archived: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  updateSeq: number,
  updateId: string,
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "new-project",
      projectId: project.id,
      machineId: project.machineId,
      path: project.path,
      repoUrl: project.repoUrl,
      metadata: project.metadata,
      metadataVersion: project.metadataVersion,
      archived: project.archived,
      createdAt: project.createdAt.getTime(),
      updatedAt: project.updatedAt.getTime(),
    },
    createdAt: Date.now(),
  };
}

export function buildUpdateProjectUpdate(
  projectId: string,
  updateSeq: number,
  updateId: string,
  metadata?: { value: string | null; version: number },
  archived?: boolean,
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "update-project",
      projectId,
      metadata,
      archived,
    },
    createdAt: Date.now(),
  };
}

export function buildDeleteProjectUpdate(
  projectId: string,
  updateSeq: number,
  updateId: string,
): UpdatePayload {
  return {
    id: updateId,
    seq: updateSeq,
    body: {
      t: "delete-project",
      projectId,
    },
    createdAt: Date.now(),
  };
}

export interface SupervisorTriggerOptions {
  projectId: string;
  runId: string;
  trigger: string;
  machineId: string;
  repoPath: string;
  mode?: string;
  dimensions?: string[];
  changedFiles?: string[];
  customRules?: string;
  fixAction?: { title: string; description: string; suggestedFix: string | null; category: string; severity: string; issueNumber?: number };
  researchParams?: string;
  fixStrategy?: string;
  fixMode?: string; // "fix" | "analyze-first"
  analyzeAutoFix?: boolean;
  existingActions?: readonly { category: string; title: string; severity: string; approval: string; fixStatus: string | null }[];
  maxConcurrentAnalysis?: number;
  maxConcurrentFix?: number;
  maxFindings?: number;
  narrative?: string;
  laws?: string;
}

export function buildSupervisorTriggerEphemeral(opts: SupervisorTriggerOptions): EphemeralPayload {
  return {
    type: "supervisor-trigger",
    ...opts,
  };
}

export function buildSupervisorStatusEphemeral(
  runId: string,
  projectId: string,
  status: string,
  artifactId?: string,
  errorMessage?: string,
  currentDimension?: string,
  dimensionIndex?: number,
  totalDimensions?: number,
): EphemeralPayload {
  return {
    type: "supervisor-status",
    runId,
    projectId,
    status,
    artifactId,
    errorMessage,
    currentDimension,
    dimensionIndex,
    totalDimensions,
  };
}

export interface SupervisorLoopStatusOptions {
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

export function buildSupervisorLoopStatusEphemeral(opts: SupervisorLoopStatusOptions): EphemeralPayload {
  return {
    type: "supervisor-loop-status",
    ...opts,
  };
}

export function buildKnowledgeCountEphemeral(
  sessionId: string,
  count: number,
): EphemeralPayload {
  return {
    type: "knowledge-count",
    id: sessionId,
    count,
  };
}

export function buildTaskTriggerEphemeral(opts: {
  taskId: string;
  prompt: string;
  directory: string;
  priority: string;
  projectId?: string;
  resultToken?: string;
  skillContents?: Array<{ name: string; content: string }>;
  agentType?: string | null;
  modelOverride?: string | null;
}): EphemeralPayload {
  return {
    type: "task-trigger",
    ...opts,
  };
}

export function buildTaskStatusChangedEphemeral(opts: {
  taskId: string;
  machineId: string;
  status: string;
  sessionId?: string;
  errorMessage?: string;
  completedAt?: number;
}): EphemeralPayload {
  return {
    type: "task-status-changed",
    ...opts,
  };
}

export function buildInboxNewItemEphemeral(item: {
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
}): EphemeralPayload {
  return {
    type: "inbox-new-item",
    item,
  };
}

export function buildInboxUnreadCountEphemeral(count: number): EphemeralPayload {
  return {
    type: "inbox-unread-count",
    count,
  };
}

export function buildSessionEventCreatedEphemeral(event: {
  id: string;
  sessionId: string;
  eventType: string;
  summary: string;
  detail?: Record<string, unknown>;
  createdAt: number;
}): EphemeralPayload {
  return {
    type: "session-event-created",
    event,
  };
}

export function buildGoalCreatedEphemeral(opts: {
  goalId: string;
  projectId: string;
  title: string;
}): EphemeralPayload {
  return {
    type: "goal-created",
    ...opts,
  };
}

export function buildGoalProgressEphemeral(opts: {
  goalId: string;
  projectId: string;
  status: string;
  progress: number;
}): EphemeralPayload {
  return {
    type: "goal-progress",
    ...opts,
  };
}

export function buildAgentMessageEphemeral(opts: {
  messageId: string;
  projectId: string;
  fromRole: string;
  toRole: string | null;
  msgType: string;
}): EphemeralPayload {
  return {
    type: "agent-message",
    ...opts,
  };
}

export function buildWorldSuggestionUpdatedEphemeral(opts: Omit<WorldSuggestionUpdated, "type">): WorldSuggestionUpdated {
  return {
    type: "world-suggestion-updated",
    ...opts,
  };
}

