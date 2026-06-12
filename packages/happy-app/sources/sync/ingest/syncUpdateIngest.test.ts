import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared mock state. The seam imports `../storage` (Zustand store),
// `@/log` (logger), `../issueSessionStore`, and `../issueSessionTypes`;
// all are mocked below.
const mocks = vi.hoisted(() => {
    const storageState = {
        machines: {} as Record<string, any>,
        users: {} as Record<string, any>,
        applyMachines: vi.fn(),
        applyRelationshipUpdate: vi.fn(),
        applyFeedItems: vi.fn(),
    };
    const issueSessionState = {
        handleKvUpdate: vi.fn(async () => {}),
        findBySessionId: vi.fn(() => null as any),
        updateStatus: vi.fn(async () => {}),
    };
    return {
        storageState,
        getStateMock: vi.fn(() => storageState),
        issueSessionGetState: vi.fn(() => issueSessionState),
        isIssueSessionKey: vi.fn((_k: string) => false),
        logError: vi.fn(),
        logWarn: vi.fn(),
        logLog: vi.fn(),
    };
});

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

vi.mock("react-native-mmkv", () => ({
    MMKV: class {
        getString() { return undefined; }
        set() {}
        delete() {}
        clearAll() {}
    },
}));

vi.mock("../storage", () => ({
    storage: { getState: mocks.getStateMock },
    ingestStorage: { getState: mocks.getStateMock },
}));

vi.mock("../issueSessionStore", () => ({
    issueSessionStore: { getState: mocks.issueSessionGetState },
}));

vi.mock("../issueSessionTypes", () => ({
    isIssueSessionKey: mocks.isIssueSessionKey,
}));

vi.mock("@/log", () => ({
    log: { log: mocks.logLog, warn: mocks.logWarn, error: mocks.logError },
}));

// The seam transitively imports modules that pull in Expo native runtime
// when loaded outside an Expo host. Stub them here.
vi.mock("../gitWorktreeOps", () => ({ removeWorktree: vi.fn() }));
vi.mock("../messageCache", () => ({
    deleteMessageCache: vi.fn(),
    deleteHistoryComplete: vi.fn(),
}));
vi.mock("../persistence", () => ({ deleteBackfillBoundary: vi.fn() }));
vi.mock("../sessionScopedStore", () => ({
    disposeSessionScopedState: vi.fn(),
}));
vi.mock("../updateSessionMerge", () => ({
    mergeUpdatedSession: vi.fn((args: any) => ({
        updatedSession: { ...args.session, seq: args.seq },
        metadataDecryptFailed: false,
    })),
}));
vi.mock("../encryption/artifactEncryption", () => {
    class ArtifactEncryption {
        constructor(public key: Uint8Array) {}
        decryptHeader = vi.fn(async () => ({ title: "stub" }));
        decryptBody = vi.fn(async () => ({ body: "stub" }));
    }
    return { ArtifactEncryption };
});
vi.mock("../syncEncryptionScope", () => ({
    resolveSessionEncryption: vi.fn(),
    resolveMachineEncryption: vi.fn(),
}));
vi.mock("../settings", () => ({
    settingsParse: vi.fn((v: unknown) => ({ schemaVersion: 1, raw: v })),
    SUPPORTED_SCHEMA_VERSION: 1,
}));

vi.mock("../typesRaw", () => ({
    normalizeRawMessage: vi.fn((id: string, localId: string, createdAt: number) => ({
        id,
        localId,
        createdAt,
        role: "user",
        content: { text: "stub" },
    })),
    extractPromptSuggestionFromRaw: vi.fn(() => null),
    extractNeedsContinueFromRaw: vi.fn(() => false),
    extractSessionStateFromRaw: vi.fn(() => null),
    extractTerminalSignalFromRaw: vi.fn(() => null),
    isUserMessageRaw: vi.fn(() => false),
}));

vi.mock("@/utils/sessionUtils", () => ({
    getLatestUserRequestPreview: vi.fn(() => ({ text: "preview", isAutoOptionSend: false })),
}));

vi.mock("../syncHelpers", () => ({
    detectNeedsAttention: vi.fn(() => false),
}));

import { ingestSyncUpdate } from "./syncUpdateIngest";
import type { IngestContext } from "./ingestContext";
import type { ApiUpdateContainer } from "../apiTypes";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const NEW_KEY = new Uint8Array([1, 2, 3, 4]);

function makeNewMachineUpdate(
    overrides: Partial<{
        machineId: string;
        seq: number;
        metadata: string;
        metadataVersion: number;
        daemonState: string | null | undefined;
        daemonStateVersion: number;
        dataEncryptionKey: string | null | undefined;
        active: boolean;
        activeAt: number;
        createdAt: number;
        updatedAt: number;
    }> = {},
): ApiUpdateContainer {
    return {
        id: "update-1",
        seq: 1,
        createdAt: 1000,
        body: {
            t: "new-machine",
            machineId: overrides.machineId ?? "machine-1",
            seq: overrides.seq ?? 5,
            metadata: overrides.metadata ?? "enc-metadata",
            metadataVersion: overrides.metadataVersion ?? 2,
            daemonState:
                overrides.daemonState === undefined
                    ? "enc-daemon"
                    : overrides.daemonState,
            daemonStateVersion: overrides.daemonStateVersion ?? 3,
            dataEncryptionKey:
                overrides.dataEncryptionKey === undefined
                    ? "enc-key"
                    : overrides.dataEncryptionKey,
            active: overrides.active ?? true,
            activeAt: overrides.activeAt ?? 1234,
            createdAt: overrides.createdAt ?? 1000,
            updatedAt: overrides.updatedAt ?? 2000,
        },
    };
}

