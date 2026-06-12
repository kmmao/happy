import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock factory (parallels syncUpdateIngest.test.ts shape)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
    const storageState = {
        machines: {} as Record<string, any>,
        sessions: {} as Record<string, any>,
        applyMachines: vi.fn(),
        sessionKnowledgeCount: {} as Record<string, number>,
        sessionKnowledgeChangesRevision: {} as Record<string, number>,
        sessionKnowledgeAccessRevision: {} as Record<string, number>,
    };
    return {
        storageState,
        getStateMock: vi.fn(() => storageState),
        setStateMock: vi.fn(),
        webhookIssueLinked: vi.fn(),
        webhookPRMerged: vi.fn(),
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
    storage: {
        getState: mocks.getStateMock,
        setState: mocks.setStateMock,
    },
    ingestStorage: {
        getState: mocks.getStateMock,
        setState: mocks.setStateMock,
    },
}));

vi.mock("../syncIssueHandlers", () => ({
    handleWebhookIssueLinked: mocks.webhookIssueLinked,
    handleWebhookPRMerged: mocks.webhookPRMerged,
}));

vi.mock("@/log", () => ({
    log: { log: mocks.logLog, warn: vi.fn(), error: vi.fn() },
}));

import { ingestSyncEphemeral } from "./syncEphemeralIngest";
import type { IngestContext } from "./ingestContext";

function makeCtx() {
    const applySessions = vi.fn();
    const addActivityUpdate = vi.fn();
    const ctx: IngestContext = {
        encryption: {} as any,
        cursor: { get: vi.fn() as any, delete: vi.fn() },
        sessionsSync: {
            awaitQueue: vi.fn().mockResolvedValue(undefined),
            forceRefetch: vi.fn(),
        },
        machinesSync: {
            awaitQueue: vi.fn().mockResolvedValue(undefined),
            forceRefetch: vi.fn(),
        },
        machineDataKeys: { set: vi.fn() },
        assumeUsers: vi.fn().mockResolvedValue(undefined),
        applySessions,
        onSessionVisible: vi.fn(),
        artifactDataKeys: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
        enqueueMessages: vi.fn(),
        addActivityUpdate,
    };
    return { ctx, applySessions, addActivityUpdate };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.storageState.machines = {};
    mocks.storageState.sessions = {};
    mocks.storageState.sessionKnowledgeCount = {};
    mocks.storageState.sessionKnowledgeChangesRevision = {};
    mocks.storageState.sessionKnowledgeAccessRevision = {};
});

// ---------------------------------------------------------------------------
// Storage-mutation-only variants (no events)
// ---------------------------------------------------------------------------

