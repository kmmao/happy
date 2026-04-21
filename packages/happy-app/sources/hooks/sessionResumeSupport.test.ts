import { describe, expect, it } from "vitest";

import type { Machine, Session } from "@/sync/storageTypes";
import {
    resolveSessionReactivationContext,
    resolveSessionResumeContext,
} from "./sessionResumeSupport";

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
            startedWithCliVersion: "0.71.43",
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
        active: false,
        activeAt: 1,
        presence: "offline",
        thinking: false,
        thinkingAt: 0,
        permissionMode: "default",
        metadata: {
            version: "0.71.42",
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

describe("resolveSessionResumeContext", () => {
    it("returns Claude resume context when the archived session is resumable", () => {
        const result = resolveSessionResumeContext(
            createSession(),
            createMachine(),
        );

        expect(result).toEqual({
            baseSpawnOptions: {
                machineId: "machine-1",
                directory: "/repo",
                happySessionId: "session-1",
                agent: "claude",
                claudeSessionId: "claude-session-1",
            },
        });
    });

    it("returns Codex resume context when an app-server thread exists", () => {
        const result = resolveSessionResumeContext(
            createSession({
                metadata: {
                    version: "0.71.42",
                    machineId: "machine-1",
                    path: "/repo",
                    host: "HomeMac",
                    homeDir: "/Users/test",
                    flavor: "codex",
                    codex: {
                        resolvedBackend: "codex-app-server",
                        threadId: "thread_123",
                    },
                },
            } as Partial<Session>),
            createMachine(),
        );

        expect(result).toEqual({
            baseSpawnOptions: {
                machineId: "machine-1",
                directory: "/repo",
                happySessionId: "session-1",
                agent: "codex",
            },
        });
    });

    it("returns Codex resume context when older metadata omitted resolvedBackend", () => {
        const result = resolveSessionResumeContext(
            createSession({
                metadata: {
                    version: "0.71.42",
                    machineId: "machine-1",
                    path: "/repo",
                    host: "HomeMac",
                    homeDir: "/Users/test",
                    flavor: "codex",
                    codex: {
                        threadId: "thread_legacy_compatible",
                    },
                },
            } as Partial<Session>),
            createMachine(),
        );

        expect(result).toEqual({
            baseSpawnOptions: {
                machineId: "machine-1",
                directory: "/repo",
                happySessionId: "session-1",
                agent: "codex",
            },
        });
    });

    it("blocks Codex resume for explicit legacy backend sessions", () => {
        const result = resolveSessionResumeContext(
            createSession({
                metadata: {
                    version: "0.71.42",
                    machineId: "machine-1",
                    path: "/repo",
                    host: "HomeMac",
                    homeDir: "/Users/test",
                    flavor: "codex",
                    codex: {
                        resolvedBackend: "codex-mcp-legacy",
                        threadId: "thread_123",
                    },
                },
            } as Partial<Session>),
            createMachine(),
        );

        expect(result).toBeNull();
    });

    it("blocks resume when the archived session has no resumable handle", () => {
        const result = resolveSessionResumeContext(
            createSession({
                metadata: {
                    version: "0.71.42",
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
});

describe("resolveSessionReactivationContext", () => {
    it("prefers runtime resume when the archived session is resumable", () => {
        const result = resolveSessionReactivationContext(
            createSession(),
            createMachine(),
        );

        expect(result).toEqual({
            mode: "resume",
            resumeContext: {
                baseSpawnOptions: {
                    machineId: "machine-1",
                    directory: "/repo",
                    happySessionId: "session-1",
                    agent: "claude",
                    claudeSessionId: "claude-session-1",
                },
            },
        });
    });

    it("falls back to unarchive when runtime resume is unavailable", () => {
        const result = resolveSessionReactivationContext(
            createSession({
                metadata: {
                    version: "0.71.42",
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

        expect(result).toEqual({
            mode: "unarchive",
        });
    });
});
