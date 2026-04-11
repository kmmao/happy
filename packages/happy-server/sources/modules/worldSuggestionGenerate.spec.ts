import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
    buildWorldSuggestionUpdatedEphemeral,
    dbMock,
    emitEphemeral,
    resetState,
    setCountResult,
    seedExistingSuggestion,
    setBlockedGoals,
    setFailedTasks,
    setCompletedTasks,
    setAttentionDecisions,
    setPlanningTimeoutGoalIds,
    setSessionEvents,
    setTaskSkillBindings,
} = vi.hoisted(() => {
    type SuggestionRow = {
        id: string;
        accountId: string;
        projectId: string;
        dedupeKey: string;
        status: string;
        updatedAt: Date;
    };

    const state = {
        blockedGoals: [] as Array<{
            id: string;
            accountId: string;
            projectId: string;
            title: string;
            description: string | null;
            plannerTaskId: string | null;
            updatedAt: Date;
            tasks: Array<{ id: string; title: string; status: string; errorMessage: string | null }>;
        }>,
        failedTasks: [] as Array<{
            id: string;
            accountId: string;
            projectId: string;
            title: string;
            status: string;
            errorMessage: string | null;
            goalId: string | null;
            attempt: number;
            maxAttempts: number;
            updatedAt: Date;
        }>,
        completedTasks: [] as Array<{
            id: string;
            accountId: string;
            projectId: string;
            title: string;
            goalId: string | null;
            sessionId: string | null;
            updatedAt: Date;
        }>,
        sessionEvents: [] as Array<{
            sessionId: string;
            eventType: string;
            summary: string;
            createdAt: Date;
        }>,
        taskSkillBindings: [] as Array<{
            taskId: string;
            skillId: string;
        }>,
        attentionDecisions: [] as Array<{
            id: string;
            accountId: string;
            projectId: string;
            question: string;
            goalId: string | null;
            status: "pending" | "expired";
            expiresAt: Date | null;
            createdAt?: Date;
            updatedAt?: Date;
        }>,
        planningTimeoutGoalIds: [] as string[],
        existingSuggestions: [] as SuggestionRow[],
        countResult: 0,
    };

    const resetState = () => {
        state.blockedGoals = [];
        state.failedTasks = [];
        state.completedTasks = [];
        state.sessionEvents = [];
        state.taskSkillBindings = [];
        state.attentionDecisions = [];
        state.planningTimeoutGoalIds = [];
        state.existingSuggestions = [];
        state.countResult = 0;
    };

    const seedExistingSuggestion = (input: Partial<SuggestionRow> & Pick<SuggestionRow, "id" | "accountId" | "projectId" | "dedupeKey" | "status">) => {
        state.existingSuggestions.push({
            id: input.id,
            accountId: input.accountId,
            projectId: input.projectId,
            dedupeKey: input.dedupeKey,
            status: input.status,
            updatedAt: input.updatedAt ?? new Date("2026-04-10T09:40:00Z"),
        });
    };

    const setBlockedGoals = (goals: typeof state.blockedGoals) => {
        state.blockedGoals = goals;
    };

    const setFailedTasks = (tasks: typeof state.failedTasks) => {
        state.failedTasks = tasks;
    };

    const setCompletedTasks = (tasks: typeof state.completedTasks) => {
        state.completedTasks = tasks;
    };

    const setSessionEvents = (events: typeof state.sessionEvents) => {
        state.sessionEvents = events;
    };

    const setTaskSkillBindings = (bindings: typeof state.taskSkillBindings) => {
        state.taskSkillBindings = bindings;
    };

    const setAttentionDecisions = (decisions: typeof state.attentionDecisions) => {
        state.attentionDecisions = decisions;
    };

    const setPlanningTimeoutGoalIds = (goalIds: string[]) => {
        state.planningTimeoutGoalIds = goalIds;
    };

    const setCountResult = (count: number) => {
        state.countResult = count;
    };

    const dbMock = {
        worldSuggestion: {
            findMany: vi.fn(async (args: any) => {
                if (args?.where?.status === "processing") {
                    return state.existingSuggestions
                        .filter((row) => row.accountId === args.where.accountId)
                        .filter((row) => row.projectId === args.where.projectId)
                        .filter((row) => row.status === "processing")
                        .filter((row) => row.updatedAt <= args.where.updatedAt.lte)
                        .map((row) => ({ id: row.id }));
                }

                if (Array.isArray(args?.where?.status?.in)) {
                    return state.existingSuggestions
                        .filter((row) => row.accountId === args.where.accountId)
                        .filter((row) => row.projectId === args.where.projectId)
                        .filter((row) => args.where.status.in.includes(row.status))
                        .map((row) => ({ id: row.id, dedupeKey: row.dedupeKey, status: row.status }));
                }

                if (args?.where?.id?.in && args?.where?.status === "open") {
                    return state.existingSuggestions
                        .filter((row) => args.where.id.in.includes(row.id) && row.status === "open")
                        .map((row) => ({ id: row.id }));
                }

                return [];
            }),
            updateMany: vi.fn(async ({ where, data }: any) => {
                for (const row of state.existingSuggestions) {
                    const matchesId = !where?.id?.in || where.id.in.includes(row.id);
                    const matchesStatus = !where?.status || row.status === where.status;
                    if (matchesId && matchesStatus) {
                        row.status = data.status;
                    }
                }
                return { count: 1 };
            }),
            create: vi.fn(async ({ data }: any) => ({ id: "created-1", ...data })),
            count: vi.fn(async () => state.countResult),
        },
        task: {
            findMany: vi.fn(async (args: any) => {
                const source = args.where.status === "failed" ? state.failedTasks : state.completedTasks;
                return source
                    .filter((task: any) => task.accountId === args.where.accountId)
                    .filter((task: any) => task.projectId === args.where.projectId)
                    .filter((task: any) => task.status === undefined || task.status === args.where.status)
                    .filter((task: any) => !args.where.sessionId?.not || task.sessionId !== args.where.sessionId.not)
                    .map((task: any) => {
                        const result = { ...task };
                        if ("status" in result && !args.select?.status) delete result.status;
                        return result;
                    });
            }),
        },
        sessionEvent: {
            findMany: vi.fn(async (args: any) =>
                state.sessionEvents
                    .filter((event) => args.where.sessionId.in.includes(event.sessionId))
                    .filter((event) => !args.where.eventType || event.eventType === args.where.eventType)
                    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                    .map((event) => ({
                        sessionId: event.sessionId,
                        eventType: event.eventType,
                        summary: event.summary,
                        createdAt: event.createdAt,
                    })),
            ),
        },
        taskSkillBinding: {
            findMany: vi.fn(async (args: any) =>
                state.taskSkillBindings
                    .filter((binding) => args.where.taskId.in.includes(binding.taskId))
                    .map((binding) => ({ taskId: binding.taskId, skillId: binding.skillId })),
            ),
        },
        goal: {
            findMany: vi.fn(async (args: any) => {
                if (args?.where?.plannerTaskId?.not === null) {
                    return state.blockedGoals
                        .filter((goal) => goal.accountId === args.where.accountId)
                        .filter((goal) => goal.projectId === args.where.projectId)
                        .filter((goal) => goal.plannerTaskId !== null)
                        .filter((goal) => state.planningTimeoutGoalIds.includes(goal.id))
                        .filter((goal) => goal.updatedAt <= args.where.updatedAt.lte)
                        .map((goal) => ({ id: goal.id }));
                }
                return state.blockedGoals
                    .filter((goal) => goal.accountId === args.where.accountId)
                    .filter((goal) => goal.projectId === args.where.projectId);
            }),
        },
        decision: {
            findMany: vi.fn(async (args: any) =>
                state.attentionDecisions
                    .filter((decision) => decision.accountId === args.where.accountId)
                    .filter((decision) => decision.projectId === args.where.projectId)
                    .filter((decision) => decision.status === args.where.status)
                    .map((decision) => ({
                        id: decision.id,
                        question: decision.question,
                        goalId: decision.goalId,
                        status: decision.status,
                        expiresAt: decision.expiresAt,
                    })),
            ),
        },
    };

    return {
        buildWorldSuggestionUpdatedEphemeral: vi.fn((payload: unknown) => payload),
        dbMock,
        emitEphemeral: vi.fn(),
        resetState,
        setCountResult,
        seedExistingSuggestion,
        setBlockedGoals,
        setFailedTasks,
        setCompletedTasks,
        setAttentionDecisions,
        setPlanningTimeoutGoalIds,
        setSessionEvents,
        setTaskSkillBindings,
    };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitEphemeral },
    buildWorldSuggestionUpdatedEphemeral,
}));