describe("ingestSyncEphemeral: storage-only variants", () => {
    it("activity → ctx.addActivityUpdate, returns []", () => {
        const { ctx, addActivityUpdate } = makeCtx();
        const update = {
            type: "activity",
            id: "sess-1",
            active: true,
            activeAt: 100,
            thinking: false,
        } as any;

        const events = ingestSyncEphemeral(update, ctx);

        expect(addActivityUpdate).toHaveBeenCalledWith(update);
        expect(events).toEqual([]);
    });

    it("machine-activity → applyMachines when machine exists", () => {
        mocks.storageState.machines = { "m1": { id: "m1", active: false } };
        const { ctx } = makeCtx();

        const events = ingestSyncEphemeral(
            { type: "machine-activity", id: "m1", active: true, activeAt: 200 } as any,
            ctx,
        );

        expect(mocks.storageState.applyMachines).toHaveBeenCalledTimes(1);
        const applied = mocks.storageState.applyMachines.mock.calls[0][0][0];
        expect(applied).toMatchObject({ id: "m1", active: true, activeAt: 200 });
        expect(events).toEqual([]);
    });

    it("machine-activity → no-op when machine missing", () => {
        const { ctx } = makeCtx();
        const events = ingestSyncEphemeral(
            { type: "machine-activity", id: "m-unknown", active: true, activeAt: 0 } as any,
            ctx,
        );
        expect(mocks.storageState.applyMachines).not.toHaveBeenCalled();
        expect(events).toEqual([]);
    });

    it("rpc-ready (machine) → applyMachines with rpcReady flag", () => {
        mocks.storageState.machines = { "m1": { id: "m1", rpcReady: false } };
        const { ctx } = makeCtx();
        ingestSyncEphemeral(
            { type: "rpc-ready", scope: "machine", id: "m1", ready: true } as any,
            ctx,
        );
        expect(mocks.storageState.applyMachines.mock.calls[0][0][0]).toMatchObject({
            id: "m1",
            rpcReady: true,
        });
    });

    it("rpc-ready (session) → applySessions with rpcReady flag", () => {
        mocks.storageState.sessions = { "s1": { id: "s1", rpcReady: false } };
        const { ctx, applySessions } = makeCtx();
        ingestSyncEphemeral(
            { type: "rpc-ready", scope: "session", id: "s1", ready: true } as any,
            ctx,
        );
        expect(applySessions).toHaveBeenCalledTimes(1);
        expect(applySessions.mock.calls[0][0][0]).toMatchObject({
            id: "s1",
            rpcReady: true,
        });
    });

    it("usage → applySessions with merged latestUsage totals", () => {
        mocks.storageState.sessions = {
            "s1": {
                id: "s1",
                latestUsage: { totalInputTokens: 10, totalOutputTokens: 5 },
            },
        };
        const { ctx, applySessions } = makeCtx();
        ingestSyncEphemeral(
            {
                type: "usage",
                id: "s1",
                timestamp: 1000,
                tokens: {
                    input: 3,
                    output: 7,
                    cache_creation: 1,
                    cache_read: 2,
                },
            } as any,
            ctx,
        );
        const applied = applySessions.mock.calls[0][0][0];
        expect(applied.latestUsage).toMatchObject({
            inputTokens: 3,
            outputTokens: 7,
            cacheCreation: 1,
            cacheRead: 2,
            contextSize: 3 + 1 + 2,
            totalInputTokens: 10 + 3 + 1 + 2,
            totalOutputTokens: 5 + 7,
            timestamp: 1000,
        });
    });

    it("knowledge-count → storage.setState bumps count + revision", () => {
        const { ctx } = makeCtx();
        ingestSyncEphemeral(
            { type: "knowledge-count", id: "s1", count: 42 } as any,
            ctx,
        );
        expect(mocks.setStateMock).toHaveBeenCalledTimes(1);
        const newState = mocks.setStateMock.mock.calls[0][0];
        expect(newState.sessionKnowledgeCount.s1).toBe(42);
        expect(newState.sessionKnowledgeChangesRevision.s1).toBe(1);
    });

    it("knowledge-access-update → storage.setState bumps access revision", () => {
        const { ctx } = makeCtx();
        ingestSyncEphemeral(
            { type: "knowledge-access-update", sessionId: "s1" } as any,
            ctx,
        );
        const newState = mocks.setStateMock.mock.calls[0][0];
        expect(newState.sessionKnowledgeAccessRevision.s1).toBe(1);
    });

    it("webhook-issue-linked → fires module call", () => {
        const { ctx } = makeCtx();
        ingestSyncEphemeral(
            { type: "webhook-issue-linked", issueKey: "GH-1" } as any,
            ctx,
        );
        expect(mocks.webhookIssueLinked).toHaveBeenCalledTimes(1);
    });

    it("webhook-pr-merged → fires module call", () => {
        const { ctx } = makeCtx();
        ingestSyncEphemeral(
            { type: "webhook-pr-merged", prUrl: "..." } as any,
            ctx,
        );
        expect(mocks.webhookPRMerged).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// Listener-fan-out variants (emit typed events)
// ---------------------------------------------------------------------------

describe("ingestSyncEphemeral: listener-fan-out events", () => {
    it("supervisor-status → 'supervisor-status-update'", () => {
        const { ctx } = makeCtx();
        const events = ingestSyncEphemeral(
            {
                type: "supervisor-status",
                projectId: "p1",
                status: "running",
                runId: "r1",
                currentDimension: "security",
                dimensionIndex: 0,
                totalDimensions: 3,
            } as any,
            ctx,
        );
        expect(events).toEqual([
            {
                kind: "supervisor-status-update",
                event: {
                    projectId: "p1",
                    status: "running",
                    runId: "r1",
                    currentDimension: "security",
                    dimensionIndex: 0,
                    totalDimensions: 3,
                },
            },
        ]);
    });

    it("task-log → 'task-log-chunk' with flat fields", () => {
        const { ctx } = makeCtx();
        const events = ingestSyncEphemeral(
            { type: "task-log", sessionId: "s1", taskId: "t1", chunk: "log..." } as any,
            ctx,
        );
        expect(events).toEqual([
            { kind: "task-log-chunk", sessionId: "s1", taskId: "t1", chunk: "log..." },
        ]);
    });

    it("inbox-new-item → 'inbox-new-item' (no emit when item missing)", () => {
        const { ctx } = makeCtx();
        const withItem = ingestSyncEphemeral(
            {
                type: "inbox-new-item",
                item: {
                    id: "i1",
                    category: "task",
                    eventType: "completed",
                    severity: "info",
                    title: "T",
                    read: false,
                    createdAt: 1,
                },
            } as any,
            ctx,
        );
        expect(withItem).toHaveLength(1);
        expect(withItem[0]).toMatchObject({ kind: "inbox-new-item" });

        const noItem = ingestSyncEphemeral(
            { type: "inbox-new-item" } as any,
            ctx,
        );
        expect(noItem).toEqual([]);
    });

    it("inbox-unread-count → 'inbox-unread-count' (no emit when count is non-number)", () => {
        const { ctx } = makeCtx();
        const ok = ingestSyncEphemeral(
            { type: "inbox-unread-count", count: 7 } as any,
            ctx,
        );
        expect(ok).toEqual([{ kind: "inbox-unread-count", count: 7 }]);
        const bad = ingestSyncEphemeral(
            { type: "inbox-unread-count" } as any,
            ctx,
        );
        expect(bad).toEqual([]);
    });

    it("inter-agent-message → 'inter-agent-message-received'", () => {
        const { ctx } = makeCtx();
        const events = ingestSyncEphemeral(
            {
                type: "inter-agent-message",
                fromSessionId: "a",
                toSessionId: "b",
                message: "hi",
                sentAt: 99,
            } as any,
            ctx,
        );
        expect(events).toEqual([
            {
                kind: "inter-agent-message-received",
                message: {
                    fromSessionId: "a",
                    toSessionId: "b",
                    message: "hi",
                    sentAt: 99,
                },
            },
        ]);
    });

    it("supervisor-loop-status → 'supervisor-loop-status'", () => {
        const { ctx } = makeCtx();
        const events = ingestSyncEphemeral(
            {
                type: "supervisor-loop-status",
                loopId: "l1",
                projectId: "p1",
                status: "running",
                currentIteration: 2,
                maxIterations: 5,
                currentPhase: "fix",
                totalCostUsd: 0.5,
                totalActionsFound: 3,
                totalActionsFixed: 1,
                currentHealthScore: 80,
                initialHealthScore: 70,
                exitReason: null,
                consecutiveFailures: 0,
            } as any,
            ctx,
        );
        expect(events).toHaveLength(1);
        expect(events[0].kind).toBe("supervisor-loop-status");
    });
});

// ---------------------------------------------------------------------------
// Unknown variants
// ---------------------------------------------------------------------------

describe("ingestSyncEphemeral: unknown variants", () => {
    it("returns [] and logs (does NOT throw — ADR-0013 ephemerals are fire-and-forget)", () => {
        const { ctx } = makeCtx();
        const events = ingestSyncEphemeral(
            { type: "future-unknown-type" } as any,
            ctx,
        );
        expect(events).toEqual([]);
        expect(mocks.logLog).toHaveBeenCalledWith(
            expect.stringContaining("'future-unknown-type'"),
        );
    });
});
