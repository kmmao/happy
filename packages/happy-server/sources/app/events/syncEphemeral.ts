import type { ResolvedRuntimeProfile } from "@kmmao/happy-wire";
import {
    eventRouter,
    buildAutoLoopFiredEphemeral,
    buildInboxNewItemEphemeral,
    buildInboxUnreadCountEphemeral,
    buildInterAgentMessageEphemeral,
    buildKnowledgeAccessUpdateEphemeral,
    buildKnowledgeCountEphemeral,
    buildMachineActivityEphemeral,
    buildPreviewCandidateReportedEphemeral,
    buildPreviewConnectionUpdatedEphemeral,
    buildRpcReadyEphemeral,
    buildSessionActivityEphemeral,
    buildSessionEventCreatedEphemeral,
    buildSupervisorLoopBriefEphemeral,
    buildSupervisorLoopStatusEphemeral,
    buildSupervisorStatusEphemeral,
    buildSupervisorTriggerEphemeral,
    buildTaskCancelEphemeral,
    buildTaskStatusChangedEphemeral,
    buildTaskTriggerEphemeral,
    buildUsageEphemeral,
    buildWorldEventCreatedEphemeral,
    type ClientConnection,
    type EphemeralPayload,
    type RecipientFilter,
} from "@/app/events/eventRouter";

/**
 * Server-side SyncEphemeral emission seam (CONTEXT.md → SyncEphemeral).
 *
 * Parallel to syncUpdate.ts (ADR-0024). One entry point —
 * `emitSyncEphemeral(accountId, body, options?)` — and one private switch
 * over `body.t` for the recipient set and another for the wire payload.
 *
 * SyncEphemeral has a strictly simpler lifecycle than SyncUpdate (ADR-0013):
 *   • no seq (clients do not reconcile)
 *   • no update id (clients do not dedup)
 *   • no afterTx coordination (fire-and-forget; the seam does not internalise
 *     tx ordering — callers that need commit-ordered delivery wrap their own
 *     emitSyncEphemeral call in afterTx(tx, …) directly)
 *
 * The seam owns:
 *   • body.t → RecipientFilter (function relation per ADR-0024)
 *   • wire payload assembly for all 32 active variants
 *
 * `inter-agent-message-deliver` and `inter-agent-message-echo` are the one
 * place where the seam discriminator deliberately differs from the wire
 * `type` — both emit `type: "inter-agent-message"` on the wire while differing
 * only in recipient set. See ADR-0024 decision E3.
 */

// === Options shapes shared with eventRouter.ts during the migration ====
//
// PR 1.5.e will move the corresponding build*Ephemeral function bodies into
// this file and these interfaces will likely move with them.

