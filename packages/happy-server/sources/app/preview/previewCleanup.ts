/**
 * Background cleanup for preview tunnels.
 *
 * Two checks every CLEANUP_INTERVAL_MS:
 *   1. Lease expired   — created more than 8h ago → force revoke.
 *   2. Idle timeout    — no traffic for > idleTimeoutMs (default 45 min) → revoke.
 *
 * On revoke: remove from store, broadcast preview-connection-updated:null,
 * and tell the daemon to stop proxying. Mirrors the manual /preview/revoke
 * route but driven by the timer.
 */

import { previewStore } from "./previewStore";
import { eventRouter, buildPreviewConnectionUpdatedEphemeral } from "@/app/events/eventRouter";
import { db } from "@/storage/db";
import { log } from "@/utils/log";

const CLEANUP_INTERVAL_MS = 60_000; // 1 minute

let cleanupTimer: NodeJS.Timeout | null = null;

async function runCleanup(): Promise<void> {
    const now = Date.now();
    const connections = previewStore.listConnections();
    if (connections.length === 0) return;

    for (const conn of connections) {
        const expiredLease = now >= conn.leaseExpiresAt;
        const idleTimedOut =
            conn.idleTimeoutMs > 0 && now - conn.lastActiveAt >= conn.idleTimeoutMs;
        if (!expiredLease && !idleTimedOut) continue;

        // C3 fix: re-read the connection to guard against a race where
        // touchConnection updated lastActiveAt between our snapshot and now.
        const fresh = previewStore.getConnection(conn.tunnelId);
        if (!fresh) continue;                              // already revoked
        if (now < fresh.leaseExpiresAt && !(fresh.idleTimeoutMs > 0 && now - fresh.lastActiveAt >= fresh.idleTimeoutMs)) continue;

        const reason = expiredLease ? "lease-expired" : "idle-timeout";
        log({ module: "preview" }, `Cleanup ${conn.tunnelId} (${reason})`);

        // Tell daemon to stop proxying
        const machineSocket = eventRouter.findMachineSocket(conn.machineId);
        if (machineSocket) {
            machineSocket.emit("preview-stop-proxy", {});
        }

        previewStore.removeConnection(conn.tunnelId);

        // Look up userId from session to scope the ephemeral broadcast
        try {
            const session = await db.session.findFirst({
                where: { id: conn.sessionId },
                select: { accountId: true },
            });
            if (session) {
                eventRouter.emitEphemeral({
                    userId: session.accountId,
                    payload: buildPreviewConnectionUpdatedEphemeral({
                        sessionId: conn.sessionId,
                        connection: null,
                    }),
                    recipientFilter: {
                        type: "all-interested-in-session",
                        sessionId: conn.sessionId,
                    },
                });
            }
        } catch {
            // Session lookup failed — drop the broadcast, the connection is
            // already removed from memory so the next /preview GET will return null.
        }
    }
}

export function startPreviewCleanup(): void {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(() => {
        void runCleanup().catch((err) => {
            log({ module: "preview", level: "warn" }, `Cleanup error: ${err}`);
        });
    }, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref?.();
}

export function stopPreviewCleanup(): void {
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
}
