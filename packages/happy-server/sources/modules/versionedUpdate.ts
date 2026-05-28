export type VersionedUpdateResult<V> =
    | { applied: true; newVersion: number }
    | { applied: false; reason: "not-found" }
    | { applied: false; reason: "version-mismatch"; currentVersion: number; currentValue: V };

/**
 * Compare-and-swap on a versioned field (optimistic concurrency control).
 *
 * Several records carry a monotonic `*Version` integer guarding a mutable
 * payload: AccessKey.dataVersion, Session.metadataVersion,
 * Session.agentStateVersion. Every writer must run the same dance — read the
 * current version, reject if the caller's `expectedVersion` no longer matches,
 * then update *guarded by* that version so a concurrent writer who slipped in
 * between the read and the write loses the race (the guarded `updateMany`
 * matches zero rows, and we re-read to report whoever won). The count===0
 * re-read and the `version + 1` off-by-one are the bug-prone steps; this is the
 * single place that owns them so the three call sites cannot drift.
 *
 * Callers supply two closures over their own Prisma model — keeping field names
 * and where-clauses type-safe at the call site — and consume the decision:
 * `applied: true` with `newVersion`, or `applied: false` distinguishing a
 * missing row from a version mismatch (the latter carries the current
 * version + value so the caller can echo it back to the loser). Each caller
 * keeps its own *outward* side-effects (HTTP status, socket callback shape,
 * emitUpdate) and just consumes this result.
 */
export async function versionedUpdate<V>(input: {
    expectedVersion: number;
    read: () => Promise<{ version: number; value: V } | null>;
    write: (expectedVersion: number) => Promise<number>;
}): Promise<VersionedUpdateResult<V>> {
    const { expectedVersion, read, write } = input;

    const current = await read();
    if (!current) {
        return { applied: false, reason: "not-found" };
    }
    if (current.version !== expectedVersion) {
        return { applied: false, reason: "version-mismatch", currentVersion: current.version, currentValue: current.value };
    }

    const count = await write(expectedVersion);
    if (count === 0) {
        // A concurrent writer won the guarded update between our read and write.
        // Re-read to report the version + value that actually landed.
        const latest = await read();
        if (!latest) {
            return { applied: false, reason: "not-found" };
        }
        return { applied: false, reason: "version-mismatch", currentVersion: latest.version, currentValue: latest.value };
    }

    return { applied: true, newVersion: expectedVersion + 1 };
}
