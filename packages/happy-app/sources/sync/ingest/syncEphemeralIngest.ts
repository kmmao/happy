/**
 * SyncEphemeralIngest: the App-side seam that consumes one SyncEphemeral
 * (CONTEXT.md) and produces the typed {@link IngestEvent}s subscribers
 * react to. Parallel to {@link ingestSyncUpdate} and symmetric to the
 * server's `emitSyncEphemeral` (ADR-0024).
 *
 * No storage mutations are required for the broadcast contract (ephemerals
 * do not reconcile), but **the seam still mutates storage for the variants
 * that today land directly there** — `machine-activity`, `rpc-ready`,
 * `usage`. These mutations
 * are not deferable into subscribers without losing the per-event delta
 * (same reasoning as ADR-0026 Decision A's "Hybrid"). The output is the
 * event stream subscribers consume; the side-effect cleanup happens
 * inline.
 *
 * Variants and their behaviour:
 *
 *   STORAGE-MUTATION-ONLY (no event emitted):
 *     - `activity`            → ctx.addActivityUpdate (debounced)
 *     - `machine-activity`    → storage.applyMachines
 *     - `rpc-ready` (machine) → storage.applyMachines
 *     - `rpc-ready` (session) → ctx.applySessions
 *     - `usage`               → ctx.applySessions
 *     - `webhook-issue-linked` / `webhook-pr-merged` → fire-and-forget
 *       module call (issueHandleWebhookXxx). No event.
 *
 *   LISTENER-FAN-OUT (emit a typed event; subscribers iterate the listener
 *   Set living on Sync):
 *     - `supervisor-status`         → 'supervisor-status-update'
 *     - `task-log`                  → 'task-log-chunk'
 *     - `task-status-changed`       → 'task-status-changed'
 *     - `inbox-new-item`            → 'inbox-new-item'
 *     - `inbox-unread-count`        → 'inbox-unread-count'
 *     - `session-event-created`     → 'session-event-created'
 *     - `inter-agent-message`       → 'inter-agent-message-received'
 *     - `supervisor-loop-status`    → 'supervisor-loop-status'
 *     - `auto-loop-fired`           → 'auto-loop-fired'
 *     - `supervisor-loop-brief`     → 'supervisor-loop-brief'
 *
 * Unknown variants are NOT a hard error (ephemerals are fire-and-forget per
 * ADR-0013 — the client may legitimately receive a type a newer server
 * introduced before the App ships the matching subscriber). The seam logs
 * and returns `[]`.
 */

import { log } from "@/log";
import { ingestStorage, storage } from "../storage";
import {
    handleWebhookIssueLinked as issueHandleWebhookIssueLinked,
    handleWebhookPRMerged as issueHandleWebhookPRMerged,
} from "../syncIssueHandlers";
import type { ApiEphemeralUpdate } from "../apiTypes";
import type { Machine, Session } from "../storageTypes";
import type { IngestContext } from "./ingestContext";
import type { IngestEvent } from "./types";

