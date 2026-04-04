import { machineAliveEventsCounter, websocketEventsCounter } from "@/app/monitoring/metrics2";
import { activityCache } from "@/app/presence/sessionCache";
import { buildMachineActivityEphemeral, buildUpdateMachineUpdate, eventRouter } from "@/app/events/eventRouter";
import { log } from "@/utils/log";
import { db } from "@/storage/db";
import { Socket } from "socket.io";
import { allocateUserSeq } from "@/storage/seq";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { checkAndTriggerScheduledRuns } from "@/modules/supervisorScheduler";
import { cleanupStaleFixActions } from "@/modules/supervisorFixWatchdog";
import { checkAndTriggerSchedules } from "@/modules/triggerScheduleRunner";
import { pushSend } from "@/modules/pushSend";
import { consolidate } from "@/modules/knowledgeConsolidate";
import { storeKnowledgeEmbedding } from "@/modules/knowledgeEmbedding";
import { inTx } from "@/storage/inTx";

// Track last seen brief timestamp per machine to detect new briefs
const lastBriefTimestamp = new Map<string, number>();

// Throttle schedule checks to once per 5 minutes per machine
const SCHEDULE_CHECK_INTERVAL = 5 * 60 * 1000;
const lastScheduleCheck = new Map<string, number>();

function shouldCheckSchedule(machineId: string): boolean {
    const now = Date.now();
    const last = lastScheduleCheck.get(machineId) ?? 0;
    if (now - last < SCHEDULE_CHECK_INTERVAL) return false;
    lastScheduleCheck.set(machineId, now);
    return true;
}