export interface SupervisorTriggerOptions {
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
    fixAction?: { title: string; description: string; suggestedFix: string | null; category: string; severity: string; issueNumber?: number };
    researchParams?: string;
    fixStrategy?: string;
    fixMode?: string;
    analyzeAutoFix?: boolean;
    existingActions?: readonly { category: string; title: string; severity: string; approval: string; fixStatus: string | null }[];
    maxConcurrentAnalysis?: number;
    maxConcurrentFix?: number;
    maxFindings?: number;
    runtimeProfile?: ResolvedRuntimeProfile;
    agent?: string;
    prContext?: {
        prNumber: number;
        prTitle: string;
        prDescription: string;
        prUrl: string;
        headBranch: string;
        baseBranch: string;
        author: string;
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

export interface SupervisorLoopBriefOptions {
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

export interface AutoLoopFiredOptions {
    projectId: string;
    loopId: string;
    healthScore: number;
    threshold: number;
    firedAt: number;
}

export interface TaskTriggerOptions {
    taskId: string;
    prompt: string;
    directory: string;
    priority: string;
    projectId?: string;
    resultToken?: string;
    skillContents?: Array<{ name: string; content: string }>;
    agentType?: string | null;
    modelOverride?: string | null;
    profileId?: string;
    runtimeProfile?: ResolvedRuntimeProfile;
    worktreeIsolation?: boolean;
}

export interface TaskStatusChangedOptions {
    taskId: string;
    machineId: string;
    status: string;
    sessionId?: string;
    errorMessage?: string;
    completedAt?: number;
    triggerType?: string;
}

export interface InboxItemPayload {
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
}

export interface SessionEventCreatedPayload {
    id: string;
    sessionId: string;
    eventType: string;
    summary: string;
    detail?: Record<string, unknown>;
    createdAt: number;
}

export interface WorldEventCreatedPayload {
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
}

export interface PreviewCandidatePayload {
    id: string;
    sessionId: string;
    state: string;
    protocol: string;
    host: string;
    port: number;
    path?: string;
    devServerType?: string;
    reportedAt: number;
}

export interface PreviewConnectionPayload {
    tunnelId: string;
    candidateId: string;
    sessionId: string;
    publicUrl: string;
    status: string;
    createdAt: number;
    leaseExpiresAt: number;
    idleTimeoutMs: number;
    lastActiveAt: number;
}

export interface ApiRetryPayload {
    attempt: number;
    maxRetries: number;
    retryDelayMs: number;
    errorStatus: number | null;
}

// === SyncEphemeralBody — the 32 active variants =========================
//
// `accountId` is NOT carried inside any variant — it is always the first
// parameter to `emitSyncEphemeral` (same convention as SyncUpdate, ADR-0023
// detail 1=A).
//
// `buildMachineStatusEphemeral` is omitted — no production caller (it can be
// deleted from eventRouter.ts in a future cleanup PR alongside
// `buildRelationshipUpdatedEvent`).

export type SyncEphemeralBody =
    // --- session/machine activity & status ---
    | {
          t: "session-activity";
          sessionId: string;
          active: boolean;
          activeAt: number;
          thinking?: boolean;
          apiRetry?: ApiRetryPayload;
      }
    | { t: "machine-activity"; machineId: string; active: boolean; activeAt: number }
    | { t: "rpc-ready"; scope: "machine" | "session"; id: string; ready: boolean }
    | {
          t: "usage";
          sessionId: string;
          key: string;
          tokens: Record<string, number>;
          cost: Record<string, number>;
      }
    // --- supervisor lifecycle ---
    | ({ t: "supervisor-trigger" } & SupervisorTriggerOptions)
    | {
          t: "supervisor-status";
          runId: string;
          projectId: string;
          status: string;
          artifactId?: string;
          errorMessage?: string;
          currentDimension?: string;
          dimensionIndex?: number;
          totalDimensions?: number;
      }
    | ({ t: "supervisor-loop-status" } & SupervisorLoopStatusOptions)
    | ({ t: "supervisor-loop-brief" } & SupervisorLoopBriefOptions)
    | ({ t: "auto-loop-fired" } & AutoLoopFiredOptions)
    | { t: "supervisor-run-complete"; runId: string; projectId: string; status: string; machineId: string }
    | { t: "supervisor-fix-kill-session"; fixSessionId: string; projectId: string; fixStatus: string; machineId: string }
    // --- knowledge ---
    | { t: "knowledge-count"; sessionId: string; count: number }
    | { t: "knowledge-access-update"; sessionId: string; hit?: number; miss?: number; evicted?: number }
    // --- task ---
    | ({ t: "task-trigger"; machineId: string } & TaskTriggerOptions)
    | ({ t: "task-status-changed" } & TaskStatusChangedOptions)
    | { t: "task-cancel"; taskId: string; sessionId?: string; machineId: string }
    | {
          t: "task-log";
          sessionId: string;
          taskId: string;
          outputFile: string;
          chunk: string;
          offset: number;
      }
    // --- inbox ---
    | { t: "inbox-new-item"; item: InboxItemPayload }
    | { t: "inbox-unread-count"; count: number }
    // --- session lifecycle (CLI signals) ---
    | { t: "session-event-created"; event: SessionEventCreatedPayload }
    | { t: "session-terminate"; sessionId: string; reason: string; machineId: string }
    // --- inter-agent message — the one wire/seam discriminator mismatch ---
    // Both wire-emit `type: "inter-agent-message"`; the seam distinguishes
    // delivery (target session) from echo (sender's own App). See ADR-0024 E3.
    | {
          t: "inter-agent-message-deliver";
          fromSessionId: string;
          toSessionId: string;
          message: string;
      }
    | {
          t: "inter-agent-message-echo";
          fromSessionId: string;
          toSessionId: string;
          message: string;
      }
    // --- world events ---
    | { t: "world-event-created"; event: WorldEventCreatedPayload }
    // --- preview ---
    | { t: "preview-candidate-reported"; sessionId: string; candidate: PreviewCandidatePayload }
    | { t: "preview-connection-updated"; sessionId: string; connection: PreviewConnectionPayload | null }
    // --- terminal relay ---
    | { t: "terminal-output"; machineId: string; terminalId: string; data: string }
    | { t: "terminal-exit"; machineId: string; terminalId: string; exitCode: number }
    | { t: "terminal-input"; machineId: string; terminalId: string; data: string }
    // --- webhook ---
    | {
          t: "webhook-trigger";
          machineId: string;
          webhookEventId: string;
          issueNumber: number;
          issueTitle: string;
          issueBody: string | null;
          issueAuthor: string;
          issueLabels: unknown;
          issueUrl: string;
          repoUrl: string;
          repoPath: string;
          provider: string;
          apiToken: string | null;
          runtimeProfile?: ResolvedRuntimeProfile;
      }
    | {
          t: "webhook-issue-linked";
          issueNumber: number;
          issueTitle: string;
          issueBody: string | null;
          issueAuthor: string;
          issueLabels: unknown;
          issueUrl: string;
          repoUrl: string;
          repoPath: string;
          machineId: string;
          sessionId: string;
      }
    | {
          t: "webhook-pr-merged";
          prNumber: number;
          prUrl: string;
          issueNumber: number;
          sessionId: string;
          machineId: string;
          repoPath: string;
      }
    // --- auto-loop fired is already covered above ---
    ;

export type EmitSyncEphemeralOptions = {
    /** Suppress echo to the originating socket connection. */
    skipSenderConnection?: ClientConnection;
};

/**
 * Emit a SyncEphemeral to the connections that need to know.
 *
 * Callers express only the domain signal (`accountId`, `body`); the seam
 * derives the recipient set, builds the wire payload, and dispatches through
 * {@link eventRouter}. See ADR-0024 for the load-bearing decisions encoded
 * here.
 */
export async function emitSyncEphemeral(
    accountId: string,
    body: SyncEphemeralBody,
    options?: EmitSyncEphemeralOptions,
): Promise<void> {
    // PR 1.5.e will rename this transport sink to
    // `eventRouter._emitEphemeralInternal` once all 78 callers have moved
    // through this seam — mirroring the PR 1.a → 1.g sequence for SyncUpdate.
    eventRouter.emitEphemeral({
        userId: accountId,
        payload: buildPayload(body),
        recipientFilter: recipientFilterFor(body),
        skipSenderConnection: options?.skipSenderConnection,
    });
}

// === Internal: body.t → RecipientFilter ================================
//
// Exhaustive switch over `SyncEphemeralBody["t"]`; TypeScript catches a
// missing case at compile time. Adding a variant means one case here, one
// case in `buildPayload`, and one variant in `SyncEphemeralBody` — all in
// this file.

function recipientFilterFor(body: SyncEphemeralBody): RecipientFilter {
    switch (body.t) {
        // user-scoped: App needs to know, no other surface cares
        case "session-activity":
        case "machine-activity":
        case "rpc-ready":
        case "usage":
        case "supervisor-status":
        case "supervisor-loop-status":
        case "supervisor-loop-brief":
        case "auto-loop-fired":
        case "knowledge-count":
        case "knowledge-access-update":
        case "task-status-changed":
        case "inbox-new-item":
        case "inbox-unread-count":
        case "world-event-created":
        case "terminal-output":
        case "terminal-exit":
        case "webhook-issue-linked":
        case "webhook-pr-merged":
        case "inter-agent-message-echo":
            return { type: "user-scoped-only" };

        // machine-scoped: a specific Machine's daemon must receive it (and
        // user-scoped is included by the recipient matcher's semantics)
        case "supervisor-trigger":
            return { type: "machine-scoped-only", machineId: body.machineId };
        case "supervisor-run-complete":
            return { type: "machine-scoped-only", machineId: body.machineId };
        case "supervisor-fix-kill-session":
            return { type: "machine-scoped-only", machineId: body.machineId };
        case "task-trigger":
            return { type: "machine-scoped-only", machineId: body.machineId };
        case "task-cancel":
            return { type: "machine-scoped-only", machineId: body.machineId };
        case "session-terminate":
            return { type: "machine-scoped-only", machineId: body.machineId };
        case "terminal-input":
            return { type: "machine-scoped-only", machineId: body.machineId };
        case "webhook-trigger":
            return { type: "machine-scoped-only", machineId: body.machineId };

        // session-scoped: a specific Session's subscribers (App + CLI session)
        case "session-event-created":
            return { type: "all-interested-in-session", sessionId: body.event.sessionId };
        case "task-log":
            return { type: "all-interested-in-session", sessionId: body.sessionId };
        case "preview-candidate-reported":
            return { type: "all-interested-in-session", sessionId: body.sessionId };
        case "preview-connection-updated":
            return { type: "all-interested-in-session", sessionId: body.sessionId };
        case "inter-agent-message-deliver":
            return { type: "all-interested-in-session", sessionId: body.toSessionId };
    }
}

// === Internal: body → EphemeralPayload =================================
//
// Phase 1.5.a delegates to inline construction; PR 1.5.e physically absorbs
// the 21 active `build*Ephemeral` exports as private helpers and this switch
// stays unchanged in shape.

function buildPayload(body: SyncEphemeralBody): EphemeralPayload {
    // PR 1.5.a delegates to the existing build*Ephemeral exports in
    // eventRouter.ts. PR 1.5.e will move them physically into this file as
    // private helpers; this switch shape stays unchanged.
    switch (body.t) {
        case "session-activity":
            return buildSessionActivityEphemeral(body.sessionId, body.active, body.activeAt, body.thinking, body.apiRetry);
        case "machine-activity":
            return buildMachineActivityEphemeral(body.machineId, body.active, body.activeAt);
        case "rpc-ready":
            return buildRpcReadyEphemeral(body.scope, body.id, body.ready);
        case "usage":
            return buildUsageEphemeral(body.sessionId, body.key, body.tokens, body.cost);
        case "supervisor-trigger": {
            const { t: _t, ...opts } = body;
            return buildSupervisorTriggerEphemeral(opts);
        }
        case "supervisor-status":
            return buildSupervisorStatusEphemeral(
                body.runId,
                body.projectId,
                body.status,
                body.artifactId,
                body.errorMessage,
                body.currentDimension,
                body.dimensionIndex,
                body.totalDimensions,
            );
        case "supervisor-loop-status": {
            const { t: _t, ...opts } = body;
            return buildSupervisorLoopStatusEphemeral(opts);
        }
        case "supervisor-loop-brief": {
            const { t: _t, ...opts } = body;
            return buildSupervisorLoopBriefEphemeral(opts);
        }
        case "auto-loop-fired": {
            const { t: _t, ...opts } = body;
            return buildAutoLoopFiredEphemeral(opts);
        }
        case "supervisor-run-complete":
            return {
                type: "supervisor-run-complete",
                runId: body.runId,
                projectId: body.projectId,
                status: body.status,
            };
        case "supervisor-fix-kill-session":
            return {
                type: "supervisor-fix-kill-session",
                fixSessionId: body.fixSessionId,
                projectId: body.projectId,
                fixStatus: body.fixStatus,
            };
        case "knowledge-count":
            return buildKnowledgeCountEphemeral(body.sessionId, body.count);
        case "knowledge-access-update":
            return buildKnowledgeAccessUpdateEphemeral({
                sessionId: body.sessionId,
                hit: body.hit,
                miss: body.miss,
                evicted: body.evicted,
            });
        case "task-trigger": {
            const { t: _t, machineId: _m, ...opts } = body;
            return buildTaskTriggerEphemeral(opts);
        }
        case "task-status-changed": {
            const { t: _t, ...opts } = body;
            return buildTaskStatusChangedEphemeral(opts);
        }
        case "task-cancel":
            return buildTaskCancelEphemeral({ taskId: body.taskId, sessionId: body.sessionId });
        case "task-log":
            return {
                type: "task-log",
                sessionId: body.sessionId,
                taskId: body.taskId,
                outputFile: body.outputFile,
                chunk: body.chunk,
                offset: body.offset,
            };
        case "inbox-new-item":
            return buildInboxNewItemEphemeral(body.item);
        case "inbox-unread-count":
            return buildInboxUnreadCountEphemeral(body.count);
        case "session-event-created":
            return buildSessionEventCreatedEphemeral(body.event);
        case "session-terminate":
            return { type: "session-terminate", sessionId: body.sessionId, reason: body.reason };
        case "inter-agent-message-deliver":
        case "inter-agent-message-echo":
            // Both seam variants emit the same wire `type` per ADR-0024 E3.
            return buildInterAgentMessageEphemeral({
                fromSessionId: body.fromSessionId,
                toSessionId: body.toSessionId,
                message: body.message,
            });
        case "world-event-created":
            return buildWorldEventCreatedEphemeral(body.event);
        case "preview-candidate-reported":
            return buildPreviewCandidateReportedEphemeral({
                sessionId: body.sessionId,
                candidate: body.candidate,
            });
        case "preview-connection-updated":
            return buildPreviewConnectionUpdatedEphemeral({
                sessionId: body.sessionId,
                connection: body.connection,
            });
        case "terminal-output":
            return {
                type: "terminal-output",
                machineId: body.machineId,
                terminalId: body.terminalId,
                data: body.data,
            };
        case "terminal-exit":
            return {
                type: "terminal-exit",
                machineId: body.machineId,
                terminalId: body.terminalId,
                exitCode: body.exitCode,
            };
        case "terminal-input":
            return {
                type: "terminal-input",
                machineId: body.machineId,
                terminalId: body.terminalId,
                data: body.data,
            };
        case "webhook-trigger": {
            const { t: _t, machineId: _m, ...rest } = body;
            return { type: "webhook-trigger", ...rest };
        }
        case "webhook-issue-linked": {
            const { t: _t, ...rest } = body;
            return { type: "webhook-issue-linked", ...rest };
        }
        case "webhook-pr-merged": {
            const { t: _t, ...rest } = body;
            return { type: "webhook-pr-merged", ...rest };
        }
    }
}
