import { describe, it, expect, beforeEach } from "vitest";
import { eventRouter } from "./eventRouter";

// NOTE: PR 1.f moved the 15 build*Update payload constructors into
// syncUpdate.ts as private helpers; PR 1.5.f did the same for the 21 active
// build*Ephemeral functions into syncEphemeral.ts (with
// buildMachineStatusEphemeral deleted as it had no production caller).
// Those wire shapes are now exercised end-to-end through emitSyncUpdate
// (in syncUpdate.spec.ts) and emitSyncEphemeral (in syncEphemeral.spec.ts).
// PR 1.5.g (this commit) deleted buildRelationshipUpdatedEvent — also a
// production-orphan — alongside its describe block here.

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