export function machineUpdateHandler(userId: string, socket: Socket) {
    socket.on('machine-alive', async (data: {
        machineId: string;
        time: number;
    }) => {
        try {
            // Track metrics
            websocketEventsCounter.inc({ event_type: 'machine-alive' });
            machineAliveEventsCounter.inc();

            // Basic validation
            if (!data || typeof data.time !== 'number' || !data.machineId) {
                return;
            }

            let t = data.time;
            if (t > Date.now()) {
                t = Date.now();
            }
            if (t < Date.now() - 1000 * 60 * 10) {
                return;
            }

            // Check machine validity using cache
            const isValid = await activityCache.isMachineValid(data.machineId, userId);
            if (!isValid) {
                return;
            }

            // Queue database update (will only update if time difference is significant)
            activityCache.queueMachineUpdate(data.machineId, t);

            const machineActivity = buildMachineActivityEphemeral(data.machineId, true, t);
            eventRouter.emitEphemeral({
                userId,
                payload: machineActivity,
                recipientFilter: { type: 'user-scoped-only' }
            });

            // Check for scheduled supervisor runs (fire-and-forget, throttled)
            if (shouldCheckSchedule(data.machineId)) {
                checkAndTriggerScheduledRuns(data.machineId, userId).catch(err =>
                    log({ module: 'supervisor', level: 'error' }, `Schedule check error: ${err}`)
                );

                // Also clean up stale fix actions whose sessions are no longer active
                cleanupStaleFixActions(userId, data.machineId).catch(err =>
                    log({ module: 'supervisor', level: 'error' }, `Stale fix cleanup error: ${err}`)
                );

                // Check for due cron trigger schedules (shares 5-min heartbeat throttle)
                checkAndTriggerSchedules(data.machineId, userId).catch(err =>
                    log({ module: 'trigger', level: 'error' }, `Trigger schedule check error: ${err}`)
                );
            }
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in machine-alive: ${error}`);
        }
    });

    // Machine metadata update with optimistic concurrency control
    socket.on('machine-update-metadata', async (data: any, callback: (response: any) => void) => {
        try {
            const { machineId, metadata, expectedVersion } = data;

            // Validate input
            if (!machineId || typeof metadata !== 'string' || typeof expectedVersion !== 'number') {
                if (callback) {
                    callback({ result: 'error', message: 'Invalid parameters' });
                }
                return;
            }

            // Resolve machine
            const machine = await db.machine.findFirst({
                where: {
                    accountId: userId,
                    id: machineId
                }
            });
            if (!machine) {
                if (callback) {
                    callback({ result: 'error', message: 'Machine not found' });
                }
                return;
            }

            // Check version
            if (machine.metadataVersion !== expectedVersion) {
                callback({
                    result: 'version-mismatch',
                    version: machine.metadataVersion,
                    metadata: machine.metadata
                });
                return;
            }

            // Update metadata with atomic version check
            const { count } = await db.machine.updateMany({
                where: {
                    accountId: userId,
                    id: machineId,
                    metadataVersion: expectedVersion  // Atomic CAS
                },
                data: {
                    metadata: metadata,
                    metadataVersion: expectedVersion + 1
                    // NOT updating active or lastActiveAt here
                }
            });

            if (count === 0) {
                // Re-fetch current version
                const current = await db.machine.findFirst({
                    where: {
                        accountId: userId,
                        id: machineId
                    }
                });
                callback({
                    result: 'version-mismatch',
                    version: current?.metadataVersion || 0,
                    metadata: current?.metadata
                });
                return;
            }

            // Generate machine metadata update
            const updSeq = await allocateUserSeq(userId);
            const metadataUpdate = {
                value: metadata,
                version: expectedVersion + 1
            };
            const updatePayload = buildUpdateMachineUpdate(machineId, updSeq, randomKeyNaked(12), metadataUpdate);
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'machine-scoped-only', machineId }
            });

            // Send success response with new version
            callback({
                result: 'success',
                version: expectedVersion + 1,
                metadata: metadata
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in machine-update-metadata: ${error}`);
            if (callback) {
                callback({ result: 'error', message: 'Internal error' });
            }
        }
    });

    // Machine daemon state update with optimistic concurrency control
    socket.on('machine-update-state', async (data: any, callback: (response: any) => void) => {
        try {
            const { machineId, daemonState, expectedVersion } = data;

            // Validate input
            if (!machineId || typeof daemonState !== 'string' || typeof expectedVersion !== 'number') {
                if (callback) {
                    callback({ result: 'error', message: 'Invalid parameters' });
                }
                return;
            }

            // Resolve machine
            const machine = await db.machine.findFirst({
                where: {
                    accountId: userId,
                    id: machineId
                }
            });
            if (!machine) {
                if (callback) {
                    callback({ result: 'error', message: 'Machine not found' });
                }
                return;
            }

            // Check version
            if (machine.daemonStateVersion !== expectedVersion) {
                callback({
                    result: 'version-mismatch',
                    version: machine.daemonStateVersion,
                    daemonState: machine.daemonState
                });
                return;
            }

            // Update daemon state with atomic version check
            const { count } = await db.machine.updateMany({
                where: {
                    accountId: userId,
                    id: machineId,
                    daemonStateVersion: expectedVersion  // Atomic CAS
                },
                data: {
                    daemonState: daemonState,
                    daemonStateVersion: expectedVersion + 1,
                    active: true,
                    lastActiveAt: new Date()
                }
            });

            if (count === 0) {
                // Re-fetch current version
                const current = await db.machine.findFirst({
                    where: {
                        accountId: userId,
                        id: machineId
                    }
                });
                callback({
                    result: 'version-mismatch',
                    version: current?.daemonStateVersion || 0,
                    daemonState: current?.daemonState
                });
                return;
            }

            // Generate machine daemon state update
            const updSeq = await allocateUserSeq(userId);
            const daemonStateUpdate = {
                value: daemonState,
                version: expectedVersion + 1
            };
            const updatePayload = buildUpdateMachineUpdate(machineId, updSeq, randomKeyNaked(12), undefined, daemonStateUpdate);
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'machine-scoped-only', machineId }
            });

            // Check for new briefs and send push notifications
            try {
                const parsed = JSON.parse(daemonState);
                const briefs = parsed?.recentBriefs;
                if (Array.isArray(briefs) && briefs.length > 0) {
                    const latestBrief = briefs[0];
                    const lastSeen = lastBriefTimestamp.get(machineId) ?? 0;
                    if (latestBrief.generatedAt > lastSeen) {
                        lastBriefTimestamp.set(machineId, latestBrief.generatedAt);
                        // Only push if this is genuinely new (not first load)
                        if (lastSeen > 0) {
                            void pushSend(userId, {
                                title: `Loop Brief: ${latestBrief.loopName ?? latestBrief.loopId}`,
                                body: latestBrief.summary,
                                data: {
                                    type: "loop_brief",
                                    loopId: latestBrief.loopId,
                                    status: latestBrief.status,
                                },
                            });
                        }
                    }
                }
            } catch {
                // best-effort brief detection — don't fail the update
            }

            // Send success response with new version
            callback({
                result: 'success',
                version: expectedVersion + 1,
                daemonState: daemonState
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in machine-update-state: ${error}`);
            if (callback) {
                callback({ result: 'error', message: 'Internal error' });
            }
        }
    });

    // Handle transcript knowledge submissions from AutoDream
    socket.on('transcript-knowledge', async (data: any) => {
        try {
            const turns = data?.turns;
            if (!Array.isArray(turns) || turns.length === 0) return;

            for (const turn of turns.slice(0, 10)) {
                const sessionId = turn.sessionId;
                if (!sessionId) continue;

                // Map session to project
                const session = await db.session.findFirst({
                    where: { id: sessionId, accountId: userId },
                    select: { projectId: true },
                });
                if (!session?.projectId) continue;

                const projectId = session.projectId;
                const action = await consolidate(projectId, {
                    title: turn.title ?? "Session activity",
                    entryType: turn.entryType ?? "discovery",
                    tags: turn.tags ?? [],
                    content: turn.content ?? "",
                });

                if (action.type === "noop") continue;

                const created = await inTx(async (tx) => {
                    if (action.type === "update" && action.existingId) {
                        await tx.projectKnowledge.update({
                            where: { id: action.existingId },
                            data: { status: "superseded" },
                        });
                    }
                    return tx.projectKnowledge.create({
                        data: {
                            projectId,
                            entryType: turn.entryType ?? "discovery",
                            contributorType: "auto-dream",
                            action: action.type === "update" ? "supersede" : "create",
                            title: turn.title ?? "Session activity",
                            content: turn.content ?? "",
                            structured: turn.request || turn.outcome
                                ? JSON.stringify({ request: turn.request, outcome: turn.outcome })
                                : null,
                            tags: JSON.stringify(turn.tags ?? []),
                            confidence: turn.confidence ?? "medium",
                            model: turn.model ?? null,
                            sessionId,
                            affectedFiles: JSON.stringify(turn.affectedFiles ?? []),
                            supersedesId: action.type === "update" ? action.existingId : null,
                        },
                    });
                });

                void storeKnowledgeEmbedding(created.id, turn.title ?? "", turn.content ?? "");
            }

            log({ module: 'knowledge' }, `Processed ${turns.length} transcript knowledge entries`);
        } catch (error) {
            log({ module: 'knowledge', level: 'error' }, `Error processing transcript knowledge: ${error}`);
        }
    });
}