type MachineEncryptionDouble = {
    decryptMetadata: ReturnType<typeof vi.fn>;
    decryptDaemonState: ReturnType<typeof vi.fn>;
};

type Doubles = {
    decryptEncryptionKey: ReturnType<typeof vi.fn>;
    initializeMachines: ReturnType<typeof vi.fn>;
    getMachineEncryption: ReturnType<typeof vi.fn>;
    machineEncryption: MachineEncryptionDouble;
    machineDataKeysSet: ReturnType<typeof vi.fn>;
    sessionsAwaitQueue: ReturnType<typeof vi.fn>;
    sessionsForceRefetch: ReturnType<typeof vi.fn>;
    machinesAwaitQueue: ReturnType<typeof vi.fn>;
    machinesForceRefetch: ReturnType<typeof vi.fn>;
    assumeUsers: ReturnType<typeof vi.fn>;
    applySessions: ReturnType<typeof vi.fn>;
    onSessionVisible: ReturnType<typeof vi.fn>;
    artifactDataKeysGet: ReturnType<typeof vi.fn>;
    artifactDataKeysSet: ReturnType<typeof vi.fn>;
    artifactDataKeysDelete: ReturnType<typeof vi.fn>;
    enqueueMessages: ReturnType<typeof vi.fn>;
    addActivityUpdate: ReturnType<typeof vi.fn>;
};

function makeCtx(
    overrides: {
        decryptEncryptionKey?: ReturnType<typeof vi.fn>;
        getMachineEncryption?: ReturnType<typeof vi.fn>;
        machineEncryption?: MachineEncryptionDouble;
    } = {},
): { ctx: IngestContext; doubles: Doubles } {
    const machineEncryption: MachineEncryptionDouble = overrides.machineEncryption ?? {
        decryptMetadata: vi.fn().mockResolvedValue({ host: "h1" }),
        decryptDaemonState: vi.fn().mockResolvedValue({ status: "running" }),
    };
    const decryptEncryptionKey =
        overrides.decryptEncryptionKey ?? vi.fn().mockResolvedValue(NEW_KEY);
    const getMachineEncryption =
        overrides.getMachineEncryption ?? vi.fn().mockReturnValue(machineEncryption);
    const initializeMachines = vi.fn().mockResolvedValue(undefined);
    const machineDataKeysSet = vi.fn();
    const sessionsAwaitQueue = vi.fn().mockResolvedValue(undefined);
    const sessionsForceRefetch = vi.fn();
    const machinesAwaitQueue = vi.fn().mockResolvedValue(undefined);
    const machinesForceRefetch = vi.fn();
    const assumeUsers = vi.fn().mockResolvedValue(undefined);
    const applySessions = vi.fn();
    const onSessionVisible = vi.fn();
    const artifactDataKeysGet = vi.fn();
    const artifactDataKeysSet = vi.fn();
    const artifactDataKeysDelete = vi.fn();
    const enqueueMessages = vi.fn();
    const addActivityUpdate = vi.fn();

    const ctx: IngestContext = {
        encryption: {
            decryptEncryptionKey,
            initializeMachines,
            getMachineEncryption,
        } as any,
        cursor: {
            get: vi.fn() as any,
            delete: vi.fn(),
        },
        sessionsSync: {
            awaitQueue: sessionsAwaitQueue,
            forceRefetch: sessionsForceRefetch,
        },
        machinesSync: {
            awaitQueue: machinesAwaitQueue,
            forceRefetch: machinesForceRefetch,
        },
        machineDataKeys: { set: machineDataKeysSet },
        assumeUsers,
        applySessions,
        onSessionVisible,
        artifactDataKeys: {
            get: artifactDataKeysGet,
            set: artifactDataKeysSet,
            delete: artifactDataKeysDelete,
        },
        enqueueMessages,
        addActivityUpdate,
    };

    return {
        ctx,
        doubles: {
            decryptEncryptionKey,
            initializeMachines,
            getMachineEncryption,
            machineEncryption,
            machineDataKeysSet,
            sessionsAwaitQueue,
            sessionsForceRefetch,
            machinesAwaitQueue,
            machinesForceRefetch,
            assumeUsers,
            applySessions,
            onSessionVisible,
            artifactDataKeysGet,
            artifactDataKeysSet,
            artifactDataKeysDelete,
            enqueueMessages,
            addActivityUpdate,
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ingestSyncUpdate (exhaustiveness)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storageState.machines = {};
    });

    it("throws on an unknown body.t variant (defensive default branch)", async () => {
        const { ctx } = makeCtx();
        const update: ApiUpdateContainer = {
            id: "u1",
            seq: 1,
            createdAt: 1,
            body: { t: "totally-unknown-variant" } as any,
        };

        await expect(ingestSyncUpdate(update, ctx)).rejects.toThrow(
            /unhandled body\.t 'totally-unknown-variant'/,
        );
    });
});

