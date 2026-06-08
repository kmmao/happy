import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
    emitUpdateMock,
    allocateUserSeqMock,
    randomKeyNakedMock,
    afterTxMock,
    resetState,
} = vi.hoisted(() => {
    const state = {
        nextSeq: 100,
        nextId: "id-1",
        afterTxCallbacks: [] as Array<() => Promise<void> | void>,
    };

    const emitUpdateMock = vi.fn();
    const allocateUserSeqMock = vi.fn(async () => state.nextSeq++);
    const randomKeyNakedMock = vi.fn(() => state.nextId);
    const afterTxMock = vi.fn((_tx: unknown, cb: () => Promise<void> | void) => {
        state.afterTxCallbacks.push(cb);
    });

    const resetState = () => {
        state.nextSeq = 100;
        state.nextId = "id-1";
        state.afterTxCallbacks = [];
        emitUpdateMock.mockClear();
        allocateUserSeqMock.mockClear();
        randomKeyNakedMock.mockClear();
        afterTxMock.mockClear();
    };

    return {
        state,
        emitUpdateMock,
        allocateUserSeqMock,
        randomKeyNakedMock,
        afterTxMock,
        resetState,
    };
});

// After PR 1.f the 15 wire payload constructors live in syncUpdate.ts as
// private helpers, so eventRouter no longer exports them. We only stub
// eventRouter.emitUpdate (the transport sink) — the real builders run end-to-
// end, which means these tests also exercise the wire shape unintrusively.
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitUpdate: emitUpdateMock },
}));

vi.mock("@/storage/inTx", () => ({
    afterTx: afterTxMock,
}));

vi.mock("@/storage/seq", () => ({
    allocateUserSeq: allocateUserSeqMock,
}));

vi.mock("@/utils/randomKeyNaked", () => ({
    randomKeyNaked: randomKeyNakedMock,
}));

vi.mock("@/storage/files", () => ({
    // Only exercised when SyncUpdateBody.update-account carries an avatar; none
    // of these tests do.
    getPublicUrl: vi.fn((path: string) => `https://cdn.test/${path}`),
}));

vi.mock("@/types", () => ({}));

import { emitSyncUpdate, type SyncUpdateBody } from "./syncUpdate";

const A = "account-1";

// === Minimal Row factories — only the fields the real builders touch =====

const nowDate = new Date(0); // deterministic; the builders only read getTime()

function makeSessionRow(overrides: Partial<{ id: string; seq: number }> = {}) {
    return {
        id: overrides.id ?? "session-row",
        seq: overrides.seq ?? 0,
        metadata: "",
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        dataEncryptionKey: null,
        active: true,
        lastActiveAt: nowDate,
        createdAt: nowDate,
        updatedAt: nowDate,
    };
}

function makeMachineRow(overrides: Partial<{ id: string; seq: number }> = {}) {
    return {
        id: overrides.id ?? "machine-row",
        seq: overrides.seq ?? 0,
        metadata: "",
        metadataVersion: 0,
        daemonState: null,
        daemonStateVersion: 0,
        dataEncryptionKey: null,
        active: true,
        lastActiveAt: nowDate,
        createdAt: nowDate,
        updatedAt: nowDate,
    };
}

function makeArtifactRow() {
    return {
        id: "artifact-row",
        seq: 0,
        header: new Uint8Array(0),
        headerVersion: 0,
        body: new Uint8Array(0),
        bodyVersion: 0,
        dataEncryptionKey: new Uint8Array(0),
        createdAt: nowDate,
        updatedAt: nowDate,
    };
}

function makeProjectRow() {
    return {
        id: "project-row",
        machineId: "m-row",
        path: "/p",
        repoUrl: null,
        metadata: null,
        metadataVersion: 0,
        archived: false,
        createdAt: nowDate,
        updatedAt: nowDate,
    };
}

