import { buildUpdateSessionUpdate, eventRouter } from "@/app/events/eventRouter";
import { versionedUpdate } from "@/modules/versionedUpdate";
import { db } from "@/storage/db";
import { allocateUserSeq } from "@/storage/seq";
import { randomKeyNaked } from "@/utils/randomKeyNaked";

/**
 * The two optimistically-versioned Session fields a client writes over the
 * socket. The discriminant drives both the guarded DB columns and the echo key
 * used in the socket acknowledgement, so the metadata/agentState handlers
 * cannot disagree on either.
 */
export type SessionVersionedField = "metadata" | "agentState";

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
 * site; only the shared dance lives here.
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
            return field === "metadata"
                ? { version: session.metadataVersion, value: session.metadata }
                : { version: session.agentStateVersion, value: session.agentState };
        },
        write: async (expected) => {
            const { count } = await db.session.updateMany({
                where: field === "metadata"
                    ? { id: sid, metadataVersion: expected }
                    : { id: sid, agentStateVersion: expected },
                data: field === "metadata"
                    ? { metadata: value as string, metadataVersion: expected + 1 }
                    : { agentState: value, agentStateVersion: expected + 1 }
            });
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

    const updSeq = await allocateUserSeq(userId);
    // agentState is nullable, but the update builder types its value as a plain
    // string; cast to keep the historical runtime shape (a null value rides
    // through unchanged) without widening the builder signature here.
    const fieldUpdate = { value, version: result.newVersion } as { value: string; version: number };
    const updatePayload = field === "metadata"
        ? buildUpdateSessionUpdate(sid, updSeq, randomKeyNaked(12), fieldUpdate)
        : buildUpdateSessionUpdate(sid, updSeq, randomKeyNaked(12), undefined, fieldUpdate);
    eventRouter.emitUpdate({
        userId,
        payload: updatePayload,
        recipientFilter: { type: "all-interested-in-session", sessionId: sid }
    });

    callback?.({ result: "success", version: result.newVersion, [field]: value });
}
