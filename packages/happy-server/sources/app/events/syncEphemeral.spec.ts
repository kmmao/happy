import { beforeEach, describe, expect, it, vi } from "vitest";

const { emitEphemeralMock, resetState } = vi.hoisted(() => {
    const emitEphemeralMock = vi.fn();
    const resetState = () => emitEphemeralMock.mockClear();
    return { emitEphemeralMock, resetState };
});

// PR 1.5.f physically moved the 21 active build*Ephemeral functions into
// syncEphemeral.ts as private helpers. We only stub the transport sink
// (`_emitEphemeralInternal`) here — the real private builders run end-to-end,
// which means these tests also exercise the wire shape unintrusively.
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { _emitEphemeralInternal: emitEphemeralMock },
}));

import { emitSyncEphemeral, type SyncEphemeralBody } from "./syncEphemeral";

const A = "account-1";

beforeEach(() => {
    resetState();
});

// === Recipient derivation per body.t ===================================

describe("emitSyncEphemeral — invariants per body.t", () => {
    type Case = { name: string; body: SyncEphemeralBody; expected: unknown };

    // user-scoped variants: 19 cases. Each derives `{ type: "user-scoped-only" }`.
    const userScopedCases: Case[] = [
        { name: "session-activity", body: { t: "session-activity", sessionId: "s1", active: true, activeAt: 0 }, expected: { type: "user-scoped-only" } },
        { name: "machine-activity", body: { t: "machine-activity", machineId: "m1", active: true, activeAt: 0 }, expected: { type: "user-scoped-only" } },
        { name: "rpc-ready", body: { t: "rpc-ready", scope: "machine", id: "m1", ready: true }, expected: { type: "user-scoped-only" } },
        { name: "usage", body: { t: "usage", sessionId: "s1", key: "k", tokens: {}, cost: {} }, expected: { type: "user-scoped-only" } },
        { name: "supervisor-status", body: { t: "supervisor-status", runId: "r", projectId: "p", status: "x" }, expected: { type: "user-scoped-only" } },
        { name: "supervisor-loop-status", body: { t: "supervisor-loop-status", loopId: "l", projectId: "p", status: "x", currentIteration: 0, maxIterations: 1, currentPhase: "a", totalCostUsd: 0, totalActionsFound: 0, totalActionsFixed: 0, currentHealthScore: null, initialHealthScore: null, exitReason: null, consecutiveFailures: 0 }, expected: { type: "user-scoped-only" } },
        { name: "supervisor-loop-brief", body: { t: "supervisor-loop-brief", loopId: "l", projectId: "p", status: "x", exitReason: null, generatedAt: 0, currentIteration: 0, maxIterations: 1, initialHealthScore: null, currentHealthScore: null, healthDelta: null, totalActionsFound: 0, totalActionsFixed: 0, consecutiveFailures: 0, totalCostUsd: 0, costCapUsd: null, summary: "" }, expected: { type: "user-scoped-only" } },
        { name: "auto-loop-fired", body: { t: "auto-loop-fired", projectId: "p", loopId: "l", healthScore: 0, threshold: 0, firedAt: 0 }, expected: { type: "user-scoped-only" } },
        { name: "knowledge-count", body: { t: "knowledge-count", sessionId: "s1", count: 0 }, expected: { type: "user-scoped-only" } },
        { name: "knowledge-access-update", body: { t: "knowledge-access-update", sessionId: "s1" }, expected: { type: "user-scoped-only" } },
        { name: "task-status-changed", body: { t: "task-status-changed", taskId: "t", machineId: "m", status: "running" }, expected: { type: "user-scoped-only" } },
        { name: "inbox-new-item", body: { t: "inbox-new-item", item: { id: "i", category: "c", eventType: "e", severity: "s", title: "t", read: false, createdAt: 0 } }, expected: { type: "user-scoped-only" } },
        { name: "inbox-unread-count", body: { t: "inbox-unread-count", count: 5 }, expected: { type: "user-scoped-only" } },
        { name: "world-event-created", body: { t: "world-event-created", event: { id: "w", eventType: "e", title: "t", summary: "s", occurredAt: 0, severity: "info", source: { type: "system" }, originalId: "o" } }, expected: { type: "user-scoped-only" } },
        { name: "terminal-output", body: { t: "terminal-output", machineId: "m", terminalId: "t", data: "x" }, expected: { type: "user-scoped-only" } },
        { name: "terminal-exit", body: { t: "terminal-exit", machineId: "m", terminalId: "t", exitCode: 0 }, expected: { type: "user-scoped-only" } },
        { name: "webhook-issue-linked", body: { t: "webhook-issue-linked", issueNumber: 1, issueTitle: "t", issueBody: null, issueAuthor: "a", issueLabels: [], issueUrl: "u", repoUrl: "r", repoPath: "p", machineId: "m", sessionId: "s" }, expected: { type: "user-scoped-only" } },
        { name: "webhook-pr-merged", body: { t: "webhook-pr-merged", prNumber: 1, prUrl: "u", issueNumber: 2, sessionId: "s", machineId: "m", repoPath: "p" }, expected: { type: "user-scoped-only" } },
        { name: "inter-agent-message-echo", body: { t: "inter-agent-message-echo", fromSessionId: "from", toSessionId: "to", message: "hi" }, expected: { type: "user-scoped-only" } },
    ];

    for (const c of userScopedCases) {
        it(`${c.name} → user-scoped-only`, async () => {
            await emitSyncEphemeral(A, c.body);
            expect(emitEphemeralMock).toHaveBeenCalledTimes(1);
            expect(emitEphemeralMock.mock.calls[0][0].recipientFilter).toEqual(c.expected);
        });
    }

    // machine-scoped variants: 8 cases. Each carries an explicit machineId.
    type MachineCase = { name: string; body: SyncEphemeralBody; machineId: string };
    const machineScopedCases: MachineCase[] = [
        { name: "supervisor-trigger", body: { t: "supervisor-trigger", projectId: "p", runId: "r", trigger: "x", machineId: "m1", repoPath: "/x" }, machineId: "m1" },
        { name: "supervisor-run-complete", body: { t: "supervisor-run-complete", runId: "r", projectId: "p", status: "x", machineId: "m2" }, machineId: "m2" },
        { name: "supervisor-fix-kill-session", body: { t: "supervisor-fix-kill-session", fixSessionId: "fs", projectId: "p", fixStatus: "x", machineId: "m3" }, machineId: "m3" },
        { name: "task-trigger", body: { t: "task-trigger", machineId: "m4", taskId: "t", prompt: "p", directory: "/d", priority: "normal" }, machineId: "m4" },
        { name: "task-cancel", body: { t: "task-cancel", taskId: "t", machineId: "m5" }, machineId: "m5" },
        { name: "session-terminate", body: { t: "session-terminate", sessionId: "s", reason: "deleted", machineId: "m6" }, machineId: "m6" },
        { name: "terminal-input", body: { t: "terminal-input", machineId: "m7", terminalId: "t", data: "x" }, machineId: "m7" },
        { name: "webhook-trigger", body: { t: "webhook-trigger", machineId: "m8", webhookEventId: "we", issueNumber: 1, issueTitle: "t", issueBody: null, issueAuthor: "a", issueLabels: [], issueUrl: "u", repoUrl: "r", repoPath: "p", provider: "github", apiToken: null }, machineId: "m8" },
    ];

    for (const c of machineScopedCases) {
        it(`${c.name} → machine-scoped-only with machineId`, async () => {
            await emitSyncEphemeral(A, c.body);
            expect(emitEphemeralMock.mock.calls[0][0].recipientFilter).toEqual({
                type: "machine-scoped-only",
                machineId: c.machineId,
            });
        });
    }

    // session-scoped variants: 5 cases. Each carries a sessionId source.
    type SessionCase = { name: string; body: SyncEphemeralBody; sessionId: string };
    const sessionScopedCases: SessionCase[] = [
        { name: "session-event-created", body: { t: "session-event-created", event: { id: "ev", sessionId: "s1", eventType: "e", summary: "s", createdAt: 0 } }, sessionId: "s1" },
        { name: "task-log", body: { t: "task-log", sessionId: "s2", taskId: "t", outputFile: "f", chunk: "x", offset: 0 }, sessionId: "s2" },
        { name: "preview-candidate-reported", body: { t: "preview-candidate-reported", sessionId: "s3", candidate: { id: "c", sessionId: "s3", state: "reported", protocol: "http", host: "h", port: 0, reportedAt: 0 } }, sessionId: "s3" },
        { name: "preview-connection-updated", body: { t: "preview-connection-updated", sessionId: "s4", connection: null }, sessionId: "s4" },
        { name: "inter-agent-message-deliver", body: { t: "inter-agent-message-deliver", fromSessionId: "from", toSessionId: "to-session", message: "hi" }, sessionId: "to-session" },
    ];

    for (const c of sessionScopedCases) {
        it(`${c.name} → all-interested-in-session with sessionId`, async () => {
            await emitSyncEphemeral(A, c.body);
            expect(emitEphemeralMock.mock.calls[0][0].recipientFilter).toEqual({
                type: "all-interested-in-session",
                sessionId: c.sessionId,
            });
        });
    }
});

