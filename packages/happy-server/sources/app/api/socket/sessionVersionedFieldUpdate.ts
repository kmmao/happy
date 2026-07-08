import { emitSyncUpdate } from "@/app/events/syncUpdate";
import { versionedUpdate } from "@/modules/versionedUpdate";
import { db } from "@/storage/db";

/**
 * The optimistically-versioned Session fields a client writes over the socket.
 * The discriminant drives the guarded DB columns, the `update-session` body slot,
 * and the echo key used in the socket acknowledgement, so the
 * metadata/agentState/preferences handlers cannot disagree on any of them.
 */
export type SessionVersionedField = "metadata" | "agentState" | "preferences";

/**
 * Apply a compare-and-swap to one versioned Session field and acknowledge the
 * socket caller with the matching response shape.
 *
 * The `update-metadata` and `update-state` handlers used to be ~45-line
 * near-duplicates that diverged in the bug-prone outward parts: the
 * acknowledgement shape, the seq-allocate → emit → ack ordering, and the
 * not-found handling (metadata stayed silent — hanging the CLI's untimed
 * `emitWithAck` — while state replied `error`). This concentrates all of that:
 * run {@link versionedUpdate} over the field, then for each outcome produce the
 * one canonical acknowledgement — `version-mismatch` echoes the current value,
 * `success` allocates a user seq and broadcasts the session update before
 * acking, and a missing row (or any non-applied, non-mismatch outcome) acks
 * `error`. Per-field validation and the surrounding try/catch stay at the call
 * site; only the shared dance lives here. `preferences` was folded in from a
 * hand-rolled inline copy in `sessionPreferencesHandler` that reported the stale
 * read version on a lost race instead of re-reading the winner — the seam's
 * re-read fixes that.
 */
export async function sessionVersionedFieldUpdate(input: {
    userId: string;
    sid: string;
    field: SessionVersionedField;
    value: string | null;
    expectedVersion: number;
    callback?: (response: any) => void;
}): Promise<void> {
    const { userId, sid, field, value, expectedVersion, callback } = input;

    const result = await versionedUpdate<string | null>({
        expectedVersion,
        read: async () => {
            const session = await db.session.findUnique({
                where: { id: sid, accountId: userId }
            });
            if (!session) {
                return null;
            }
            switch (field) {
                case "metadata":
                    return { version: session.metadataVersion, value: session.metadata };
                case "agentState":
                    return { version: session.agentStateVersion, value: session.agentState };
                case "preferences":
                    return { version: session.preferencesVersion, value: session.preferences };
            }
        },
        write: async (expected) => {
            const where =
                field === "metadata" ? { id: sid, metadataVersion: expected } :
                field === "agentState" ? { id: sid, agentStateVersion: expected } :
                { id: sid, preferencesVersion: expected };
            const data =
                field === "metadata" ? { metadata: value as string, metadataVersion: expected + 1 } :
                field === "agentState" ? { agentState: value, agentStateVersion: expected + 1 } :
                { preferences: value as string, preferencesVersion: expected + 1 };
            const { count } = await db.session.updateMany({ where, data });
            return count;
        }
    });

    if (!result.applied) {
        if (result.reason === "version-mismatch") {
            callback?.({ result: "version-mismatch", version: result.currentVersion, [field]: result.currentValue });
        } else {
            callback?.({ result: "error" });
        }
        return;
    }

    // agentState is nullable, but the update builder types its value as a plain
    // string; cast to keep the historical runtime shape (a null value rides
    // through unchanged) without widening the builder signature here.
    const fieldUpdate = { value, version: result.newVersion } as { value: string; version: number };
    // update-session SyncUpdate (seam owns seq + id + recipient, ADR-0023).
    // The field branch lives at the body level: each emitSyncUpdate carries
    // exactly one of the versioned-field slots.
    await emitSyncUpdate(userId,
        field === "metadata" ? { t: "update-session", sessionId: sid, metadata: fieldUpdate } :
        field === "agentState" ? { t: "update-session", sessionId: sid, agentState: fieldUpdate } :
        { t: "update-session", sessionId: sid, preferences: fieldUpdate }
    );

    callback?.({ result: "success", version: result.newVersion, [field]: value });
}
