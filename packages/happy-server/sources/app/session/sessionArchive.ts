import { Context } from "@/context";
import { inTx, afterTx } from "@/storage/inTx";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { activityCache } from "@/app/presence/sessionCache";
import { log } from "@/utils/log";

/**
 * Archive a session (set active=false) and signal the CLI daemon to terminate
 * the running process if one exists.
 *
 * This is the server-side fallback for the App's killSession RPC. When the RPC
 * cannot reach the daemon (process crashed, network dropped, etc.) the App calls
 * PATCH /v1/sessions/:id/archive which invokes this function to:
 *   1. Persist active=false in the DB
 *   2. Invalidate the heartbeat cache
 *   3. Push a session-activity(active=false) ephemeral so the App updates immediately
 *   4. Push a session-terminate ephemeral to the daemon — if the process is still
 *      alive the daemon will kill it; if it is already gone the event is a no-op.
 */
export async function sessionArchive(ctx: Context, sessionId: string): Promise<boolean> {
    return await inTx(async (tx) => {
        const session = await tx.session.findFirst({
            where: {
                id: sessionId,
                accountId: ctx.uid,
            },
        });

        if (!session) {
            log(
                { module: "session-archive", userId: ctx.uid, sessionId },
                `Session not found or not owned by user`,
            );
            return false;
        }

        const now = Date.now();
        const wasActive = session.active;

        // Only write to DB when there is an actual state change
        if (wasActive) {
            await tx.session.update({
                where: { id: sessionId },
                data: { active: false, lastActiveAt: new Date(now) },
            });
        }

        // Query machine IDs regardless of active state — the process may still be
        // running even if the session was already marked inactive (e.g. Supervisor
        // auto-archived the session but the daemon process never received a kill signal)
        const accessKeys = await tx.accessKey.findMany({
            where: { sessionId },
            select: { machineId: true },
        });
        const machineIds = [...new Set(accessKeys.map((ak) => ak.machineId))];

        afterTx(tx, async () => {
            if (wasActive) {
                // Evict heartbeat cache so the session is immediately seen as inactive.
                activityCache.invalidateSession(sessionId);

                // Notify App clients: session is now inactive.
                await emitSyncEphemeral(ctx.uid, {
                    t: "session-activity",
                    sessionId,
                    active: false,
                    activeAt: now,
                });
            }

            // Always send session-terminate — the daemon will kill the process if it is
            // still running, and will silently ignore the event if it is already gone.
            for (const machineId of machineIds) {
                await emitSyncEphemeral(ctx.uid, {
                    t: "session-terminate",
                    sessionId,
                    reason: "archived",
                    machineId,
                });
            }

            log(
                { module: "session-archive", userId: ctx.uid, sessionId },
                `Session archive: wasActive=${wasActive}; terminate signal sent to ${machineIds.length} machine(s)`,
            );
        });

        return true;
    });
}
