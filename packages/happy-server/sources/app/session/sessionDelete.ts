import { Context } from "@/context";
import { inTx, afterTx } from "@/storage/inTx";
import { eventRouter } from "@/app/events/eventRouter";
import { emitSyncUpdate } from "@/app/events/syncUpdate";
import { log } from "@/utils/log";

/**
 * Delete a session and all its related data.
 * Handles:
 * - Deleting all session messages
 * - Detaching usage reports (setting sessionId to null to preserve history)
 * - Deleting all access keys for the session
 * - Deleting the session itself
 * - Sending socket notification to all connected clients
 * 
 * @param ctx - Context with user information
 * @param sessionId - ID of the session to delete
 * @returns true if deletion was successful, false if session not found or not owned by user
 */
export async function sessionDelete(ctx: Context, sessionId: string): Promise<boolean> {
    return await inTx(async (tx) => {
        // Verify session exists and belongs to the user
        const session = await tx.session.findFirst({
            where: {
                id: sessionId,
                accountId: ctx.uid
            }
        });

        if (!session) {
            log({ 
                module: 'session-delete', 
                userId: ctx.uid, 
                sessionId 
            }, `Session not found or not owned by user`);
            return false;
        }

        // Delete all related data
        // Note: Order matters to avoid foreign key constraint violations
        
        // 1. Delete session messages
        const deletedMessages = await tx.sessionMessage.deleteMany({
            where: { sessionId }
        });
        log({ 
            module: 'session-delete', 
            userId: ctx.uid, 
            sessionId,
            deletedCount: deletedMessages.count
        }, `Deleted ${deletedMessages.count} session messages`);

        // 2. Detach usage reports (preserve for historical statistics).
        // This is intentionally redundant with schema-level onDelete: SetNull
        // as a double safety net — explicit app logic + DB constraint.
        const detachedReports = await tx.usageReport.updateMany({
            where: { sessionId },
            data: { sessionId: null }
        });
        log({
            module: 'session-delete',
            userId: ctx.uid,
            sessionId,
            detachedCount: detachedReports.count
        }, `Detached ${detachedReports.count} usage reports (sessionId set to null)`);

        // 3. Query machine IDs before deleting access keys (used to notify CLI daemons)
        const accessKeys = await tx.accessKey.findMany({
            where: { sessionId },
            select: { machineId: true }
        });
        const machineIds = [...new Set(accessKeys.map(ak => ak.machineId))];

        // 4. Delete access keys
        const deletedAccessKeys = await tx.accessKey.deleteMany({
            where: { sessionId }
        });
        log({
            module: 'session-delete',
            userId: ctx.uid,
            sessionId,
            deletedCount: deletedAccessKeys.count
        }, `Deleted ${deletedAccessKeys.count} access keys`);

        // 4. Delete the session itself
        await tx.session.delete({
            where: { id: sessionId }
        });
        log({ 
            module: 'session-delete', 
            userId: ctx.uid, 
            sessionId 
        }, `Session deleted successfully`);

        // delete-session SyncUpdate (seam owns seq + id + recipient + afterTx
        // wrapping, ADR-0023).
        await emitSyncUpdate(ctx.uid, { t: "delete-session", sessionId }, { tx });

        // Notify CLI daemons to terminate the process for this session.
        // Ephemerals stay on the eventRouter primitive (out of scope for
        // Phase 1 / Scope X — see Phase 1.5 in ADR-0023).
        afterTx(tx, async () => {
            for (const machineId of machineIds) {
                eventRouter.emitEphemeral({
                    userId: ctx.uid,
                    payload: { type: 'session-terminate', sessionId, reason: 'deleted' },
                    recipientFilter: { type: 'machine-scoped-only', machineId }
                });
            }
        });

        return true;
    });
}