describe("ingestSyncUpdate: new-machine", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storageState.machines = {};
    });

    it("decrypts the data encryption key once, mirrors it into machineDataKeys, and registers the machine encryption", async () => {
        const { ctx, doubles } = makeCtx();

        const events = await ingestSyncUpdate(makeNewMachineUpdate(), ctx);

        expect(events).toEqual([]);
        expect(doubles.decryptEncryptionKey).toHaveBeenCalledTimes(1);
        expect(doubles.decryptEncryptionKey).toHaveBeenCalledWith("enc-key");
        expect(doubles.initializeMachines).toHaveBeenCalledTimes(1);
        // The initializeMachines argument is a Map keyed by machineId with the
        // decrypted Uint8Array as value.
        const initArg = doubles.initializeMachines.mock.calls[0][0] as Map<
            string,
            Uint8Array | null
        >;
        expect(initArg.get("machine-1")).toBe(NEW_KEY);
        expect(doubles.machineDataKeysSet).toHaveBeenCalledTimes(1);
        expect(doubles.machineDataKeysSet).toHaveBeenCalledWith("machine-1", NEW_KEY);
    });

    it("applies the new machine to storage with decrypted metadata and daemonState", async () => {
        const { ctx, doubles } = makeCtx();

        await ingestSyncUpdate(makeNewMachineUpdate(), ctx);

        expect(doubles.machineEncryption.decryptMetadata).toHaveBeenCalledWith(
            2,
            "enc-metadata",
        );
        expect(doubles.machineEncryption.decryptDaemonState).toHaveBeenCalledWith(
            3,
            "enc-daemon",
        );
        expect(mocks.storageState.applyMachines).toHaveBeenCalledTimes(1);
        const applied = mocks.storageState.applyMachines.mock.calls[0][0][0];
        expect(applied).toMatchObject({
            id: "machine-1",
            seq: 5,
            active: true,
            activeAt: 1234,
            createdAt: 1000,
            updatedAt: 2000,
            rpcReady: false,
            metadata: { host: "h1" },
            metadataVersion: 2,
            daemonState: { status: "running" },
            daemonStateVersion: 3,
        });
    });

    it("preserves existing createdAt and rpcReady when re-onboarding a known machine", async () => {
        mocks.storageState.machines = {
            "machine-1": { createdAt: 500, rpcReady: true },
        };
        const { ctx } = makeCtx();

        await ingestSyncUpdate(makeNewMachineUpdate(), ctx);

        const applied = mocks.storageState.applyMachines.mock.calls[0][0][0];
        expect(applied.createdAt).toBe(500); // existing wins
        expect(applied.rpcReady).toBe(true); // existing wins
    });

    it("registers a null key (still calls initializeMachines) when dataEncryptionKey is missing on the update", async () => {
        const { ctx, doubles } = makeCtx();

        await ingestSyncUpdate(
            makeNewMachineUpdate({ dataEncryptionKey: null }),
            ctx,
        );

        expect(doubles.decryptEncryptionKey).not.toHaveBeenCalled();
        expect(doubles.machineDataKeysSet).not.toHaveBeenCalled();
        const initArg = doubles.initializeMachines.mock.calls[0][0] as Map<
            string,
            Uint8Array | null
        >;
        expect(initArg.get("machine-1")).toBeNull();
        // Machine is still applied — metadata/daemonState use whichever encryption
        // (legacy / open) the Encryption module returns from getMachineEncryption.
        expect(mocks.storageState.applyMachines).toHaveBeenCalledTimes(1);
    });

    it("logs an error and still applies the machine with a null key when decryption of the data key fails", async () => {
        const decryptEncryptionKey = vi.fn().mockResolvedValue(null);
        const { ctx, doubles } = makeCtx({ decryptEncryptionKey });

        await ingestSyncUpdate(makeNewMachineUpdate(), ctx);

        expect(mocks.logError).toHaveBeenCalledWith(
            expect.stringContaining("Failed to decrypt data encryption key for new machine machine-1"),
        );
        const initArg = doubles.initializeMachines.mock.calls[0][0] as Map<
            string,
            Uint8Array | null
        >;
        expect(initArg.get("machine-1")).toBeNull();
        expect(doubles.machineDataKeysSet).not.toHaveBeenCalled();
        expect(mocks.storageState.applyMachines).toHaveBeenCalledTimes(1);
    });

    it("logs and skips the apply when no MachineEncryption is registered after init (defensive)", async () => {
        const getMachineEncryption = vi.fn().mockReturnValue(null);
        const { ctx } = makeCtx({ getMachineEncryption });

        const events = await ingestSyncUpdate(makeNewMachineUpdate(), ctx);

        expect(events).toEqual([]);
        expect(mocks.logError).toHaveBeenCalledWith(
            expect.stringContaining("Machine encryption not found for machine-1"),
        );
        expect(mocks.storageState.applyMachines).not.toHaveBeenCalled();
    });

    it("still applies the machine (with null fields) when metadata decryption throws — best-effort fallback matches fetchMachines", async () => {
        const machineEncryption: MachineEncryptionDouble = {
            decryptMetadata: vi.fn().mockRejectedValue(new Error("bad metadata")),
            decryptDaemonState: vi.fn().mockResolvedValue({ status: "running" }),
        };
        const { ctx } = makeCtx({ machineEncryption });

        await ingestSyncUpdate(makeNewMachineUpdate(), ctx);

        expect(mocks.logError).toHaveBeenCalledWith(
            expect.stringContaining("Failed to decrypt new machine machine-1"),
            expect.any(Error),
        );
        // Apply still fires; both metadata and daemonState are null because
        // the try/catch wraps both calls (the first throw aborts the second).
        expect(mocks.storageState.applyMachines).toHaveBeenCalledTimes(1);
        const applied = mocks.storageState.applyMachines.mock.calls[0][0][0];
        expect(applied.metadata).toBeNull();
        expect(applied.daemonState).toBeNull();
    });

    it("treats an empty-string metadata field as 'nothing to decrypt' and applies null", async () => {
        const { ctx, doubles } = makeCtx();

        await ingestSyncUpdate(
            makeNewMachineUpdate({ metadata: "", daemonState: null }),
            ctx,
        );

        expect(doubles.machineEncryption.decryptMetadata).not.toHaveBeenCalled();
        expect(doubles.machineEncryption.decryptDaemonState).not.toHaveBeenCalled();
        const applied = mocks.storageState.applyMachines.mock.calls[0][0][0];
        expect(applied.metadata).toBeNull();
        expect(applied.daemonState).toBeNull();
    });

    it("returns an empty event list — new-machine has no subscriber today (ADR-0026 F1)", async () => {
        const { ctx } = makeCtx();

        const events = await ingestSyncUpdate(makeNewMachineUpdate(), ctx);

        expect(events).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// PR 3 — one-liner / small handlers
// ---------------------------------------------------------------------------

function makeUpdate(body: any): ApiUpdateContainer {
    return { id: "u1", seq: 1, createdAt: 1, body };
}

describe("ingestSyncUpdate: new-session", () => {
    beforeEach(() => vi.clearAllMocks());

    it("emits a single 'sessions-stale' event and does not touch storage", async () => {
        const { ctx } = makeCtx();

        const events = await ingestSyncUpdate(
            makeUpdate({ t: "new-session", id: "sid" }),
            ctx,
        );

        expect(events).toEqual([{ kind: "sessions-stale" }]);
        expect(mocks.storageState.applyMachines).not.toHaveBeenCalled();
    });
});

describe("ingestSyncUpdate: relationship-updated", () => {
    beforeEach(() => vi.clearAllMocks());

    it("applies the relationship update to storage and emits three stale events", async () => {
        const { ctx } = makeCtx();
        const body = {
            t: "relationship-updated",
            fromUserId: "user-a",
            toUserId: "user-b",
            status: "friends" as const,
            action: "accept" as const,
            fromUser: { id: "user-a", username: "a" },
            toUser: { id: "user-b", username: "b" },
            timestamp: 1234,
        };

        const events = await ingestSyncUpdate(makeUpdate(body), ctx);

        expect(mocks.storageState.applyRelationshipUpdate).toHaveBeenCalledTimes(1);
        expect(mocks.storageState.applyRelationshipUpdate).toHaveBeenCalledWith({
            fromUserId: "user-a",
            toUserId: "user-b",
            status: "friends",
            action: "accept",
            fromUser: { id: "user-a", username: "a" },
            toUser: { id: "user-b", username: "b" },
            timestamp: 1234,
        });
        expect(events).toEqual([
            { kind: "friends-stale" },
            { kind: "friend-requests-stale" },
            { kind: "feed-stale" },
        ]);
    });
});

describe("ingestSyncUpdate: new-feed-post", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storageState.users = {};
    });

    it("applies a generic feed item without assumeUsers gating", async () => {
        const { ctx, doubles } = makeCtx();
        const body = {
            t: "new-feed-post",
            id: "feed-1",
            cursor: "c-2",
            createdAt: 1,
            body: { kind: "generic", text: "hi" } as any,
            repeatKey: null,
        };

        const events = await ingestSyncUpdate(makeUpdate(body), ctx);

        expect(doubles.assumeUsers).not.toHaveBeenCalled();
        expect(mocks.storageState.applyFeedItems).toHaveBeenCalledTimes(1);
        const applied = mocks.storageState.applyFeedItems.mock.calls[0][0][0];
        expect(applied).toMatchObject({
            id: "feed-1",
            cursor: "c-2",
            counter: 2,
        });
        expect(events).toEqual([]);
    });

    it("awaits assumeUsers and applies the feed item when the friend_request user resolves", async () => {
        mocks.storageState.users = { "u-9": { id: "u-9", username: "u9" } };
        const { ctx, doubles } = makeCtx();
        const body = {
            t: "new-feed-post",
            id: "feed-2",
            cursor: "c-5",
            createdAt: 1,
            body: { kind: "friend_request", uid: "u-9" } as any,
            repeatKey: null,
        };

        const events = await ingestSyncUpdate(makeUpdate(body), ctx);

        expect(doubles.assumeUsers).toHaveBeenCalledWith(["u-9"]);
        expect(mocks.storageState.applyFeedItems).toHaveBeenCalledTimes(1);
        expect(events).toEqual([]);
    });

    it("skips applying the feed item when the friend_request user is still unknown after assumeUsers", async () => {
        // users map left empty — assumeUsers couldn't resolve them
        const { ctx, doubles } = makeCtx();
        const body = {
            t: "new-feed-post",
            id: "feed-3",
            cursor: "c-1",
            createdAt: 1,
            body: { kind: "friend_accepted", uid: "u-x" } as any,
            repeatKey: null,
        };

        const events = await ingestSyncUpdate(makeUpdate(body), ctx);

        expect(doubles.assumeUsers).toHaveBeenCalledWith(["u-x"]);
        expect(mocks.storageState.applyFeedItems).not.toHaveBeenCalled();
        expect(events).toEqual([]);
    });
});