import {
    type SuggestionCandidate,
    buildSuggestionCandidates,
    reconcileSuggestionCandidates,
    failedTaskFollowup,
    retryExhaustedDecision,
    blockedGoalAttention,
    decisionAttention,
    completedTaskSkillSuggestion,
    worldSuggestionRefresh,
} from "./worldSuggestionGenerate";

describe("failedTaskFollowup", () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    it("should generate a suggested_task for a failed task with remaining retries", () => {
        const result = failedTaskFollowup({
            id: "task-1",
            title: "Fix auth endpoint",
            errorMessage: "Connection refused: ECONNREFUSED 127.0.0.1:5432",
            goalId: "goal-1",
            attempt: 1,
            maxAttempts: 3,
        });

        expect(result.type).toBe("suggested_task");
        expect(result.dedupeKey).toBe("failed_task_followup:task-1:1:3:Connection refused: ECONNREFUSED 127.0.0.1:5432");
        expect(result.relatedGoalId).toBe("goal-1");
        expect(result.relatedTaskId).toBe("task-1");
        expect(result.payload.task).toBeDefined();
        expect(result.payload.task!.prompt).toContain("Connection refused");
    });
});

describe("retryExhaustedDecision", () => {
    it("should generate a suggested_decision when retries are exhausted", () => {
        const result = retryExhaustedDecision({
            id: "task-2",
            title: "Deploy release",
            errorMessage: "Still failing after retries",
            goalId: "goal-2",
            attempt: 3,
            maxAttempts: 3,
        });

        expect(result.type).toBe("suggested_decision");
        expect(result.relatedGoalId).toBe("goal-2");
        expect(result.relatedTaskId).toBe("task-2");
        expect(result.payload.decision).toBeDefined();
        expect(result.payload.decision!.question).toContain("Deploy release");
        expect(result.payload.decision!.goalId).toBe("goal-2");
        expect(result.dedupeKey).toBe("retry_exhausted_decision:task-2:3:3:Still failing after retries");
    });
});

