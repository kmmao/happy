import type { SessionMessageContent } from "@kmmao/happy-wire";
import {
    buildDeleteArtifactUpdate,
    buildDeleteProjectUpdate,
    buildDeleteSessionUpdate,
    buildKVBatchUpdateUpdate,
    buildNewArtifactUpdate,
    buildNewFeedPostUpdate,
    buildNewMachineUpdate,
    buildNewMessageUpdate,
    buildNewProjectUpdate,
    buildNewSessionUpdate,
    buildUpdateAccountUpdate,
    buildUpdateArtifactUpdate,
    buildUpdateMachineUpdate,
    buildUpdateProjectUpdate,
    buildUpdateSessionUpdate,
    eventRouter,
    type ClientConnection,
    type RecipientFilter,
    type UpdatePayload,
} from "@/app/events/eventRouter";
import { afterTx, type Tx } from "@/storage/inTx";
import { allocateUserSeq } from "@/storage/seq";
import { AccountProfile } from "@/types";
import { randomKeyNaked } from "@/utils/randomKeyNaked";

/**
 * Server-side SyncUpdate emission seam (CONTEXT.md → SyncUpdate).
 *
 * One entry point: `emitSyncUpdate(accountId, body, options?)`. The module owns
 * the four invariants every emit site used to re-implement:
 *
 *   1. seq    — `allocateUserSeq(accountId)` (ADR-0012, single per-Account
 *               monotonic seq)
 *   2. id     — `randomKeyNaked(12)` (client-side dedup key)
 *   3. filter — `body.t → RecipientFilter` is a derived function (ADR-0023);
 *               callers cannot override. Adding a new SyncUpdate variant is
 *               one case in `SyncUpdateBody`, one case in `recipientFilterFor`,
 *               and one case in `buildPayload` — all in this file.
 *   4. tx     — when `options.tx` is provided, emission is wrapped in
 *               `afterTx(tx, …)`; when absent, emission fires immediately. The
 *               tx mode is the only knob: per ADR-0023 (Q3=A) the tx is
 *               optional in Phase 1, may tighten to required in a future ADR.
 *
 * `eventRouter` remains the transport-level multicast primitive. PR 1.f moves
 * the 15 `build*Update` payload constructors physically into this file.
 */

// === Row types — shapes the SyncUpdateBody variants carry ==============
//
// These mirror the existing build*Update inline signatures one-for-one; they
// are extracted as named aliases so SyncUpdateBody stays readable. PR 1.f
// (which physically moves the builders into this file) absorbs them as the
// builders' own parameter types.

export type VersionedField = { value: string; version: number };
export type NullableVersionedField = { value: string | null; version: number };

export type NewSessionRow = {
    id: string;
    seq: number;
    metadata: string;
    metadataVersion: number;
    agentState: string | null;
    agentStateVersion: number;
    dataEncryptionKey: Uint8Array | null;
    active: boolean;
    lastActiveAt: Date;
    createdAt: Date;
    updatedAt: Date;
    forkedFromSessionId?: string | null;
    parentSessionId?: string | null;
};

export type NewMessageRow = {
    id: string;
    seq: number;
    content: SessionMessageContent;
    localId: string | null;
    createdAt: Date;
    updatedAt: Date;
};

export type NewMachineRow = {
    id: string;
    seq: number;
    metadata: string;
    metadataVersion: number;
    daemonState: string | null;
    daemonStateVersion: number;
    dataEncryptionKey: Uint8Array | null;
    active: boolean;
    lastActiveAt: Date;
    createdAt: Date;
    updatedAt: Date;
};

export type NewArtifactRow = {
    id: string;
    seq: number;
    header: Uint8Array;
    headerVersion: number;
    body: Uint8Array;
    bodyVersion: number;
    dataEncryptionKey: Uint8Array;
    createdAt: Date;
    updatedAt: Date;
};

export type NewProjectRow = {
    id: string;
    machineId: string;
    path: string;
    repoUrl: string | null;
    metadata: string | null;
    metadataVersion: number;
    archived: boolean;
    createdAt: Date;
    updatedAt: Date;
};

export type FeedPostRow = {
    id: string;
    body: any;
    cursor: string;
    createdAt: number;
};

export type KVChange = { key: string; value: string | null; version: number };

// === SyncUpdateBody — the 14 active variants ===========================
//
// `accountId` is NOT carried inside any variant. It is always the first
// parameter to `emitSyncUpdate` (ADR-0023 / detail 1=A); having it in two
// places would invite caller mistakes.
//
// `buildRelationshipUpdatedEvent` exists in eventRouter.ts but has no
// production caller (only its spec exercises it). It is deliberately omitted
// from this union and may be deleted in a future cleanup.

