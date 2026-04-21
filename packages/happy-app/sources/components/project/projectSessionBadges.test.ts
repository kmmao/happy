import { describe, expect, it } from "vitest";
import { Session } from "@/sync/storageTypes";
import {
    resolveProjectSessionScopeTone,
    resolveProjectSessionTextBadges,
} from "./projectSessionBadges";

function createSession(
    overrides?: Partial<Session>,
): Session {
    return {
        id: "session-1",
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        forkedFromSessionId: null,
        rpcReady: true,
        metadata: null,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        preferencesVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: "online",
        ...overrides,
    };
}

describe("resolveProjectSessionScopeTone", () => {
    it("returns branch for worktree sessions", () => {
        const session = createSession({
            metadata: {
                worktree: {
                    isWorktree: true,
                    name: "feature",
                    branchName: "feat/layout",
                    worktreePath: "/tmp/worktree",
                    parentRepoPath: "/tmp/repo",
                    parentBranch: "main",
                    state: "active",
                    stateChangedAt: 1,
                },
            } as Session["metadata"],
        });

        expect(resolveProjectSessionScopeTone(session)).toBe("branch");
    });

    it("falls back to main for regular sessions", () => {
        expect(resolveProjectSessionScopeTone(createSession())).toBe("main");
    });
});

describe("resolveProjectSessionTextBadges", () => {
    it("prefers trimmed machine display name over host and keeps version order stable", () => {
        const session = createSession({
            metadata: {
                host: "host-name",
                version: " 0.71.47 ",
            } as Session["metadata"],
        });

        expect(
            resolveProjectSessionTextBadges({
                session,
                machineLabel: " HomeMac ",
            }),
        ).toEqual([
            { kind: "machine", value: "HomeMac" },
            { kind: "version", value: "0.71.47" },
        ]);
    });

    it("falls back to host and includes branch name for worktree sessions", () => {
        const session = createSession({
            metadata: {
                host: "fallback-host",
                worktree: {
                    isWorktree: true,
                    name: "feature",
                    branchName: " feat/layout ",
                    worktreePath: "/tmp/worktree",
                    parentRepoPath: "/tmp/repo",
                    parentBranch: "main",
                    state: "active",
                    stateChangedAt: 1,
                },
            } as Session["metadata"],
        });

        expect(
            resolveProjectSessionTextBadges({
                session,
                machineLabel: "   ",
            }),
        ).toEqual([
            { kind: "machine", value: "fallback-host" },
            { kind: "branchName", value: "feat/layout" },
        ]);
    });

    it("drops empty values so narrow cards do not waste space", () => {
        const session = createSession({
            metadata: {
                host: "   ",
                version: "",
                worktree: {
                    isWorktree: true,
                    name: "feature",
                    branchName: "   ",
                    worktreePath: "/tmp/worktree",
                    parentRepoPath: "/tmp/repo",
                    parentBranch: "main",
                    state: "active",
                    stateChangedAt: 1,
                },
            } as Session["metadata"],
        });

        expect(
            resolveProjectSessionTextBadges({
                session,
                machineLabel: null,
            }),
        ).toEqual([]);
    });
});
