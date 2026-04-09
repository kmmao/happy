import { describe, expect, it } from "vitest";
import {
    buildGoalTaskStatusSummary,
    selectLatestGoalSession,
    buildGoalBlockerSummary,
} from "./goalSummary";

describe("buildGoalTaskStatusSummary", () => {
    it("should count task statuses", () => {
        const result = buildGoalTaskStatusSummary([
            { status: "dispatching" },
            { status: "queued" },
            { status: "running" },
            { status: "completed" },
            { status: "failed" },
            { status: "cancelled" },
            { status: "completed" },
        ]);

        expect(result).toEqual({
            dispatching: 1,
            queued: 1,
            running: 1,
            completed: 2,
            failed: 1,
            cancelled: 1,
        });
    });

    it("should default missing statuses to zero", () => {
        const result = buildGoalTaskStatusSummary([]);

        expect(result).toEqual({
            dispatching: 0,
            queued: 0,
            running: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
        });
    });
});

describe("selectLatestGoalSession", () => {
    it("should return the newest task with a session", () => {
        const result = selectLatestGoalSession([
            {
                id: "task-1",
                title: "Older task",
                status: "completed",
                sessionId: "session-1",
                updatedAt: new Date("2026-04-08T10:00:00Z"),
            },
            {
                id: "task-2",
                title: "No session",
                status: "running",
                sessionId: null,
                updatedAt: new Date("2026-04-08T12:00:00Z"),
            },
            {
                id: "task-3",
                title: "Newest task",
                status: "running",
                sessionId: "session-3",
                updatedAt: new Date("2026-04-08T13:00:00Z"),
            },
        ]);

        expect(result).toEqual({
            sessionId: "session-3",
            taskId: "task-3",
            taskTitle: "Newest task",
            status: "running",
            updatedAt: new Date("2026-04-08T13:00:00Z").getTime(),
        });
    });

    it("should return null when no task has a session", () => {
        const result = selectLatestGoalSession([
            {
                id: "task-1",
                title: "Task 1",
                status: "queued",
                sessionId: null,
                updatedAt: new Date("2026-04-08T10:00:00Z"),
            },
        ]);

        expect(result).toBeNull();
    });
});

describe("buildGoalBlockerSummary", () => {
    it("should build planner timeout blocker summary", () => {
        const result = buildGoalBlockerSummary({
            goalStatus: "blocked",
            plannerTimedOut: true,
            tasks: [],
            agentMessages: [],
        });

        expect(result).toEqual({
            kind: "planner_timeout",
            summary: "Planning result timed out",
            requiresHuman: false,
        });
    });

    it("should prefer failed task blocker over unresolved agent conflict", () => {
        const result = buildGoalBlockerSummary({
            goalStatus: "blocked",
            plannerTimedOut: false,
            tasks: [
                {
                    id: "task-1",
                    title: "Fix API",
                    status: "failed",
                },
            ],
            agentMessages: [
                {
                    id: "msg-1",
                    fromRole: "builder",
                    msgType: "conflict",
                    content: "Need decision on API migration direction",
                    status: "unread",
                    sessionId: "session-1",
                    decisionId: "decision-1",
                    createdAt: new Date("2026-04-08T13:00:00Z"),
                },
            ],
        });

        expect(result).toEqual({
            kind: "task_failed",
            summary: "Task failed: Fix API",
            sourceTaskId: "task-1",
            requiresHuman: false,
        });
    });

    it("should build failed task blocker summary", () => {
        const result = buildGoalBlockerSummary({
            goalStatus: "blocked",
            plannerTimedOut: false,
            tasks: [
                {
                    id: "task-1",
                    title: "Fix API",
                    status: "failed",
                },
            ],
            agentMessages: [],
        });

        expect(result).toEqual({
            kind: "task_failed",
            summary: "Task failed: Fix API",
            sourceTaskId: "task-1",
            requiresHuman: false,
        });
    });

    it("should return null for non-blocked goals", () => {
        const result = buildGoalBlockerSummary({
            goalStatus: "in_progress",
            plannerTimedOut: false,
            tasks: [
                {
                    id: "task-1",
                    title: "Fix API",
                    status: "failed",
                },
            ],
            agentMessages: [],
        });

        expect(result).toBeNull();
    });
});
