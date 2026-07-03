/**
 * SyncUpdateIngest: the App-side seam that consumes one SyncUpdate
 * (CONTEXT.md), applies its storage mutations, and returns the typed
 * {@link IngestEvent}s the mutation produced.
 *
 * Symmetric to the server's `emitSyncUpdate` (ADR-0023). Owns:
 *   - exhaustive body.t dispatch (TypeScript exhaustiveness check)
 *   - encryption-scope readiness (delegates to the existing
 *     `syncEncryptionScope.ts` internal seam shared across variants)
 *   - storage mutation (calls `storage.getState().applyXxx()` directly —
 *     Zustand stays the store of record)
 *   - event production (caller fans out via `ingestEvents.emit(events)`)
 *
 * MIGRATION STATUS (ADR-0026):
 *   - PR 2: `new-machine`.
 *   - PR 3: `new-session`, `relationship-updated`, `new-feed-post`,
 *     `kv-batch-update`, `new-project` / `update-project` / `delete-project`.
 *   - PR 4 (this PR): `delete-session`, `update-session`, `update-machine`,
 *     `update-account`, `new-artifact`, `update-artifact`, `delete-artifact`.
 *   - PR 5: `new-message` (the 263-line monster).
 *   - PR 7: the if-else chain in `sync.ts` collapses to a single
 *     `await ingestSyncUpdate(...)` call and this file becomes the sole
 *     dispatch surface.
 */

import { log } from "@/log";
import { ingestStorage, storage } from "../storage";
import { issueSessionStore } from "../issueSessionStore";
import { isIssueSessionKey } from "../issueSessionTypes";
import { deleteMessageCache, deleteHistoryComplete } from "../messageCache";
import { deleteBackfillBoundary } from "../persistence";
import { removeWorktree } from "../gitWorktreeOps";
import { disposeSessionScopedState } from "../sessionScopedStore";
import { mergeUpdatedSession } from "../updateSessionMerge";
import { detectNeedsAttention } from "../syncHelpers";
import { ArtifactEncryption } from "../encryption/artifactEncryption";
import {
    resolveSessionEncryption,
    resolveMachineEncryption,
} from "../syncEncryptionScope";
import {
    settingsParse,
    SUPPORTED_SCHEMA_VERSION,
} from "../settings";
import {
    normalizeRawMessage,
    extractPromptSuggestionFromRaw,
    extractNeedsContinueFromRaw,
    extractSessionStateFromRaw,
    extractTerminalSignalFromRaw,
    isUserMessageRaw,
    type NormalizedMessage,
} from "../typesRaw";
import { getLatestUserRequestPreview } from "@/utils/sessionUtils";
import type { ApiUpdate, ApiUpdateContainer } from "../apiTypes";
import type { Machine } from "../storageTypes";
import type { FeedItem } from "../feedTypes";
import type { DecryptedArtifact } from "../artifactTypes";
import type { Profile } from "../profile";
import type { IngestContext } from "./ingestContext";
import type { IngestEvent } from "./types";
import {
    classifyTurnLifecycle,
    type RawLifecycleContent,
} from "./turnLifecycleClassify";

type NewMachineBody = Extract<ApiUpdate, { t: "new-machine" }>;
type UpdateMachineBody = Extract<ApiUpdate, { t: "update-machine" }>;
type DeleteSessionBody = Extract<ApiUpdate, { t: "delete-session" }>;
type UpdateSessionBody = Extract<ApiUpdate, { t: "update-session" }>;
type UpdateAccountBody = Extract<ApiUpdate, { t: "update-account" }>;
type NewArtifactBody = Extract<ApiUpdate, { t: "new-artifact" }>;
type UpdateArtifactBody = Extract<ApiUpdate, { t: "update-artifact" }>;
type DeleteArtifactBody = Extract<ApiUpdate, { t: "delete-artifact" }>;
type NewMessageBody = Extract<ApiUpdate, { t: "new-message" }>;
type RelationshipUpdatedBody = Extract<ApiUpdate, { t: "relationship-updated" }>;
type NewFeedPostBody = Extract<ApiUpdate, { t: "new-feed-post" }>;
type KvBatchUpdateBody = Extract<ApiUpdate, { t: "kv-batch-update" }>;

const RESEARCH_CONFIG_PREFIX = "researchConfig/";

// [stream-perf] dev-only delta-arrival tracking, preserved from the original
// handler. Module-level state — same lifetime as the seam (process-singleton).
let _perfLastDeltaAt = 0;
let _perfDeltaCount = 0;
let _perfDeltaLogAt = 0;

