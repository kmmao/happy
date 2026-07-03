import { machineAliveEventsCounter, websocketEventsCounter } from "@/app/monitoring/metrics2";
import { activityCache } from "@/app/presence/sessionCache";
import { machineVersionedUpdate } from "./machineVersionedUpdate";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { log } from "@/utils/log";
import { db } from "@/storage/db";
import { Socket } from "socket.io";
import { runDueMachineHeartbeatScans } from "@/app/api/socket/machineHeartbeatScans";
import { buildBriefPushBody, pushSend } from "@/modules/pushSend";
import { consolidate } from "@/modules/knowledgeConsolidate";
import { writeKnowledgeEntry } from "@/modules/knowledgeWrite";

// Track last seen brief timestamp per machine to detect new briefs
const lastBriefTimestamp = new Map<string, number>();

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

            await emitSyncEphemeral(userId, {
                t: "machine-activity",
                machineId: data.machineId,
                active: true,
                activeAt: t,
            });

            // Fire all due heartbeat scans (supervisor runs, stale-fix cleanup,
            // cron triggers, generic AgentLoops). The seam owns the registry,
            // per-machine throttle, and per-scan error isolation.
            runDueMachineHeartbeatScans(data.machineId, userId);
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
                callback?.({ result: 'error', message: 'Invalid parameters' });
                return;
            }

            await machineVersionedUpdate({ userId, machineId, field: 'metadata', value: metadata, expectedVersion, callback });
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
                callback?.({ result: 'error', message: 'Invalid parameters' });
                return;
            }

            const result = await machineVersionedUpdate({ userId, machineId, field: 'daemonState', value: daemonState, expectedVersion, callback });

            // Check for new briefs and send push notifications — only after a
            // successful write (best-effort; must not fail the update).
            if (result.applied) {
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
                                    body: buildBriefPushBody(latestBrief),
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
            }
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in machine-update-state: ${error}`);
            if (callback) {
                callback({ result: 'error', message: 'Internal error' });
            }
        }
    });

    // Daemon reconnect: re-activate sessions that are still alive on the daemon side.
    // Called after the authenticated socket is ready so the server has an accurate
    // view of which sessions survived a server restart or reconnect window.
    socket.on('session-sync', async (data: { sessionIds: string[] }, callback?: (response: { ok: boolean; reactivated?: number; error?: string }) => void) => {
        try {
            const rawSessionIds = data?.sessionIds;
            if (!Array.isArray(rawSessionIds)) {
                callback?.({ ok: false, error: 'Invalid sessionIds' });
                return;
            }

            const sessionIds = [...new Set(
                rawSessionIds
                    .filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0)
                    .slice(0, 500),
            )];
            if (sessionIds.length === 0) {
                callback?.({ ok: true, reactivated: 0 });
                return;
            }

            const activeAt = new Date();
            const updatedSessions = await db.session.updateManyAndReturn({
                where: {
                    id: { in: sessionIds },
                    accountId: userId,
                },
                data: {
                    active: true,
                    lastActiveAt: activeAt,
                },
            });

            for (const session of updatedSessions) {
                activityCache.invalidateSession(session.id);
                await emitSyncEphemeral(userId, {
                    t: "session-activity",
                    sessionId: session.id,
                    active: true,
                    activeAt: session.lastActiveAt.getTime(),
                });
            }

            callback?.({ ok: true, reactivated: updatedSessions.length });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in session-sync: ${error}`);
            callback?.({ ok: false, error: 'Internal error' });
        }
    });

    // Handle transcript knowledge submissions from AutoDream
    socket.on('transcript-knowledge', async (data: any) => {
        try {
            const turns = data?.turns;
            if (!Array.isArray(turns) || turns.length === 0) return;

            const updatedSessionIds = new Set<string>();

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

                const created = await writeKnowledgeEntry(action, {
                    projectId,
                    entryType: turn.entryType ?? "discovery",
                    contributorType: "auto-dream",
                    action: "create",
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
                    supersedesId: null,
                });

                updatedSessionIds.add(sessionId);

                // Push unified world event for Stream Mode real-time updates
                {
                    let tags: string[] = [];
                    try { tags = JSON.parse(created.tags) as string[]; } catch { /* ignore */ }
                    const label = tags.length > 0
                        ? `${created.entryType}: ${tags.slice(0, 3).join(", ")}`
                        : created.entryType;
                    await emitSyncEphemeral(userId, {
                        t: "world-event-created",
                        event: {
                            id: `memory-${created.id}`,
                            eventType: "memory.created",
                            title: label,
                            summary: `${created.entryType} · ${created.confidence}`,
                            occurredAt: created.createdAt.getTime(),
                            severity: "info",
                            source: {
                                type: "project",
                                projectId: created.projectId,
                                sessionId: created.sessionId ?? null,
                            },
                            originalId: created.id,
                        },
                    });
                }
            }

            // Notify App once per affected session so the "changes" tab updates in real time.
            for (const sessionId of updatedSessionIds) {
                const knowledgeCount = await db.projectKnowledge.count({
                    where: { sessionId, status: "active" },
                });
                await emitSyncEphemeral(userId, { t: "knowledge-count", sessionId, count: knowledgeCount });
            }

            log({ module: 'knowledge' }, `Processed ${turns.length} transcript knowledge entries`);
        } catch (error) {
            log({ module: 'knowledge', level: 'error' }, `Error processing transcript knowledge: ${error}`);
        }
    });
}