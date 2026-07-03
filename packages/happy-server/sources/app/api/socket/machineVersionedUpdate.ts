import { emitSyncUpdate } from "@/app/events/syncUpdate";
import { versionedUpdate } from "@/modules/versionedUpdate";
import { db } from "@/storage/db";

/**
 * The two optimistically-versioned Machine fields a daemon writes over the
 * socket. The discriminant drives the guarded DB columns, the guarded write's
 * side-effects, the SyncUpdate body slot, and the acknowledgement key, so the
 * metadata/daemonState handlers cannot disagree on any of them.
 */
export type MachineVersionedField = "metadata" | "daemonState";

/**
 * Apply a compare-and-swap to one versioned Machine field and acknowledge the
 * socket caller with the matching response shape — the Machine analogue of
 * `sessionVersionedFieldUpdate`, running the shared {@link versionedUpdate}
 * dance so DaemonState and MachineMetadata stop re-implementing the version
 * arithmetic + count===0 re-read inline (they used to be two ~80-line
 * near-duplicates).
 *
 * Field-specific facts stay declared here once: `daemonState` writes also flip
 * `active`/`lastActiveAt` (a metadata write must not), and each `update-machine`
 * SyncUpdate carries exactly one of the two versioned-field slots. Input
 * validation, the surrounding try/catch, and the daemonState-only brief-push
 * side-effect stay at the call site. Returns the CAS outcome so a caller can run
 * its own post-success work (e.g. brief detection) only when the write applied.
 */
export async function machineVersionedUpdate(input: {
    userId: string;
    machineId: string;
    field: MachineVersionedField;
    value: string;
    expectedVersion: number;
    callback?: (response: any) => void;
}): Promise<{ applied: boolean; newVersion?: number }> {
    const { userId, machineId, field, value, expectedVersion, callback } = input;

    const result = await versionedUpdate<string | null>({
        expectedVersion,
        read: async () => {
            const machine = await db.machine.findFirst({
                where: { accountId: userId, id: machineId },
            });
            if (!machine) {
                return null;
            }
            return field === "metadata"
                ? { version: machine.metadataVersion, value: machine.metadata }
                : { version: machine.daemonStateVersion, value: machine.daemonState };
        },
        write: async (expected) => {
            const { count } = await db.machine.updateMany({
                where: field === "metadata"
                    ? { accountId: userId, id: machineId, metadataVersion: expected }
                    : { accountId: userId, id: machineId, daemonStateVersion: expected },
                data: field === "metadata"
                    ? { metadata: value, metadataVersion: expected + 1 }
                    : {
                        daemonState: value,
                        daemonStateVersion: expected + 1,
                        active: true,
                        lastActiveAt: new Date(),
                    },
            });
            return count;
        },
    });

    if (!result.applied) {
        if (result.reason === "version-mismatch") {
            callback?.({ result: "version-mismatch", version: result.currentVersion, [field]: result.currentValue });
        } else {
            callback?.({ result: "error", message: "Machine not found" });
        }
        return { applied: false };
    }

    // update-machine SyncUpdate (seam owns seq + id + recipient, ADR-0023;
    // machine-scoped-only). The metadata-vs-daemonState branch lives at the body
    // level: each carries exactly one versioned-field slot.
    await emitSyncUpdate(userId, field === "metadata"
        ? { t: "update-machine", machineId, metadata: { value, version: result.newVersion } }
        : { t: "update-machine", machineId, daemonState: { value, version: result.newVersion } });

    callback?.({ result: "success", version: result.newVersion, [field]: value });
    return { applied: true, newVersion: result.newVersion };
}