function makeFeedPostRow() {
    return { id: "post-row", body: {}, cursor: "c", createdAt: 0 };
}

function makeMessageRow() {
    return {
        id: "msg-row",
        seq: 0,
        content: { t: "encrypted" as const, c: "x" },
        localId: null,
        createdAt: nowDate,
        updatedAt: nowDate,
    };
}

beforeEach(() => {
    resetState();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("emitSyncUpdate — invariants per body.t", () => {
    type RecipientCase = {
        name: string;
        body: SyncUpdateBody;
        expected: unknown;
    };

    // ADR-0023: body.t → RecipientFilter is a function. The 12 variants below
    // all derive `user-scoped-only`; `update-session`, `new-message`, and
    // `update-machine` derive the session/machine variants verified separately.
    const userScopedCases: RecipientCase[] = [
        { name: "update-account", body: { t: "update-account", profile: { username: "alice" } }, expected: { type: "user-scoped-only" } },
        { name: "new-session", body: { t: "new-session", session: makeSessionRow() }, expected: { type: "user-scoped-only" } },
        { name: "delete-session", body: { t: "delete-session", sessionId: "s1" }, expected: { type: "user-scoped-only" } },
        { name: "new-machine", body: { t: "new-machine", machine: makeMachineRow() }, expected: { type: "user-scoped-only" } },
        { name: "new-feed-post", body: { t: "new-feed-post", post: makeFeedPostRow() }, expected: { type: "user-scoped-only" } },
        { name: "kv-batch-update", body: { t: "kv-batch-update", changes: [] }, expected: { type: "user-scoped-only" } },
        { name: "new-artifact", body: { t: "new-artifact", artifact: makeArtifactRow() }, expected: { type: "user-scoped-only" } },
        { name: "update-artifact", body: { t: "update-artifact", artifactId: "a1" }, expected: { type: "user-scoped-only" } },
        { name: "delete-artifact", body: { t: "delete-artifact", artifactId: "a1" }, expected: { type: "user-scoped-only" } },
        { name: "new-project", body: { t: "new-project", project: makeProjectRow() }, expected: { type: "user-scoped-only" } },
        { name: "update-project", body: { t: "update-project", projectId: "p1" }, expected: { type: "user-scoped-only" } },
        { name: "delete-project", body: { t: "delete-project", projectId: "p1" }, expected: { type: "user-scoped-only" } },
    ];

    for (const c of userScopedCases) {
        it(`${c.name} → user-scoped-only`, async () => {
            await emitSyncUpdate(A, c.body);
            expect(emitUpdateMock).toHaveBeenCalledTimes(1);
            expect(emitUpdateMock.mock.calls[0][0].recipientFilter).toEqual(c.expected);
        });
    }

    it("update-session → all-interested-in-session with sessionId", async () => {
        await emitSyncUpdate(A, { t: "update-session", sessionId: "s7" });
        expect(emitUpdateMock.mock.calls[0][0].recipientFilter).toEqual({
            type: "all-interested-in-session",
            sessionId: "s7",
        });
    });

    it("new-message → all-interested-in-session with sessionId", async () => {
        await emitSyncUpdate(A, {
            t: "new-message",
            sessionId: "s8",
            message: makeMessageRow(),
        });
        expect(emitUpdateMock.mock.calls[0][0].recipientFilter).toEqual({
            type: "all-interested-in-session",
            sessionId: "s8",
        });
    });

    it("update-machine → machine-scoped-only with machineId", async () => {
        await emitSyncUpdate(A, { t: "update-machine", machineId: "m3" });
        expect(emitUpdateMock.mock.calls[0][0].recipientFilter).toEqual({
            type: "machine-scoped-only",
            machineId: "m3",
        });
    });
});

describe("emitSyncUpdate — lifecycle invariants (seq, id, ordering)", () => {
    it("allocates exactly one seq and one id per call", async () => {
        await emitSyncUpdate(A, { t: "update-account", profile: { username: "x" } });
        expect(allocateUserSeqMock).toHaveBeenCalledTimes(1);
        expect(allocateUserSeqMock).toHaveBeenCalledWith(A);
        expect(randomKeyNakedMock).toHaveBeenCalledTimes(1);
        expect(randomKeyNakedMock).toHaveBeenCalledWith(12);
    });

    it("threads the allocated seq + id into the payload", async () => {
        await emitSyncUpdate(A, { t: "delete-session", sessionId: "s1" });
        const payload = emitUpdateMock.mock.calls[0][0].payload;
        expect(payload.seq).toBe(100);
        expect(payload.id).toBe("id-1");
        expect(payload.body.t).toBe("delete-session");
    });

    it("uses accountId as userId on eventRouter.emitUpdate", async () => {
        await emitSyncUpdate(A, { t: "kv-batch-update", changes: [] });
        expect(emitUpdateMock.mock.calls[0][0].userId).toBe(A);
    });

    it("threads accountId into update-account so caller never repeats it", async () => {
        // ADR-0023 detail 1=A: accountId is the single source of truth; the
        // builder receives it from the seam, not from the body.
        await emitSyncUpdate(A, { t: "update-account", profile: { username: "x" } });
        const payload = emitUpdateMock.mock.calls[0][0].payload;
        expect(payload.body.id).toBe(A);
    });

    it("two emits get monotonically increasing seq", async () => {
        await emitSyncUpdate(A, { t: "delete-session", sessionId: "s1" });
        await emitSyncUpdate(A, { t: "delete-session", sessionId: "s2" });
        expect(emitUpdateMock.mock.calls[0][0].payload.seq).toBe(100);
        expect(emitUpdateMock.mock.calls[1][0].payload.seq).toBe(101);
    });
});

describe("emitSyncUpdate — transaction coordination (Q3=A: tx optional)", () => {
    it("without tx: emit fires immediately", async () => {
        await emitSyncUpdate(A, { t: "update-account", profile: { username: "x" } });
        expect(afterTxMock).not.toHaveBeenCalled();
        expect(emitUpdateMock).toHaveBeenCalledTimes(1);
    });

    it("with tx: emit is deferred via afterTx and does not fire yet", async () => {
        const tx = { __tx: true } as any;
        await emitSyncUpdate(A, { t: "kv-batch-update", changes: [] }, { tx });
        expect(afterTxMock).toHaveBeenCalledTimes(1);
        expect(afterTxMock).toHaveBeenCalledWith(tx, expect.any(Function));
        // emit has NOT happened yet — it's scheduled on the afterTx callback
        expect(emitUpdateMock).not.toHaveBeenCalled();
    });

    it("with tx: running the captured afterTx callback fires the emit", async () => {
        const tx = { __tx: true } as any;
        await emitSyncUpdate(A, { t: "delete-session", sessionId: "s1" }, { tx });
        const captured = afterTxMock.mock.calls[0][1];
        await captured();
        expect(emitUpdateMock).toHaveBeenCalledTimes(1);
        expect(emitUpdateMock.mock.calls[0][0].payload.body.t).toBe("delete-session");
    });

    it("with tx: seq is allocated when the callback runs, not when emitSyncUpdate returns", async () => {
        const tx = { __tx: true } as any;
        await emitSyncUpdate(A, { t: "delete-session", sessionId: "s1" }, { tx });
        // The seam scheduled the work — but the seq slot is reserved at
        // emit-time, not at schedule-time. This matches today's afterTx-wrapping
        // pattern in kvMutate / sessionDelete.
        expect(allocateUserSeqMock).not.toHaveBeenCalled();
        await afterTxMock.mock.calls[0][1]();
        expect(allocateUserSeqMock).toHaveBeenCalledTimes(1);
    });
});

describe("emitSyncUpdate — skipSenderConnection forwarding", () => {
    it("forwards skipSenderConnection to eventRouter.emitUpdate when given", async () => {
        const conn = { connectionType: "user-scoped" } as any;
        await emitSyncUpdate(
            A,
            { t: "new-message", sessionId: "s1", message: makeMessageRow() },
            { skipSenderConnection: conn },
        );
        expect(emitUpdateMock.mock.calls[0][0].skipSenderConnection).toBe(conn);
    });

    it("omits skipSenderConnection when not given", async () => {
        await emitSyncUpdate(A, { t: "kv-batch-update", changes: [] });
        expect(emitUpdateMock.mock.calls[0][0].skipSenderConnection).toBeUndefined();
    });
});

describe("emitSyncUpdate — wire payload shape (end-to-end through real builders)", () => {
    // These spot-check the real wire shape that the syncUpdate.ts private
    // builders produce. They complement the per-body-type filter tests above:
    // those tests assert what reaches eventRouter; these assert the body
    // structure is correct so clients can deserialise.

    it("update-session puts metadata/agentState/preferences slots in body", async () => {
        await emitSyncUpdate(A, {
            t: "update-session",
            sessionId: "s1",
            metadata: { value: "m", version: 2 },
            preferences: { value: "p", version: 3 },
        });
        const body = emitUpdateMock.mock.calls[0][0].payload.body;
        expect(body.t).toBe("update-session");
        expect(body.id).toBe("s1");
        expect(body.metadata).toEqual({ value: "m", version: 2 });
        expect(body.preferences).toEqual({ value: "p", version: 3 });
        expect(body.agentState).toBeUndefined();
    });

    it("update-machine puts machineId + versioned fields in body", async () => {
        await emitSyncUpdate(A, {
            t: "update-machine",
            machineId: "m9",
            daemonState: { value: "d", version: 7 },
        });
        const body = emitUpdateMock.mock.calls[0][0].payload.body;
        expect(body.t).toBe("update-machine");
        expect(body.machineId).toBe("m9");
        expect(body.daemonState).toEqual({ value: "d", version: 7 });
    });

    it("delete-session uses 'sid' (not 'id') for the session id in body", async () => {
        // Wire-shape quirk worth pinning: delete-session uses `sid`, while
        // update-session uses `id`. Both refer to the Session being changed.
        await emitSyncUpdate(A, { t: "delete-session", sessionId: "s7" });
        const body = emitUpdateMock.mock.calls[0][0].payload.body;
        expect(body.t).toBe("delete-session");
        expect(body.sid).toBe("s7");
    });

    it("new-message wraps the message and uses 'sid' for sessionId", async () => {
        await emitSyncUpdate(A, {
            t: "new-message",
            sessionId: "s2",
            message: makeMessageRow(),
        });
        const body = emitUpdateMock.mock.calls[0][0].payload.body;
        expect(body.t).toBe("new-message");
        expect(body.sid).toBe("s2");
        expect(body.message.id).toBe("msg-row");
        expect(typeof body.message.createdAt).toBe("number");
    });

    it("kv-batch-update preserves the changes array verbatim", async () => {
        const changes = [
            { key: "k1", value: "v1", version: 1 },
            { key: "k2", value: null, version: -1 },
        ];
        await emitSyncUpdate(A, { t: "kv-batch-update", changes });
        const body = emitUpdateMock.mock.calls[0][0].payload.body;
        expect(body.t).toBe("kv-batch-update");
        expect(body.changes).toEqual(changes);
    });

    it("new-project flattens project row into body fields", async () => {
        await emitSyncUpdate(A, { t: "new-project", project: makeProjectRow() });
        const body = emitUpdateMock.mock.calls[0][0].payload.body;
        expect(body.t).toBe("new-project");
        expect(body.projectId).toBe("project-row");
        expect(body.machineId).toBe("m-row");
        expect(body.archived).toBe(false);
    });
});
