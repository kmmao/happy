import type { SessionMessageContent } from "@kmmao/happy-wire";
import {
    eventRouter,
    type ClientConnection,
    type RecipientFilter,
    type UpdatePayload,
} from "@/app/events/eventRouter";
import { afterTx, type Tx } from "@/storage/inTx";
import { allocateUserSeq } from "@/storage/seq";
import { getPublicUrl } from "@/storage/files";
import { AccountProfile } from "@/types";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import * as privacyKit from "privacy-kit";

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
 * `eventRouter` remains the transport-level multicast primitive. The 15 wire
 * payload constructors live in this file as private helpers (PR 1.f physically
 * moved them out of eventRouter.ts).
 */

// === Row types — shapes the SyncUpdateBody variants carry ==============
//
// These mirror the historical build*Update inline signatures one-for-one and
// are extracted as named aliases so SyncUpdateBody stays readable.

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
// Dispatch + the 15 wire payload constructors. Names are `*Payload` to mark
// them as private to this seam (the old `*Update` exports on eventRouter.ts
// were removed in PR 1.f). Adding a new SyncUpdate variant adds one case
// here, one case in recipientFilterFor, and one entry in SyncUpdateBody —
// all in this file. TypeScript exhaustiveness checks the switch at compile
// time.

function buildPayload(
    accountId: string,
    body: SyncUpdateBody,
    seq: number,
    id: string,
): UpdatePayload {
    switch (body.t) {
        case "update-account":
            return buildUpdateAccountPayload(accountId, body.profile, seq, id);
        case "update-session":
            return buildUpdateSessionPayload(
                body.sessionId,
                seq,
                id,
                body.metadata,
                body.agentState,
                body.preferences,
            );
        case "update-machine":
            return buildUpdateMachinePayload(
                body.machineId,
                seq,
                id,
                body.metadata,
                body.daemonState,
            );
        case "new-session":
            return buildNewSessionPayload(body.session, seq, id);
        case "new-message":
            return buildNewMessagePayload(body.message, body.sessionId, seq, id);
        case "new-machine":
            return buildNewMachinePayload(body.machine, seq, id);
        case "delete-session":
            return buildDeleteSessionPayload(body.sessionId, seq, id);
        case "new-feed-post":
            return buildNewFeedPostPayload(body.post, seq, id);
        case "kv-batch-update":
            return buildKVBatchUpdatePayload(body.changes, seq, id);
        case "new-artifact":
            return buildNewArtifactPayload(body.artifact, seq, id);
        case "update-artifact":
            return buildUpdateArtifactPayload(
                body.artifactId,
                seq,
                id,
                body.header,
                body.body,
            );
        case "delete-artifact":
            return buildDeleteArtifactPayload(body.artifactId, seq, id);
        case "new-project":
            return buildNewProjectPayload(body.project, seq, id);
        case "update-project":
            return buildUpdateProjectPayload(
                body.projectId,
                seq,
                id,
                body.metadata,
                body.archived,
            );
        case "delete-project":
            return buildDeleteProjectPayload(body.projectId, seq, id);
    }
}

function buildUpdateAccountPayload(
    userId: string,
    profile: Partial<AccountProfile>,
    updateSeq: number,
    updateId: string,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: {
            t: "update-account",
            id: userId,
            ...profile,
            avatar: profile.avatar
                ? { ...profile.avatar, url: getPublicUrl(profile.avatar.path) }
                : undefined,
        },
        createdAt: Date.now(),
    };
}

function buildNewSessionPayload(
    session: NewSessionRow,
    updateSeq: number,
    updateId: string,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: {
            t: "new-session",
            id: session.id,
            seq: session.seq,
            metadata: session.metadata,
            metadataVersion: session.metadataVersion,
            agentState: session.agentState,
            agentStateVersion: session.agentStateVersion,
            dataEncryptionKey: session.dataEncryptionKey
                ? privacyKit.encodeBase64(new Uint8Array(session.dataEncryptionKey))
                : null,
            active: session.active,
            activeAt: session.lastActiveAt.getTime(),
            createdAt: session.createdAt.getTime(),
            updatedAt: session.updatedAt.getTime(),
            forkedFromSessionId: session.forkedFromSessionId ?? null,
            parentSessionId: session.parentSessionId ?? null,
        },
        createdAt: Date.now(),
    };
}

function buildNewMessagePayload(
    message: NewMessageRow,
    sessionId: string,
    updateSeq: number,
    updateId: string,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: {
            t: "new-message",
            sid: sessionId,
            message: {
                id: message.id,
                seq: message.seq,
                content: message.content,
                localId: message.localId,
                createdAt: message.createdAt.getTime(),
                updatedAt: message.updatedAt.getTime(),
            },
        },
        createdAt: Date.now(),
    };
}

