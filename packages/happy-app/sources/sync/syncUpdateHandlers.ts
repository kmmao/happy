import { Platform } from "react-native";
import { storage } from "./storage";
import { log } from "@/log";
import {
    normalizeRawMessage,
    extractPromptSuggestionFromRaw,
    extractNeedsContinueFromRaw,
    type NormalizedMessage,
} from "./typesRaw";
import type { Session, Machine } from "./storageTypes";
import type { Encryption } from "./encryption/encryption";
import type { SessionEncryption } from "./encryption/sessionEncryption";
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
import { projectManager } from "./projectManager";
import { removeWorktree } from "./gitWorktreeOps";
import { issueSessionStore } from "./issueSessionStore";
import { isIssueSessionKey } from "./issueSessionTypes";
import {
    handleIssueSessionCompletion as issueHandleCompletion,
} from "./syncIssueHandlers";
import { deleteMessageCache } from "./messageCache";
import { detectNeedsAttention } from "./syncHelpers";
import { voiceHooks } from "@/realtime/hooks/voiceHooks";
import { t } from "@/text";
import { getSessionName } from "@/utils/sessionUtils";
import {
    notifyTaskComplete,
    notifyPermissionRequest,
    clearNotifiedRequests,
} from "@/utils/webNotification";

import type { ApiUpdateContainerSchema } from "./apiTypes";
import type { z } from "zod";

type UpdateData = z.infer<typeof ApiUpdateContainerSchema>;

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
    onSessionVisible: (sessionId: string) => void;
    sessionLastSeq: Map<string, number>;
    saveLastSeq: (sessionId: string, seq: number) => void;
    deleted404Sessions: Set<string>;
    messagesSync: Map<string, { stop: () => void }>;
    sendSync: Map<string, { stop: () => void }>;
    pendingOutbox: Map<string, unknown[]>;
    deleteLastSeq: (sessionId: string) => void;
    sessionMessageLocks: Map<string, unknown>;
    sessionMessageQueue: Map<string, unknown[]>;
    sessionQueueProcessing: Set<string>;
    artifactsSync: { invalidate: () => void };
    friendsSync: { invalidate: () => void };
    friendRequestsSync: { invalidate: () => void };
    feedSync: { invalidate: () => void };
    projectsSync: { invalidate: () => void };
    sessionsSync: { invalidate: () => void };
    assumeUsers: (userIds: string[]) => Promise<void>;
};

// ---------------------------------------------------------------------------
// new-message
// ---------------------------------------------------------------------------
export async function handleNewMessageUpdate(
    updateData: UpdateData,
    body: Extract<UpdateData["body"], { t: "new-message" }>,
    ctx: UpdateHandlerContext,
): Promise<void> {
    // Get encryption
    const encryption = ctx.encryption.getSessionEncryption(body.sid);
    if (!encryption) {
        console.error(`Session ${body.sid} not found`);
        ctx.fetchSessions();
        return;
    }

    // Decrypt message
    let lastMessage: NormalizedMessage | null = null;
    if (body.message) {
        const decrypted = await encryption.decryptMessage(body.message);
        if (decrypted) {
            // Extract prompt suggestion before normalizing
            const suggestion = extractPromptSuggestionFromRaw(decrypted.content);
            if (suggestion !== null) {
                storage.getState().setPromptSuggestion(body.sid, suggestion);
            }

            // Extract needs-continue signal
            if (extractNeedsContinueFromRaw(decrypted.content)) {
                storage.getState().setNeedsContinue(body.sid, true);
            }

            lastMessage = normalizeRawMessage(
                decrypted.id,
                decrypted.localId,
                decrypted.createdAt,
                decrypted.content,
            );

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

            // Apply current message immediately
            const currentLastSeq = ctx.sessionLastSeq.get(body.sid);
            const incomingSeq = body.message.seq;
            const isConsecutive =
                lastMessage &&
                currentLastSeq !== undefined &&
                incomingSeq === currentLastSeq + 1;

            if (lastMessage) {
                ctx.enqueueMessages(body.sid, [lastMessage]);

                if (currentLastSeq === undefined || incomingSeq > currentLastSeq) {
                    ctx.sessionLastSeq.set(body.sid, incomingSeq);
                    ctx.saveLastSeq(body.sid, incomingSeq);
                }

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

            // If seq is non-consecutive, also fetch missing messages from server
            if (!isConsecutive) {
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

    // Remove from project manager
    projectManager.removeSession(sessionId);

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

    // Clear any cached git status and remaining state
    gitStatusSync.clearForSession(sessionId);
    ctx.pendingOutbox.delete(sessionId);
    ctx.sessionLastSeq.delete(sessionId);
    ctx.deleteLastSeq(sessionId);
    deleteMessageCache(sessionId);
    ctx.sessionMessageLocks.delete(sessionId);
    ctx.sessionMessageQueue.delete(sessionId);
    ctx.sessionQueueProcessing.delete(sessionId);

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
    const session = storage.getState().sessions[body.id];
    if (!session) return;

    const sessionEncryption = ctx.encryption.getSessionEncryption(body.id);
    if (!sessionEncryption) {
        console.error(
            `Session encryption not found for ${body.id} - this should never happen`,
        );
        return;
    }

    const agentState =
        body.agentState && sessionEncryption
            ? await sessionEncryption.decryptAgentState(
                body.agentState.version,
                body.agentState.value,
            )
            : session.agentState;
    const metadata =
        body.metadata && sessionEncryption
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

    ctx.applySessions([
        {
            ...session,
            agentState,
            agentStateVersion: body.agentState
                ? body.agentState.version
                : session.agentStateVersion,
            metadata,
            metadataVersion: body.metadata
                ? body.metadata.version
                : session.metadataVersion,
            preferencesVersion: preferencesData
                ? preferencesData.version
                : session.preferencesVersion,
            ...(preferences
                ? {
                    permissionMode: preferences.permissionMode,
                    modelMode: preferences.modelMode,
                    customModels: preferences.customModels,
                    modelMappings: preferences.modelMappings,
                    profileId: preferences.profileId,
                    profileName: preferences.profileName,
                    thinkingMode: preferences.thinkingMode,
                    thinkingBudget: preferences.thinkingBudget,
                    effortLevel: preferences.effortLevel,
                    maxBudgetUsd: preferences.maxBudgetUsd,
                }
                : {}),
            updatedAt: updateData.createdAt,
            seq: updateData.seq,
        },
    ]);

    // Invalidate git status when agent state changes
    if (body.agentState) {
        gitStatusSync.invalidate(body.id);

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
                console.warn(
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
            console.error("❌ Failed to process settings update:", error);
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
        metadata: machine?.metadata ?? null,
        metadataVersion: machine?.metadataVersion ?? 0,
        daemonState: machine?.daemonState ?? null,
        daemonStateVersion: machine?.daemonStateVersion ?? 0,
    };

    const machineEncryption = ctx.encryption.getMachineEncryption(machineId);
    if (!machineEncryption) {
        console.error(
            `Machine encryption not found for ${machineId} - cannot decrypt updates`,
        );
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
            console.error(
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
            console.error(
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
            console.error(`Failed to decrypt key for new artifact ${artifactId}`);
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
        console.error(`Failed to process new artifact ${artifactId}:`, error);
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
        console.error(`Artifact ${artifactId} not found in storage`);
        ctx.artifactsSync.invalidate();
        return;
    }

    try {
        let dataEncryptionKey = ctx.artifactDataKeys.get(artifactId);
        if (!dataEncryptionKey) {
            console.error(
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
        console.error(
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
