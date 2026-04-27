import { Context } from "@/context";
import { inTx, afterTx } from "@/storage/inTx";
import { eventRouter, buildSessionActivityEphemeral } from "@/app/events/eventRouter";
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

        if (!session.active) {
            // Already archived — idempotent, treat as success
            return true;
        }

        const now = Date.now();

        await tx.session.update({
            where: { id: sessionId },
            data: { active: false, lastActiveAt: new Date(now) },
        });

        // Query machine IDs before the transaction commits so we can notify daemons
        const accessKeys = await tx.accessKey.findMany({
            where: { sessionId },
            select: { machineId: true },
        });
        const machineIds = [...new Set(accessKeys.map((ak) => ak.machineId))];

        afterTx(tx, async () => {
            // Evict heartbeat cache so the session is immediately seen as inactive
            activityCache.invalidateSession(sessionId);

            // Notify App clients: session is now inactive
            eventRouter.emitEphemeral({
                userId: ctx.uid,
                payload: buildSessionActivityEphemeral(sessionId, false, now, false),
                recipientFilter: { type: "user-scoped-only" },
            });

            // Signal each daemon that may be running this session to terminate it
            for (const machineId of machineIds) {
                eventRouter.emitEphemeral({
                    userId: ctx.uid,
                    payload: { type: "session-terminate", sessionId, reason: "archived" },
                    recipientFilter: { type: "machine-scoped-only", machineId },
                });
            }

            log(
                { module: "session-archive", userId: ctx.uid, sessionId },
                `Session archived; terminate signal sent to ${machineIds.length} machine(s)`,
            );
        });

        return true;
    });
}