function buildUpdateSessionPayload(
    sessionId: string,
    updateSeq: number,
    updateId: string,
    metadata?: VersionedField,
    agentState?: VersionedField,
    preferences?: VersionedField,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: {
            t: "update-session",
            id: sessionId,
            metadata,
            agentState,
            preferences,
        },
        createdAt: Date.now(),
    };
}

function buildDeleteSessionPayload(
    sessionId: string,
    updateSeq: number,
    updateId: string,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: { t: "delete-session", sid: sessionId },
        createdAt: Date.now(),
    };
}

function buildNewMachinePayload(
    machine: NewMachineRow,
    updateSeq: number,
    updateId: string,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: {
            t: "new-machine",
            machineId: machine.id,
            seq: machine.seq,
            metadata: machine.metadata,
            metadataVersion: machine.metadataVersion,
            daemonState: machine.daemonState,
            daemonStateVersion: machine.daemonStateVersion,
            dataEncryptionKey: machine.dataEncryptionKey
                ? privacyKit.encodeBase64(new Uint8Array(machine.dataEncryptionKey))
                : null,
            active: machine.active,
            activeAt: machine.lastActiveAt.getTime(),
            createdAt: machine.createdAt.getTime(),
            updatedAt: machine.updatedAt.getTime(),
        },
        createdAt: Date.now(),
    };
}

function buildUpdateMachinePayload(
    machineId: string,
    updateSeq: number,
    updateId: string,
    metadata?: VersionedField,
    daemonState?: VersionedField,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: { t: "update-machine", machineId, metadata, daemonState },
        createdAt: Date.now(),
    };
}

function buildNewArtifactPayload(
    artifact: NewArtifactRow,
    updateSeq: number,
    updateId: string,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: {
            t: "new-artifact",
            artifactId: artifact.id,
            seq: artifact.seq,
            header: privacyKit.encodeBase64(new Uint8Array(artifact.header)),
            headerVersion: artifact.headerVersion,
            body: privacyKit.encodeBase64(new Uint8Array(artifact.body)),
            bodyVersion: artifact.bodyVersion,
            dataEncryptionKey: privacyKit.encodeBase64(new Uint8Array(artifact.dataEncryptionKey)),
            createdAt: artifact.createdAt.getTime(),
            updatedAt: artifact.updatedAt.getTime(),
        },
        createdAt: Date.now(),
    };
}

function buildUpdateArtifactPayload(
    artifactId: string,
    updateSeq: number,
    updateId: string,
    header?: VersionedField,
    body?: VersionedField,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: { t: "update-artifact", artifactId, header, body },
        createdAt: Date.now(),
    };
}

function buildDeleteArtifactPayload(
    artifactId: string,
    updateSeq: number,
    updateId: string,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: { t: "delete-artifact", artifactId },
        createdAt: Date.now(),
    };
}

function buildNewFeedPostPayload(
    feedItem: FeedPostRow,
    updateSeq: number,
    updateId: string,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: {
            t: "new-feed-post",
            id: feedItem.id,
            body: feedItem.body,
            cursor: feedItem.cursor,
            createdAt: feedItem.createdAt,
        },
        createdAt: Date.now(),
    };
}

function buildKVBatchUpdatePayload(
    changes: KVChange[],
    updateSeq: number,
    updateId: string,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: { t: "kv-batch-update", changes },
        createdAt: Date.now(),
    };
}

function buildNewProjectPayload(
    project: NewProjectRow,
    updateSeq: number,
    updateId: string,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: {
            t: "new-project",
            projectId: project.id,
            machineId: project.machineId,
            path: project.path,
            repoUrl: project.repoUrl,
            metadata: project.metadata,
            metadataVersion: project.metadataVersion,
            archived: project.archived,
            createdAt: project.createdAt.getTime(),
            updatedAt: project.updatedAt.getTime(),
        },
        createdAt: Date.now(),
    };
}

function buildUpdateProjectPayload(
    projectId: string,
    updateSeq: number,
    updateId: string,
    metadata?: NullableVersionedField,
    archived?: boolean,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: { t: "update-project", projectId, metadata, archived },
        createdAt: Date.now(),
    };
}

function buildDeleteProjectPayload(
    projectId: string,
    updateSeq: number,
    updateId: string,
): UpdatePayload {
    return {
        id: updateId,
        seq: updateSeq,
        body: { t: "delete-project", projectId },
        createdAt: Date.now(),
    };
}
