/**
 * IngestEvent: the typed domain event union emitted by SyncUpdateIngest /
 * SyncEphemeralIngest after a server broadcast has been applied to storage.
 * Subscribers register on the {@link IngestEventDispatcher} by `kind` and
 * react in their own files (voice, notifications, sync invalidation, etc.).
 *
 * See ADR-0026 for the load-bearing rationale (Decisions A, D, F1):
 *
 *   - **Hybrid side effects**: the seam applies storage mutations directly
 *     and ALSO returns these events. The seam keeps the delta detection
 *     (it's free at mutation time); subscribers stay simple and feature-
 *     scoped. Subscribers never call back into the seam.
 *   - **Typed-domain events, not generic state-change events**: a variant
 *     here names a domain fact (`permission-requested`, `task-completed`)
 *     not a storage diff (`session-changed`). Detection lives in the seam,
 *     consumption lives in the subscriber.
 *
 * Adding a variant:
 *   1. Add the case to this union.
 *   2. Emit it from the appropriate `ingestSyncUpdate` / `ingestSyncEphemeral`
 *      case ONLY when at least one real subscriber consumes it — emitting
 *      dead events is waste and grows the union without leverage.
 *   3. Register the subscriber(s) with `ingestEvents.on(kind, ...)`.
 *
 * Variants for SyncEphemeral arrive in PR 6 of the ADR-0026 migration plan.
 * Today's union covers only the SyncUpdate-side events; the SyncEphemeral
 * mirror extends this union when PR 6 lands.
 */

import type { TerminalSignal } from "../typesRaw";
import type { ResearchConfigChange } from "../syncUpdateHandlers";

export type IngestEvent =
    // --- SyncUpdate-side: state-change / domain-fact events --------------
    /**
     * A NEW permission request appeared on a Session's agentState (i.e. an
     * incoming `update-session` carried agentState.requests with at least
     * one entry). Subscribers: voiceHooks, web notification.
     */
    | {
          kind: "permission-requested";
          sid: string;
          requestId: string;
          toolName: string | undefined;
          toolArguments: unknown;
      }
    /**
     * The previously-observed permission requests on this Session have been
     * resolved (agentState now reports no requests). Subscribers: web
     * notification cleanup.
     */
    | { kind: "permission-resolved"; sid: string; resolvedRequestIds: string[] }
    /**
     * Control of the Session has just transitioned from agent to the user
     * (agentState.controlledByUser went false → true). Subscribers re-fetch
     * messages so the user sees the latest state.
     */
    | { kind: "session-control-returned"; sid: string }
    /**
     * An `update-account` carried settings that were decrypted and applied.
     * Subscribers: re-apply pending local settings on top of server settings.
     */
    | { kind: "account-settings-applied" }
    /**
     * A Task within a Session reached a terminal status (task_complete /
     * turn_aborted / turn-end). Subscribers: web task-complete notification,
     * issue-session completion forwarding.
     */
    | { kind: "task-completed"; sid: string }
    /**
     * A terminal-signal envelope (OSC code) was decoded inside a live
     * message. Subscribers: the per-kind dispatch switch (window-title →
     * setTerminalTitle, notification → expo Notifications.scheduleAsync,
     * bell / other → log).
     */
    | { kind: "terminal-signal"; sid: string; signal: TerminalSignal }
    /**
     * A mutable-class tool call (file edit, bash, etc.) was observed in a
     * live tool-result message. Subscribers: invalidate git status for the
     * Session.
     */
    | { kind: "mutable-tool-observed"; sid: string }
    /**
     * A live `new-message` arrived with a seq that the per-session cursor
     * classified as `gap` (we missed at least one earlier message).
     * Subscribers: trigger a per-session messages refetch to fill the gap.
     */
    | { kind: "message-gap"; sid: string }
    /**
     * A Session was removed. Subscribers handle Sync-class internal cleanup
     * (messagesSync.stop, sendSync.stop, pendingOutbox, deleteLastSeq,
     * releaseMessageProcessing, deleted404Sessions). Storage write and
     * module-level cleanups (issueSessionStore, removeWorktree,
     * disposeSessionScopedState, deleteMessageCache, deleteHistoryComplete,
     * deleteBackfillBoundary, Encryption.removeSessionEncryption) are
     * performed inside the seam before the event is emitted.
     */
    | { kind: "session-deleted"; sid: string }
    // --- SyncUpdate-side: "stale" signals (replace today's *.invalidate calls) ---
    | { kind: "sessions-stale" }
    | { kind: "machines-stale" }
    | { kind: "artifacts-stale" }
    | { kind: "feed-stale" }
    | { kind: "friends-stale" }
    | { kind: "friend-requests-stale" }
    | { kind: "projects-stale" }
    /**
     * Phase-2 follow-up: server emits `agent-loop-updated` /
     * `agent-loop-deleted` SyncUpdates from agentLoopEngine on every
     * loop create/update/iteration/pause/resume/delete. Subscribers
     * (useWorkflows) react by re-fetching loops so the Workflow IA
     * reflects changes without a page reload.
     */
    | { kind: "agent-loops-stale" }
    /**
     * Workflow IA Phase C — Schedule + Webhook real-time updates emitted
     * by the server on every cron tick / webhook fire / CRUD. With these
     * signals the App no longer needs a 30 s wall-clock poll over
     * triggerSchedules / webhookTriggers — useWorkflows refetches on the
     * same throttled callback used for agent-loops-stale.
     */
    | { kind: "schedules-stale" }
    | { kind: "webhooks-stale" }
    // --- SyncUpdate-side: domain-specific batched changes ----------------
    /** A `kv-batch-update` produced ResearchConfig changes that other modules listen for. */
    | { kind: "research-config-changed"; changes: ResearchConfigChange[] }

    // --- SyncEphemeral-side: listener-set fan-outs (PR 6) ----------------
    // Storage-only ephemerals (activity, machine-activity, rpc-ready, usage,
    // knowledge-count, knowledge-access-update, webhook-issue-linked,
    // webhook-pr-merged) are applied inline in the seam and emit no events.
    // The variants below mirror the `Set<Listener>` callbacks in Sync today
    // — subscribers iterate the matching Set when an event fires.
    | {
          kind: "supervisor-status-update";
          event: {
              projectId: string;
              status: string;
              runId: string;
              currentDimension?: string;
              dimensionIndex?: number;
              totalDimensions?: number;
          };
      }
    | { kind: "task-log-chunk"; sessionId: string; taskId: string; chunk: string }
    | {
          kind: "task-status-changed";
          event: {
              taskId: string;
              machineId?: string;
              status: string;
              sessionId?: string;
              errorMessage?: string;
              completedAt?: number;
              triggerType?: string;
          };
      }
    | {
          kind: "inbox-new-item";
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
    | { kind: "inbox-unread-count"; count: number }
    | {
          kind: "session-event-created";
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
          kind: "inter-agent-message-received";
          message: {
              fromSessionId: string;
              toSessionId: string;
              message: string;
              sentAt: number;
          };
      }
    | {
          kind: "supervisor-loop-status";
          event: {
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
          };
      }
    | {
          kind: "auto-loop-fired";
          event: {
              projectId: string;
              loopId: string;
              healthScore: number;
              threshold: number;
              firedAt: number;
          };
      }
    | {
          kind: "supervisor-loop-brief";
          event: {
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
          };
      };

export type IngestEventKind = IngestEvent["kind"];
