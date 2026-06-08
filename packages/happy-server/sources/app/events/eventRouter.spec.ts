import { describe, it, expect, beforeEach } from "vitest";
import {
    buildSessionActivityEphemeral,
    buildMachineActivityEphemeral,
    buildRelationshipUpdatedEvent,
    buildSupervisorStatusEphemeral,
    buildUsageEphemeral,
    buildMachineStatusEphemeral,
    eventRouter,
} from "./eventRouter";

// NOTE: the 15 build*Update payload constructors (buildNewSessionUpdate,
// buildUpdateSessionUpdate, etc.) moved into syncUpdate.ts as private helpers
// in PR 1.f (ADR-0023). They are no longer part of eventRouter's external
// interface; their wire shape is now exercised end-to-end through
// emitSyncUpdate in syncUpdate.spec.ts. buildRelationshipUpdatedEvent
// continues to live in eventRouter.ts — it has no production caller yet, so
// no caller migration to SyncUpdate is meaningful.

describe("buildSessionActivityEphemeral", () => {
    it("should build activity ephemeral payload", () => {
        const result = buildSessionActivityEphemeral("session-1", true, 1000, false);
        expect(result).toEqual({
            type: "activity",
            id: "session-1",
            active: true,
            activeAt: 1000,
            thinking: false,
        });
    });

    it("should set thinking to true when provided", () => {
        const result = buildSessionActivityEphemeral("s1", false, 2000, true);
        expect(result.thinking).toBe(true);
    });

    it("should default thinking to false when undefined", () => {
        const result = buildSessionActivityEphemeral("s1", true, 3000);
        expect(result.thinking).toBe(false);
    });
});

describe("buildMachineActivityEphemeral", () => {
    it("should build machine activity ephemeral payload", () => {
        const result = buildMachineActivityEphemeral("machine-1", true, 5000);
        expect(result).toEqual({
            type: "machine-activity",
            id: "machine-1",
            active: true,
            activeAt: 5000,
        });
    });
});

describe("buildRelationshipUpdatedEvent", () => {
    it("should build relationship updated payload", () => {
        const result = buildRelationshipUpdatedEvent(
            { uid: "user-1", status: "friend", timestamp: 9999 },
            7,
            "upd-4",
        );
        expect(result.body.t).toBe("relationship-updated");
        expect(result.body.uid).toBe("user-1");
        expect(result.body.status).toBe("friend");
        expect(result.body.timestamp).toBe(9999);
    });
});

describe("buildSupervisorStatusEphemeral", () => {
    it("should build supervisor status ephemeral", () => {
        const result = buildSupervisorStatusEphemeral("run-1", "proj-1", "running", "art-1");
        expect(result).toMatchObject({
            type: "supervisor-status",
            runId: "run-1",
            projectId: "proj-1",
            status: "running",
            artifactId: "art-1",
        });
    });

    it("should include error message when provided", () => {
        const result = buildSupervisorStatusEphemeral("run-1", "proj-1", "failed", undefined, "something broke");
        expect(result.errorMessage).toBe("something broke");
    });
});

describe("buildUsageEphemeral", () => {
    it("should build usage ephemeral payload", () => {
        const tokens = { input: 100, output: 50 };
        const cost = { input: 0.01, output: 0.03 };
        const result = buildUsageEphemeral("session-1", "key-1", tokens, cost);
        expect(result.type).toBe("usage");
        expect(result.id).toBe("session-1");
        expect(result.key).toBe("key-1");
        expect(result.tokens).toEqual(tokens);
        expect(result.cost).toEqual(cost);
        expect(result.timestamp).toBeGreaterThan(0);
    });
});

describe("buildMachineStatusEphemeral", () => {
    it("should build machine status ephemeral", () => {
        const result = buildMachineStatusEphemeral("machine-1", true);
        expect(result.type).toBe("machine-status");
        expect(result.machineId).toBe("machine-1");
        expect(result.online).toBe(true);
        expect(result.timestamp).toBeGreaterThan(0);
    });
});

describe("EventRouter.hasActiveNonMachineSocket", () => {
    const fakeSocket = {} as unknown;
    const userId = "u-active-test";

    beforeEach(() => {
        // Clean any leftover singleton state from prior tests.
        const existing = (eventRouter as any).userConnections.get(userId) as Set<unknown> | undefined;
        if (existing) {
            for (const c of [...existing]) eventRouter.removeConnection(userId, c as any);
        }
    });

    it("returns false when there are no connections", () => {
        expect(eventRouter.hasActiveNonMachineSocket(userId)).toBe(false);
    });

    it("returns false when only machine-scoped connections are present", () => {
        const machineConn = { connectionType: "machine-scoped", socket: fakeSocket, userId, machineId: "m1" } as any;
        eventRouter.addConnection(userId, machineConn);
        expect(eventRouter.hasActiveNonMachineSocket(userId)).toBe(false);
        eventRouter.removeConnection(userId, machineConn);
    });

    it("returns true when a user-scoped connection is present", () => {
        const userConn = { connectionType: "user-scoped", socket: fakeSocket, userId } as any;
        eventRouter.addConnection(userId, userConn);
        expect(eventRouter.hasActiveNonMachineSocket(userId)).toBe(true);
        eventRouter.removeConnection(userId, userConn);
    });

    it("returns true when a session-scoped connection is present (even alongside machines)", () => {
        const machineConn = { connectionType: "machine-scoped", socket: fakeSocket, userId, machineId: "m1" } as any;
        const sessionConn = { connectionType: "session-scoped", socket: fakeSocket, userId, sessionId: "s1" } as any;
        eventRouter.addConnection(userId, machineConn);
        eventRouter.addConnection(userId, sessionConn);
        expect(eventRouter.hasActiveNonMachineSocket(userId)).toBe(true);
        eventRouter.removeConnection(userId, machineConn);
        eventRouter.removeConnection(userId, sessionConn);
    });
});
