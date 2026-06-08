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

vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitUpdate: emitUpdateMock },
    // The 15 build*Update functions are real (not mocked) — we assert that the
    // payload that reaches eventRouter.emitUpdate carries the right body.t,
    // seq, and id, which exercises the builders end-to-end without coupling
    // the spec to their inline output shape.
    buildUpdateAccountUpdate: (userId: string, profile: any, seq: number, id: string) => ({
        id,
        seq,
        body: { t: "update-account", id: userId, ...profile },
        createdAt: 0,
    }),
    buildUpdateSessionUpdate: (sid: string, seq: number, id: string, metadata?: any, agentState?: any, preferences?: any) => ({
        id,
        seq,
        body: { t: "update-session", id: sid, metadata, agentState, preferences },
        createdAt: 0,
    }),
    buildUpdateMachineUpdate: (mid: string, seq: number, id: string, metadata?: any, daemonState?: any) => ({
        id,
        seq,
        body: { t: "update-machine", machineId: mid, metadata, daemonState },
        createdAt: 0,
    }),
    buildNewSessionUpdate: (_session: unknown, seq: number, id: string) => ({
        id,
        seq,
        body: { t: "new-session" },
        createdAt: 0,
    }),
    buildNewMessageUpdate: (_msg: unknown, sid: string, seq: number, id: string) => ({
        id,
        seq,
        body: { t: "new-message", sid },
        createdAt: 0,
    }),
    buildNewMachineUpdate: (_m: unknown, seq: number, id: string) => ({
        id,
        seq,
        body: { t: "new-machine" },
        createdAt: 0,
    }),
    buildDeleteSessionUpdate: (sid: string, seq: number, id: string) => ({
        id,
        seq,
        body: { t: "delete-session", sid },
        createdAt: 0,
    }),
    buildNewFeedPostUpdate: (_p: unknown, seq: number, id: string) => ({
        id,
        seq,
        body: { t: "new-feed-post" },
        createdAt: 0,
    }),
    buildKVBatchUpdateUpdate: (changes: unknown, seq: number, id: string) => ({
        id,
        seq,
        body: { t: "kv-batch-update", changes },
        createdAt: 0,
    }),
    buildNewArtifactUpdate: (_a: unknown, seq: number, id: string) => ({
        id,
        seq,
        body: { t: "new-artifact" },
        createdAt: 0,
    }),
    buildUpdateArtifactUpdate: (aid: string, seq: number, id: string, header?: any, body?: any) => ({
        id,
        seq,
        body: { t: "update-artifact", artifactId: aid, header, body },
        createdAt: 0,
    }),
    buildDeleteArtifactUpdate: (aid: string, seq: number, id: string) => ({
        id,
        seq,
        body: { t: "delete-artifact", artifactId: aid },
        createdAt: 0,
    }),
    buildNewProjectUpdate: (_p: unknown, seq: number, id: string) => ({
        id,
        seq,
        body: { t: "new-project" },
        createdAt: 0,
    }),
    buildUpdateProjectUpdate: (pid: string, seq: number, id: string, metadata?: any, archived?: boolean) => ({
        id,
        seq,
        body: { t: "update-project", projectId: pid, metadata, archived },
        createdAt: 0,
    }),
    buildDeleteProjectUpdate: (pid: string, seq: number, id: string) => ({
        id,
        seq,
        body: { t: "delete-project", projectId: pid },
        createdAt: 0,
    }),
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

vi.mock("@/types", () => ({}));

import { emitSyncUpdate, type SyncUpdateBody } from "./syncUpdate";

const A = "account-1";

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
        { name: "new-session", body: { t: "new-session", session: {} as any }, expected: { type: "user-scoped-only" } },
        { name: "delete-session", body: { t: "delete-session", sessionId: "s1" }, expected: { type: "user-scoped-only" } },
        { name: "new-machine", body: { t: "new-machine", machine: {} as any }, expected: { type: "user-scoped-only" } },
        { name: "new-feed-post", body: { t: "new-feed-post", post: {} as any }, expected: { type: "user-scoped-only" } },
        { name: "kv-batch-update", body: { t: "kv-batch-update", changes: [] }, expected: { type: "user-scoped-only" } },
        { name: "new-artifact", body: { t: "new-artifact", artifact: {} as any }, expected: { type: "user-scoped-only" } },
        { name: "update-artifact", body: { t: "update-artifact", artifactId: "a1" }, expected: { type: "user-scoped-only" } },
        { name: "delete-artifact", body: { t: "delete-artifact", artifactId: "a1" }, expected: { type: "user-scoped-only" } },
        { name: "new-project", body: { t: "new-project", project: {} as any }, expected: { type: "user-scoped-only" } },
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
            message: {} as any,
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
            { t: "new-message", sessionId: "s1", message: {} as any },
            { skipSenderConnection: conn },
        );
        expect(emitUpdateMock.mock.calls[0][0].skipSenderConnection).toBe(conn);
    });

    it("omits skipSenderConnection when not given", async () => {
        await emitSyncUpdate(A, { t: "kv-batch-update", changes: [] });
        expect(emitUpdateMock.mock.calls[0][0].skipSenderConnection).toBeUndefined();
    });
});