describe("ingestSyncUpdate: kv-batch-update", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isIssueSessionKey.mockReturnValue(false);
    });

    it("emits 'research-config-changed' for researchConfig/* keys", async () => {
        const { ctx } = makeCtx();
        const body = {
            t: "kv-batch-update",
            changes: [
                { key: "researchConfig/proj-a", value: "{}", version: 1 },
                { key: "other/random", value: "ignored", version: 2 },
                { key: "researchConfig/proj-b", value: null, version: 3 },
            ],
        };

        const events = await ingestSyncUpdate(makeUpdate(body), ctx);

        expect(events).toEqual([
            {
                kind: "research-config-changed",
                changes: [
                    { projectId: "proj-a", value: "{}", version: 1 },
                    { projectId: "proj-b", value: null, version: 3 },
                ],
            },
        ]);
    });

    it("emits no event when no researchConfig keys are present", async () => {
        const { ctx } = makeCtx();
        const body = {
            t: "kv-batch-update",
            changes: [{ key: "other/random", value: "x", version: 1 }],
        };

        const events = await ingestSyncUpdate(makeUpdate(body), ctx);

        expect(events).toEqual([]);
    });

    it("forwards issue-session keys to issueSessionStore before emitting events", async () => {
        mocks.isIssueSessionKey.mockImplementation((k: string) =>
            k.startsWith("issueSession/"),
        );
        const issueState = mocks.issueSessionGetState();
        const { ctx } = makeCtx();
        const body = {
            t: "kv-batch-update",
            changes: [
                { key: "issueSession/session-1", value: "x", version: 1 },
                { key: "researchConfig/proj-a", value: "{}", version: 2 },
            ],
        };

        const events = await ingestSyncUpdate(makeUpdate(body), ctx);

        expect(issueState.handleKvUpdate).toHaveBeenCalledTimes(1);
        expect(issueState.handleKvUpdate).toHaveBeenCalledWith([
            { key: "issueSession/session-1", value: "x", version: 1 },
        ]);
        // Research-config still emits in the same call
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ kind: "research-config-changed" });
    });
});

