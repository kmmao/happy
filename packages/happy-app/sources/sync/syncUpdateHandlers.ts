import { Platform } from "react-native";
import { storage } from "./storage";
import { log } from "@/log";
import {
    normalizeRawMessage,
    extractPromptSuggestionFromRaw,
    extractNeedsContinueFromRaw,
    extractSessionStateFromRaw,
    isUserMessageRaw,
    type NormalizedMessage,
} from "./typesRaw";
import type { Session, Machine } from "./storageTypes";
import type { Encryption } from "./encryption/encryption";
import type { SessionMessageCursor } from "./sessionMessageCursor";
import { ArtifactEncryption } from "./encryption/artifactEncryption";
import type { DecryptedArtifact } from "./artifactTypes";
import type { FeedItem } from "./feedTypes";
import { Profile, profileParse } from "./profile";
import {
    applySettings,
    Settings,
    settingsDefaults,
    settingsParse,
    SUPPORTED_SCHEMA_VERSION,
} from "./settings";
import { gitStatusSync } from "./gitStatusSync";
import { disposeSessionScopedState } from "./sessionScopedStore";
import { removeWorktree } from "./gitWorktreeOps";
import { issueSessionStore } from "./issueSessionStore";
import { isIssueSessionKey } from "./issueSessionTypes";
import {
    handleIssueSessionCompletion as issueHandleCompletion,
} from "./syncIssueHandlers";
import { deleteMessageCache, deleteHistoryComplete } from "./messageCache";
import { deleteBackfillBoundary } from "./persistence";
import { detectNeedsAttention } from "./syncHelpers";
import { mergeUpdatedSession } from "./updateSessionMerge";
import { resolveSessionEncryption, resolveMachineEncryption } from "./syncEncryptionScope";
import { voiceHooks } from "@/realtime/hooks/voiceHooks";
import { t } from "@/text";
import { getSessionName } from "@/utils/sessionUtils";
import { getLatestUserRequestPreview } from "@/utils/sessionUtils";
import {
    notifyTaskComplete,
    notifyPermissionRequest,
    clearNotifiedRequests,
} from "@/utils/webNotification";

import type { ApiUpdateContainer } from "./apiTypes";

type UpdateData = ApiUpdateContainer;

/**
 * Context needed by update handlers to access sync state.
 * Passed from the Sync class to avoid tight coupling.
 */
export type UpdateHandlerContext = {
    encryption: Encryption;
    artifactDataKeys: Map<string, Uint8Array>;
    applySessions: (
        sessions: (Omit<Session, "presence"> & { presence?: "online" | number })[],
        replace?: boolean,
    ) => void;
    enqueueMessages: (sessionId: string, messages: NormalizedMessage[]) => void;
    getMessagesSync: (sessionId: string) => { invalidate: () => void } | null;
    fetchSessions: () => void;
    fetchMachines: () => void;
    onSessionVisible: (sessionId: string) => void;
    /** The single owner of per-session seq + live dedup. */
    getCursor: (sessionId: string) => SessionMessageCursor;
    deleteCursor: (sessionId: string) => void;
    deleted404Sessions: Set<string>;
    messagesSync: Map<string, { stop: () => void }>;
    sendSync: Map<string, { stop: () => void }>;
    pendingOutbox: Map<string, unknown[]>;
    deleteLastSeq: (sessionId: string) => void;
    /** Fully release the message processor's per-session queue, lock, and flags. */
    releaseMessageProcessing: (sessionId: string) => void;
    artifactsSync: { invalidate: () => void };
    friendsSync: { invalidate: () => void };
    friendRequestsSync: { invalidate: () => void };
    feedSync: { invalidate: () => void };
    projectsSync: { invalidate: () => void };
    sessionsSync: { invalidate: () => void; awaitQueue: () => Promise<void> };
    machinesSync: { invalidate: () => void; awaitQueue: () => Promise<void> };
    assumeUsers: (userIds: string[]) => Promise<void>;
};

// [stream-perf] delta arrival interval tracking
let _perfLastDeltaAt = 0;
let _perfDeltaCount = 0;
let _perfDeltaLogAt = 0;