export function ingestSyncEphemeral(
    update: ApiEphemeralUpdate,
    ctx: IngestContext,
): IngestEvent[] {
    const events: IngestEvent[] = [];

    switch (update.type) {
        // ---- storage-only ---------------------------------------------------
        case "activity":
            ctx.addActivityUpdate(update);
            return events;

        case "machine-activity": {
            const machine = storage.getState().machines[update.id];
            if (machine) {
                const updatedMachine: Machine = {
                    ...machine,
                    active: update.active,
                    activeAt: update.activeAt,
                };
                ingestStorage.getState().applyMachines([updatedMachine]);
            }
            return events;
        }

        case "rpc-ready": {
            if (update.scope === "machine") {
                const machine = storage.getState().machines[update.id];
                if (machine) {
                    ingestStorage.getState().applyMachines([{
                        ...machine,
                        rpcReady: update.ready,
                    }]);
                }
            } else if (update.scope === "session") {
                const session = storage.getState().sessions[update.id];
                if (session) {
                    ctx.applySessions([{ ...session, rpcReady: update.ready }]);
                }
            }
            return events;
        }

        case "usage": {
            const session = storage.getState().sessions[update.id];
            if (session) {
                const prevUsage = session.latestUsage;
                const updatedSession: Session = {
                    ...session,
                    latestUsage: {
                        inputTokens: update.tokens.input,
                        outputTokens: update.tokens.output,
                        cacheCreation: update.tokens.cache_creation,
                        cacheRead: update.tokens.cache_read,
                        contextSize:
                            update.tokens.input +
                            update.tokens.cache_creation +
                            update.tokens.cache_read,
                        totalInputTokens:
                            (prevUsage?.totalInputTokens ?? 0) +
                            update.tokens.input +
                            update.tokens.cache_creation +
                            update.tokens.cache_read,
                        totalOutputTokens:
                            (prevUsage?.totalOutputTokens ?? 0) +
                            update.tokens.output,
                        timestamp: update.timestamp,
                    },
                };
                ctx.applySessions([updatedSession]);
            }
            return events;
        }

        case "webhook-issue-linked":
            void issueHandleWebhookIssueLinked(update);
            return events;

        case "webhook-pr-merged":
            void issueHandleWebhookPRMerged(update);
            return events;

        // ---- listener-fan-out (emit typed events) --------------------------
        case "supervisor-status":
            events.push({
                kind: "supervisor-status-update",
                event: {
                    projectId: update.projectId,
                    status: update.status,
                    runId: update.runId,
                    currentDimension: update.currentDimension,
                    dimensionIndex: update.dimensionIndex,
                    totalDimensions: update.totalDimensions,
                },
            });
            return events;

        case "task-log":
            events.push({
                kind: "task-log-chunk",
                sessionId: update.sessionId,
                taskId: update.taskId,
                chunk: update.chunk,
            });
            return events;

        case "task-status-changed":
            events.push({
                kind: "task-status-changed",
                event: {
                    taskId: update.taskId,
                    machineId: update.machineId,
                    status: update.status,
                    sessionId: update.sessionId,
                    errorMessage: update.errorMessage,
                    completedAt: update.completedAt,
                    triggerType: update.triggerType,
                },
            });
            return events;

        case "inbox-new-item":
            if (update.item) {
                events.push({ kind: "inbox-new-item", item: update.item });
            }
            return events;

        case "inbox-unread-count":
            if (typeof update.count === "number") {
                events.push({ kind: "inbox-unread-count", count: update.count });
            }
            return events;

        case "session-event-created":
            if (update.event) {
                events.push({ kind: "session-event-created", event: update.event });
            }
            return events;

        case "inter-agent-message":
            events.push({
                kind: "inter-agent-message-received",
                message: {
                    fromSessionId: update.fromSessionId,
                    toSessionId: update.toSessionId,
                    message: update.message,
                    sentAt: update.sentAt,
                },
            });
            return events;

        case "supervisor-loop-status":
            events.push({
                kind: "supervisor-loop-status",
                event: {
                    loopId: update.loopId,
                    projectId: update.projectId,
                    status: update.status,
                    currentIteration: update.currentIteration,
                    maxIterations: update.maxIterations,
                    currentPhase: update.currentPhase,
                    totalCostUsd: update.totalCostUsd,
                    totalActionsFound: update.totalActionsFound,
                    totalActionsFixed: update.totalActionsFixed,
                    currentHealthScore: update.currentHealthScore,
                    initialHealthScore: update.initialHealthScore,
                    exitReason: update.exitReason,
                    consecutiveFailures: update.consecutiveFailures,
                },
            });
            return events;

        case "auto-loop-fired":
            events.push({
                kind: "auto-loop-fired",
                event: {
                    projectId: update.projectId,
                    loopId: update.loopId,
                    healthScore: update.healthScore,
                    threshold: update.threshold,
                    firedAt: update.firedAt,
                },
            });
            return events;

        case "supervisor-loop-brief":
            events.push({
                kind: "supervisor-loop-brief",
                event: {
                    loopId: update.loopId,
                    projectId: update.projectId,
                    status: update.status,
                    exitReason: update.exitReason,
                    generatedAt: update.generatedAt,
                    currentIteration: update.currentIteration,
                    maxIterations: update.maxIterations,
                    initialHealthScore: update.initialHealthScore,
                    currentHealthScore: update.currentHealthScore,
                    healthDelta: update.healthDelta,
                    totalActionsFound: update.totalActionsFound,
                    totalActionsFixed: update.totalActionsFixed,
                    consecutiveFailures: update.consecutiveFailures,
                    totalCostUsd: update.totalCostUsd,
                    costCapUsd: update.costCapUsd,
                    summary: update.summary,
                },
            });
            return events;

        default:
            // Unknown ephemeral type — log and continue (ADR-0013 ephemerals
            // are not contract-required to be exhaustively handled).
            log.log(
                `[ingestSyncEphemeral] unknown type '${(update as { type?: string }).type}' — ignored`,
            );
            return events;
    }
}