describe("blockedGoalAttention", () => {
    it("should generate task follow-up for task_failed blockers", () => {
        const result = blockedGoalAttention({
            id: "goal-1",
            title: "Ship v2.0",
            description: "Release version 2.0",
            blocker: {
                kind: "task_failed",
                summary: "Planner task failed with syntax error",
                sourceTaskId: "task-9",
                requiresHuman: false,
            },
        });

        expect(result.type).toBe("suggested_task");
        expect(result.relatedTaskId).toBe("task-9");
        expect(result.reason).toContain("Planner task failed with syntax error");
        expect(result.dedupeKey).toBe("blocked_goal_attention:goal-1:task_failed:Planner task failed with syntax error");
    });

    it("should generate decision attention for planner timeout blockers", () => {
        const result = blockedGoalAttention({
            id: "goal-2",
            title: "Plan migration",
            description: null,
            blocker: {
                kind: "planner_timeout",
                summary: "Planning result timed out",
                requiresHuman: false,
            },
        });

        expect(result.type).toBe("suggested_decision");
        expect(result.payload.decision).toBeDefined();
        expect(result.payload.decision!.question).toContain("Plan migration");
        expect(result.dedupeKey).toBe("blocked_goal_attention:goal-2:planner_timeout:Planning result timed out");
    });
});

