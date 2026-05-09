import { sessionAliveEventsCounter, websocketEventsCounter } from "@/app/monitoring/metrics2";
import { activityCache } from "@/app/presence/sessionCache";
import {
    buildNewMessageUpdate,
    buildSessionActivityEphemeral,
    buildTaskStatusChangedEphemeral,
    buildUpdateSessionUpdate,
    ClientConnection,
    eventRouter,
} from "@/app/events/eventRouter";
import { inboxCreate } from "@/modules/inboxCreate";
import { db } from "@/storage/db";
import { allocateSessionSeq, allocateUserSeq } from "@/storage/seq";
import { AsyncLock } from "@/utils/lock";
import { debug, log } from "@/utils/log";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { Socket } from "socket.io";

/**
 * Look up the git branch for a session that was started in a worktree.
 * Reads the `session_start` event detail emitted by the CLI when it detects
 * a Happy-managed git worktree. Returns null when not in a worktree.
 */
async function getSessionWorktreeBranch(sessionId: string): Promise<string | null> {
    const event = await db.sessionEvent.findFirst({
        where: { sessionId, eventType: "session_start" },
        orderBy: { createdAt: "asc" },
        select: { detail: true },
    });
    const detail = event?.detail as Record<string, unknown> | null;
    const branch = detail?.branch;
    return typeof branch === "string" ? branch : null;
}

