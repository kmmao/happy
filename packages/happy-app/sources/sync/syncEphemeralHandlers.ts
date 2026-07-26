/**
 * Ephemeral WebSocket update handlers, extracted from sync.ts.
 * Handles real-time ephemeral events: activity, machine-activity, rpc-ready,
 * usage, supervisor-status, task-log, inbox, session-events, and more.
 */

import { ApiEphemeralUpdateSchema, type ApiEphemeralActivityUpdate } from "./apiTypes";
import { ActivityUpdateAccumulator } from "./reducer/activityUpdateAccumulator";
import { resolveActivityThinking } from "./reducer/resolveActivityThinking";
import { ingestStorage, storage } from "./storage";
import { log } from "@/log";
import { Session, Machine } from "./storageTypes";
import type { ResearchConfigChange } from "./ingest/types";
import {
  handleWebhookIssueLinked as issueHandleWebhookIssueLinked,
  handleWebhookPRMerged as issueHandleWebhookPRMerged,
} from "./syncIssueHandlers";

// ---------------------------------------------------------------------------
// Listener callback types (mirror private field types in Sync class)
// ---------------------------------------------------------------------------

type SupervisorStatusListener = (event: {
  projectId: string;
  status: string;
  runId: string;
  currentDimension?: string;
  dimensionIndex?: number;
  totalDimensions?: number;
}) => void;

type TaskLogListener = (sessionId: string, taskId: string, chunk: string) => void;

type TaskStatusListener = (event: {
  taskId: string;
  machineId?: string;
  status: string;
  sessionId?: string;
  errorMessage?: string;
  completedAt?: number;
  triggerType?: string;
}) => void;

type SupervisorLoopStatusListener = (event: {
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
}) => void;

type SupervisorLoopBriefListener = (event: {
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
}) => void;

type AutoLoopFiredListener = (event: {
  projectId: string;
  loopId: string;
  healthScore: number;
  threshold: number;
  firedAt: number;
}) => void;

type InboxNewItemListener = (item: {
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
}) => void;

type SessionEventCreatedListener = (event: {
  id: string;
  sessionId: string;
  eventType: string;
  summary: string;
  detail?: Record<string, unknown>;
  createdAt: number;
}) => void;

type InterAgentMessageListener = (event: {
  fromSessionId: string;
  toSessionId: string;
  message: string;
  sentAt: number;
}) => void;

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

export type EphemeralHandlerContext = {
  activityAccumulator: ActivityUpdateAccumulator;
  applySessions: (
    sessions: Array<Omit<Session, "presence"> & { presence?: "online" | number }>,
  ) => void;
  supervisorStatusListeners: Set<SupervisorStatusListener>;
  researchConfigListeners: Set<(event: ResearchConfigChange) => void>;
  taskLogListeners: Set<TaskLogListener>;
  taskStatusListeners: Set<TaskStatusListener>;
  supervisorLoopStatusListeners: Set<SupervisorLoopStatusListener>;
  supervisorLoopBriefListeners: Set<SupervisorLoopBriefListener>;
  autoLoopFiredListeners: Set<AutoLoopFiredListener>;
  inboxNewItemListeners: Set<InboxNewItemListener>;
  inboxUnreadCountListeners: Set<(count: number) => void>;
  sessionEventCreatedListeners: Set<SessionEventCreatedListener>;
  interAgentMessageListeners: Set<InterAgentMessageListener>;
};

// ---------------------------------------------------------------------------
// Exported action functions
// ---------------------------------------------------------------------------

/**
 * Flush accumulated activity updates into storage sessions.
 * Called by ActivityUpdateAccumulator when the debounce fires.
 */
