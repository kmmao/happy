/**
 * Unit-level coverage for the pure helpers in agentLoopEngine.
 * DB-bound functions (create/update/delete/tick/handleCallback) get
 * exercised by the integration spec in supervisorLoopRoutes.spec.ts'
 * companion file.
 */

import { describe, it, expect } from "vitest";
import {
    buildCallbackToken,
    verifyCallbackToken,
    computeNextRunAt,
    serializeAgentLoop,
} from "./agentLoopEngine";

describe("agentLoopEngine.buildCallbackToken / verifyCallbackToken", () => {
    it("round-trips a freshly built token", () => {
        const token = buildCallbackToken("loop-abc", 7);
        expect(verifyCallbackToken("loop-abc", 7, token)).toBe(true);
    });

    it("rejects a token for a different iteration", () => {
        const token = buildCallbackToken("loop-abc", 7);
        expect(verifyCallbackToken("loop-abc", 8, token)).toBe(false);
    });

    it("rejects a token for a different loop", () => {
        const token = buildCallbackToken("loop-abc", 7);
        expect(verifyCallbackToken("loop-xyz", 7, token)).toBe(false);
    });

    it("rejects malformed tokens without throwing", () => {
        expect(verifyCallbackToken("loop-abc", 7, "")).toBe(false);
        expect(verifyCallbackToken("loop-abc", 7, "not-a-hex-token")).toBe(false);
    });
});

describe("agentLoopEngine.computeNextRunAt", () => {
    const now = new Date("2026-06-14T12:00:00.000Z").getTime();

    it("adds intervalMs when no cron present", () => {
        const next = computeNextRunAt(60_000, null, now);
        expect(next).toBe(now + 60_000);
    });

    it("floors very small intervals at 30s", () => {
        const next = computeNextRunAt(1_000, null, now);
        expect(next - now).toBe(30_000);
    });

    it("uses cron expression when present (every hour)", () => {
        const next = computeNextRunAt(null, "0 * * * *", now);
        // 12:00 UTC → next on the hour is 13:00.
        expect(next).toBe(new Date("2026-06-14T13:00:00.000Z").getTime());
    });

    it("falls back to +1h on malformed cron, no throw", () => {
        const next = computeNextRunAt(null, "not a cron", now);
        expect(next).toBe(now + 60 * 60 * 1000);
    });

    it("returns a far-future sentinel when nothing scheduled", () => {
        const next = computeNextRunAt(null, null, now);
        expect(next - now).toBe(365 * 24 * 60 * 60 * 1000);
    });
});

describe("agentLoopEngine.serializeAgentLoop (cross-role surface)", () => {
    // ADR-0022 Phase 4 — the unified `/v1/projects/:id/agent-loops`
    // family returns the same shape for both supervisor and generic
    // rows. Verify the serializer surfaces the role discriminator + the
    // role-specific column blocks without column collisions.
    const baseLoop = {
        id: "loop-x",
        projectId: "proj-1",
        accountId: "acc-1",
        status: "running",
        activeRunId: null,
        exitReason: null,
        profileId: null,
        runtimeProfile: null,
        maxDurationMinutes: 240,
        createdAt: new Date("2026-06-14T12:00:00Z"),
        updatedAt: new Date("2026-06-14T12:01:00Z"),
        completedAt: null,
        prompt: null,
        directory: null,
        agent: null,
        intervalMs: null,
        cronExpression: null,
        enabled: true,
        nextRunAt: null,
        continuityKey: null,
        iteration: 0,
        genericConfig: null,
        currentPhase: "idle",
        currentIteration: 0,
        maxIterations: 5,
        costCapUsd: null,
        healthScoreTarget: null,
        autoApproveThreshold: 80,
        maxConsecutiveFailures: 2,
        emptyIterationsToConfirm: 2,
        consecutiveEmptyIterations: 0,
        initialHealthScore: null,
        currentHealthScore: null,
        totalCostUsd: 0,
        totalTokens: 0,
        totalActionsFound: 0,
        totalActionsFixed: 0,
        consecutiveFailures: 0,
    };

    it("serializes a generic-role row with generic fields populated", () => {
        const out = serializeAgentLoop({
            ...baseLoop,
            role: "generic",
            prompt: "do the work",
            directory: "/tmp/proj",
            agent: "claude",
            intervalMs: 60_000,
            nextRunAt: BigInt(baseLoop.createdAt.getTime() + 60_000),
        } as any);
        expect(out.role).toBe("generic");
        expect(out.prompt).toBe("do the work");
        expect(out.directory).toBe("/tmp/proj");
        expect(out.agent).toBe("claude");
        expect(out.intervalMs).toBe(60_000);
        expect(out.nextRunAt).toBe(baseLoop.createdAt.getTime() + 60_000);
    });

    it("serializes a supervisor-role row with supervisor fields populated", () => {
        const out = serializeAgentLoop({
            ...baseLoop,
            role: "supervisor",
            currentPhase: "analyzing",
            currentIteration: 2,
            maxIterations: 5,
            totalActionsFound: 3,
            totalActionsFixed: 1,
        } as any);
        expect(out.role).toBe("supervisor");
        expect(out.currentPhase).toBe("analyzing");
        expect(out.currentIteration).toBe(2);
        expect(out.totalActionsFound).toBe(3);
        expect(out.totalActionsFixed).toBe(1);
    });

    it("coerces nextRunAt bigint to number for the wire", () => {
        const out = serializeAgentLoop({
            ...baseLoop,
            role: "generic",
            nextRunAt: BigInt(1_700_000_000_000),
        } as any);
        expect(out.nextRunAt).toBe(1_700_000_000_000);
        expect(typeof out.nextRunAt).toBe("number");
    });

    it("passes through null nextRunAt without coercion", () => {
        const out = serializeAgentLoop({
            ...baseLoop,
            role: "generic",
            nextRunAt: null,
        } as any);
        expect(out.nextRunAt).toBeNull();
    });
});