describe("ingestSyncUpdate: project events", () => {
    beforeEach(() => vi.clearAllMocks());

    it.each(["new-project", "update-project", "delete-project"] as const)(
        "%s emits a single 'projects-stale' event",
        async (variant) => {
            const { ctx } = makeCtx();

            const events = await ingestSyncUpdate(
                makeUpdate({ t: variant, projectId: "p1" }),
                ctx,
            );

            expect(events).toEqual([{ kind: "projects-stale" }]);
        },
    );
});

// ---------------------------------------------------------------------------
// PR 4 — medium per-entity handlers
// ---------------------------------------------------------------------------

import * as syncEncScope from "../syncEncryptionScope";

describe("ingestSyncUpdate: update-machine", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.storageState.machines = {};
    });

    it("decrypts metadata via resolveMachineEncryption and applies the updated machine", async () => {
        const machineEncryption: MachineEncryptionDouble = {
            decryptMetadata: vi.fn().mockResolvedValue({ host: "updated" }),
            decryptDaemonState: vi.fn().mockResolvedValue({ status: "running" }),
        };
        vi.mocked(syncEncScope.resolveMachineEncryption).mockResolvedValue(
            machineEncryption as any,
        );
        const { ctx } = makeCtx();

        await ingestSyncUpdate(
            makeUpdate({
                t: "update-machine",
                machineId: "machine-1",
                metadata: { version: 2, value: "enc-meta" },
                daemonState: { version: 3, value: "enc-daemon" },
                active: true,
                activeAt: 999,
            }),
            ctx,
        );

        expect(machineEncryption.decryptMetadata).toHaveBeenCalledWith(2, "enc-meta");
        expect(mocks.storageState.applyMachines).toHaveBeenCalledTimes(1);
        const applied = mocks.storageState.applyMachines.mock.calls[0][0][0];
        expect(applied).toMatchObject({
            id: "machine-1",
            metadata: { host: "updated" },
            metadataVersion: 2,
            daemonState: { status: "running" },
            daemonStateVersion: 3,
        });
    });

    it("skips the apply when resolveMachineEncryption returns null (race-recovery refetch already scheduled)", async () => {
        vi.mocked(syncEncScope.resolveMachineEncryption).mockResolvedValue(null);
        const { ctx } = makeCtx();

        const events = await ingestSyncUpdate(
            makeUpdate({
                t: "update-machine",
                machineId: "machine-1",
                metadata: { version: 1, value: "x" },
            }),
            ctx,
        );

        expect(mocks.storageState.applyMachines).not.toHaveBeenCalled();
        expect(events).toEqual([]);
    });
});

describe("ingestSyncUpdate: delete-session", () => {
    let storageDeleteSession: ReturnType<typeof vi.fn>;
    let removeSessionEncryption: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        storageDeleteSession = vi.fn();
        removeSessionEncryption = vi.fn();
        (mocks.storageState as any).sessions = {};
        (mocks.storageState as any).deleteSession = storageDeleteSession;
    });

    it("removes the session from storage + encryption and emits 'session-deleted'", async () => {
        const { ctx, doubles } = makeCtx();
        // override encryption to add removeSessionEncryption
        (ctx.encryption as any).removeSessionEncryption = removeSessionEncryption;

        const events = await ingestSyncUpdate(
            makeUpdate({ t: "delete-session", sid: "sess-1" }),
            ctx,
        );

        expect(storageDeleteSession).toHaveBeenCalledWith("sess-1");
        expect(removeSessionEncryption).toHaveBeenCalledWith("sess-1");
        expect((ctx.cursor.delete as any)).toHaveBeenCalledWith("sess-1");
        expect(events).toEqual([{ kind: "session-deleted", sid: "sess-1" }]);
        void doubles;
    });
});

