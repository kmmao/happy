import { describe, expect, it } from "vitest";

import type { Machine, Session } from "@/sync/storageTypes";
import { resolveSessionUpgradeContext } from "./sessionUpgradeSupport";

function createMachine(
    overrides: Partial<Machine> = {},
): Machine {
    return {
        id: "machine-1",
        active: true,
        activeAt: 1,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        rpcReady: true,
        metadataVersion: 1,
        metadata: {
            displayName: "HomeMac",
        },
        daemonState: {
            startedWithCliVersion: "0.71.42",
            status: "online",
        },
        daemonStateVersion: 1,
        ...overrides,
    } as Machine;
}

function createSession(
    overrides: Partial<Session> = {},
): Session {
    return {
        id: "session-1",
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        presence: "online",
        thinking: false,
        thinkingAt: 0,
        permissionMode: "default",
        metadata: {
            version: "0.71.41",
            machineId: "machine-1",
            path: "/repo",
            host: "HomeMac",
            homeDir: "/Users/test",
            flavor: "claude",
            claudeSessionId: "claude-session-1",
        },
        ...overrides,
    } as Session;
}

describe("resolveSessionUpgradeContext", () => {
    it("returns Claude upgrade context when the session version is older than the machine CLI", () => {
        const result = resolveSessionUpgradeContext(
            createSession(),
            createMachine(),
        );

        expect(result).toEqual({
            machineCliVersion: "0.71.42",
            baseSpawnOptions: {
                machineId: "machine-1",
                directory: "/repo",
                happySessionId: "session-1",
                agent: "claude",
                claudeSessionId: "claude-session-1",
            },
        });
    });

    it("returns Codex upgrade context when an app-server thread can be resumed", () => {
        const result = resolveSessionUpgradeContext(
            createSession({
                metadata: {
                    version: "0.71.41",
                    machineId: "machine-1",
                    path: "/repo",
                    host: "HomeMac",
                    homeDir: "/Users/test",
                    flavor: "codex",
                    codex: {
                        threadId: "thread_123",
                    },
                },
            } as Partial<Session>),
            createMachine(),
        );

        expect(result).toEqual({
            machineCliVersion: "0.71.42",
            baseSpawnOptions: {
                machineId: "machine-1",
                directory: "/repo",
                happySessionId: "session-1",
                agent: "codex",
            },
        });
    });

    it("does not allow Codex upgrade when there is no resumable thread id", () => {
        const result = resolveSessionUpgradeContext(
            createSession({
                metadata: {
                    version: "0.71.41",
                    machineId: "machine-1",
                    path: "/repo",
                    host: "HomeMac",
                    homeDir: "/Users/test",
                    flavor: "codex",
                    codex: {},
                },
            } as Partial<Session>),
            createMachine(),
        );

        expect(result).toBeNull();
    });

    it("does not allow upgrade when the session is already on the same CLI version", () => {
        const result = resolveSessionUpgradeContext(
            createSession({
                metadata: {
                    version: "0.71.42",
                    machineId: "machine-1",
                    path: "/repo",
                    host: "HomeMac",
                    homeDir: "/Users/test",
                    flavor: "codex",
                    codex: {
                        threadId: "thread_123",
                    },
                },
            } as Partial<Session>),
            createMachine(),
        );

        expect(result).toBeNull();
    });
});
