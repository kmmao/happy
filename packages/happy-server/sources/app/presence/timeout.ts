import { db } from "@/storage/db";
import { delay } from "@/utils/delay";
import { forever } from "@/utils/forever";
import { shutdownSignal } from "@/utils/shutdown";
import { buildMachineActivityEphemeral, buildSessionActivityEphemeral, eventRouter } from "@/app/events/eventRouter";

const TIMEOUT_BATCH_SIZE = 100;

export function startTimeout() {
    forever('session-timeout', async () => {
        while (true) {
            // Find and process timed out sessions in batches
            let sessionBatch: Awaited<ReturnType<typeof db.session.findMany>>;
            do {
                sessionBatch = await db.session.findMany({
                    where: {
                        active: true,
                        lastActiveAt: {
                            lte: new Date(Date.now() - 1000 * 60 * 10) // 10 minutes
                        }
                    },
                    take: TIMEOUT_BATCH_SIZE
                });
                // Batch-fetch all access keys for sessions in this batch to avoid N+1 queries
                const sessionIds = sessionBatch.map(s => s.id);
                const accessKeys = await db.accessKey.findMany({
                    where: { sessionId: { in: sessionIds } },
                    select: { sessionId: true, machineId: true, accountId: true }
                });
                const accessKeyBySessionId = new Map(accessKeys.map(k => [k.sessionId, k]));

                for (const session of sessionBatch) {
                    const updated = await db.session.updateManyAndReturn({
                        where: { id: session.id, active: true },
                        data: { active: false }
                    });
                    if (updated.length === 0) {
                        continue;
                    }
                    eventRouter.emitEphemeral({
                        userId: session.accountId,
                        payload: buildSessionActivityEphemeral(session.id, false, updated[0].lastActiveAt.getTime(), false),
                        recipientFilter: { type: 'user-scoped-only' }
                    });
                    // Notify the CLI daemon to terminate the process for this session
                    const accessKey = accessKeyBySessionId.get(session.id);
                    if (accessKey) {
                        eventRouter.emitEphemeral({
                            userId: session.accountId,
                            payload: { type: 'session-terminate', sessionId: session.id, reason: 'timeout' },
                            recipientFilter: { type: 'machine-scoped-only', machineId: accessKey.machineId }
                        });
                    }
                }
            } while (sessionBatch.length === TIMEOUT_BATCH_SIZE);

            // Find and process timed out machines in batches
            let machineBatch: Awaited<ReturnType<typeof db.machine.findMany>>;
            do {
                machineBatch = await db.machine.findMany({
                    where: {
                        active: true,
                        lastActiveAt: {
                            lte: new Date(Date.now() - 1000 * 60 * 10) // 10 minutes
                        }
                    },
                    take: TIMEOUT_BATCH_SIZE
                });
                for (const machine of machineBatch) {
                    const updated = await db.machine.updateManyAndReturn({
                        where: { id: machine.id, active: true },
                        data: { active: false }
                    });
                    if (updated.length === 0) {
                        continue;
                    }
                    eventRouter.emitEphemeral({
                        userId: machine.accountId,
                        payload: buildMachineActivityEphemeral(machine.id, false, updated[0].lastActiveAt.getTime()),
                        recipientFilter: { type: 'user-scoped-only' }
                    });
                }
            } while (machineBatch.length === TIMEOUT_BATCH_SIZE);

            // Wait for 1 minute
            await delay(1000 * 60, shutdownSignal);
        }
    });
}
