/**
 * apiSessionAdopt — App-side client for the `session-adopt` socket RPC.
 *
 * Two-step flow that lives entirely on top of the existing socket plumbing:
 *
 *   1. emit `session-adopt` → server (modules/sessionAdopt.ts) validates
 *      ownership, resolves or creates the automation owner (loop / schedule),
 *      pushes a `session-adopted` ephemeral to the daemon for GuardianRegistry,
 *      and returns `{automationContext, ownerId}` in its ack callback.
 *
 *   2. Patch the App-local Session.metadata.automationContext with the
 *      returned value, re-encrypt, and ship via the existing `update-metadata`
 *      socket event. The server's `sessionVersionedFieldUpdate` writes it,
 *      bumps metadataVersion, and emits `update-session` SyncUpdate so every
 *      device (mobile, web, other browser tabs) re-groups the Session under
 *      its new owner without an extra round-trip.
 *
 * The server side intentionally does NOT touch the encrypted metadata blob —
 * it doesn't hold the session-scoped key. Step 2 is therefore mandatory and
 * is what makes the Workflow grouping survive a page reload.
 *
 * Version conflicts (CLI happens to write metadata between our read and
 * write) are surfaced as `version-mismatch`; we retry once before giving up.
 */

import * as wire from "@kmmao/happy-wire";
import { apiSocket } from "./apiSocket";
import { sync } from "./sync";
import { storage } from "./storage";
import type { Metadata } from "./storageTypes";

const MAX_RETRIES = 2;

export type SessionAdoptResult =
    | {
          success: true;
          automationContext: wire.AdoptedAutomationContext;
          ownerId: string;
      }
    | {
          success: false;
          errorMessage: string;
          errorCode?: string;
      };

/**
 * Bind an existing Session to an automation owner (existing loop, new loop,
 * or new schedule). Resolves once the server has set up the owner AND the
 * App's local metadata has been re-encrypted + uploaded.
 */
export async function sessionAdopt(
    request: wire.SessionAdoptRequest,
): Promise<SessionAdoptResult> {
    // Step 1: RPC to server.
    const ack = await apiSocket.emitWithAck<unknown>(
        "session-adopt",
        request,
    );
    const parsed = wire.SessionAdoptResponseSchema.safeParse(ack);
    if (!parsed.success) {
        return {
            success: false,
            errorMessage: "Server returned an invalid sessionAdopt response",
            errorCode: "invalid_response",
        };
    }
    const response = parsed.data;
    if (!response.success) {
        return {
            success: false,
            errorMessage: response.errorMessage,
            errorCode: response.errorCode,
        };
    }

    // Step 2: patch local metadata and upload. We do this on a best-effort
    // basis — if the upload retries-out the server still has the owner row
    // created from Step 1, the user just won't see the visual grouping on
    // this device until the CLI eventually writes automationContext into
    // metadata (e.g. on next iteration via HAPPY_AUTOMATION_CONTEXT_JSON).
    try {
        await patchSessionMetadataWithContext(
            request.sessionId,
            response.automationContext,
        );
    } catch (err) {
        return {
            success: false,
            errorMessage:
                err instanceof Error
                    ? err.message
                    : "Failed to apply adopted context to local metadata",
            errorCode: "metadata_patch_failed",
        };
    }

    return {
        success: true,
        automationContext: response.automationContext,
        ownerId: response.ownerId,
    };
}

/**
 * Read the local Session, merge automationContext into its decrypted
 * metadata, re-encrypt and ship via `update-metadata`. Retries once on
 * version mismatch (CLI raced us between read and write).
 */
async function patchSessionMetadataWithContext(
    sessionId: string,
    automationContext: wire.AdoptedAutomationContext,
): Promise<void> {
    const encryption = sync.encryption.getSessionEncryption(sessionId);
    if (!encryption) {
        throw new Error("Session encryption not available");
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const session = storage.getState().sessions[sessionId];
        if (!session) {
            throw new Error("Session no longer in local storage");
        }
        const currentMetadata: Metadata =
            session.metadata ??
            // metadata is required to have at least path+host per
            // MetadataSchema; if it is null on the storage row we can't
            // construct a valid blob. Bail rather than corrupt.
            (() => {
                throw new Error("Session metadata is missing");
            })();

        const nextMetadata: Metadata = {
            ...currentMetadata,
            automationContext,
        };
        const encrypted = await encryption.encryptMetadata(nextMetadata);
        const result = await apiSocket.emitWithAck<{
            result: "success" | "version-mismatch" | "error";
            version?: number;
            metadata?: string;
        }>("update-metadata", {
            sid: sessionId,
            metadata: encrypted,
            expectedVersion: session.metadataVersion,
        });
        if (result.result === "success") {
            // Server's update-session SyncUpdate will land via the ingest
            // pipeline and patch local storage; nothing else to do here.
            return;
        }
        if (result.result === "error") {
            throw new Error("Server rejected metadata update");
        }
        // version-mismatch — server's reply carries the fresher version
        // and value. The ingest seam will reconcile local storage shortly;
        // wait briefly then retry from the fresher snapshot.
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error("Metadata update kept losing version race");
}