describe("emitSyncEphemeral — wire payload shape spot checks", () => {
    it("uses accountId as userId on eventRouter.emitEphemeral", async () => {
        await emitSyncEphemeral(A, { t: "inbox-unread-count", count: 3 });
        expect(emitEphemeralMock.mock.calls[0][0].userId).toBe(A);
    });

    it("session-activity puts the sessionId in the wire `id` field (not `sessionId`)", async () => {
        // Wire-shape quirk worth pinning: the activity ephemeral uses `id` for
        // both session and machine variants, which is a holdover from the
        // pre-SyncEphemeral wire shape.
        await emitSyncEphemeral(A, { t: "session-activity", sessionId: "s7", active: true, activeAt: 100 });
        const payload = emitEphemeralMock.mock.calls[0][0].payload;
        expect(payload.type).toBe("activity");
        expect(payload.id).toBe("s7");
        expect(payload.thinking).toBe(false);
    });

    it("inter-agent-message-deliver emits wire type 'inter-agent-message' (ADR-0024 E3)", async () => {
        await emitSyncEphemeral(A, {
            t: "inter-agent-message-deliver",
            fromSessionId: "from",
            toSessionId: "to",
            message: "hi",
        });
        const payload = emitEphemeralMock.mock.calls[0][0].payload;
        expect(payload.type).toBe("inter-agent-message");
        expect(payload.fromSessionId).toBe("from");
        expect(payload.toSessionId).toBe("to");
        expect(payload.message).toBe("hi");
        expect(typeof payload.sentAt).toBe("number");
    });

    it("inter-agent-message-echo emits the SAME wire type as -deliver (only the recipient differs)", async () => {
        await emitSyncEphemeral(A, {
            t: "inter-agent-message-echo",
            fromSessionId: "from",
            toSessionId: "to",
            message: "hi",
        });
        const payload = emitEphemeralMock.mock.calls[0][0].payload;
        expect(payload.type).toBe("inter-agent-message");
        // ECHO goes to user-scoped-only (verified in the recipient case above).
    });

    it("session-terminate strips machineId from the wire payload (it's only for routing)", async () => {
        await emitSyncEphemeral(A, { t: "session-terminate", sessionId: "s1", reason: "deleted", machineId: "m1" });
        const payload = emitEphemeralMock.mock.calls[0][0].payload;
        expect(payload.type).toBe("session-terminate");
        expect(payload.sessionId).toBe("s1");
        expect(payload.reason).toBe("deleted");
        expect(payload.machineId).toBeUndefined();
    });

    it("task-trigger strips machineId from the wire payload (it's only for routing)", async () => {
        await emitSyncEphemeral(A, {
            t: "task-trigger",
            machineId: "m1",
            taskId: "t",
            prompt: "p",
            directory: "/d",
            priority: "normal",
        });
        const payload = emitEphemeralMock.mock.calls[0][0].payload;
        expect(payload.type).toBe("task-trigger");
        expect(payload.taskId).toBe("t");
        expect(payload.machineId).toBeUndefined();
    });

    it("rpc-ready preserves scope + id + ready", async () => {
        await emitSyncEphemeral(A, { t: "rpc-ready", scope: "session", id: "s1", ready: false });
        const payload = emitEphemeralMock.mock.calls[0][0].payload;
        expect(payload).toEqual({ type: "rpc-ready", scope: "session", id: "s1", ready: false });
    });
});

describe("emitSyncEphemeral — skipSenderConnection forwarding", () => {
    it("forwards skipSenderConnection to eventRouter.emitEphemeral when given", async () => {
        const conn = { connectionType: "user-scoped" } as any;
        await emitSyncEphemeral(
            A,
            { t: "session-activity", sessionId: "s1", active: true, activeAt: 0 },
            { skipSenderConnection: conn },
        );
        expect(emitEphemeralMock.mock.calls[0][0].skipSenderConnection).toBe(conn);
    });

    it("omits skipSenderConnection when not given", async () => {
        await emitSyncEphemeral(A, { t: "inbox-unread-count", count: 1 });
        expect(emitEphemeralMock.mock.calls[0][0].skipSenderConnection).toBeUndefined();
    });
});
