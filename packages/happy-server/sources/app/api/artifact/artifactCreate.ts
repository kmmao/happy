import { db } from "@/storage/db";
import * as privacyKit from "privacy-kit";
import { emitSyncUpdate } from "@/app/events/syncUpdate";

/**
 * Artifact intake — the single seam that turns an artifact-create request into a
 * created Artifact, whatever transport it arrived on.
 *
 * Both the socket `artifact-create` handler and the `POST /v1/artifacts` route
 * inlined the same intake dance: look the id up, reject it as a conflict if it
 * already belongs to another Account, return the existing row idempotently if it
 * belongs to this one, otherwise create it with the fixed initial shape
 * (`headerVersion`/`bodyVersion = 1`, `seq = 0`, base64 payloads decoded to
 * bytes) and broadcast `new-artifact`. That "conflict vs idempotent vs create +
 * broadcast" rule and the initial-row shape are the invariant-bearing pieces;
 * consolidating them here means the two transports cannot drift — the same
 * concern the sibling `artifactVersionedUpdate` seam addresses for updates, and
 * doubly relevant because the artifact path has thin test coverage, so a silent
 * divergence would go unnoticed.
 *
 * Unlike `artifactVersionedUpdate` (which leaves the emit to each caller because
 * update fan-out varies), the create broadcast is identical on both paths and is
 * part of what "create an artifact" means, so it lives inside the seam. Each
 * transport keeps ONLY its own outward shape — HTTP 409 / 200-with-key vs socket
 * callback strings — and consumes this result.
 */

type ArtifactRow = NonNullable<
    Awaited<ReturnType<typeof db.artifact.findUnique>>
>;

export interface ArtifactCreateInput {
    accountId: string;
    id: string;
    /** Base64-encoded header ciphertext. */
    header: string;
    /** Base64-encoded body ciphertext. */
    body: string;
    /** Base64-encoded per-artifact data encryption key. */
    dataEncryptionKey: string;
}

export type ArtifactCreateResult =
    /** A brand-new row was written and `new-artifact` broadcast. */
    | { status: "created"; artifact: ArtifactRow }
    /** The id already exists for this Account — returned unchanged (idempotent). */
    | { status: "existing"; artifact: ArtifactRow }
    /** The id exists for a DIFFERENT Account — caller should reject. */
    | { status: "conflict" };

export async function artifactCreate(
    input: ArtifactCreateInput,
): Promise<ArtifactCreateResult> {
    const existing = await db.artifact.findUnique({ where: { id: input.id } });
    if (existing) {
        if (existing.accountId !== input.accountId) {
            return { status: "conflict" };
        }
        return { status: "existing", artifact: existing };
    }

    const artifact = await db.artifact.create({
        data: {
            id: input.id,
            accountId: input.accountId,
            header: privacyKit.decodeBase64(input.header),
            headerVersion: 1,
            body: privacyKit.decodeBase64(input.body),
            bodyVersion: 1,
            dataEncryptionKey: privacyKit.decodeBase64(input.dataEncryptionKey),
            seq: 0,
        },
    });

    // Broadcast new-artifact. Seam owns seq + id + recipient (ADR-0023).
    await emitSyncUpdate(input.accountId, { t: "new-artifact", artifact });

    return { status: "created", artifact };
}
