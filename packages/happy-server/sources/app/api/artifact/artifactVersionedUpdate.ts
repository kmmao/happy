import { db } from "@/storage/db";
import * as privacyKit from "privacy-kit";

/**
 * One side of an artifact's compare-and-swap. The caller supplies the new
 * base64 payload and the version it believes is current; on success it gets
 * the version that landed (`expectedVersion + 1`).
 */
export interface ArtifactFieldUpdate {
    /** Base64-encoded ciphertext to write. */
    data: string;
    expectedVersion: number;
}

/** The current value of a field, echoed back to the loser of a CAS. */
export interface ArtifactFieldConflict {
    currentVersion: number;
    /** Base64-encoded current ciphertext. */
    currentData: string;
}

export type ArtifactVersionedUpdateResult =
    | { applied: false; reason: "not-found" }
    | {
          applied: false;
          reason: "version-mismatch";
          header?: ArtifactFieldConflict;
          body?: ArtifactFieldConflict;
      }
    | {
          applied: true;
          seq: number;
          headerVersion?: number;
          bodyVersion?: number;
      };

/**
 * Compare-and-swap on an Artifact's header and/or body in ONE atomic write.
 *
 * An Artifact carries two independently versioned encrypted fields —
 * `headerVersion` and `bodyVersion` — and a caller may update either or both.
 * Both the socket `artifact-update` handler and the `POST /v1/artifacts/:id`
 * route used to inline the same five-step dance around them — read current,
 * compare each provided field's `expectedVersion`, do the `version + 1`
 * arithmetic, run a single `updateMany` guarded by EVERY provided version so a
 * concurrent writer who slipped in matches zero rows, and on `count === 0`
 * re-read to report whoever won. The guarded-where, the `+1` off-by-one, and
 * the re-read are the bug-prone steps; this is the single place that owns them
 * so the two transports cannot drift (one of the reasons this matters: the
 * Artifact code path has no test coverage, so a silent drift would go
 * unnoticed).
 *
 * Why not the single-field `versionedUpdate`: header and body must be swapped
 * together under one guarded `updateMany` (where = `headerVersion: X AND
 * bodyVersion: Y`) so a two-field update never half-applies. A single-field CAS
 * run twice would lose that atomicity. The shared idea — guarded write, then
 * re-read on a lost race — is the same; the shape is artifact-specific.
 *
 * Each transport keeps its own outward shape (socket callback vs HTTP 404 /
 * 409 / 200, and the `emitUpdate` fan-out) and just consumes this result.
 */
export async function artifactVersionedUpdate(input: {
    artifactId: string;
    userId: string;
    header?: ArtifactFieldUpdate;
    body?: ArtifactFieldUpdate;
}): Promise<ArtifactVersionedUpdateResult> {
    const { artifactId, userId, header, body } = input;

    const read = () =>
        db.artifact.findFirst({ where: { id: artifactId, accountId: userId } });

    const current = await read();
    if (!current) {
        return { applied: false, reason: "not-found" };
    }

    // Pre-write mismatch check: report the fields the caller got wrong.
    const headerMismatch =
        header !== undefined && current.headerVersion !== header.expectedVersion;
    const bodyMismatch =
        body !== undefined && current.bodyVersion !== body.expectedVersion;
    if (headerMismatch || bodyMismatch) {
        return {
            applied: false,
            reason: "version-mismatch",
            ...(headerMismatch && {
                header: {
                    currentVersion: current.headerVersion,
                    currentData: privacyKit.encodeBase64(current.header),
                },
            }),
            ...(bodyMismatch && {
                body: {
                    currentVersion: current.bodyVersion,
                    currentData: privacyKit.encodeBase64(current.body),
                },
            }),
        };
    }

    const seq = current.seq + 1;
    const data: Record<string, unknown> = { updatedAt: new Date(), seq };
    if (header) {
        data.header = privacyKit.decodeBase64(header.data);
        data.headerVersion = header.expectedVersion + 1;
    }
    if (body) {
        data.body = privacyKit.decodeBase64(body.data);
        data.bodyVersion = body.expectedVersion + 1;
    }

    // Atomic write guarded by EVERY provided version — a concurrent writer who
    // moved either field between our read and write matches zero rows.
    const { count } = await db.artifact.updateMany({
        where: {
            id: artifactId,
            accountId: userId,
            ...(header && { headerVersion: header.expectedVersion }),
            ...(body && { bodyVersion: body.expectedVersion }),
        },
        data,
    });

    if (count === 0) {
        // Lost the race between read and guarded write: re-read and report the
        // versions that actually landed, for whichever fields we tried to set.
        const latest = await read();
        if (!latest) {
            return { applied: false, reason: "not-found" };
        }
        return {
            applied: false,
            reason: "version-mismatch",
            ...(header && {
                header: {
                    currentVersion: latest.headerVersion,
                    currentData: privacyKit.encodeBase64(latest.header),
                },
            }),
            ...(body && {
                body: {
                    currentVersion: latest.bodyVersion,
                    currentData: privacyKit.encodeBase64(latest.body),
                },
            }),
        };
    }

    return {
        applied: true,
        seq,
        ...(header && { headerVersion: header.expectedVersion + 1 }),
        ...(body && { bodyVersion: body.expectedVersion + 1 }),
    };
}