describe("ingestSyncUpdate: update-session", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (mocks.storageState as any).sessions = {};
        (mocks.storageState as any).getPendingSessionPreferences = vi.fn(() => null);
    });

    function makeSessionEncryptionDouble() {
        return {
            decryptAgentState: vi.fn().mockResolvedValue({
                requests: { "req-a": { tool: "edit", arguments: {} } },
            }),
            decryptMetadata: vi.fn().mockResolvedValue({ path: "/p" }),
            decryptPreferences: vi.fn().mockResolvedValue(null),
        };
    }

    it("emits 'permission-requested' when agentState carries new requests", async () => {
        const enc = makeSessionEncryptionDouble();
        vi.mocked(syncEncScope.resolveSessionEncryption).mockResolvedValue(enc as any);
        (mocks.storageState as any).sessions = {
            "sess-1": { id: "sess-1", agentState: { requests: {} } },
        };
        const { ctx, doubles } = makeCtx();

        const events = await ingestSyncUpdate(
            makeUpdate({
                t: "update-session",
                id: "sess-1",
                agentState: { version: 1, value: "enc" },
            }),
            ctx,
        );

        expect(doubles.applySessions).toHaveBeenCalledTimes(1);
        expect(events).toEqual([
            {
                kind: "permission-requested",
                sid: "sess-1",
                requestId: "req-a",
                toolName: "edit",
                toolArguments: {},
            },
        ]);
    });

    it("emits 'permission-resolved' when agentState clears previously-known requests", async () => {
        const enc = makeSessionEncryptionDouble();
        enc.decryptAgentState.mockResolvedValue({ requests: {} });
        vi.mocked(syncEncScope.resolveSessionEncryption).mockResolvedValue(enc as any);
        (mocks.storageState as any).sessions = {
            "sess-1": {
                id: "sess-1",
                agentState: { requests: { "old-1": { tool: "x" } } },
            },
        };
        const { ctx } = makeCtx();

        const events = await ingestSyncUpdate(
            makeUpdate({
                t: "update-session",
                id: "sess-1",
                agentState: { version: 2, value: "enc" },
            }),
            ctx,
        );

        expect(events).toEqual([
            { kind: "permission-resolved", sid: "sess-1", resolvedRequestIds: ["old-1"] },
        ]);
    });

    it("emits 'session-control-returned' when controlledByUser flips false → true", async () => {
        const enc = makeSessionEncryptionDouble();
        enc.decryptAgentState.mockResolvedValue({
            requests: {},
            controlledByUser: true,
        });
        vi.mocked(syncEncScope.resolveSessionEncryption).mockResolvedValue(enc as any);
        (mocks.storageState as any).sessions = {
            "sess-1": {
                id: "sess-1",
                agentState: { requests: {}, controlledByUser: false },
            },
        };
        const { ctx } = makeCtx();

        const events = await ingestSyncUpdate(
            makeUpdate({
                t: "update-session",
                id: "sess-1",
                agentState: { version: 3, value: "enc" },
            }),
            ctx,
        );

        // No permission events (both old + new have empty requests), control-returned only.
        expect(events).toEqual([
            { kind: "session-control-returned", sid: "sess-1" },
        ]);
    });

    it("emits no events when agentState was not in the update", async () => {
        const enc = makeSessionEncryptionDouble();
        vi.mocked(syncEncScope.resolveSessionEncryption).mockResolvedValue(enc as any);
        (mocks.storageState as any).sessions = {
            "sess-1": { id: "sess-1", agentState: null },
        };
        const { ctx } = makeCtx();

        const events = await ingestSyncUpdate(
            makeUpdate({
                t: "update-session",
                id: "sess-1",
                metadata: { version: 1, value: "x" },
            }),
            ctx,
        );

        expect(events).toEqual([]);
    });
});

describe("ingestSyncUpdate: update-account", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (mocks.storageState as any).profile = { firstName: "old" };
        (mocks.storageState as any).applyProfile = vi.fn();
        (mocks.storageState as any).applySettings = vi.fn();
    });

    it("updates profile fields and does NOT emit when no settings payload", async () => {
        const { ctx } = makeCtx();

        const events = await ingestSyncUpdate(
            makeUpdate({
                t: "update-account",
                id: "u",
                firstName: "new",
            }),
            ctx,
        );

        expect((mocks.storageState as any).applyProfile).toHaveBeenCalledTimes(1);
        const applied = (mocks.storageState as any).applyProfile.mock.calls[0][0];
        expect(applied.firstName).toBe("new");
        expect(events).toEqual([]);
    });

    it("emits 'account-settings-applied' when settings were successfully decrypted", async () => {
        const { ctx } = makeCtx();
        (ctx.encryption as any).decryptRaw = vi.fn().mockResolvedValue('{"k":"v"}');

        const events = await ingestSyncUpdate(
            makeUpdate({
                t: "update-account",
                id: "u",
                settings: { value: "enc-settings", version: 5 },
            }),
            ctx,
        );

        expect((mocks.storageState as any).applySettings).toHaveBeenCalledTimes(1);
        expect(events).toEqual([{ kind: "account-settings-applied" }]);
    });
});