export function flushActivityUpdatesAction(
  applySessions: EphemeralHandlerContext["applySessions"],
  updates: Map<string, ApiEphemeralActivityUpdate>,
): void {
  const sessions: Session[] = [];

  for (const [sessionId, update] of updates) {
    const session = storage.getState().sessions[sessionId];
    if (session) {
      const resolved = resolveActivityThinking(
        { thinking: session.thinking, thinkingAt: session.thinkingAt },
        { active: update.active, activeAt: update.activeAt, thinking: update.thinking },
      );
      sessions.push({
        ...session,
        active: update.active,
        activeAt: update.activeAt,
        thinking: resolved.thinking,
        thinkingAt: resolved.thinkingAt,
        apiRetry: update.apiRetry
          ? {
              attempt: update.apiRetry.attempt,
              maxRetries: update.apiRetry.maxRetries,
              retryDelayMs: update.apiRetry.retryDelayMs,
              errorStatus: update.apiRetry.errorStatus,
              timestamp: Date.now(),
            }
          : null,
      });
    }
  }

  if (sessions.length > 0) {
    applySessions(sessions);
  }
}

/**
 * Handle an ephemeral WebSocket update event.
 * Dispatches to the appropriate listener sets or storage updates.
 */
export function handleEphemeralUpdateAction(
  ctx: EphemeralHandlerContext,
  update: unknown,
): void {
  const validatedUpdate = ApiEphemeralUpdateSchema.safeParse(update);
  if (!validatedUpdate.success) {
    log.log(`Invalid ephemeral update received: ${validatedUpdate.error}`);
    return;
  }
  const updateData = validatedUpdate.data;

  // Process activity updates through smart debounce accumulator
  if (updateData.type === "activity") {
    ctx.activityAccumulator.addUpdate(updateData);
  }

  // Handle machine activity updates
  if (updateData.type === "machine-activity") {
    const machine = storage.getState().machines[updateData.id];
    if (machine) {
      const updatedMachine: Machine = {
        ...machine,
        active: updateData.active,
        activeAt: updateData.activeAt,
      };
      ingestStorage.getState().applyMachines([updatedMachine]);
    }
  }

  // Handle RPC ready status updates
  if (updateData.type === "rpc-ready") {
    if (updateData.scope === "machine") {
      const machine = storage.getState().machines[updateData.id];
      if (machine) {
        ingestStorage.getState().applyMachines([{
          ...machine,
          rpcReady: updateData.ready,
        }]);
      }
    } else if (updateData.scope === "session") {
      const session = storage.getState().sessions[updateData.id];
      if (session) {
        ctx.applySessions([{
          ...session,
          rpcReady: updateData.ready,
        }]);
      }
    }
  }

  // Handle usage updates
  if (updateData.type === "usage") {
    const session = storage.getState().sessions[updateData.id];
    if (session) {
      const prevUsage = session.latestUsage;
      const updatedSession: Session = {
        ...session,
        latestUsage: {
          inputTokens: updateData.tokens.input,
          outputTokens: updateData.tokens.output,
          cacheCreation: updateData.tokens.cache_creation,
          cacheRead: updateData.tokens.cache_read,
          contextSize:
            updateData.tokens.input +
            updateData.tokens.cache_creation +
            updateData.tokens.cache_read,
          totalInputTokens:
            (prevUsage?.totalInputTokens ?? 0) +
            updateData.tokens.input +
            updateData.tokens.cache_creation +
            updateData.tokens.cache_read,
          totalOutputTokens:
            (prevUsage?.totalOutputTokens ?? 0) + updateData.tokens.output,
          timestamp: updateData.timestamp,
        },
      };
      ctx.applySessions([updatedSession]);
    }
  }

  // Handle webhook-issue-linked
  if (updateData.type === "webhook-issue-linked") {
    void issueHandleWebhookIssueLinked(updateData);
  }

  // Handle webhook-pr-merged
  if (updateData.type === "webhook-pr-merged") {
    void issueHandleWebhookPRMerged(updateData);
  }

  // Handle supervisor-status
  if (updateData.type === "supervisor-status") {
    const event = {
      projectId: updateData.projectId,
      status: updateData.status,
      runId: updateData.runId,
      currentDimension: updateData.currentDimension,
      dimensionIndex: updateData.dimensionIndex,
      totalDimensions: updateData.totalDimensions,
    };
    for (const listener of ctx.supervisorStatusListeners) {
      listener(event);
    }
  }

  // Handle task-log
  if (updateData.type === "task-log") {
    for (const listener of ctx.taskLogListeners) {
      listener(updateData.sessionId, updateData.taskId, updateData.chunk);
    }
  }

  // Handle task-status-changed
  if (updateData.type === "task-status-changed") {
    for (const listener of ctx.taskStatusListeners) {
      listener({
        taskId: updateData.taskId,
        machineId: updateData.machineId,
        status: updateData.status,
        sessionId: updateData.sessionId,
        errorMessage: updateData.errorMessage,
        completedAt: updateData.completedAt,
        triggerType: updateData.triggerType,
      });
    }
  }

  // Handle inbox-new-item
  if (updateData.type === "inbox-new-item" && updateData.item) {
    for (const listener of ctx.inboxNewItemListeners) {
      listener(updateData.item);
    }
  }

  // Handle inbox-unread-count
  if (
    updateData.type === "inbox-unread-count" &&
    typeof updateData.count === "number"
  ) {
    for (const listener of ctx.inboxUnreadCountListeners) {
      listener(updateData.count);
    }
  }

  // Handle session-event-created
  if (updateData.type === "session-event-created" && updateData.event) {
    for (const listener of ctx.sessionEventCreatedListeners) {
      listener(updateData.event);
    }
  }

  // Handle inter-agent-message
  if (updateData.type === "inter-agent-message") {
    const msg = {
      fromSessionId: updateData.fromSessionId,
      toSessionId: updateData.toSessionId,
      message: updateData.message,
      sentAt: updateData.sentAt,
    };
    for (const listener of ctx.interAgentMessageListeners) {
      listener(msg);
    }
  }

  // Handle supervisor-loop-status
  if (updateData.type === "supervisor-loop-status") {
    const loopEvent = {
      loopId: updateData.loopId,
      projectId: updateData.projectId,
      status: updateData.status,
      currentIteration: updateData.currentIteration,
      maxIterations: updateData.maxIterations,
      currentPhase: updateData.currentPhase,
      totalCostUsd: updateData.totalCostUsd,
      totalActionsFound: updateData.totalActionsFound,
      totalActionsFixed: updateData.totalActionsFixed,
      currentHealthScore: updateData.currentHealthScore,
      initialHealthScore: updateData.initialHealthScore,
      exitReason: updateData.exitReason,
      consecutiveFailures: updateData.consecutiveFailures,
    };
    for (const listener of ctx.supervisorLoopStatusListeners) {
      listener(loopEvent);
    }
  }

  // Handle auto-loop-fired (ADR-0022 D-1 — system auto-started a loop)
  if (updateData.type === "auto-loop-fired") {
    const event = {
      projectId: updateData.projectId,
      loopId: updateData.loopId,
      healthScore: updateData.healthScore,
      threshold: updateData.threshold,
      firedAt: updateData.firedAt,
    };
    for (const listener of ctx.autoLoopFiredListeners) {
      listener(event);
    }
  }

  // Handle supervisor-loop-brief (ADR-0022 cherry-pick — fires once on loop completion)
  if (updateData.type === "supervisor-loop-brief") {
    const briefEvent = {
      loopId: updateData.loopId,
      projectId: updateData.projectId,
      status: updateData.status,
      exitReason: updateData.exitReason,
      generatedAt: updateData.generatedAt,
      currentIteration: updateData.currentIteration,
      maxIterations: updateData.maxIterations,
      initialHealthScore: updateData.initialHealthScore,
      currentHealthScore: updateData.currentHealthScore,
      healthDelta: updateData.healthDelta,
      totalActionsFound: updateData.totalActionsFound,
      totalActionsFixed: updateData.totalActionsFixed,
      consecutiveFailures: updateData.consecutiveFailures,
      totalCostUsd: updateData.totalCostUsd,
      costCapUsd: updateData.costCapUsd,
      summary: updateData.summary,
    };
    for (const listener of ctx.supervisorLoopBriefListeners) {
      listener(briefEvent);
    }
  }
}
