import { db } from "@/storage/db";
import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { activityCache } from "@/app/presence/sessionCache";

/**
 * Mark a session inactive and refresh presence, WITHOUT signaling the daemon to
 * terminate the process.
 *
 * This is the presence-only half of archival, owned as one seam so the Supervisor
 * run/fix completion flows cannot drift on the mechanic. Each caller previously
 * hand-rolled the same three steps (or a subset of them):
 *   1. `session.updateMany({ active: true } → { active: false, lastActiveAt })`
 *      — guarded on active:true so it is a no-op on an already-inactive session
 *   2. `activityCache.invalidateSession` — evict the heartbeat cache so presence
 *      flips immediately rather than waiting for a heartbeat timeout
 *   3. emit `session-activity(active:false)` — tell App clients the session ended
 *
 * The kill signal (if any) is a SEPARATE decision and stays caller-owned — the
 * Supervisor flows emit `supervisor-fix-kill-session` / `requestSessionKill`
 * themselves (ADR-0054). Contrast with `sessionArchive()`
 * (app/session/sessionArchive.ts), which additionally sends `session-terminate`
 * and runs inside a Context / inTx flow; this seam operates on the raw `db`
 * client + a userId, matching how the Supervisor completion handlers run.
 */
export async function sessionDeactivate(userId: string, sessionId: string): Promise<void> {
    const now = Date.now();
    await db.session.updateMany({
        where: { id: sessionId, active: true },
        data: { lastActiveAt: new Date(now), active: false },
    });
    activityCache.invalidateSession(sessionId);
    await emitSyncEphemeral(userId, {
        t: "session-activity",
        sessionId,
        active: false,
        activeAt: now,
    });
}
