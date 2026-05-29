import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    __resetSessionScopedStoresForTest,
    disposeSessionScopedState,
    registerSessionScopedStore,
    type SessionScopedStore,
} from "./sessionScopedStore";
import { log } from "@/log";

vi.mock("@/log", () => ({
    log: {
        warn: vi.fn(),
    },
}));

describe("sessionScopedStore", () => {
    beforeEach(() => {
        __resetSessionScopedStoresForTest();
        vi.clearAllMocks();
    });

    it("disposes every registered store for a session", () => {
        const first: SessionScopedStore = { disposeSession: vi.fn() };
        const second: SessionScopedStore = { disposeSession: vi.fn() };

        registerSessionScopedStore(first);
        registerSessionScopedStore(second);

        disposeSessionScopedState("session-1");

        expect(first.disposeSession).toHaveBeenCalledWith("session-1");
        expect(second.disposeSession).toHaveBeenCalledWith("session-1");
    });

    it("continues disposing later stores when one store throws", () => {
        const first: SessionScopedStore = {
            disposeSession: vi.fn(() => {
                throw new Error("dispose failed");
            }),
        };
        const second: SessionScopedStore = { disposeSession: vi.fn() };

        registerSessionScopedStore(first);
        registerSessionScopedStore(second);

        expect(() => disposeSessionScopedState("session-1")).not.toThrow();
        expect(second.disposeSession).toHaveBeenCalledWith("session-1");
        expect(log.warn).toHaveBeenCalledWith(
            "session scoped store dispose failed for session-1: dispose failed",
        );
    });
});