// ---------------------------------------------------------------------------
// new-message
// ---------------------------------------------------------------------------
export async function handleNewMessageUpdate(
    updateData: UpdateData,
    body: Extract<UpdateData["body"], { t: "new-message" }>,
    ctx: UpdateHandlerContext,
): Promise<void> {
    // resolveSessionEncryption owns the #84 startup-race + refetch-recovery
    // invariant (shared with update-session and update-machine).
    const encryption = await resolveSessionEncryption(body.sid, ctx);
    if (!encryption) {
        return;
    }

    // Decrypt message
    let lastMessage: NormalizedMessage | null = null;
    if (body.message) {
        const [outcome] = await encryption.decryptMessageOutcomes([body.message]);
        if (!outcome.ok && outcome.reason === "decrypt-failed") {
            // A live decrypt failure almost always means our session key is stale
            // after a reconnect/rotation. Surface it and refetch so the recovered
            // key can re-decrypt — don't mark the message processed.
            // (not-encrypted / missing are benign and fall through below.)
            log.warn(
                `decrypt-failed for live message seq=${outcome.seq} in session ${body.sid}; refetching sessions to recover key (likely key mismatch after reconnect)`,
            );
            ctx.fetchSessions();
            return;
        }
        const decrypted = outcome.ok ? outcome.message : null;
        if (decrypted) {
            // Keep prompt suggestion / needsContinue in sync for multi-device history and live updates.
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

            // Extract SDK session state (idle/running/requires_action)
            const sdkState = extractSessionStateFromRaw(decrypted.content);
            if (sdkState !== null) {
                const currentSession = storage.getState().sessions[body.sid];
                if (currentSession) {
                    ctx.applySessions([
                        {
                            ...currentSession,
                            sdkSessionState: sdkState,
                        },
                    ]);
                }
            }

            lastMessage = normalizeRawMessage(
                decrypted.id,
                decrypted.localId,
                decrypted.createdAt,
                decrypted.content,
            );

            // [stream-perf] Track text-delta arrival intervals
            if (__DEV__ && lastMessage?.role === "agent" && lastMessage.content[0]?.type === "text-delta") {
                const now = Date.now();
                _perfDeltaCount++;
                if (_perfLastDeltaAt > 0) {
                    const interval = now - _perfLastDeltaAt;
                    // Log every 20 deltas or if interval is unusually large
                    if (interval > 200 || (_perfDeltaCount % 20 === 0 && now - _perfDeltaLogAt > 1000)) {
                        console.log(`[stream-perf] delta-arrival: interval=${interval}ms, total=${_perfDeltaCount}`);
                        _perfDeltaLogAt = now;
                    }
                }
                _perfLastDeltaAt = now;
            } else if (lastMessage?.role !== "agent" || lastMessage?.content[0]?.type !== "text-delta") {
                // Reset on non-delta messages
                if (_perfDeltaCount > 0 && __DEV__) {
                    console.log(`[stream-perf] delta-stream ended: total=${_perfDeltaCount} deltas`);
                }
                _perfDeltaCount = 0;
                _perfLastDeltaAt = 0;
            }

            // Check for task lifecycle events to update thinking state
            const rawContent = decrypted.content as {
                role?: string;
                content?: {
                    type?: string;
                    data?: {
                        type?: string;
                        ev?: { t?: string };
                    };
                    ev?: { t?: string };
                };
            } | null;
            const contentType = rawContent?.content?.type;
            const dataType = rawContent?.content?.data?.type;
            const sessionEventType = rawContent?.content?.data?.ev?.t;
            const envelopeEventType = rawContent?.content?.ev?.t;

            if (
                dataType === "task_complete" ||
                dataType === "turn_aborted" ||
                dataType === "task_started" ||
                sessionEventType === "turn-start" ||
                sessionEventType === "turn-end" ||
                envelopeEventType === "turn-start" ||
                envelopeEventType === "turn-end"
            ) {
                log.log(
                    `🔄 [Sync] Lifecycle event detected: contentType=${contentType}, dataType=${dataType}, sessionEventType=${sessionEventType}, role=${rawContent?.role}, envelopeEventType=${envelopeEventType}`,
                );
            }

            const isSessionProtocolEvent = rawContent?.role === "session";

            const isTaskComplete =
                ((contentType === "acp" || contentType === "codex") &&
                    (dataType === "task_complete" || dataType === "turn_aborted")) ||
                (contentType === "session" && sessionEventType === "turn-end") ||
                (isSessionProtocolEvent && envelopeEventType === "turn-end");

            const isTaskStarted =
                ((contentType === "acp" || contentType === "codex") &&
                    dataType === "task_started") ||
                (contentType === "session" && sessionEventType === "turn-start") ||
                (isSessionProtocolEvent && envelopeEventType === "turn-start");

            if (isTaskComplete || isTaskStarted) {
                log.log(
                    `🔄 [Sync] Updating thinking state: isTaskComplete=${isTaskComplete}, isTaskStarted=${isTaskStarted}`,
                );
            }

            // Update session
            const session = storage.getState().sessions[body.sid];
            if (session) {
                ctx.applySessions([
                    {
                        ...session,
                        updatedAt: updateData.createdAt,
                        seq: updateData.seq,
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
                                needsAttention: detectNeedsAttention(body.sid, lastMessage),
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
                    // Web browser notification for task completion
                    if (
                        Platform.OS === "web" &&
                        storage.getState().settings.webNotifications
                    ) {
                        const settings = storage.getState().settings;
                        const sessionName = getSessionName(session);
                        notifyTaskComplete(
                            sessionName,
                            body.sid,
                            t("webNotification.taskComplete"),
                            settings.webNotificationsPersistent,
                        );
                    }

                    const link = issueSessionStore
                        .getState()
                        .findBySessionId(body.sid);
                    log.log(
                        `🔄 [IssueSession] turn-end: sid=${body.sid}, link=${link ? `${link.issueKey}(${link.status})` : "NONE"}`,
                    );
                    if (link && link.status === "processing") {
                        void issueHandleCompletion(link);
                    }
                }
            } else {
                ctx.fetchSessions();
            }

            // Apply current message immediately. The per-session cursor owns
            // seq + dedup; classification decides apply-direct vs gap-fetch.
            const cursor = ctx.getCursor(body.sid);
            const incomingSeq = body.message.seq;
            const classification = cursor.classifyIncoming(incomingSeq);

            // Guard against the same WebSocket event being applied twice (e.g.
            // after reconnect or any delivery quirk). The server DB message id is
            // a stable, unique identifier; the cursor caps the dedup set.
            if (cursor.markApplied(body.message.id) === "duplicate") {
                return;
            }

            if (lastMessage) {
                ctx.enqueueMessages(body.sid, [lastMessage]);

                // advanceTo is the single seq write point (and persists). Echoes
                // (seq <= lastSeq) are non-advancing no-ops inside advanceTo.
                cursor.advanceTo(incomingSeq);

                // Check for mutable tool calls to refresh git status
                let hasMutableTool = false;
                if (
                    lastMessage.role === "agent" &&
                    lastMessage.content[0] &&
                    lastMessage.content[0].type === "tool-result"
                ) {
                    hasMutableTool = storage
                        .getState()
                        .isMutableToolCall(body.sid, lastMessage.content[0].tool_use_id);
                }
                if (hasMutableTool) {
                    gitStatusSync.invalidate(body.sid);
                }
            }

            // If seq is a gap (missed messages), fetch the missing ones. We do
            // NOT fetch on an echo (already received via POST ack or earlier
            // fetch) — that races with the next socket push and can duplicate
            // (e.g. double "Context was reset" on /clear).
            if (classification === "gap") {
                ctx.getMessagesSync(body.sid)?.invalidate();
            }
        }
    }
}

// ---------------------------------------------------------------------------
// delete-session
// ---------------------------------------------------------------------------
export function handleDeleteSessionUpdate(
    body: Extract<UpdateData["body"], { t: "delete-session" }>,
    ctx: UpdateHandlerContext,
): void {
    log.log("🗑️ Delete session update received");
    const sessionId = body.sid;

    // Update any issue-session link associated with this session
    const issueLink = issueSessionStore.getState().findBySessionId(sessionId);
    if (issueLink && issueLink.status === "processing") {
        void issueSessionStore
            .getState()
            .updateStatus(issueLink.issueKey, "cancelled")
            .catch(() => {
                // Best-effort
            });
    }

    // Clean up worktree if this was a worktree session
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

    // Remove session from storage
    storage.getState().deleteSession(sessionId);

    // Remove from 404 guard if present
    ctx.deleted404Sessions.delete(sessionId);

    // Remove encryption keys from memory
    ctx.encryption.removeSessionEncryption(sessionId);

    disposeSessionScopedState(sessionId);

    // Stop and clean up syncs
    const msgSync = ctx.messagesSync.get(sessionId);
    if (msgSync) {
        msgSync.stop();
        ctx.messagesSync.delete(sessionId);
    }
    const sndSync = ctx.sendSync.get(sessionId);
    if (sndSync) {
        sndSync.stop();
        ctx.sendSync.delete(sessionId);
    }

    // Clear remaining sync-local state
    ctx.pendingOutbox.delete(sessionId);
    ctx.deleteCursor(sessionId);
    ctx.deleteLastSeq(sessionId);
    deleteBackfillBoundary(sessionId);
    deleteMessageCache(sessionId);
    deleteHistoryComplete(sessionId);
    ctx.releaseMessageProcessing(sessionId);

    log.log(`🗑️ Session ${sessionId} deleted from local storage`);
}

// ---------------------------------------------------------------------------
// update-session
// ---------------------------------------------------------------------------
export async function handleUpdateSessionUpdate(
    updateData: UpdateData,
    body: Extract<UpdateData["body"], { t: "update-session" }>,
    ctx: UpdateHandlerContext,
): Promise<void> {
    // update-session needs the encryptor AND the session row. fetchSessions
    // registers the encryptor (initializeSessions) BEFORE it writes the row
    // (applySessions), so gating on encryption alone would drop a push that
    // arrives mid-sync; resolving both together makes it await the sync (#80).
    const sessionEncryption = await resolveSessionEncryption(
        body.id,
        ctx,
        () => !!storage.getState().sessions[body.id],
    );
    if (!sessionEncryption) {
        return;
    }
    const session = storage.getState().sessions[body.id];
    if (!session) {
        // Defensive: row removed between resolution and read (concurrent delete).
        ctx.fetchSessions();
        return;
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

    // Decrypt preferences if included in the update
    const preferencesData = body.preferences;
    const preferences = preferencesData?.value
        ? await sessionEncryption.decryptPreferences(preferencesData.value)
        : null;

    const {
        updatedSession,
        metadataDecryptFailed,
    } = mergeUpdatedSession({
        session,
        seq: updateData.seq,
        updatedAt: updateData.createdAt,
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
        ctx.fetchSessions();
    }

    ctx.applySessions([
        updatedSession,
    ]);

    if (body.agentState) {
        // Check for new permission requests and notify voice assistant
        if (agentState?.requests && Object.keys(agentState.requests).length > 0) {
            const requestIds = Object.keys(agentState.requests);
            const firstRequest = agentState.requests[requestIds[0]];
            const toolName = firstRequest?.tool;
            voiceHooks.onPermissionRequested(
                body.id,
                requestIds[0],
                toolName,
                firstRequest?.arguments,
            );

            // Web browser notification for permission request
            if (
                Platform.OS === "web" &&
                storage.getState().settings.webNotifications
            ) {
                const permSession = storage.getState().sessions[body.id];
                if (permSession) {
                    const sessionName = getSessionName(permSession);
                    notifyPermissionRequest(
                        sessionName,
                        body.id,
                        requestIds[0],
                        toolName,
                        t("webNotification.permissionRequest"),
                        storage.getState().settings.webNotificationsPersistent,
                    );
                }
            }
        } else if (Platform.OS === "web") {
            // Permissions resolved -- clear notified request IDs
            const prevRequests = session.agentState?.requests;
            if (prevRequests && Object.keys(prevRequests).length > 0) {
                clearNotifiedRequests(Object.keys(prevRequests));
            }
        }

        // Re-fetch messages when control returns to mobile
        const wasControlledByUser = session.agentState?.controlledByUser;
        const isNowControlledByUser = agentState?.controlledByUser;
        if (!wasControlledByUser && isNowControlledByUser) {
            log.log(
                `🔄 Control returned to mobile for session ${body.id}, re-fetching messages`,
            );
            ctx.onSessionVisible(body.id);
        }
    }
}

// ---------------------------------------------------------------------------
// update-account
// ---------------------------------------------------------------------------
export async function handleUpdateAccountUpdate(
    updateData: UpdateData,
    body: Extract<UpdateData["body"], { t: "update-account" }>,
    ctx: UpdateHandlerContext,
): Promise<void> {
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
        timestamp: updateData.createdAt,
    };

    storage.getState().applyProfile(updatedProfile);

    // Handle settings updates
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
        } catch (error) {
            log.error("❌ Failed to process settings update:", error);
        }
    }
}

// ---------------------------------------------------------------------------
// update-machine
// ---------------------------------------------------------------------------
export async function handleUpdateMachineUpdate(
    updateData: UpdateData,
    body: Extract<UpdateData["body"], { t: "update-machine" }>,
    ctx: UpdateHandlerContext,
): Promise<void> {
    const machineId = body.machineId;
    const machine = storage.getState().machines[machineId];

    const updatedMachine: Machine = {
        id: machineId,
        seq: updateData.seq,
        createdAt: machine?.createdAt ?? updateData.createdAt,
        updatedAt: updateData.createdAt,
        active: body.active ?? true,
        activeAt: body.activeAt ?? updateData.createdAt,
        rpcReady: machine?.rpcReady ?? false,
        metadata: machine?.metadata ?? null,
        metadataVersion: machine?.metadataVersion ?? 0,
        daemonState: machine?.daemonState ?? null,
        daemonStateVersion: machine?.daemonStateVersion ?? 0,
    };

    // resolveMachineEncryption applies the same startup-race + refetch-recovery
    // invariant the session handlers use. Previously update-machine had no
    // awaitQueue/refetch and silently dropped a raced update.
    const machineEncryption = await resolveMachineEncryption(machineId, ctx);
    if (!machineEncryption) {
        return;
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

    storage.getState().applyMachines([updatedMachine]);
}

// ---------------------------------------------------------------------------
// relationship-updated
// ---------------------------------------------------------------------------
export function handleRelationshipUpdate(
    body: Extract<UpdateData["body"], { t: "relationship-updated" }>,
    ctx: UpdateHandlerContext,
): void {
    log.log("👥 Received relationship-updated update");

    storage.getState().applyRelationshipUpdate({
        fromUserId: body.fromUserId,
        toUserId: body.toUserId,
        status: body.status,
        action: body.action,
        fromUser: body.fromUser,
        toUser: body.toUser,
        timestamp: body.timestamp,
    });

    ctx.friendsSync.invalidate();
    ctx.friendRequestsSync.invalidate();
    ctx.feedSync.invalidate();
}

// ---------------------------------------------------------------------------
// new-artifact
// ---------------------------------------------------------------------------
export async function handleNewArtifactUpdate(
    body: Extract<UpdateData["body"], { t: "new-artifact" }>,
    ctx: UpdateHandlerContext,
): Promise<void> {
    log.log("📦 Received new-artifact update");
    const artifactId = body.artifactId;

    try {
        const decryptedKey = await ctx.encryption.decryptEncryptionKey(
            body.dataEncryptionKey,
        );
        if (!decryptedKey) {
            log.error(`Failed to decrypt key for new artifact ${artifactId}`);
            return;
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
}

// ---------------------------------------------------------------------------
// update-artifact
// ---------------------------------------------------------------------------
export async function handleUpdateArtifactUpdate(
    updateData: UpdateData,
    body: Extract<UpdateData["body"], { t: "update-artifact" }>,
    ctx: UpdateHandlerContext,
): Promise<void> {
    log.log("📦 Received update-artifact update");
    const artifactId = body.artifactId;

    const existingArtifact = storage.getState().artifacts[artifactId];
    if (!existingArtifact) {
        log.error(`Artifact ${artifactId} not found in storage`);
        ctx.artifactsSync.invalidate();
        return;
    }

    try {
        let dataEncryptionKey = ctx.artifactDataKeys.get(artifactId);
        if (!dataEncryptionKey) {
            log.error(
                `Encryption key not found for artifact ${artifactId}, fetching artifacts`,
            );
            ctx.artifactsSync.invalidate();
            return;
        }

        const artifactEncryption = new ArtifactEncryption(dataEncryptionKey);

        const updatedArtifact: DecryptedArtifact = {
            ...existingArtifact,
            seq: updateData.seq,
            updatedAt: updateData.createdAt,
        };

        if (body.header) {
            const header = await artifactEncryption.decryptHeader(
                body.header.value,
            );
            updatedArtifact.title = header?.title || null;
            updatedArtifact.sessions = header?.sessions;
            updatedArtifact.draft = header?.draft;
            updatedArtifact.headerVersion = body.header.version;
        }

        if (body.body) {
            const bodyResult = await artifactEncryption.decryptBody(
                body.body.value,
            );
            updatedArtifact.body = bodyResult?.body || null;
            updatedArtifact.bodyVersion = body.body.version;
        }

        storage.getState().updateArtifact(updatedArtifact);
        log.log(`📦 Updated artifact ${artifactId} in storage`);
    } catch (error) {
        log.error(
            `Failed to process artifact update ${artifactId}:`,
            error,
        );
    }
}

// ---------------------------------------------------------------------------
// delete-artifact
// ---------------------------------------------------------------------------
export function handleDeleteArtifactUpdate(
    body: Extract<UpdateData["body"], { t: "delete-artifact" }>,
    ctx: UpdateHandlerContext,
): void {
    log.log("📦 Received delete-artifact update");
    const artifactId = body.artifactId;

    storage.getState().deleteArtifact(artifactId);
    ctx.artifactDataKeys.delete(artifactId);
}

// ---------------------------------------------------------------------------
// new-feed-post
// ---------------------------------------------------------------------------
export async function handleNewFeedPostUpdate(
    body: Extract<UpdateData["body"], { t: "new-feed-post" }>,
    ctx: UpdateHandlerContext,
): Promise<void> {
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
            return;
        }
    }

    storage.getState().applyFeedItems([feedItem]);
}

// ---------------------------------------------------------------------------
// kv-batch-update
// ---------------------------------------------------------------------------

const RESEARCH_CONFIG_PREFIX = "researchConfig/";

export interface ResearchConfigChange {
    projectId: string;
    value: string | null;
    version: number;
}

export async function handleKvBatchUpdate(
    body: Extract<UpdateData["body"], { t: "kv-batch-update" }>,
): Promise<{ researchConfigChanges: ResearchConfigChange[] }> {
    log.log("📋 Received kv-batch-update");

    const issueSessionChanges = body.changes.filter(
        (c: { key: string }) => isIssueSessionKey(c.key),
    );
    if (issueSessionChanges.length > 0) {
        await issueSessionStore.getState().handleKvUpdate(issueSessionChanges);
    }

    const researchConfigChanges: ResearchConfigChange[] = body.changes
        .filter((c: { key: string }) => c.key.startsWith(RESEARCH_CONFIG_PREFIX))
        .map((c: { key: string; value: string | null; version: number }) => ({
            projectId: c.key.slice(RESEARCH_CONFIG_PREFIX.length),
            value: c.value,
            version: c.version,
        }));

    return { researchConfigChanges };
}

// ---------------------------------------------------------------------------
// project events
// ---------------------------------------------------------------------------
export function handleProjectUpdate(
    body: { t: "new-project" | "update-project" | "delete-project" },
    ctx: UpdateHandlerContext,
): void {
    log.log(`📁 Received ${body.t} event`);
    ctx.projectsSync.invalidate();
}
