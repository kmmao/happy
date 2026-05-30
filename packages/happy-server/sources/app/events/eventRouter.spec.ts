import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    buildSessionActivityEphemeral,
    buildMachineActivityEphemeral,
    buildDeleteSessionUpdate,
    buildUpdateSessionUpdate,
    buildNewMessageUpdate,
    buildDeleteArtifactUpdate,
    buildUpdateArtifactUpdate,
    buildRelationshipUpdatedEvent,
    buildNewFeedPostUpdate,
    buildKVBatchUpdateUpdate,
    buildNewProjectUpdate,
    buildUpdateProjectUpdate,
    buildDeleteProjectUpdate,
    buildSupervisorStatusEphemeral,
    buildUsageEphemeral,
    buildMachineStatusEphemeral,
    buildUpdateMachineUpdate,
    eventRouter,
} from "./eventRouter";

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

describe("buildDeleteSessionUpdate", () => {
    it("should build delete session update payload", () => {
        const result = buildDeleteSessionUpdate("session-1", 10, "update-1");
        expect(result.id).toBe("update-1");
        expect(result.seq).toBe(10);
        expect(result.body.t).toBe("delete-session");
        expect(result.body.sid).toBe("session-1");
        expect(result.createdAt).toBeGreaterThan(0);
    });
});

describe("buildUpdateSessionUpdate", () => {
    it("should build update session with metadata", () => {
        const result = buildUpdateSessionUpdate(
            "session-1",
            5,
            "upd-1",
            { value: "meta", version: 2 },
        );
        expect(result.body.t).toBe("update-session");
        expect(result.body.id).toBe("session-1");
        expect(result.body.metadata).toEqual({ value: "meta", version: 2 });
    });

    it("should build update session with all fields", () => {
        const result = buildUpdateSessionUpdate(
            "session-1",
            5,
            "upd-1",
            { value: "meta", version: 2 },
            { value: "state", version: 3 },
            { value: "prefs", version: 1 },
        );
        expect(result.body.agentState).toEqual({ value: "state", version: 3 });
        expect(result.body.preferences).toEqual({ value: "prefs", version: 1 });
    });
});

describe("buildNewMessageUpdate", () => {
    it("should build new message update payload", () => {
        const message = {
            id: "msg-1",
            seq: 1,
            content: { c: "encrypted-hello", t: "encrypted" as const },
            localId: "local-1" as string | null,
            createdAt: new Date("2024-01-01"),
            updatedAt: new Date("2024-01-02"),
        };
        const result = buildNewMessageUpdate(message, "session-1", 10, "upd-1");
        expect(result.body.t).toBe("new-message");
        expect(result.body.sid).toBe("session-1");
        expect(result.body.message.id).toBe("msg-1");
        expect(result.body.message.seq).toBe(1);
        expect(result.body.message.localId).toBe("local-1");
        expect(result.body.message.createdAt).toBe(new Date("2024-01-01").getTime());
    });
});

describe("buildDeleteArtifactUpdate", () => {
    it("should build delete artifact update payload", () => {
        const result = buildDeleteArtifactUpdate("art-1", 3, "upd-2");
        expect(result.body.t).toBe("delete-artifact");
        expect(result.body.artifactId).toBe("art-1");
        expect(result.seq).toBe(3);
    });
});

describe("buildUpdateArtifactUpdate", () => {
    it("should build update artifact with header and body", () => {
        const result = buildUpdateArtifactUpdate(
            "art-1",
            5,
            "upd-3",
            { value: "header-data", version: 2 },
            { value: "body-data", version: 3 },
        );
        expect(result.body.t).toBe("update-artifact");
        expect(result.body.artifactId).toBe("art-1");
        expect(result.body.header).toEqual({ value: "header-data", version: 2 });
        expect(result.body.body).toEqual({ value: "body-data", version: 3 });
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

describe("buildNewFeedPostUpdate", () => {
    it("should build new feed post payload", () => {
        const result = buildNewFeedPostUpdate(
            { id: "post-1", body: { text: "hello" }, cursor: "c1", createdAt: 1000 },
            8,
            "upd-5",
        );
        expect(result.body.t).toBe("new-feed-post");
        expect(result.body.id).toBe("post-1");
        expect(result.body.cursor).toBe("c1");
    });
});

describe("buildKVBatchUpdateUpdate", () => {
    it("should build KV batch update payload", () => {
        const changes = [
            { key: "k1", value: "v1", version: 1 },
            { key: "k2", value: null, version: -1 },
        ];
        const result = buildKVBatchUpdateUpdate(changes, 9, "upd-6");
        expect(result.body.t).toBe("kv-batch-update");
        expect(result.body.changes).toEqual(changes);
    });
});

describe("buildNewProjectUpdate", () => {
    it("should build new project payload", () => {
        const project = {
            id: "proj-1",
            machineId: "m-1",
            path: "/my/project",
            repoUrl: "https://github.com/test/repo",
            metadata: '{"name":"test"}',
            metadataVersion: 1,
            archived: false,
            createdAt: new Date("2024-01-01"),
            updatedAt: new Date("2024-01-02"),
        };
        const result = buildNewProjectUpdate(project, 10, "upd-7");
        expect(result.body.t).toBe("new-project");
        expect(result.body.projectId).toBe("proj-1");
        expect(result.body.machineId).toBe("m-1");
        expect(result.body.path).toBe("/my/project");
        expect(result.body.repoUrl).toBe("https://github.com/test/repo");
        expect(result.body.archived).toBe(false);
    });
});

describe("buildUpdateProjectUpdate", () => {
    it("should build update project with metadata", () => {
        const result = buildUpdateProjectUpdate(
            "proj-1",
            11,
            "upd-8",
            { value: "meta", version: 2 },
            true,
        );
        expect(result.body.t).toBe("update-project");
        expect(result.body.projectId).toBe("proj-1");
        expect(result.body.metadata).toEqual({ value: "meta", version: 2 });
        expect(result.body.archived).toBe(true);
    });
});

describe("buildDeleteProjectUpdate", () => {
    it("should build delete project payload", () => {
        const result = buildDeleteProjectUpdate("proj-1", 12, "upd-9");
        expect(result.body.t).toBe("delete-project");
        expect(result.body.projectId).toBe("proj-1");
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


describe("buildUpdateMachineUpdate", () => {
    it("should build update machine payload", () => {
        const result = buildUpdateMachineUpdate(
            "machine-1",
            5,
            "upd-10",
            { value: "meta", version: 1 },
            { value: "daemon-state", version: 2 },
        );
        expect(result.body.t).toBe("update-machine");
        expect(result.body.machineId).toBe("machine-1");
        expect(result.body.metadata).toEqual({ value: "meta", version: 1 });
        expect(result.body.daemonState).toEqual({ value: "daemon-state", version: 2 });
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