export type SyncUpdateBody =
    | { t: "update-account"; profile: Partial<AccountProfile> }
    | {
          t: "update-session";
          sessionId: string;
          metadata?: VersionedField;
          agentState?: VersionedField;
          preferences?: VersionedField;
      }
    | {
          t: "update-machine";
          machineId: string;
          metadata?: VersionedField;
          daemonState?: VersionedField;
      }
    | { t: "new-session"; session: NewSessionRow }
    | { t: "new-message"; sessionId: string; message: NewMessageRow }
    | { t: "new-machine"; machine: NewMachineRow }
    | { t: "delete-session"; sessionId: string }
    | { t: "new-feed-post"; post: FeedPostRow }
    | { t: "kv-batch-update"; changes: KVChange[] }
    | { t: "new-artifact"; artifact: NewArtifactRow }
    | {
          t: "update-artifact";
          artifactId: string;
          header?: VersionedField;
          body?: VersionedField;
      }
    | { t: "delete-artifact"; artifactId: string }
    | { t: "new-project"; project: NewProjectRow }
    | {
          t: "update-project";
          projectId: string;
          metadata?: NullableVersionedField;
          archived?: boolean;
      }
    | { t: "delete-project"; projectId: string };

export type EmitSyncUpdateOptions = {
    /**
     * When provided, emission is deferred until the surrounding transaction
     * commits via {@link afterTx}. `tx` must come from {@link inTx} — passing
     * a foreign TransactionClient throws (afterTx's own invariant). When
     * absent, emission fires immediately after `await emitSyncUpdate(…)`.
     */
    tx?: Tx;
    /**
     * Suppress echo to the originating socket connection. Used by socket
     * handlers that already replied to the caller via the same emit.
     */
    skipSenderConnection?: ClientConnection;
};

/**
 * Emit a SyncUpdate to the connections that need to know.
 *
 * Callers express only the domain change (`accountId`, `body`); the seam
 * derives the recipient set, allocates the seq, generates the update id,
 * builds the wire payload, and dispatches through {@link eventRouter}. See
 * ADR-0023 for the load-bearing decisions this seam encodes.
 */
export async function emitSyncUpdate(
    accountId: string,
    body: SyncUpdateBody,
    options?: EmitSyncUpdateOptions,
): Promise<void> {
    const emit = async () => {
        const seq = await allocateUserSeq(accountId);
        const id = randomKeyNaked(12);
        const payload = buildPayload(accountId, body, seq, id);
        eventRouter.emitUpdate({
            userId: accountId,
            payload,
            recipientFilter: recipientFilterFor(body),
            skipSenderConnection: options?.skipSenderConnection,
        });
    };

    if (options?.tx) {
        afterTx(options.tx, emit);
        return;
    }
    await emit();
}

// === Internal: body.t → RecipientFilter ================================
//
// Switch is exhaustive over `SyncUpdateBody["t"]`; TypeScript catches a
// missing case at compile time. Adding a variant is the same patch as adding
// it to `buildPayload` below — both in this file.

function recipientFilterFor(body: SyncUpdateBody): RecipientFilter {
    switch (body.t) {
        case "update-account":
        case "new-session":
        case "delete-session":
        case "new-machine":
        case "new-feed-post":
        case "kv-batch-update":
        case "new-artifact":
        case "update-artifact":
        case "delete-artifact":
        case "new-project":
        case "update-project":
        case "delete-project":
            return { type: "user-scoped-only" };
        case "update-machine":
            return { type: "machine-scoped-only", machineId: body.machineId };
        case "update-session":
            return { type: "all-interested-in-session", sessionId: body.sessionId };
        case "new-message":
            return { type: "all-interested-in-session", sessionId: body.sessionId };
    }
}

// === Internal: body → UpdatePayload ====================================
//
// Phase 1.a delegates to the 15 existing `build*Update` exports in
// eventRouter.ts. PR 1.f moves them physically into this file as private
// helpers; this switch shape stays unchanged.

function buildPayload(
    accountId: string,
    body: SyncUpdateBody,
    seq: number,
    id: string,
): UpdatePayload {
    switch (body.t) {
        case "update-account":
            return buildUpdateAccountUpdate(accountId, body.profile, seq, id);
        case "update-session":
            return buildUpdateSessionUpdate(
                body.sessionId,
                seq,
                id,
                body.metadata,
                body.agentState,
                body.preferences,
            );
        case "update-machine":
            return buildUpdateMachineUpdate(
                body.machineId,
                seq,
                id,
                body.metadata,
                body.daemonState,
            );
        case "new-session":
            return buildNewSessionUpdate(body.session, seq, id);
        case "new-message":
            return buildNewMessageUpdate(body.message, body.sessionId, seq, id);
        case "new-machine":
            return buildNewMachineUpdate(body.machine, seq, id);
        case "delete-session":
            return buildDeleteSessionUpdate(body.sessionId, seq, id);
        case "new-feed-post":
            return buildNewFeedPostUpdate(body.post, seq, id);
        case "kv-batch-update":
            return buildKVBatchUpdateUpdate(body.changes, seq, id);
        case "new-artifact":
            return buildNewArtifactUpdate(body.artifact, seq, id);
        case "update-artifact":
            return buildUpdateArtifactUpdate(
                body.artifactId,
                seq,
                id,
                body.header,
                body.body,
            );
        case "delete-artifact":
            return buildDeleteArtifactUpdate(body.artifactId, seq, id);
        case "new-project":
            return buildNewProjectUpdate(body.project, seq, id);
        case "update-project":
            return buildUpdateProjectUpdate(
                body.projectId,
                seq,
                id,
                body.metadata,
                body.archived,
            );
        case "delete-project":
            return buildDeleteProjectUpdate(body.projectId, seq, id);
    }
}
