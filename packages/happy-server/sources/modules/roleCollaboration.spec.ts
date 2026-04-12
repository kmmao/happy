import { describe, expect, it } from "vitest";
import {
    buildCollaborationSummary,
    type RawAgentMessage,
    type RawAgentRole,
    type RawDecision,
    type RawTask,
} from "./roleCollaboration";

const makeMsg = (overrides: Partial<RawAgentMessage> & { id: string }): RawAgentMessage => ({
    id: overrides.id,
    fromRole: overrides.fromRole ?? "builder",
    toRole: overrides.toRole ?? null,
    msgType: overrides.msgType ?? "request",
    status: overrides.status ?? "unread",
    relatedGoalId: overrides.relatedGoalId ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-04-12T10:00:00Z"),
});

describe("buildCollaborationSummary", () => {
    it("returns empty summary when project has no roles or messages", () => {
        const result = buildCollaborationSummary({
            roles: [],
            tasks: [],
            messages: [],
            decisions: [],
        });

        expect(result).toEqual({
            roles: [],
            openConflicts: 0,
            pendingDecisions: 0,
            blockedChains: [],
        });
    });

    it("groups unread messages by toRole for pendingMessages count", () => {
        const roles: RawAgentRole[] = [
            { name: "planner", type: "planner" },
            { name: "builder", type: "executor" },
        ];
        const messages: RawAgentMessage[] = [
            makeMsg({ id: "m1", fromRole: "builder", toRole: "planner", msgType: "request", status: "unread" }),
            makeMsg({ id: "m2", fromRole: "builder", toRole: "planner", msgType: "review_request", status: "unread" }),
            makeMsg({ id: "m3", fromRole: "planner", toRole: "builder", msgType: "handoff", status: "unread" }),
        ];

        const result = buildCollaborationSummary({ roles, tasks: [], messages, decisions: [] });

        const planner = result.roles.find((r) => r.roleName === "planner")!;
        const builder = result.roles.find((r) => r.roleName === "builder")!;

        expect(planner.pendingMessages).toBe(2);
        expect(planner.pendingReviews).toBe(1);
        expect(builder.pendingMessages).toBe(1);
        expect(builder.pendingHandoffs).toBe(1);
    });

    it("counts active tasks per role from roleType field", () => {
        const roles: RawAgentRole[] = [{ name: "builder", type: "executor" }];
        const tasks: RawTask[] = [
            { roleType: "builder", status: "running" },
            { roleType: "builder", status: "queued" },
            { roleType: "builder", status: "completed" }, // not active
            { roleType: null, status: "running" },         // no role
        ];

        const result = buildCollaborationSummary({ roles, tasks, messages: [], decisions: [] });

        expect(result.roles[0]?.activeTasks).toBe(2);
    });

    it("builds blockedOn from dependency_blocked messages", () => {
        const roles: RawAgentRole[] = [{ name: "builder", type: "executor" }];
        const messages: RawAgentMessage[] = [
            makeMsg({
                id: "dep-1",
                fromRole: "builder",
                toRole: "planner",
                msgType: "dependency_blocked",
                status: "unread",
                relatedGoalId: "goal-1",
            }),
        ];

        const result = buildCollaborationSummary({ roles, tasks: [], messages, decisions: [] });

        const builder = result.roles[0]!;
        expect(builder.blockedOn).toHaveLength(1);
        expect(builder.blockedOn[0]).toMatchObject({
            waitingFor: "planner",
            reason: "dependency_blocked",
            messageId: "dep-1",
            relatedGoalId: "goal-1",
        });
    });

    it("excludes resolved messages from blockedOn", () => {
        const roles: RawAgentRole[] = [{ name: "builder", type: "executor" }];
        const messages: RawAgentMessage[] = [
            makeMsg({ id: "dep-resolved", fromRole: "builder", toRole: "planner", msgType: "dependency_blocked", status: "resolved" }),
        ];

        const result = buildCollaborationSummary({ roles, tasks: [], messages, decisions: [] });

        expect(result.roles[0]?.blockedOn).toHaveLength(0);
    });

    it("counts open conflicts and pending decisions", () => {
        const messages: RawAgentMessage[] = [
            makeMsg({ id: "c1", msgType: "conflict", status: "unread" }),
            makeMsg({ id: "c2", msgType: "conflict", status: "read" }),
            makeMsg({ id: "c3", msgType: "conflict", status: "resolved" }), // excluded
        ];
        const decisions: RawDecision[] = [
            { status: "pending" },
            { status: "pending" },
            { status: "decided" },
        ];

        const result = buildCollaborationSummary({ roles: [], tasks: [], messages, decisions });

        expect(result.openConflicts).toBe(2);
        expect(result.pendingDecisions).toBe(2);
    });

    it("builds blocked chain A → B → C", () => {
        const messages: RawAgentMessage[] = [
            makeMsg({ id: "d1", fromRole: "tester", toRole: "builder", msgType: "dependency_blocked", status: "unread" }),
            makeMsg({ id: "d2", fromRole: "builder", toRole: "planner", msgType: "dependency_blocked", status: "unread" }),
        ];

        const result = buildCollaborationSummary({ roles: [], tasks: [], messages, decisions: [] });

        expect(result.blockedChains).toHaveLength(1);
        expect(result.blockedChains[0]?.chain).toEqual(["tester", "builder", "planner"]);
    });

    it("returns no blocked chains when all dependency_blocked are resolved", () => {
        const messages: RawAgentMessage[] = [
            makeMsg({ id: "d1", fromRole: "builder", toRole: "planner", msgType: "dependency_blocked", status: "resolved" }),
        ];

        const result = buildCollaborationSummary({ roles: [], tasks: [], messages, decisions: [] });

        expect(result.blockedChains).toHaveLength(0);
    });
});