export function sessionUpdateHandler(userId: string, socket: Socket, connection: ClientConnection) {
    socket.on('update-metadata', async (data: any, callback: (response: any) => void) => {
        try {
            const { sid, metadata, expectedVersion } = data;

            // Validate input
            if (!sid || typeof metadata !== 'string' || typeof expectedVersion !== 'number') {
                if (callback) {
                    callback({ result: 'error' });
                }
                return;
            }

            // Resolve session
            const session = await db.session.findUnique({
                where: { id: sid, accountId: userId }
            });
            if (!session) {
                return;
            }

            // Check version
            if (session.metadataVersion !== expectedVersion) {
                callback({ result: 'version-mismatch', version: session.metadataVersion, metadata: session.metadata });
                return null;
            }

            // Update metadata
            const { count } = await db.session.updateMany({
                where: { id: sid, metadataVersion: expectedVersion },
                data: {
                    metadata: metadata,
                    metadataVersion: expectedVersion + 1
                }
            });
            if (count === 0) {
                callback({ result: 'version-mismatch', version: session.metadataVersion, metadata: session.metadata });
                return null;
            }

            // Generate session metadata update
            const updSeq = await allocateUserSeq(userId);
            const metadataUpdate = {
                value: metadata,
                version: expectedVersion + 1
            };
            const updatePayload = buildUpdateSessionUpdate(sid, updSeq, randomKeyNaked(12), metadataUpdate);
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'all-interested-in-session', sessionId: sid }
            });

            // Send success response with new version via callback
            callback({ result: 'success', version: expectedVersion + 1, metadata: metadata });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in update-metadata: ${error}`);
            if (callback) {
                callback({ result: 'error' });
            }
        }
    });

    socket.on('update-state', async (data: any, callback: (response: any) => void) => {
        try {
            const { sid, agentState, expectedVersion } = data;

            // Validate input
            if (!sid || (typeof agentState !== 'string' && agentState !== null) || typeof expectedVersion !== 'number') {
                if (callback) {
                    callback({ result: 'error' });
                }
                return;
            }

            // Resolve session
            const session = await db.session.findUnique({
                where: {
                    id: sid,
                    accountId: userId
                }
            });
            if (!session) {
                callback({ result: 'error' });
                return null;
            }

            // Check version
            if (session.agentStateVersion !== expectedVersion) {
                callback({ result: 'version-mismatch', version: session.agentStateVersion, agentState: session.agentState });
                return null;
            }

            // Update agent state
            const { count } = await db.session.updateMany({
                where: { id: sid, agentStateVersion: expectedVersion },
                data: {
                    agentState: agentState,
                    agentStateVersion: expectedVersion + 1
                }
            });
            if (count === 0) {
                callback({ result: 'version-mismatch', version: session.agentStateVersion, agentState: session.agentState });
                return null;
            }

            // Generate session agent state update
            const updSeq = await allocateUserSeq(userId);
            const agentStateUpdate = {
                value: agentState,
                version: expectedVersion + 1
            };
            const updatePayload = buildUpdateSessionUpdate(sid, updSeq, randomKeyNaked(12), undefined, agentStateUpdate);
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'all-interested-in-session', sessionId: sid }
            });

            // Send success response with new version via callback
            callback({ result: 'success', version: expectedVersion + 1, agentState: agentState });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in update-state: ${error}`);
            if (callback) {
                callback({ result: 'error' });
            }
        }
    });
    socket.on('session-alive', async (data: {
        sid: string;
        time: number;
        thinking?: boolean;
        apiRetry?: {
            attempt: number;
            maxRetries: number;
            retryDelayMs: number;
            errorStatus: number | null;
        };
    }) => {
        try {
            // Track metrics
            websocketEventsCounter.inc({ event_type: 'session-alive' });
            sessionAliveEventsCounter.inc();

            // Basic validation
            if (!data || typeof data.time !== 'number' || !data.sid) {
                return;
            }

            let t = data.time;
            if (t > Date.now()) {
                t = Date.now();
            }
            if (t < Date.now() - 1000 * 60 * 10) {
                return;
            }

            const { sid, thinking } = data;

            // Check session validity using cache
            const isValid = await activityCache.isSessionValid(sid, userId);
            if (!isValid) {
                return;
            }

            // Queue database update (will only update if time difference is significant)
            activityCache.queueSessionUpdate(sid, t);

            // Emit session activity update (include apiRetry if present)
            const sessionActivity = buildSessionActivityEphemeral(sid, true, t, thinking || false, data.apiRetry);
            eventRouter.emitEphemeral({
                userId,
                payload: sessionActivity,
                recipientFilter: { type: 'user-scoped-only' }
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in session-alive: ${error}`);
        }
    });

    const receiveMessageLock = new AsyncLock();
    socket.on('message', async (data: any) => {
        await receiveMessageLock.inLock(async () => {
            try {
                websocketEventsCounter.inc({ event_type: 'message' });
                const { sid, message, localId } = data;

                debug({ module: 'websocket' }, `Received message from socket ${socket.id}: sessionId=${sid}, messageLength=${message.length} bytes, connectionType=${connection.connectionType}, connectionSessionId=${connection.connectionType === 'session-scoped' ? connection.sessionId : 'N/A'}`);

                // Resolve session
                const session = await db.session.findUnique({
                    where: { id: sid, accountId: userId }
                });
                if (!session) {
                    return;
                }
                let useLocalId = typeof localId === 'string' ? localId : null;

                // Create encrypted message
                const msgContent: PrismaJson.SessionMessageContent = {
                    t: 'encrypted',
                    c: message
                };

                // Resolve seq
                const updSeq = await allocateUserSeq(userId);
                const msgSeq = await allocateSessionSeq(sid);

                // Check if message already exists
                if (useLocalId) {
                    const existing = await db.sessionMessage.findFirst({
                        where: { sessionId: sid, localId: useLocalId }
                    });
                    if (existing) {
                        return { msg: existing, update: null };
                    }
                }

                // Create message
                const msg = await db.sessionMessage.create({
                    data: {
                        sessionId: sid,
                        seq: msgSeq,
                        content: msgContent,
                        localId: useLocalId
                    }
                });

                // Emit new message update to relevant clients
                const updatePayload = buildNewMessageUpdate(msg, sid, updSeq, randomKeyNaked(12));
                eventRouter.emitUpdate({
                    userId,
                    payload: updatePayload,
                    recipientFilter: { type: 'all-interested-in-session', sessionId: sid },
                    skipSenderConnection: connection
                });
            } catch (error) {
                log({ module: 'websocket', level: 'error' }, `Error in message handler: ${error}`);
            }
        });
    });

    socket.on('session-end', async (data: {
        sid: string;
        time: number;
    }) => {
        try {
            const { sid, time } = data;
            let t = time;
            if (typeof t !== 'number') {
                return;
            }
            if (t > Date.now()) {
                t = Date.now();
            }
            if (t < Date.now() - 1000 * 60 * 10) { // Ignore if time is in the past 10 minutes
                return;
            }

            // Resolve session
            const session = await db.session.findUnique({
                where: { id: sid, accountId: userId }
            });
            if (!session) {
                return;
            }

            // Update last active at
            await db.session.update({
                where: { id: sid },
                data: { lastActiveAt: new Date(t), active: false }
            });

            // Evict from cache so heartbeats are immediately rejected
            activityCache.invalidateSession(sid);

            // Any task bound to this session that never received a terminal task-status
            // (e.g. lost socket event) would otherwise stay "running"; session-end is a
            // reliable signal that the CLI session is done, so converge task state here.
            const inProgressTasks = await db.task.findMany({
                where: {
                    accountId: userId,
                    sessionId: sid,
                    status: { in: ["running", "dispatching"] },
                },
            });
            const completedAt = new Date();
            // Look up worktree branch once for all tasks in this session
            const worktreeBranch = inProgressTasks.length > 0
                ? await getSessionWorktreeBranch(sid)
                : null;
            const branchPrefix = worktreeBranch ? `[${worktreeBranch}] ` : "";
            for (const task of inProgressTasks) {
                const updated = await db.task.update({
                    where: { id: task.id },
                    data: {
                        status: "completed",
                        completedAt,
                    },
                });
                const taskLabel = updated.title ?? `Task ${task.id.slice(-6)}`;
                void inboxCreate({
                    accountId: userId,
                    category: "task",
                    eventType: "task.completed",
                    severity: "info",
                    title: `${branchPrefix}${taskLabel}: completed`,
                    referenceUrl: updated.sessionId ? `/session/${updated.sessionId}` : undefined,
                    refType: "task",
                    refId: task.id,
                    groupKey: `task:${task.id}:completed`,
                });
                eventRouter.emitEphemeral({
                    userId,
                    payload: buildTaskStatusChangedEphemeral({
                        taskId: task.id,
                        machineId: task.machineId,
                        status: "completed",
                        triggerType: task.triggerType,
                        sessionId: updated.sessionId ?? undefined,
                        completedAt: completedAt.getTime(),
                    }),
                    recipientFilter: { type: "user-scoped-only" },
                });
            }
            if (inProgressTasks.length > 0) {
                log(
                    { module: "websocket" },
                    `session-end: marked ${inProgressTasks.length} task(s) completed for session ${sid}`,
                );
            }

            // Emit session activity update
            const sessionActivity = buildSessionActivityEphemeral(sid, false, t, false);
            eventRouter.emitEphemeral({
                userId,
                payload: sessionActivity,
                recipientFilter: { type: 'user-scoped-only' }
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in session-end: ${error}`);
        }
    });

}