describe("decisionAttention", () => {
    it("should distinguish pending vs expired decisions", () => {
        const pending = decisionAttention({
            id: "dec-1",
            question: "Should we use PostgreSQL or MongoDB?",
            goalId: "goal-1",
            status: "pending",
            expiresAt: new Date("2026-04-12T10:00:00Z"),
        });
        const expired = decisionAttention({
            id: "dec-1",
            question: "Should we use PostgreSQL or MongoDB?",
            goalId: "goal-1",
            status: "expired",
            expiresAt: new Date("2026-04-12T10:00:00Z"),
        });

        expect(pending.type).toBe("suggested_decision");
        expect(pending.payload.decision!.existingDecisionId).toBe("dec-1");
        expect(pending.dedupeKey).toBe("decision_attention:dec-1:pending:2026-04-12T10:00:00.000Z");
        expect(expired.dedupeKey).toBe("decision_attention:dec-1:expired:2026-04-12T10:00:00.000Z");
        expect(expired.summary).toContain("expired");
    });
});

describe("completedTaskSkillSuggestion", () => {
    it("should generate a suggested_skill for a completed task with stable session summary", () => {
        const result = completedTaskSkillSuggestion({
            id: "task-3",
            title: "Implement auth refresh",
            goalId: "goal-3",
            sessionId: "session-3",
            summary: "Updated token refresh middleware to reuse cached signing key and verified the auth tests pass.",
        });

        expect(result.type).toBe("suggested_skill");
        expect(result.relatedTaskId).toBe("task-3");
        expect(result.relatedGoalId).toBe("goal-3");
        expect(result.payload.skill).toBeDefined();
        expect(result.payload.skill!.sourceTaskId).toBe("task-3");
        expect(result.payload.skill!.content).toContain("Updated token refresh middleware");
        expect(result.dedupeKey).toBe("completed_task_skill:task-3:session-3:Updated token refresh middleware to reuse cached signing key and verified the auth tests pass.");
    });
});

describe("buildSuggestionCandidates", () => {
    it("should only emit Sprint 1 rules", () => {
        const results = buildSuggestionCandidates({
            failedTasks: [
                {
                    id: "task-open",
                    title: "Retryable task",
                    errorMessage: "boom",
                    goalId: null,
                    attempt: 1,
                    maxAttempts: 3,
                },
                {
                    id: "task-exhausted",
                    title: "Exhausted task",
                    errorMessage: "still broken",
                    goalId: null,
                    attempt: 3,
                    maxAttempts: 3,
                },
            ],
            blockedGoals: [
                {
                    id: "goal-1",
                    title: "Blocked goal",
                    description: null,
                    blocker: {
                        kind: "planner_timeout",
                        summary: "Planning result timed out",
                        requiresHuman: false,
                    },
                },
            ],
            attentionDecisions: [
                {
                    id: "dec-1",
                    question: "Need human input",
                    goalId: null,
                    status: "pending",
                    expiresAt: null,
                },
            ],
            completedTaskSkills: [
                {
                    id: "task-skill-1",
                    title: "Implement auth refresh",
                    goalId: null,
                    sessionId: "session-skill-1",
                    summary: "Updated token refresh middleware to reuse cached signing key and verified the auth tests pass.",
                },
            ],
        });

        expect(results).toHaveLength(5);
        expect(results.map((item) => item.type)).toEqual([
            "suggested_task",
            "suggested_decision",
            "suggested_decision",
            "suggested_decision",
            "suggested_skill",
        ]);
    });
});