export async function ingestSyncUpdate(
    update: ApiUpdateContainer,
    ctx: IngestContext,
): Promise<IngestEvent[]> {
    const body = update.body;

    switch (body.t) {
        case "new-machine":
            return await ingestNewMachine(body, ctx);
        case "update-machine":
            return await ingestUpdateMachine(update, body, ctx);
        case "new-session":
            // The server-side new-session arrives without a Session payload;
            // we trigger a sessions refetch to pull the full row. Storage
            // write happens inside the refetch action.
            log.log("🆕 New session update received");
            return [{ kind: "sessions-stale" }];
        case "update-session":
            return await ingestUpdateSession(update, body, ctx);
        case "delete-session":
            return ingestDeleteSession(body, ctx);
        case "update-account":
            return await ingestUpdateAccount(update, body, ctx);
        case "new-artifact":
            return await ingestNewArtifact(body, ctx);
        case "update-artifact":
            return await ingestUpdateArtifact(update, body, ctx);
        case "delete-artifact":
            return ingestDeleteArtifact(body, ctx);
        case "relationship-updated":
            return ingestRelationshipUpdated(body);
        case "new-feed-post":
            return await ingestNewFeedPost(body, ctx);
        case "kv-batch-update":
            return await ingestKvBatchUpdate(body);
        case "new-project":
        case "update-project":
        case "delete-project":
            log.log(`📁 Received ${body.t} event`);
            return [{ kind: "projects-stale" }];
        case "agent-loop-updated":
        case "agent-loop-deleted":
            // Server emits these from agentLoopEngine on every loop
            // mutation (CRUD/iteration/pause/resume). useWorkflows
            // subscribes and re-fetches so the Workflow IA shows the
            // new state without a page reload.
            log.log(`🔁 Received ${body.t} event`);
            return [{ kind: "agent-loops-stale" }];
        case "trigger-schedule-updated":
        case "trigger-schedule-deleted":
            // Server emits on cron tick + every Schedule CRUD. Replaces
            // the 30 s poll that useWorkflows used to run as a fallback.
            // [diag:nextRunAt] dump the schedule payload so we can verify
            // the server-side nextRunAt actually advances on each tick
            // (compare to what useWorkflows logs on the follow-up fetch).
            if (body.t === "trigger-schedule-updated") {
                const schedule = body.schedule as Record<string, unknown>;
                const nextRunAt =
                    typeof schedule?.nextRunAt === "number"
                        ? new Date(schedule.nextRunAt).toISOString()
                        : (schedule?.nextRunAt ?? null);
                const lastRunAt =
                    typeof schedule?.lastRunAt === "number"
                        ? new Date(schedule.lastRunAt).toISOString()
                        : (schedule?.lastRunAt ?? null);
                log.log(
                    `⏰ Received trigger-schedule-updated id=${schedule?.id} name=${JSON.stringify(schedule?.name ?? null)} enabled=${schedule?.enabled} nextRunAt=${nextRunAt} lastRunAt=${lastRunAt} runCount=${schedule?.runCount}`,
                );
            } else {
                log.log(`⏰ Received trigger-schedule-deleted id=${(body as { scheduleId?: string }).scheduleId}`);
            }
            return [{ kind: "schedules-stale" }];
        case "webhook-trigger-updated":
        case "webhook-trigger-deleted":
            // Server emits on webhook fire + every Webhook CRUD. Same
            // story as above — kills the wall-clock poll fallback.
            log.log(`⚡ Received ${body.t} event`);
            return [{ kind: "webhooks-stale" }];
        case "new-message":
            return await ingestNewMessage(update, body, ctx);
        default: {
            // Exhaustiveness check — if a new body.t variant appears in
            // apiTypes the type system will fail here until a case is added.
            const _exhaustive: never = body;
            void _exhaustive;
            throw new Error(
                `ingestSyncUpdate: unhandled body.t '${(body as { t: string }).t}'`,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// new-machine
// ---------------------------------------------------------------------------

/**
 * Apply a `new-machine` SyncUpdate.
 *
 * The pre-step (register the data encryption key into the Encryption module
 * BEFORE any decryption attempt) is the reason this variant had to be
 * inlined in `sync.ts:2263–2324` before PR 2. Cold onboarding for a brand-
 * new machine arrives via `new-machine` *before* `fetchMachines` has seen
 * it, so per-machine encryption is not initialised yet. Without the
 * pre-step every later decrypt for this machine fails and it never lands in
 * storage — the new-session screen is unable to start a session until an
 * app restart triggers a full machine refetch.
 *
 * Empty return: `new-machine` has no subscriber-driven side effects today
 * (the full data arrived inline; no `machinesSync.invalidate()`, no voice
 * cue, no notification). Per ADR-0026 Decision F1 — emit events only when
 * a real subscriber consumes them — we return `[]` rather than fabricate
 * a dead `machine-mutated` event.
 */
async function ingestNewMachine(
    body: NewMachineBody,
    ctx: IngestContext,
): Promise<IngestEvent[]> {
    const { machineId } = body;

    // Register the data encryption key. Mirrors fetchMachines' setup —
    // both Encryption.initializeMachines and Sync's machineDataKeys mirror
    // populated from the same decrypted key (single decrypt).
    const machineKeysMap = new Map<string, Uint8Array | null>();
    if (body.dataEncryptionKey) {
        const decryptedKey = await ctx.encryption.decryptEncryptionKey(
            body.dataEncryptionKey,
        );
        if (decryptedKey) {
            machineKeysMap.set(machineId, decryptedKey);
            ctx.machineDataKeys.set(machineId, decryptedKey);
        } else {
            log.error(
                `Failed to decrypt data encryption key for new machine ${machineId}`,
            );
            machineKeysMap.set(machineId, null);
        }
    } else {
        machineKeysMap.set(machineId, null);
    }
    await ctx.encryption.initializeMachines(machineKeysMap);

    const machineEncryption = ctx.encryption.getMachineEncryption(machineId);
    if (!machineEncryption) {
        log.error(
            `Machine encryption not found for ${machineId} after init — cannot apply new-machine`,
        );
        return [];
    }

    const existing = storage.getState().machines[machineId];
    const newMachine: Machine = {
        id: machineId,
        seq: body.seq,
        createdAt: existing?.createdAt ?? body.createdAt,
        updatedAt: body.updatedAt,
        active: body.active,
        activeAt: body.activeAt,
        rpcReady: existing?.rpcReady ?? false,
        metadata: null,
        metadataVersion: body.metadataVersion,
        daemonState: null,
        daemonStateVersion: body.daemonStateVersion,
    };

    // Decrypt best-effort; still apply the machine on failure so it stays
    // visible/usable (matches fetchMachines' fallback behavior).
    try {
        newMachine.metadata = body.metadata
            ? await machineEncryption.decryptMetadata(
                  body.metadataVersion,
                  body.metadata,
              )
            : null;
        newMachine.daemonState = body.daemonState
            ? await machineEncryption.decryptDaemonState(
                  body.daemonStateVersion,
                  body.daemonState,
              )
            : null;
    } catch (error) {
        log.error(`Failed to decrypt new machine ${machineId}:`, error);
    }

    ingestStorage.getState().applyMachines([newMachine]);

    return [];
}

// ---------------------------------------------------------------------------
// update-machine
// ---------------------------------------------------------------------------

/**
 * Apply an `update-machine` SyncUpdate.
 *
 * Uses `resolveMachineEncryption` (the same startup-race + refetch-recovery
 * invariant the session handlers use). Before that internal seam was added
 * (PR 4 of the encryption-scope-readiness work that pre-dated this ADR),
 * `update-machine` silently dropped a raced update. The seam preserves the
 * fix here.
 *
 * Empty return: like `new-machine`, no subscriber consumes a machine
 * mutation event today. The full data lives in storage after the apply.
 */
async function ingestUpdateMachine(
    update: ApiUpdateContainer,
    body: UpdateMachineBody,
    ctx: IngestContext,
): Promise<IngestEvent[]> {
    const machineId = body.machineId;
    const machine = storage.getState().machines[machineId];

    const updatedMachine: Machine = {
        id: machineId,
        seq: update.seq,
        createdAt: machine?.createdAt ?? update.createdAt,
        updatedAt: update.createdAt,
        active: body.active ?? true,
        activeAt: body.activeAt ?? update.createdAt,
        rpcReady: machine?.rpcReady ?? false,
        metadata: machine?.metadata ?? null,
        metadataVersion: machine?.metadataVersion ?? 0,
        daemonState: machine?.daemonState ?? null,
        daemonStateVersion: machine?.daemonStateVersion ?? 0,
    };

    const machineEncryption = await resolveMachineEncryption(machineId, ctx);
    if (!machineEncryption) {
        return [];
    }

    const metadataUpdate = body.metadata;
    if (metadataUpdate) {
        try {
            const metadata = await machineEncryption.decryptMetadata(
                metadataUpdate.version,
                metadataUpdate.value,
            );
            updatedMachine.metadata = metadata;
            updatedMachine.metadataVersion = metadataUpdate.version;
        } catch (error) {
            log.error(
                `Failed to decrypt machine metadata for ${machineId}:`,
                error,
            );
        }
    }

    const daemonStateUpdate = body.daemonState;
    if (daemonStateUpdate) {
        try {
            const daemonState = await machineEncryption.decryptDaemonState(
                daemonStateUpdate.version,
                daemonStateUpdate.value,
            );
            updatedMachine.daemonState = daemonState;
            updatedMachine.daemonStateVersion = daemonStateUpdate.version;
        } catch (error) {
            log.error(
                `Failed to decrypt machine daemonState for ${machineId}:`,
                error,
            );
        }
    }

    ingestStorage.getState().applyMachines([updatedMachine]);
    return [];
}

// ---------------------------------------------------------------------------
// delete-session
// ---------------------------------------------------------------------------

/**
 * Apply a `delete-session` SyncUpdate.
 *
 * The seam owns module-level cleanups (issueSessionStore status, worktree
 * removal, storage delete, encryption removal, cache deletion). Sync-class
 * internal cleanups (messagesSync / sendSync / pendingOutbox / cursors /
 * lastSeq / deleted404Sessions / message processor release) are handled
 * by the `session-deleted` event subscriber registered in Sync.
 */
function ingestDeleteSession(
    body: DeleteSessionBody,
    ctx: IngestContext,
): IngestEvent[] {
    log.log("🗑️ Delete session update received");
    const sessionId = body.sid;

    const issueLink = issueSessionStore.getState().findBySessionId(sessionId);
    if (issueLink && issueLink.status === "processing") {
        void issueSessionStore
            .getState()
            .updateStatus(issueLink.issueKey, "cancelled")
            .catch(() => {
                // Best-effort
            });
    }

    const sessionToDelete = storage.getState().sessions[sessionId];
    const wt = sessionToDelete?.metadata?.worktree;
    if (wt?.isWorktree && wt.name && sessionToDelete?.metadata?.machineId) {
        const parentPath =
            wt.parentRepoPath ?? sessionToDelete.metadata.path ?? "";
        const branchCleanup: "skip" | "safe" | "force" = wt.prUrl
            ? "skip"
            : wt.state === "merged"
                ? "safe"
                : "force";

        void removeWorktree(
            sessionToDelete.metadata.machineId,
            wt.name,
            parentPath,
            branchCleanup,
        ).catch((err) => {
            log.log(`⚠️ Worktree cleanup failed for ${wt.name}: ${err}`);
        });
    }

    storage.getState().deleteSession(sessionId);
    ctx.encryption.removeSessionEncryption(sessionId);
    disposeSessionScopedState(sessionId);

    // The cursor lives on ctx (per-session seq + dedup). `delete` forgets the
    // in-memory cursor AND the persisted seq in one call. Other Sync-class queues
    // (messagesSync/sendSync/pendingOutbox/messageProcessor) are cleaned by the
    // `session-deleted` subscriber this handler's return value triggers.
    ctx.cursor.delete(sessionId);

    deleteBackfillBoundary(sessionId);
    deleteMessageCache(sessionId);
    deleteHistoryComplete(sessionId);

    log.log(`🗑️ Session ${sessionId} deleted from local storage`);
    return [{ kind: "session-deleted", sid: sessionId }];
}

// ---------------------------------------------------------------------------
// update-session
// ---------------------------------------------------------------------------

/**
 * Apply an `update-session` SyncUpdate.
 *
 * Owns the agentState / metadata / preferences decryption and the
 * mergeUpdatedSession merge. Emits domain events for the conditions that
 * today have inline side effects: `permission-requested` (a new request
 * appeared), `permission-resolved` (requests cleared), and
 * `session-control-returned` (control flipped back to user).
 *
 * Note on `applySessions`: we go through `ctx.applySessions` (Sync's
 * wrapped version, which does live-message side-channel work) rather than
 * `storage.getState().applySessions` directly. PR 7 may revisit whether
 * the wrapper-only behaviour can move to subscribers.
 */
async function ingestUpdateSession(
    update: ApiUpdateContainer,
    body: UpdateSessionBody,
    ctx: IngestContext,
): Promise<IngestEvent[]> {
    const sessionEncryption = await resolveSessionEncryption(
        body.id,
        ctx,
        () => !!storage.getState().sessions[body.id],
    );
    if (!sessionEncryption) {
        return [];
    }
    const session = storage.getState().sessions[body.id];
    if (!session) {
        // Defensive: row removed between resolution and read (concurrent delete).
        ctx.sessionsSync.forceRefetch();
        return [];
    }

    const agentState = body.agentState
        ? await sessionEncryption.decryptAgentState(
              body.agentState.version,
              body.agentState.value,
          )
        : session.agentState;
    const metadata = body.metadata
        ? await sessionEncryption.decryptMetadata(
              body.metadata.version,
              body.metadata.value,
          )
        : session.metadata;
    const preferencesData = body.preferences;
    const preferences = preferencesData?.value
        ? await sessionEncryption.decryptPreferences(preferencesData.value)
        : null;

    const { updatedSession, metadataDecryptFailed } = mergeUpdatedSession({
        session,
        seq: update.seq,
        updatedAt: update.createdAt,
        agentState,
        agentStateVersion: body.agentState
            ? body.agentState.version
            : session.agentStateVersion,
        metadata,
        metadataUpdate: body.metadata,
        preferences,
        preferencesUpdate: preferencesData,
        pendingPreferences: storage
            .getState()
            .getPendingSessionPreferences(session.id),
    });

    if (body.metadata && metadataDecryptFailed) {
        log.warn(
            `Failed to decrypt session metadata for ${body.id} version ${body.metadata.version}; preserving existing metadata and refetching sessions`,
        );
        ctx.sessionsSync.forceRefetch();
    }

    ctx.applySessions([updatedSession]);

    const events: IngestEvent[] = [];

    if (body.agentState) {
        // New permission request(s) just appeared on agentState.
        if (agentState?.requests && Object.keys(agentState.requests).length > 0) {
            const requestIds = Object.keys(agentState.requests);
            const firstRequest = agentState.requests[requestIds[0]];
            events.push({
                kind: "permission-requested",
                sid: body.id,
                requestId: requestIds[0],
                toolName: firstRequest?.tool,
                toolArguments: firstRequest?.arguments,
            });
        } else {
            // Permissions resolved -- collect previously-observed request IDs
            // so subscribers (web notification) can clear their tracking.
            const prevRequests = session.agentState?.requests;
            if (prevRequests && Object.keys(prevRequests).length > 0) {
                events.push({
                    kind: "permission-resolved",
                    sid: body.id,
                    resolvedRequestIds: Object.keys(prevRequests),
                });
            }
        }

        // Control just returned to mobile — re-fetch messages so the user
        // sees the latest state.
        const wasControlledByUser = session.agentState?.controlledByUser;
        const isNowControlledByUser = agentState?.controlledByUser;
        if (!wasControlledByUser && isNowControlledByUser) {
            log.log(
                `🔄 Control returned to mobile for session ${body.id}, re-fetching messages`,
            );
            events.push({ kind: "session-control-returned", sid: body.id });
        }
    }

    return events;
}

// ---------------------------------------------------------------------------
// update-account
// ---------------------------------------------------------------------------

/**
 * Apply an `update-account` SyncUpdate.
 *
 * Profile fields update unconditionally; settings update only when a value
 * was carried. Emits `account-settings-applied` ONLY when settings were
 * actually applied — subscribers (e.g. Sync's pendingSettings re-apply) use
 * that event to know the local pending settings should be re-layered over
 * the freshly-decrypted server settings.
 */
async function ingestUpdateAccount(
    update: ApiUpdateContainer,
    body: UpdateAccountBody,
    ctx: IngestContext,
): Promise<IngestEvent[]> {
    const currentProfile = storage.getState().profile;
    const updatedProfile: Profile = {
        ...currentProfile,
        firstName:
            body.firstName !== undefined ? body.firstName : currentProfile.firstName,
        lastName:
            body.lastName !== undefined ? body.lastName : currentProfile.lastName,
        avatar:
            body.avatar !== undefined ? body.avatar : currentProfile.avatar,
        github:
            body.github !== undefined ? body.github : currentProfile.github,
        timestamp: update.createdAt,
    };
    ingestStorage.getState().applyProfile(updatedProfile);

    const events: IngestEvent[] = [];

    if (body.settings?.value) {
        try {
            const decryptedSettings = await ctx.encryption.decryptRaw(
                body.settings.value,
            );
            const parsedSettings = settingsParse(decryptedSettings);

            const settingsSchemaVersion = parsedSettings.schemaVersion ?? 1;
            if (settingsSchemaVersion > SUPPORTED_SCHEMA_VERSION) {
                log.warn(
                    `⚠️ Received settings schema v${settingsSchemaVersion}, ` +
                    `we support v${SUPPORTED_SCHEMA_VERSION}. Update app for full functionality.`,
                );
            }

            storage
                .getState()
                .applySettings(parsedSettings, body.settings.version);
            log.log(
                `📋 Settings synced from server (schema v${settingsSchemaVersion}, version ${body.settings.version})`,
            );
            events.push({ kind: "account-settings-applied" });
        } catch (error) {
            log.error("❌ Failed to process settings update:", error);
        }
    }

    return events;
}

// ---------------------------------------------------------------------------
// new-artifact
// ---------------------------------------------------------------------------

async function ingestNewArtifact(
    body: NewArtifactBody,
    ctx: IngestContext,
): Promise<IngestEvent[]> {
    log.log("📦 Received new-artifact update");
    const artifactId = body.artifactId;

    try {
        const decryptedKey = await ctx.encryption.decryptEncryptionKey(
            body.dataEncryptionKey,
        );
        if (!decryptedKey) {
            log.error(`Failed to decrypt key for new artifact ${artifactId}`);
            return [];
        }

        ctx.artifactDataKeys.set(artifactId, decryptedKey);

        const artifactEncryption = new ArtifactEncryption(decryptedKey);
        const header = await artifactEncryption.decryptHeader(body.header);

        let decryptedBody: string | null | undefined = undefined;
        if (body.body && body.bodyVersion !== undefined) {
            const bodyResult = await artifactEncryption.decryptBody(body.body);
            decryptedBody = bodyResult?.body || null;
        }

        const decryptedArtifact: DecryptedArtifact = {
            id: artifactId,
            title: header?.title || null,
            body: decryptedBody,
            headerVersion: body.headerVersion,
            bodyVersion: body.bodyVersion,
            seq: body.seq,
            createdAt: body.createdAt,
            updatedAt: body.updatedAt,
            isDecrypted: !!header,
        };

        storage.getState().addArtifact(decryptedArtifact);
        log.log(`📦 Added new artifact ${artifactId} to storage`);
    } catch (error) {
        log.error(`Failed to process new artifact ${artifactId}:`, error);
    }
    return [];
}

// ---------------------------------------------------------------------------
// update-artifact
// ---------------------------------------------------------------------------

async function ingestUpdateArtifact(
    update: ApiUpdateContainer,
    body: UpdateArtifactBody,
    ctx: IngestContext,
): Promise<IngestEvent[]> {
    log.log("📦 Received update-artifact update");
    const artifactId = body.artifactId;

    const existingArtifact = storage.getState().artifacts[artifactId];
    if (!existingArtifact) {
        log.error(`Artifact ${artifactId} not found in storage`);
        return [{ kind: "artifacts-stale" }];
    }

    try {
        const dataEncryptionKey = ctx.artifactDataKeys.get(artifactId);
        if (!dataEncryptionKey) {
            log.error(
                `Encryption key not found for artifact ${artifactId}, fetching artifacts`,
            );
            return [{ kind: "artifacts-stale" }];
        }

        const artifactEncryption = new ArtifactEncryption(dataEncryptionKey);
        const updatedArtifact: DecryptedArtifact = {
            ...existingArtifact,
            seq: update.seq,
            updatedAt: update.createdAt,
        };

        if (body.header) {
            const header = await artifactEncryption.decryptHeader(body.header.value);
            updatedArtifact.title = header?.title || null;
            updatedArtifact.sessions = header?.sessions;
            updatedArtifact.draft = header?.draft;
            updatedArtifact.headerVersion = body.header.version;
        }

        if (body.body) {
            const bodyResult = await artifactEncryption.decryptBody(body.body.value);
            updatedArtifact.body = bodyResult?.body || null;
            updatedArtifact.bodyVersion = body.body.version;
        }

        storage.getState().updateArtifact(updatedArtifact);
        log.log(`📦 Updated artifact ${artifactId} in storage`);
    } catch (error) {
        log.error(`Failed to process artifact update ${artifactId}:`, error);
    }
    return [];
}

// ---------------------------------------------------------------------------
// delete-artifact
// ---------------------------------------------------------------------------

function ingestDeleteArtifact(
    body: DeleteArtifactBody,
    ctx: IngestContext,
): IngestEvent[] {
    log.log("📦 Received delete-artifact update");
    const artifactId = body.artifactId;
    storage.getState().deleteArtifact(artifactId);
    ctx.artifactDataKeys.delete(artifactId);
    return [];
}

// ---------------------------------------------------------------------------
// new-message
// ---------------------------------------------------------------------------

/**
 * Apply a `new-message` SyncUpdate.
 *
 * This is the largest variant — the seam owns the decrypt → normalize →
 * apply → cursor-dedup pipeline and applies many storage mutations directly
 * (prompt suggestion, needsContinue, sdkSessionState, session thinking
 * state, latestUserRequestPreview). Side effects whose consumers live
 * elsewhere are emitted as typed events:
 *
 *   - `terminal-signal`: the per-kind dispatch (window-title, notification,
 *     bell, other) becomes a subscriber switch in Sync.
 *   - `task-completed`: web task-complete notification + issue-session link
 *     completion forwarding become subscribers.
 *   - `mutable-tool-observed`: git-status invalidation becomes a subscriber.
 *   - `message-gap`: per-session message refetch becomes a subscriber.
 *
 * The seam continues to call `ctx.applySessions` and `ctx.enqueueMessages`
 * (Sync-class wrappers) for per-session state and the message processor
 * queue — those wrappers carry behaviour the seam cannot replicate via
 * direct `storage.getState()` calls (live-message side-channel handling,
 * scheduled rAF folds). PR 7 may revisit if those wrappers can shrink.
 *
 * Decrypt-failed recovery and session-not-found fallback continue to call
 * `ctx.sessionsSync.forceRefetch()` directly — these are the seam's own
 * recovery primitives, not subscriber concerns.
 */
async function ingestNewMessage(
    update: ApiUpdateContainer,
    body: NewMessageBody,
    ctx: IngestContext,
): Promise<IngestEvent[]> {
    const sessionEncryption = await resolveSessionEncryption(body.sid, ctx);
    if (!sessionEncryption) {
        return [];
    }

    if (!body.message) {
        // No payload to apply (server occasionally sends bare envelopes).
        return [];
    }

    const events: IngestEvent[] = [];

    const [outcome] = await sessionEncryption.decryptMessageOutcomes([
        body.message,
    ]);
    if (!outcome.ok && outcome.reason === "decrypt-failed") {
        // A live decrypt failure almost always means our session key is
        // stale after a reconnect/rotation. Surface it and refetch so the
        // recovered key can re-decrypt — don't mark the message processed.
        // (not-encrypted / missing are benign and fall through below.)
        log.warn(
            `decrypt-failed for live message seq=${outcome.seq} in session ${body.sid}; refetching sessions to recover key (likely key mismatch after reconnect)`,
        );
        ctx.sessionsSync.forceRefetch();
        return events;
    }
    const decrypted = outcome.ok ? outcome.message : null;
    if (!decrypted) {
        // not-encrypted / missing — silently skip.
        return events;
    }

    // ----- prompt-suggestion / needsContinue maintenance -----------------
    if (isUserMessageRaw(decrypted.content)) {
        storage.getState().setPromptSuggestion(body.sid, null);
        storage.getState().setNeedsContinue(body.sid, false);
    }

    const suggestion = extractPromptSuggestionFromRaw(decrypted.content);
    if (suggestion !== null) {
        storage.getState().setPromptSuggestion(body.sid, suggestion);
    }

    if (extractNeedsContinueFromRaw(decrypted.content)) {
        storage.getState().setNeedsContinue(body.sid, true);
    }

    // ----- SDK session state extraction -----------------------------------
    const sdkState = extractSessionStateFromRaw(decrypted.content);
    if (sdkState !== null) {
        const currentSession = storage.getState().sessions[body.sid];
        if (currentSession) {
            ctx.applySessions([
                { ...currentSession, sdkSessionState: sdkState },
            ]);
        }
    }

    // ----- terminal-signal extraction (event-driven dispatch) -------------
    // Live update path only. History replay deliberately skips this (see
    // syncMessageFetch) — re-firing a weeks-old notification on resume
    // would be hostile.
    try {
        const signal = extractTerminalSignalFromRaw(decrypted.content as any);
        if (signal) {
            events.push({ kind: "terminal-signal", sid: body.sid, signal });
        }
    } catch (err) {
        log.log(`[terminal-signal] extract failed: ${err}`);
    }

    // ----- normalize the message into the App's NormalizedMessage shape ---
    const lastMessage: NormalizedMessage | null = normalizeRawMessage(
        decrypted.id,
        decrypted.localId,
        decrypted.createdAt,
        decrypted.content,
    );

    // [stream-perf] dev-only delta-arrival tracking
    if (
        __DEV__ &&
        lastMessage?.role === "agent" &&
        lastMessage.content[0]?.type === "text-delta"
    ) {
        const now = Date.now();
        _perfDeltaCount++;
        if (_perfLastDeltaAt > 0) {
            const interval = now - _perfLastDeltaAt;
            if (
                interval > 200 ||
                (_perfDeltaCount % 20 === 0 && now - _perfDeltaLogAt > 1000)
            ) {
                console.log(
                    `[stream-perf] delta-arrival: interval=${interval}ms, total=${_perfDeltaCount}`,
                );
                _perfDeltaLogAt = now;
            }
        }
        _perfLastDeltaAt = now;
    } else if (
        lastMessage?.role !== "agent" ||
        lastMessage?.content[0]?.type !== "text-delta"
    ) {
        if (_perfDeltaCount > 0 && __DEV__) {
            console.log(
                `[stream-perf] delta-stream ended: total=${_perfDeltaCount} deltas`,
            );
        }
        _perfDeltaCount = 0;
        _perfLastDeltaAt = 0;
    }

    // ----- task lifecycle detection (turn-start / turn-end) ---------------
    // The tangled per-Provider discriminator logic lives behind the pure
    // `classifyTurnLifecycle` seam (turnLifecycleClassify.ts), exhaustively
    // tested there; this handler only reacts to the verdict.
    const rawContent = decrypted.content as RawLifecycleContent;
    const { isTaskStarted, isTaskComplete } = classifyTurnLifecycle(rawContent);

    if (isTaskComplete || isTaskStarted) {
        log.log(
            `🔄 [Sync] Updating thinking state: isTaskComplete=${isTaskComplete}, isTaskStarted=${isTaskStarted}`,
        );
    }

    // ----- session update with thinking state + previews ------------------
    const session = storage.getState().sessions[body.sid];
    if (session) {
        ctx.applySessions([
            {
                ...session,
                updatedAt: update.createdAt,
                seq: update.seq,
                ...(lastMessage?.role === "user"
                    ? {
                          latestUserRequestPreview: getLatestUserRequestPreview([
                              {
                                  kind: "user-text",
                                  id: lastMessage.id,
                                  realId: null,
                                  localId: lastMessage.localId,
                                  createdAt: lastMessage.createdAt,
                                  text: lastMessage.content.text,
                                  meta: lastMessage.meta,
                              },
                          ]),
                      }
                    : {}),
                ...(isTaskComplete
                    ? {
                          thinking: false,
                          needsAttention: detectNeedsAttention(
                              body.sid,
                              lastMessage,
                          ),
                          thinkingAt: Date.now(),
                          apiRetry: null,
                      }
                    : {}),
                ...(isTaskStarted
                    ? {
                          thinking: true,
                          needsAttention: false,
                          thinkingAt: Date.now(),
                      }
                    : {}),
            },
        ]);

        if (isTaskComplete) {
            events.push({ kind: "task-completed", sid: body.sid });
        }
    } else {
        ctx.sessionsSync.forceRefetch();
    }

    // ----- cursor classify + dedup + apply --------------------------------
    const cursor = ctx.cursor.get(body.sid);
    const incomingSeq = body.message.seq;
    const classification = cursor.classifyIncoming(incomingSeq);

    // Guard against the same WebSocket event being applied twice (e.g.
    // after reconnect or any delivery quirk). The server DB message id is
    // a stable, unique identifier; the cursor caps the dedup set.
    if (cursor.markApplied(body.message.id) === "duplicate") {
        return events;
    }

    if (lastMessage) {
        ctx.enqueueMessages(body.sid, [lastMessage]);

        // advanceTo is the single seq write point (and persists). Echoes
        // (seq <= lastSeq) are non-advancing no-ops inside advanceTo.
        cursor.advanceTo(incomingSeq);

        // Mutable-tool detection — invalidate git status downstream so the
        // App refreshes diff badges. The check itself stays on storage
        // (the mutable-set is per-session state); the event carries only
        // sid because the subscriber only needs that.
        if (
            lastMessage.role === "agent" &&
            lastMessage.content[0] &&
            lastMessage.content[0].type === "tool-result"
        ) {
            const hasMutableTool = storage
                .getState()
                .isMutableToolCall(body.sid, lastMessage.content[0].tool_use_id);
            if (hasMutableTool) {
                events.push({ kind: "mutable-tool-observed", sid: body.sid });
            }
        }
    }

    // ----- gap detection → per-session messages refetch -------------------
    // Echoes (seq <= lastSeq) are NOT gap-fetched — that races with the
    // next socket push and can duplicate (e.g. double "Context was reset"
    // on /clear). Only emit when classification is a real forward gap.
    if (classification === "gap") {
        events.push({ kind: "message-gap", sid: body.sid });
    }

    return events;
}

// ---------------------------------------------------------------------------
// relationship-updated
// ---------------------------------------------------------------------------

function ingestRelationshipUpdated(body: RelationshipUpdatedBody): IngestEvent[] {
    log.log("👥 Received relationship-updated update");

    ingestStorage.getState().applyRelationshipUpdate({
        fromUserId: body.fromUserId,
        toUserId: body.toUserId,
        status: body.status,
        action: body.action,
        fromUser: body.fromUser,
        toUser: body.toUser,
        timestamp: body.timestamp,
    });

    // The original handler invalidated three syncs after applying the
    // relationship change. Emit three stale events so subscribers (wired in
    // Sync constructor) trigger the matching refetches.
    return [
        { kind: "friends-stale" },
        { kind: "friend-requests-stale" },
        { kind: "feed-stale" },
    ];
}

// ---------------------------------------------------------------------------
// new-feed-post
// ---------------------------------------------------------------------------

async function ingestNewFeedPost(
    body: NewFeedPostBody,
    ctx: IngestContext,
): Promise<IngestEvent[]> {
    log.log("📰 Received new-feed-post update");

    const feedItem: FeedItem = {
        id: body.id,
        body: body.body,
        cursor: body.cursor,
        createdAt: body.createdAt,
        repeatKey: body.repeatKey,
        counter: parseInt(body.cursor.substring(2), 10),
    };

    if (
        feedItem.body &&
        (feedItem.body.kind === "friend_request" ||
            feedItem.body.kind === "friend_accepted")
    ) {
        await ctx.assumeUsers([feedItem.body.uid]);

        const users = storage.getState().users;
        const userProfile = users[feedItem.body.uid];
        if (userProfile === null || userProfile === undefined) {
            log.log(
                `📰 Skipping feed item ${feedItem.id} - user ${feedItem.body.uid} not found`,
            );
            return [];
        }
    }

    ingestStorage.getState().applyFeedItems([feedItem]);

    return [];
}

// ---------------------------------------------------------------------------
// kv-batch-update
// ---------------------------------------------------------------------------

async function ingestKvBatchUpdate(
    body: KvBatchUpdateBody,
): Promise<IngestEvent[]> {
    log.log("📋 Received kv-batch-update");

    const issueSessionChanges = body.changes.filter((c: { key: string }) =>
        isIssueSessionKey(c.key),
    );
    if (issueSessionChanges.length > 0) {
        await issueSessionStore.getState().handleKvUpdate(issueSessionChanges);
    }

    const researchConfigChanges = body.changes
        .filter((c: { key: string }) => c.key.startsWith(RESEARCH_CONFIG_PREFIX))
        .map((c: { key: string; value: string | null; version: number }) => ({
            projectId: c.key.slice(RESEARCH_CONFIG_PREFIX.length),
            value: c.value,
            version: c.version,
        }));

    if (researchConfigChanges.length === 0) {
        return [];
    }
    return [{ kind: "research-config-changed", changes: researchConfigChanges }];
}
