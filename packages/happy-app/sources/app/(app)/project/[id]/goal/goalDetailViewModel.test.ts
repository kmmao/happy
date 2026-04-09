import { describe, expect, it } from "vitest";
import { buildGoalDetailSections, deriveGoalDetailScreenState } from "./goalDetailViewModel";
import type { GoalDetail } from "@/sync/apiProjects";

function createGoalDetail(overrides: Partial<GoalDetail> = {}): GoalDetail {
    return {
        id: "goal-1",
        projectId: "project-1",
        title: "Launch feature",
        description: "Ship the new flow",
        status: "in_progress",
        progress: 42,
        priority: "urgent",
        deadline: null,
        parentGoalId: null,
        machineId: "machine-1",
        createdBy: "user-1",
        plannerTaskId: null,
        createdAt: 1,
        updatedAt: 2,
        subGoalCount: 1,
        taskCount: 2,
        decisionCount: 1,
        taskStatusSummary: {
            dispatching: 0,
            queued: 1,
            running: 1,
            completed: 0,
            failed: 0,
            cancelled: 0,
        },
        latestSession: {
            sessionId: "session-1",
            taskId: "task-1",
            taskTitle: "Implement UI",
            status: "running",
            updatedAt: 2,
        },
        blocker: null,
        tasks: [
            {
                id: "task-1",
                title: "Implement UI",
                status: "running",
                sessionId: "session-1",
                roleType: "builder",
                promptPreview: "Do the UI work",
                priority: "user",
                createdAt: 1,
                completedAt: null,
            },
            {
                id: "task-2",
                title: "Write tests",
                status: "queued",
                sessionId: null,
                roleType: "builder",
                promptPreview: "Add tests",
                priority: "user",
                createdAt: 1,
                completedAt: null,
            },
        ],
        subGoals: [
            {
                id: "subgoal-1",
                title: "Polish UX",
                status: "planning",
                progress: 0,
                priority: "normal",
            },
        ],
        blockers: [
            {
                kind: "task_failed",
                summary: "Task failed: API migration",
                sourceTaskId: "task-3",
                requiresHuman: false,
            },
        ],
        decisions: [
            {
                id: "decision-1",
                question: "Use modal or sheet?",
                status: "pending",
                createdAt: 3,
            },
        ],
        ...overrides,
    };
}

describe("buildGoalDetailSections", () => {
    it("builds hero metrics and visible sections", () => {
        const result = buildGoalDetailSections(createGoalDetail());

        expect(result.hero.badges).toEqual(["in_progress", "urgent"]);
        expect(result.hero.progressLabel).toBe("42%");
        expect(result.hero.stats).toEqual([
            { label: "tasks", value: "2" },
            { label: "subGoals", value: "1" },
            { label: "decisions", value: "1" },
        ]);
        expect(result.sections.map((section) => section.key)).toEqual([
            "latest-session",
            "tasks",
            "subgoals",
            "blockers",
            "decisions",
        ]);
    });

    it("surfaces blocker actions for decision and session links", () => {
        const result = buildGoalDetailSections(createGoalDetail({
            blockers: [
                {
                    kind: "agent_conflict",
                    summary: "builder conflict: Need decision on API migration direction",
                    requiresHuman: true,
                    sourceMessageId: "msg-1",
                    decisionId: "decision-1",
                    sessionId: "session-1",
                    messageStatus: "unread",
                },
            ],
        }));

        expect(result.blockerActions).toEqual([
            {
                kind: "open_decision",
                blockerIndex: 0,
                targetId: "decision-1",
            },
            {
                kind: "open_session",
                blockerIndex: 0,
                targetId: "session-1",
            },
            {
                kind: "mark_read",
                blockerIndex: 0,
                targetId: "msg-1",
            },
        ]);
    });

    it("omits empty sections", () => {
        const result = buildGoalDetailSections(createGoalDetail({
            latestSession: null,
            tasks: [],
            subGoals: [],
            blockers: [],
            decisions: [],
            taskCount: 0,
            subGoalCount: 0,
            decisionCount: 0,
        }));

        expect(result.sections).toEqual([]);
        expect(result.blockerActions).toEqual([]);
    });
});

describe("deriveGoalDetailScreenState", () => {
    it("returns loading when initial fetch is in flight", () => {
        expect(deriveGoalDetailScreenState({ loading: true, goal: null, error: null })).toEqual({
            kind: "loading",
        });
    });

    it("returns error when fetch failed", () => {
        expect(deriveGoalDetailScreenState({ loading: false, goal: null, error: "boom" })).toEqual({
            kind: "error",
            message: "boom",
        });
    });

    it("returns empty when no goal and no error", () => {
        expect(deriveGoalDetailScreenState({ loading: false, goal: null, error: null })).toEqual({
            kind: "empty",
        });
    });

    it("returns ready when goal exists", () => {
        expect(deriveGoalDetailScreenState({
            loading: false,
            goal: createGoalDetail(),
            error: null,
        })).toEqual({ kind: "ready" });
    });
});