describe("reconcileSuggestionCandidates", () => {
    it("should keep dismissed suggestions dismissed for the same fact and reopen only on fact change", () => {
        const candidate: SuggestionCandidate = {
            relatedGoalId: null,
            relatedTaskId: "task-1",
            type: "suggested_task",
            title: "Follow up: task-1",
            summary: "Task failed",
            reason: "Task failed with: boom",
            evidence: [{ kind: "task", id: "task-1", label: "Failed: task-1" }],
            recommendedRole: "builder",
            payload: { task: { title: "Fix task-1", prompt: "Investigate", priority: "user" } },
            requiresHuman: true,
            dedupeKey: "failed_task_followup:task-1:1:3:boom",
            factKey: "task-1|1|3|boom",
        };

        const sameFact = reconcileSuggestionCandidates({
            candidates: [candidate],
            existing: [
                {
                    id: "sug-1",
                    dedupeKey: "failed_task_followup:task-1:1:3:boom",
                    factKey: "task-1|1|3|boom",
                    status: "dismissed",
                },
            ],
        });

        expect(sameFact.toCreate).toHaveLength(0);
        expect(sameFact.toExpireIds).toHaveLength(0);
        expect(sameFact.unchanged).toBe(1);

        const changedFact = reconcileSuggestionCandidates({
            candidates: [{ ...candidate, dedupeKey: "failed_task_followup:task-1:2:3:still-boom", factKey: "task-1|2|3|still-boom" }],
            existing: [
                {
                    id: "sug-1",
                    dedupeKey: "failed_task_followup:task-1:1:3:boom",
                    factKey: "task-1|1|3|boom",
                    status: "dismissed",
                },
            ],
        });

        expect(changedFact.toCreate).toHaveLength(1);
        expect(changedFact.toExpireIds).toEqual(["sug-1"]);
    });

    it("should expire open suggestions missing from refreshed facts", () => {
        const result = reconcileSuggestionCandidates({
            candidates: [],
            existing: [
                {
                    id: "sug-open",
                    dedupeKey: "decision_attention:dec-1:pending:none",
                    factKey: "dec-1|pending|none",
                    status: "open",
                },
                {
                    id: "sug-accepted",
                    dedupeKey: "decision_attention:dec-2:pending:none",
                    factKey: "dec-2|pending|none",
                    status: "accepted",
                },
            ],
        });

        expect(result.toExpireIds).toEqual(["sug-open"]);
    });

    it("should treat processing and suspended suggestions as existing lifecycle rows", () => {
        const candidate: SuggestionCandidate = {
            relatedGoalId: null,
            relatedTaskId: null,
            type: "suggested_goal",
            title: "Create goal",
            summary: "Goal needs follow-up",
            reason: "Recent signal",
            evidence: [{ kind: "goal", id: "goal-1", label: "Goal 1" }],
            recommendedRole: null,
            payload: { goal: { title: "Create goal" } },
            requiresHuman: true,
            dedupeKey: "blocked_goal_attention:goal-1:request:Recent signal",
            factKey: "goal-1|request|Recent signal",
        };

        const processing = reconcileSuggestionCandidates({
            candidates: [candidate],
            existing: [
                {
                    id: "sug-processing",
                    dedupeKey: "blocked_goal_attention:goal-1:request:Recent signal",
                    factKey: "goal-1|request|Recent signal",
                    status: "processing",
                },
            ],
        });

        const suspended = reconcileSuggestionCandidates({
            candidates: [candidate],
            existing: [
                {
                    id: "sug-suspended",
                    dedupeKey: "blocked_goal_attention:goal-1:request:Recent signal",
                    factKey: "goal-1|request|Recent signal",
                    status: "suspended",
                },
            ],
        });

        expect(processing.toCreate).toHaveLength(0);
        expect(processing.unchanged).toBe(1);
        expect(suspended.toCreate).toHaveLength(0);
        expect(suspended.unchanged).toBe(1);
    });

    it("should create a new suggestion when a suspended suggestion changes fact", () => {
        const candidate: SuggestionCandidate = {
            relatedGoalId: null,
            relatedTaskId: null,
            type: "suggested_goal",
            title: "Create goal",
            summary: "Goal needs follow-up",
            reason: "Recent signal changed",
            evidence: [{ kind: "goal", id: "goal-1", label: "Goal 1" }],
            recommendedRole: null,
            payload: { goal: { title: "Create goal" } },
            requiresHuman: true,
            dedupeKey: "blocked_goal_attention:goal-1:request:Recent signal changed",
            factKey: "goal-1|request|Recent signal changed",
        };

        const result = reconcileSuggestionCandidates({
            candidates: [candidate],
            existing: [
                {
                    id: "sug-suspended",
                    dedupeKey: "blocked_goal_attention:goal-1:request:Recent signal",
                    factKey: "goal-1|request|Recent signal",
                    status: "suspended",
                },
            ],
        });

        expect(result.toCreate).toEqual([candidate]);
        expect(result.toExpireIds).toHaveLength(0);
        expect(result.unchanged).toBe(0);
    });

    it("should reopen stale processing suggestions as suspended on refresh event semantics", () => {
        const processingOnly = reconcileSuggestionCandidates({
            candidates: [],
            existing: [
                {
                    id: "sug-processing",
                    dedupeKey: "blocked_goal_attention:goal-1:request:Recent signal",
                    factKey: "goal-1|request|Recent signal",
                    status: "processing",
                },
            ],
        });

        expect(processingOnly.toExpireIds).toHaveLength(0);
    });
});