describe("ingestSyncUpdate: new-artifact / update-artifact / delete-artifact", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (mocks.storageState as any).artifacts = {};
        (mocks.storageState as any).addArtifact = vi.fn();
        (mocks.storageState as any).updateArtifact = vi.fn();
        (mocks.storageState as any).deleteArtifact = vi.fn();
    });

    it("new-artifact: decrypts key, populates artifactDataKeys, applies via addArtifact", async () => {
        const decryptedKey = new Uint8Array([9, 9]);
        const { ctx, doubles } = makeCtx({
            decryptEncryptionKey: vi.fn().mockResolvedValue(decryptedKey),
        });

        await ingestSyncUpdate(
            makeUpdate({
                t: "new-artifact",
                artifactId: "a1",
                header: "enc-h",
                headerVersion: 1,
                body: "enc-b",
                bodyVersion: 1,
                dataEncryptionKey: "enc-key",
                seq: 1,
                createdAt: 0,
                updatedAt: 0,
            }),
            ctx,
        );

        expect(doubles.artifactDataKeysSet).toHaveBeenCalledWith("a1", decryptedKey);
        expect((mocks.storageState as any).addArtifact).toHaveBeenCalledTimes(1);
    });

    it("new-artifact: returns [] and logs error when key decryption fails", async () => {
        const { ctx, doubles } = makeCtx({
            decryptEncryptionKey: vi.fn().mockResolvedValue(null),
        });

        const events = await ingestSyncUpdate(
            makeUpdate({
                t: "new-artifact",
                artifactId: "a1",
                header: "enc-h",
                headerVersion: 1,
                dataEncryptionKey: "enc-key",
                seq: 1,
                createdAt: 0,
                updatedAt: 0,
            }),
            ctx,
        );

        expect(events).toEqual([]);
        expect(mocks.logError).toHaveBeenCalledWith(
            expect.stringContaining("Failed to decrypt key for new artifact a1"),
        );
        expect(doubles.artifactDataKeysSet).not.toHaveBeenCalled();
    });

    it("update-artifact: emits 'artifacts-stale' when the existing artifact is missing", async () => {
        const { ctx } = makeCtx();
        const events = await ingestSyncUpdate(
            makeUpdate({
                t: "update-artifact",
                artifactId: "missing",
                header: { version: 2, value: "h" },
            }),
            ctx,
        );

        expect(events).toEqual([{ kind: "artifacts-stale" }]);
    });

    it("update-artifact: emits 'artifacts-stale' when the data key is missing from the mirror", async () => {
        (mocks.storageState as any).artifacts = { "a1": { id: "a1" } };
        const { ctx, doubles } = makeCtx();
        doubles.artifactDataKeysGet.mockReturnValue(undefined);

        const events = await ingestSyncUpdate(
            makeUpdate({
                t: "update-artifact",
                artifactId: "a1",
                header: { version: 2, value: "h" },
            }),
            ctx,
        );

        expect(events).toEqual([{ kind: "artifacts-stale" }]);
    });

    it("update-artifact: applies the update when both existing artifact and key are present", async () => {
        (mocks.storageState as any).artifacts = {
            "a1": { id: "a1", title: "old", seq: 1 },
        };
        const { ctx, doubles } = makeCtx();
        doubles.artifactDataKeysGet.mockReturnValue(new Uint8Array([1]));

        const events = await ingestSyncUpdate(
            makeUpdate({
                t: "update-artifact",
                artifactId: "a1",
                header: { version: 3, value: "h" },
            }),
            ctx,
        );

        expect((mocks.storageState as any).updateArtifact).toHaveBeenCalledTimes(1);
        expect(events).toEqual([]);
    });

    it("delete-artifact: removes from storage and clears the data key mirror", async () => {
        const { ctx, doubles } = makeCtx();

        await ingestSyncUpdate(
            makeUpdate({ t: "delete-artifact", artifactId: "a1" }),
            ctx,
        );

        expect((mocks.storageState as any).deleteArtifact).toHaveBeenCalledWith("a1");
        expect(doubles.artifactDataKeysDelete).toHaveBeenCalledWith("a1");
    });
});

// ---------------------------------------------------------------------------
// PR 5 — new-message
// ---------------------------------------------------------------------------

import * as typesRaw from "../typesRaw";

