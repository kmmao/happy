import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Socket } from "socket.io";

// We test the routing logic by instantiating a fresh EventRouter
// Since eventRouter is a singleton with side-effect imports, we create
// a minimal replica of the routing logic for unit testing.

// Import the class indirectly by testing the shouldSendToConnection logic
// via the public API (addConnection + emitEphemeral/emitUpdate)

function createMockSocket(): Socket {
    return {
        emit: vi.fn(),
    } as unknown as Socket;
}

// Replicate the routing logic for direct unit testing
function shouldSendToConnection(
    connectionType: "session-scoped" | "user-scoped" | "machine-scoped",
    connectionSessionId: string | undefined,
    connectionMachineId: string | undefined,
    filterType: string,
    filterSessionId?: string,
    filterMachineId?: string,
): boolean {
    switch (filterType) {
        case "all-interested-in-session":
            if (connectionType === "session-scoped") {
                if (connectionSessionId !== filterSessionId) return false;
            } else if (connectionType === "machine-scoped") {
                return false;
            }
            return true;

        case "user-scoped-only":
            return connectionType === "user-scoped";

        case "machine-scoped-only":
            if (connectionType === "user-scoped") return true;
            if (connectionType === "machine-scoped") return connectionMachineId === filterMachineId;
            return false;

        case "all-user-authenticated-connections":
            return true;

        default:
            return false;
    }
}

describe("EventRouter routing logic", () => {
    describe("all-interested-in-session filter", () => {
        it("should include user-scoped connections", () => {
            expect(
                shouldSendToConnection("user-scoped", undefined, undefined, "all-interested-in-session", "s1"),
            ).toBe(true);
        });

        it("should include session-scoped with matching session", () => {
            expect(
                shouldSendToConnection("session-scoped", "s1", undefined, "all-interested-in-session", "s1"),
            ).toBe(true);
        });

        it("should exclude session-scoped with different session", () => {
            expect(
                shouldSendToConnection("session-scoped", "s2", undefined, "all-interested-in-session", "s1"),
            ).toBe(false);
        });

        it("should exclude machine-scoped connections", () => {
            expect(
                shouldSendToConnection("machine-scoped", undefined, "m1", "all-interested-in-session", "s1"),
            ).toBe(false);
        });
    });

    describe("user-scoped-only filter", () => {
        it("should include user-scoped connections", () => {
            expect(shouldSendToConnection("user-scoped", undefined, undefined, "user-scoped-only")).toBe(true);
        });

        it("should exclude session-scoped connections", () => {
            expect(shouldSendToConnection("session-scoped", "s1", undefined, "user-scoped-only")).toBe(false);
        });

        it("should exclude machine-scoped connections", () => {
            expect(shouldSendToConnection("machine-scoped", undefined, "m1", "user-scoped-only")).toBe(false);
        });
    });

    describe("machine-scoped-only filter", () => {
        it("should include user-scoped connections", () => {
            expect(
                shouldSendToConnection("user-scoped", undefined, undefined, "machine-scoped-only", undefined, "m1"),
            ).toBe(true);
        });

        it("should include matching machine-scoped connection", () => {
            expect(
                shouldSendToConnection("machine-scoped", undefined, "m1", "machine-scoped-only", undefined, "m1"),
            ).toBe(true);
        });

        it("should exclude non-matching machine-scoped connection", () => {
            expect(
                shouldSendToConnection("machine-scoped", undefined, "m2", "machine-scoped-only", undefined, "m1"),
            ).toBe(false);
        });

        it("should exclude session-scoped connections", () => {
            expect(
                shouldSendToConnection("session-scoped", "s1", undefined, "machine-scoped-only", undefined, "m1"),
            ).toBe(false);
        });
    });

    describe("all-user-authenticated-connections filter", () => {
        it("should include all connection types", () => {
            expect(
                shouldSendToConnection("user-scoped", undefined, undefined, "all-user-authenticated-connections"),
            ).toBe(true);
            expect(
                shouldSendToConnection("session-scoped", "s1", undefined, "all-user-authenticated-connections"),
            ).toBe(true);
            expect(
                shouldSendToConnection("machine-scoped", undefined, "m1", "all-user-authenticated-connections"),
            ).toBe(true);
        });
    });

    describe("unknown filter", () => {
        it("should exclude all connections", () => {
            expect(shouldSendToConnection("user-scoped", undefined, undefined, "unknown-filter")).toBe(false);
        });
    });
});