describe("worldSuggestionRefresh", () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-04-10T10:00:00Z"));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("does not suspend processing suggestions newer than five minutes", async () => {
        seedExistingSuggestion({
            id: "sug-processing-fresh",
            accountId: "user-1",
            projectId: "project-1",
            dedupeKey: "blocked_goal_attention:goal-fresh:planner_timeout:Planning result timed out",
            status: "processing",
            updatedAt: new Date("2026-04-10T09:55:01Z"),
        });

        const result = await worldSuggestionRefresh("user-1", "project-1");

        expect(dbMock.worldSuggestion.updateMany).not.toHaveBeenCalled();
        expect(emitEphemeral).not.toHaveBeenCalled();
        expect(dbMock.worldSuggestion.create).not.toHaveBeenCalled();
        expect(result).toEqual({ created: 0, unchanged: 0, total: 0 });
    });

    it("suspends processing suggestions exactly at the five minute boundary", async () => {
        seedExistingSuggestion({
            id: "sug-processing-boundary",
            accountId: "user-1",
            projectId: "project-1",
            dedupeKey: "blocked_goal_attention:goal-boundary:planner_timeout:Planning result timed out",
            status: "processing",
            updatedAt: new Date("2026-04-10T09:55:00Z"),
        });

        const result = await worldSuggestionRefresh("user-1", "project-1");

        expect(dbMock.worldSuggestion.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ["sug-processing-boundary"] }, status: "processing" },
            data: { status: "suspended" },
        });
        expect(emitEphemeral).toHaveBeenCalledWith({
            userId: "user-1",
            payload: {
                projectId: "project-1",
                suggestionId: "sug-processing-boundary",
                status: "suspended",
            },
            recipientFilter: { type: "user-scoped-only" },
        });
        expect(dbMock.worldSuggestion.create).not.toHaveBeenCalled();
        expect(result).toEqual({ created: 0, unchanged: 0, total: 0 });
    });

    it("creates a suggested_skill from a completed task with a stable session summary", async () => {
        setCompletedTasks([
            {
                id: "task-skill-1",
                accountId: "user-1",
                projectId: "project-1",
                title: "Implement auth refresh",
                goalId: null,
                sessionId: "session-skill-1",
                updatedAt: new Date("2026-04-10T09:57:00Z"),
            },
        ]);
        setSessionEvents([
            {
                sessionId: "session-skill-1",
                eventType: "session_end",
                summary: "Updated token refresh middleware to reuse cached signing key and verified the auth tests pass.",
                createdAt: new Date("2026-04-10T09:56:00Z"),
            },
        ]);

        await worldSuggestionRefresh("user-1", "project-1");

        expect(dbMock.worldSuggestion.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                type: "suggested_skill",
                relatedTaskId: "task-skill-1",
            }),
        }));
    });

    it("does not create a suggested_skill when the completed task summary is missing or unstable", async () => {
        setCompletedTasks([
            {
                id: "task-skill-2",
                accountId: "user-1",
                projectId: "project-1",
                title: "Implement auth refresh",
                goalId: null,
                sessionId: "session-skill-2",
                updatedAt: new Date("2026-04-10T09:57:00Z"),
            },
            {
                id: "task-skill-3",
                accountId: "user-1",
                projectId: "project-1",
                title: "Implement billing fix",
                goalId: null,
                sessionId: "session-skill-3",
                updatedAt: new Date("2026-04-10T09:57:00Z"),
            },
        ]);
        setSessionEvents([
            {
                sessionId: "session-skill-2",
                eventType: "session_end",
                summary: "done",
                createdAt: new Date("2026-04-10T09:56:00Z"),
            },
            {
                sessionId: "session-skill-3",
                eventType: "session_end",
                summary: "Need user decision on billing API direction.",
                createdAt: new Date("2026-04-10T09:56:00Z"),
            },
        ]);

        await worldSuggestionRefresh("user-1", "project-1");

        expect(dbMock.worldSuggestion.create).not.toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ type: "suggested_skill" }),
        }));
    });

    it("ignores non-session_end events for suggested_skill generation", async () => {
        setCompletedTasks([
            {
                id: "task-skill-4",
                accountId: "user-1",
                projectId: "project-1",
                title: "Refactor auth flow",
                goalId: null,
                sessionId: "session-skill-4",
                updatedAt: new Date("2026-04-10T09:57:00Z"),
            },
        ]);
        setSessionEvents([
            {
                sessionId: "session-skill-4",
                eventType: "file_edit",
                summary: "Edited packages/happy-server/sources/app/api/routes/auth.ts",
                createdAt: new Date("2026-04-10T09:56:30Z"),
            },
            {
                sessionId: "session-skill-4",
                eventType: "session_end",
                summary: "Completed OAuth callback flow hardening and verified the auth regression tests pass.",
                createdAt: new Date("2026-04-10T09:56:00Z"),
            },
        ]);

        await worldSuggestionRefresh("user-1", "project-1");

        expect(dbMock.worldSuggestion.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                type: "suggested_skill",
                relatedTaskId: "task-skill-4",
            }),
        }));
    });

    it("does not create suggested_skill from file_edit events alone", async () => {
        setCompletedTasks([
            {
                id: "task-skill-5",
                accountId: "user-1",
                projectId: "project-1",
                title: "Refactor auth flow",
                goalId: null,
                sessionId: "session-skill-5",
                updatedAt: new Date("2026-04-10T09:57:00Z"),
            },
        ]);
        setSessionEvents([
            {
                sessionId: "session-skill-5",
                eventType: "file_edit",
                summary: "Completed auth.ts edit and saved the file.",
                createdAt: new Date("2026-04-10T09:56:30Z"),
            },
        ]);

        await worldSuggestionRefresh("user-1", "project-1");

        expect(dbMock.worldSuggestion.create).not.toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                type: "suggested_skill",
                relatedTaskId: "task-skill-5",
            }),
        }));
    });

    it("does not generate planner timeout suggestions newer than ten minutes", async () => {
        setBlockedGoals([
            {
                id: "goal-not-stale",
                accountId: "user-1",
                projectId: "project-1",
                title: "Plan migration",
                description: null,
                plannerTaskId: "planner-1",
                updatedAt: new Date("2026-04-10T09:50:01Z"),
                tasks: [],
            },
        ]);
        setPlanningTimeoutGoalIds([]);

        const result = await worldSuggestionRefresh("user-1", "project-1");

        expect(dbMock.goal.findMany).toHaveBeenNthCalledWith(2, {
            where: {
                accountId: "user-1",
                projectId: "project-1",
                status: "blocked",
                plannerTaskId: { not: null },
                updatedAt: { lte: new Date("2026-04-10T09:50:00Z") },
            },
            select: { id: true },
        });
        expect(dbMock.worldSuggestion.create).not.toHaveBeenCalled();
        expect(result).toEqual({ created: 0, unchanged: 0, total: 0 });
    });

    it("marks stale processing suggestions suspended and does not recreate the same fact at the planner timeout boundary", async () => {
        seedExistingSuggestion({
            id: "sug-processing-1",
            accountId: "user-1",
            projectId: "project-1",
            dedupeKey: "blocked_goal_attention:goal-1:planner_timeout:Planning result timed out",
            status: "processing",
            updatedAt: new Date("2026-04-10T09:54:00Z"),
        });
        setBlockedGoals([
            {
                id: "goal-1",
                accountId: "user-1",
                projectId: "project-1",
                title: "Plan migration",
                description: null,
                plannerTaskId: "planner-1",
                updatedAt: new Date("2026-04-10T09:50:00Z"),
                tasks: [],
            },
        ]);
        setPlanningTimeoutGoalIds(["goal-1"]);
        setCountResult(0);

        const result = await worldSuggestionRefresh("user-1", "project-1");

        expect(dbMock.worldSuggestion.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ["sug-processing-1"] }, status: "processing" },
            data: { status: "suspended" },
        });
        expect(dbMock.goal.findMany).toHaveBeenNthCalledWith(2, {
            where: {
                accountId: "user-1",
                projectId: "project-1",
                status: "blocked",
                plannerTaskId: { not: null },
                updatedAt: { lte: new Date("2026-04-10T09:50:00Z") },
            },
            select: { id: true },
        });
        expect(dbMock.worldSuggestion.findMany).toHaveBeenNthCalledWith(2, {
            where: {
                accountId: "user-1",
                projectId: "project-1",
                status: { in: ["open", "processing", "suspended", "dismissed", "accepted"] },
            },
            select: { id: true, dedupeKey: true, status: true },
        });
        expect(dbMock.worldSuggestion.create).not.toHaveBeenCalled();
        expect(emitEphemeral).toHaveBeenCalledWith({
            userId: "user-1",
            payload: {
                projectId: "project-1",
                suggestionId: "sug-processing-1",
                status: "suspended",
            },
            recipientFilter: { type: "user-scoped-only" },
        });
        expect(result).toEqual({ created: 0, unchanged: 1, total: 0 });
    });

    it("creates a new task follow-up when a suspended task suggestion changes fact", async () => {
        seedExistingSuggestion({
            id: "sug-task-suspended",
            accountId: "user-1",
            projectId: "project-1",
            dedupeKey: "failed_task_followup:task-1:1:3:boom",
            status: "suspended",
        });
        setFailedTasks([
            {
                id: "task-1",
                accountId: "user-1",
                projectId: "project-1",
                title: "Retryable task",
                status: "failed",
                errorMessage: "still-boom",
                goalId: null,
                attempt: 2,
                maxAttempts: 3,
                updatedAt: new Date("2026-04-10T09:59:00Z"),
            },
        ]);
        setCountResult(1);

        const result = await worldSuggestionRefresh("user-1", "project-1");

        expect(dbMock.worldSuggestion.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                accountId: "user-1",
                projectId: "project-1",
                type: "suggested_task",
                dedupeKey: "failed_task_followup:task-1:2:3:still-boom",
                relatedTaskId: "task-1",
            }),
        });
        expect(result).toEqual({ created: 1, unchanged: 0, total: 1 });
    });

    it("creates a new decision attention suggestion when a dismissed decision fact changes", async () => {
        seedExistingSuggestion({
            id: "sug-decision-dismissed",
            accountId: "user-1",
            projectId: "project-1",
            dedupeKey: "decision_attention:dec-1:pending:none",
            status: "dismissed",
        });
        setAttentionDecisions([
            {
                id: "dec-1",
                accountId: "user-1",
                projectId: "project-1",
                question: "Need human input",
                goalId: null,
                status: "expired",
                expiresAt: new Date("2026-04-12T10:00:00Z"),
            },
        ]);
        setCountResult(1);

        const result = await worldSuggestionRefresh("user-1", "project-1");

        expect(dbMock.worldSuggestion.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                accountId: "user-1",
                projectId: "project-1",
                type: "suggested_decision",
                dedupeKey: "decision_attention:dec-1:expired:2026-04-12T10:00:00.000Z",
            }),
        });
        expect(result).toEqual({ created: 1, unchanged: 0, total: 1 });
    });
});