describe("ingestSyncUpdate: new-message", () => {
    let cursor: {
        classifyIncoming: ReturnType<typeof vi.fn>;
        markApplied: ReturnType<typeof vi.fn>;
        advanceTo: ReturnType<typeof vi.fn>;
    };
    let sessionEncryption: {
        decryptMessageOutcomes: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        vi.clearAllMocks();
        (mocks.storageState as any).sessions = {};
        (mocks.storageState as any).setPromptSuggestion = vi.fn();
        (mocks.storageState as any).setNeedsContinue = vi.fn();
        (mocks.storageState as any).isMutableToolCall = vi.fn(() => false);
        cursor = {
            classifyIncoming: vi.fn(() => "echo" as const),
            markApplied: vi.fn(() => "new" as const),
            advanceTo: vi.fn(),
        };
        sessionEncryption = {
            decryptMessageOutcomes: vi.fn(),
        };
        vi.mocked(syncEncScope.resolveSessionEncryption).mockResolvedValue(
            sessionEncryption as any,
        );
    });

    function makeMessageUpdate(overrides: {
        sid?: string;
        seq?: number;
        messageSeq?: number;
        messageId?: string;
        body?: any;
    } = {}): ApiUpdateContainer {
        return {
            id: "update-x",
            seq: overrides.seq ?? 7,
            createdAt: 1700,
            body: overrides.body ?? {
                t: "new-message",
                sid: overrides.sid ?? "sess-1",
                message: {
                    id: overrides.messageId ?? "msg-1",
                    seq: overrides.messageSeq ?? 1,
                    content: "enc-content",
                },
            },
        };
    }

    function setupCursorReturn(ctx: any) {
        (ctx.cursor.get as any).mockReturnValue(cursor);
    }

    function setupDecrypted(decrypted: any) {
        sessionEncryption.decryptMessageOutcomes.mockResolvedValue([
            { ok: true, message: decrypted },
        ]);
    }

    it("returns [] and triggers forceRefetch when decryption fails", async () => {
        sessionEncryption.decryptMessageOutcomes.mockResolvedValue([
            { ok: false, reason: "decrypt-failed", seq: 1 },
        ]);
        const { ctx, doubles } = makeCtx();
        setupCursorReturn(ctx);

        const events = await ingestSyncUpdate(makeMessageUpdate(), ctx);

        expect(doubles.sessionsForceRefetch).toHaveBeenCalledTimes(1);
        expect(events).toEqual([]);
    });

    it("returns [] when decryption returns null (not-encrypted / missing)", async () => {
        sessionEncryption.decryptMessageOutcomes.mockResolvedValue([
            { ok: false, reason: "missing", seq: 1 },
        ]);
        const { ctx, doubles } = makeCtx();
        setupCursorReturn(ctx);

        const events = await ingestSyncUpdate(makeMessageUpdate(), ctx);

        expect(doubles.sessionsForceRefetch).not.toHaveBeenCalled();
        expect(events).toEqual([]);
    });

    it("clears prompt suggestion and needsContinue when the message is from the user", async () => {
        vi.mocked(typesRaw.isUserMessageRaw).mockReturnValue(true);
        setupDecrypted({
            id: "msg-1",
            localId: "lid",
            createdAt: 1500,
            content: { role: "user", content: { text: "hi" } },
        });
        (mocks.storageState as any).sessions = { "sess-1": { id: "sess-1" } };
        const { ctx } = makeCtx();
        setupCursorReturn(ctx);

        await ingestSyncUpdate(makeMessageUpdate(), ctx);

        expect((mocks.storageState as any).setPromptSuggestion).toHaveBeenCalledWith(
            "sess-1",
            null,
        );
        expect((mocks.storageState as any).setNeedsContinue).toHaveBeenCalledWith(
            "sess-1",
            false,
        );
    });

    it("emits 'terminal-signal' when the message decodes to a TerminalSignal", async () => {
        vi.mocked(typesRaw.extractTerminalSignalFromRaw).mockReturnValue({
            kind: "window-title",
            text: "build",
        } as any);
        setupDecrypted({
            id: "msg-1",
            localId: "lid",
            createdAt: 1,
            content: { fake: "raw" },
        });
        (mocks.storageState as any).sessions = { "sess-1": { id: "sess-1" } };
        const { ctx } = makeCtx();
        setupCursorReturn(ctx);

        const events = await ingestSyncUpdate(makeMessageUpdate(), ctx);

        expect(events).toContainEqual({
            kind: "terminal-signal",
            sid: "sess-1",
            signal: { kind: "window-title", text: "build" },
        });
    });

    it("emits 'task-completed' when the content decodes as a turn-end / task_complete event", async () => {
        setupDecrypted({
            id: "msg-1",
            localId: "lid",
            createdAt: 1,
            content: { role: "session", content: { ev: { t: "turn-end" } } },
        });
        (mocks.storageState as any).sessions = { "sess-1": { id: "sess-1" } };
        const { ctx } = makeCtx();
        setupCursorReturn(ctx);

        const events = await ingestSyncUpdate(makeMessageUpdate(), ctx);

        expect(events).toContainEqual({ kind: "task-completed", sid: "sess-1" });
    });

    it("emits 'mutable-tool-observed' when the agent message reports a mutable tool call", async () => {
        vi.mocked(typesRaw.normalizeRawMessage).mockReturnValue({
            role: "agent",
            content: [{ type: "tool-result", tool_use_id: "tu-1" } as any],
        } as any);
        setupDecrypted({
            id: "msg-1",
            localId: "lid",
            createdAt: 1,
            content: {},
        });
        (mocks.storageState as any).sessions = { "sess-1": { id: "sess-1" } };
        (mocks.storageState as any).isMutableToolCall = vi.fn(() => true);
        const { ctx, doubles } = makeCtx();
        setupCursorReturn(ctx);

        const events = await ingestSyncUpdate(makeMessageUpdate(), ctx);

        expect(events).toContainEqual({ kind: "mutable-tool-observed", sid: "sess-1" });
        expect(doubles.enqueueMessages).toHaveBeenCalledTimes(1);
    });

    it("emits 'message-gap' when the cursor classifies the incoming seq as a forward gap", async () => {
        cursor.classifyIncoming.mockReturnValue("gap");
        setupDecrypted({
            id: "msg-1",
            localId: "lid",
            createdAt: 1,
            content: {},
        });
        (mocks.storageState as any).sessions = { "sess-1": { id: "sess-1" } };
        const { ctx } = makeCtx();
        setupCursorReturn(ctx);

        const events = await ingestSyncUpdate(makeMessageUpdate(), ctx);

        expect(events).toContainEqual({ kind: "message-gap", sid: "sess-1" });
    });

    it("returns early (no enqueue, no advance) when cursor.markApplied reports duplicate", async () => {
        cursor.markApplied.mockReturnValue("duplicate");
        setupDecrypted({
            id: "msg-1",
            localId: "lid",
            createdAt: 1,
            content: {},
        });
        (mocks.storageState as any).sessions = { "sess-1": { id: "sess-1" } };
        const { ctx, doubles } = makeCtx();
        setupCursorReturn(ctx);

        const events = await ingestSyncUpdate(makeMessageUpdate(), ctx);

        expect(doubles.enqueueMessages).not.toHaveBeenCalled();
        expect(cursor.advanceTo).not.toHaveBeenCalled();
        // No gap event either — the early return happens before classification check.
        expect(events.filter((e) => e.kind === "message-gap")).toEqual([]);
    });

    it("calls sessionsSync.forceRefetch when the session row is missing during apply", async () => {
        setupDecrypted({
            id: "msg-1",
            localId: "lid",
            createdAt: 1,
            content: {},
        });
        (mocks.storageState as any).sessions = {}; // session NOT in storage
        const { ctx, doubles } = makeCtx();
        setupCursorReturn(ctx);

        await ingestSyncUpdate(makeMessageUpdate(), ctx);

        expect(doubles.sessionsForceRefetch).toHaveBeenCalledTimes(1);
    });

    it("returns [] when body.message is absent (bare envelope)", async () => {
        const { ctx, doubles } = makeCtx();
        setupCursorReturn(ctx);

        const events = await ingestSyncUpdate(
            makeMessageUpdate({
                body: { t: "new-message", sid: "sess-1" } as any,
            }),
            ctx,
        );

        expect(events).toEqual([]);
        expect(sessionEncryption.decryptMessageOutcomes).not.toHaveBeenCalled();
        expect(doubles.enqueueMessages).not.toHaveBeenCalled();
    });
});
