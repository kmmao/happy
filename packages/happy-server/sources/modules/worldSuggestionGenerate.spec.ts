import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const {
    buildWorldSuggestionUpdatedEphemeral,
    dbMock,
    emitEphemeral,
    autoAcceptSuggestedTasksIfEnabled,
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
    setProjectSupervisorConfig,
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
        projectSupervisorConfig: null as string | null,
        projectSupervisorMode: null as string | null,
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
        state.projectSupervisorConfig = null;
        state.projectSupervisorMode = null;
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

    const setProjectSupervisorConfig = (supervisorConfig: string | null) => {
        state.projectSupervisorConfig = supervisorConfig;
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
        project: {
            findUnique: vi.fn(async () => ({ supervisorConfig: state.projectSupervisorConfig, supervisorMode: state.projectSupervisorMode })),
        },
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
            create: vi.fn(async ({ data }: any) => ({ id: `created-${state.countResult + 1}`, ...data })),
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
                        if ("status" in result && !args.select?.status) {
                            delete result.status;
                        }
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
        repeatKey: {
            findUnique: vi.fn(async () => null) as any,
            upsert: vi.fn(async () => ({})),
        },
    };

    return {
        buildWorldSuggestionUpdatedEphemeral: vi.fn((payload: unknown) => payload),
        dbMock,
        emitEphemeral: vi.fn(),
        autoAcceptSuggestedTasksIfEnabled: vi.fn(async () => {}),
        resetState,
        setCountResult,
        seedExistingSuggestion,
        setBlockedGoals,
        setFailedTasks,
        setCompletedTasks,
        setAttentionDecisions,
        setPlanningTimeoutGoalIds,
        setProjectSupervisorConfig,
        setSessionEvents,
        setTaskSkillBindings,
    };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitEphemeral },
    buildWorldSuggestionUpdatedEphemeral,
}));
vi.mock("./worldSuggestionAutoAccept", () => ({
    autoAcceptSuggestedTasksIfEnabled,
}));

import {
    type SuggestionCandidate,
    buildSuggestionCandidates,
    reconcileSuggestionCandidates,
    failedTaskFollowup,
    retryableFailedTask,
    retryExhaustedDecision,
    blockedGoalAttention,
    blockedGoalSupplement,
    decisionAttention,
    completedTaskSkillSuggestion,
    worldSuggestionRefresh,
} from "./worldSuggestionGenerate";
import { normalizeSuggestionFactText } from "./summaryDetailFilter";

describe("worldSuggestionGenerate", () => {
    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("binds suggested_task payload to task type", () => {
        const result = failedTaskFollowup({
            id: "task-1",
            title: "Fix auth endpoint",
            errorMessage: "Connection refused",
            goalId: "goal-1",
            attempt: 1,
            maxAttempts: 3,
        });

        expect(result.type).toBe("suggested_task");
        expect(result.bucket).toBe("next_step");
        expect("task" in result.payload).toBe(true);
        expect("goal" in result.payload).toBe(false);
        if (!("task" in result.payload)) throw new Error("expected task payload");
        expect(result.payload.task.prompt).toContain("Connection refused");
    });

    it("normalizes empty fact text in failed task follow-up", () => {
        const fallback = normalizeSuggestionFactText("   ", "Unknown error");
        const result = failedTaskFollowup({
            id: "task-empty-error",
            title: "Fix auth endpoint",
            errorMessage: "   ",
            goalId: null,
            attempt: 1,
            maxAttempts: 3,
        });

        expect(result.reason).toBe(`Task failed with: ${fallback}`);
        if (!("task" in result.payload)) throw new Error("expected task payload");
        expect(result.payload.task.prompt).toContain(`Error: ${fallback}`);
    });

    it("binds suggested_decision payload to exhausted retry type", () => {
        const result = retryExhaustedDecision({
            id: "task-2",
            title: "Deploy release",
            errorMessage: "Still failing after retries",
            goalId: "goal-2",
            attempt: 3,
            maxAttempts: 3,
        });

        expect(result.type).toBe("suggested_decision");
        expect(result.bucket).toBe("needs_decision");
        expect("decision" in result.payload).toBe(true);
        expect("task" in result.payload).toBe(false);
        if (!("decision" in result.payload)) throw new Error("expected decision payload");
        expect(result.payload.decision.question).toContain("Deploy release");
    });

    it("emits decision payload for planner timeout blockers", () => {
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
        expect(result.bucket).toBe("needs_decision");
        if (!("decision" in result.payload)) throw new Error("expected decision payload");
        expect(result.payload.decision.context).toBe("Goal is blocked");
    });

    it("emits task payload for blocked goal remediation", () => {
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
        expect(result.bucket).toBe("next_step");
        if (!("task" in result.payload)) throw new Error("expected task payload");
        expect(result.payload.task.goalId).toBe("goal-1");
        expect(result.relatedTaskId).toBe("task-9");
    });

    it("binds suggested_skill payload to completed task extraction", () => {
        const result = completedTaskSkillSuggestion({
            id: "task-3",
            title: "Implement auth refresh",
            goalId: "goal-3",
            sessionId: "session-3",
            summary: "Updated token refresh middleware to reuse cached signing key and verified the auth tests pass.",
        });

        expect(result.type).toBe("suggested_skill");
        expect(result.bucket).toBe("next_step");
        expect("skill" in result.payload).toBe(true);
        expect("decision" in result.payload).toBe(false);
        if (!("skill" in result.payload)) throw new Error("expected skill payload");
        expect(result.payload.skill.sourceTaskId).toBe("task-3");
    });

    it("builds only current suggestion candidates", () => {
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

        expect(results.map((item) => item.type)).toEqual([
            "suggested_task",
            "suggested_decision",
            "suggested_decision",
            "suggested_decision",
            "suggested_skill",
        ]);
    });

    it("keeps dismissed suggestion dismissed for the same fact", () => {
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
            bucket: "next_step",
            dedupeKey: "failed_task_followup:task-1:1:3:boom",
            factKey: "task-1|1|3|boom",
        };

        const result = reconcileSuggestionCandidates({
            candidates: [candidate],
            existing: [{
                id: "sug-1",
                dedupeKey: "failed_task_followup:task-1:1:3:boom",
                factKey: "task-1|1|3|boom",
                status: "dismissed",
            }],
        });

        expect(result.toCreate).toHaveLength(0);
        expect(result.toExpireIds).toHaveLength(0);
        expect(result.unchanged).toBe(1);
    });

    it("reopens changed dismissed fact as a new suggestion", () => {
        const candidate: SuggestionCandidate = {
            relatedGoalId: null,
            relatedTaskId: "task-1",
            type: "suggested_task",
            title: "Follow up: task-1",
            summary: "Task failed",
            reason: "Task failed with: still-boom",
            evidence: [{ kind: "task", id: "task-1", label: "Failed: task-1" }],
            recommendedRole: "builder",
            payload: { task: { title: "Fix task-1", prompt: "Investigate", priority: "user" } },
            requiresHuman: true,
            bucket: "next_step",
            dedupeKey: "failed_task_followup:task-1:2:3:still-boom",
            factKey: "task-1|2|3|still-boom",
        };

        const result = reconcileSuggestionCandidates({
            candidates: [candidate],
            existing: [{
                id: "sug-1",
                dedupeKey: "failed_task_followup:task-1:1:3:boom",
                factKey: "task-1|1|3|boom",
                status: "dismissed",
            }],
        });

        expect(result.toCreate).toEqual([candidate]);
        expect(result.toExpireIds).toEqual(["sug-1"]);
    });

    it("suspends stale processing suggestions at the five minute boundary", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-04-10T10:00:00Z"));
        seedExistingSuggestion({
            id: "processing-stale",
            accountId: "user-1",
            projectId: "project-1",
            dedupeKey: "blocked_goal_attention:goal-1:planner_timeout:Planning result timed out",
            status: "processing",
            updatedAt: new Date("2026-04-10T09:55:00Z"),
        });
        setCountResult(0);

        const result = await worldSuggestionRefresh("user-1", "project-1");

        expect(dbMock.worldSuggestion.updateMany).toHaveBeenCalledWith({
            where: {
                id: { in: ["processing-stale"] },
                status: "processing",
            },
            data: { status: "suspended" },
        });
        expect(buildWorldSuggestionUpdatedEphemeral).toHaveBeenCalledWith({
            projectId: "project-1",
            suggestionId: "processing-stale",
            status: "suspended",
        });
        expect(result.created).toBe(0);
    });

    it("creates a suggested_skill from a completed task with stable session summary", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-04-10T10:00:00Z"));
        setCompletedTasks([
            {
                id: "task-skill-1",
                accountId: "user-1",
                projectId: "project-1",
                title: "Implement auth refresh",
                goalId: "goal-1",
                sessionId: "session-skill-1",
                updatedAt: new Date("2026-04-10T09:50:00Z"),
            },
        ]);
        setSessionEvents([
            {
                sessionId: "session-skill-1",
                eventType: "session_end",
                summary: "Updated token refresh middleware to reuse cached signing key and verified the auth tests pass.",
                createdAt: new Date("2026-04-10T09:51:00Z"),
            },
        ]);
        setCountResult(1);

        const result = await worldSuggestionRefresh("user-1", "project-1");

        expect(dbMock.worldSuggestion.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                type: "suggested_skill",
                relatedTaskId: "task-skill-1",
                payload: expect.stringContaining('"sourceTaskId":"task-skill-1"'),
            }),
        });
        expect(result.created).toBe(1);
        expect(result.total).toBe(1);
    });

    it("passes newly created suggestions into auto-accept with project config", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-04-10T10:00:00Z"));
        setProjectSupervisorConfig(JSON.stringify({
            worldAutonomy: { autoAcceptSafeSuggestedTasks: true },
        }));
        setBlockedGoals([
            {
                id: "goal-1",
                accountId: "user-1",
                projectId: "project-1",
                title: "Ship v2.0",
                description: "Release version 2.0",
                plannerTaskId: null,
                updatedAt: new Date("2026-04-10T09:50:00Z"),
                tasks: [{
                    id: "task-9",
                    title: "Planner task",
                    status: "failed",
                    errorMessage: "syntax error",
                }],
            },
        ]);
        setCountResult(1);

        await worldSuggestionRefresh("user-1", "project-1");

        expect(autoAcceptSuggestedTasksIfEnabled).toHaveBeenCalledWith({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: null,
            supervisorConfig: JSON.stringify({
                worldAutonomy: { autoAcceptSafeSuggestedTasks: true },
            }),
            suggestions: expect.arrayContaining([
                expect.objectContaining({
                    type: "suggested_task",
                    projectId: "project-1",
                    status: "open",
                    relatedGoalId: "goal-1",
                }),
            ]),
        });
    });

    it("calls auto-accept with empty created list when no new suggestions are created", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-04-10T10:00:00Z"));
        setProjectSupervisorConfig(JSON.stringify({
            worldAutonomy: { autoAcceptSafeSuggestedTasks: true },
        }));
        setCountResult(0);

        await worldSuggestionRefresh("user-1", "project-1");

        expect(autoAcceptSuggestedTasksIfEnabled).toHaveBeenCalledWith({
            accountId: "user-1",
            projectId: "project-1",
            supervisorMode: null,
            supervisorConfig: JSON.stringify({
                worldAutonomy: { autoAcceptSafeSuggestedTasks: true },
            }),
            suggestions: [],
        });
    });

    it("returns debounced result when refresh is called within the debounce window", async () => {
        dbMock.repeatKey.findUnique.mockResolvedValueOnce({
            key: "world-suggestion-refresh:project-1",
            value: "1",
            expiresAt: new Date(Date.now() + 5_000),
            createdAt: new Date(),
        });
        setCountResult(3);

        const result = await worldSuggestionRefresh("user-1", "project-1");

        expect(result).toEqual({ created: 0, unchanged: 0, total: 3, debounced: true });
        expect(autoAcceptSuggestedTasksIfEnabled).not.toHaveBeenCalled();
    });

    it("proceeds normally when debounce key has expired", async () => {
        dbMock.repeatKey.findUnique.mockResolvedValueOnce({
            key: "world-suggestion-refresh:project-1",
            value: "1",
            expiresAt: new Date(Date.now() - 1_000),
            createdAt: new Date(),
        });
        setCountResult(0);

        const result = await worldSuggestionRefresh("user-1", "project-1");

        expect(result.debounced).toBeUndefined();
        expect(dbMock.repeatKey.upsert).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Sprint 3: retryableFailedTask
// ---------------------------------------------------------------------------

describe("retryableFailedTask", () => {
    it("builds a requiresHuman=false suggested_task for transient errors", () => {
        const task = {
            id: "task-1",
            title: "Deploy service",
            errorMessage: "Connection timeout",
            goalId: "goal-1",
            attempt: 1,
            maxAttempts: 3,
        };
        const candidate = retryableFailedTask(task);

        expect(candidate.type).toBe("suggested_task");
        expect(candidate.requiresHuman).toBe(false);
        expect(candidate.bucket).toBe("next_step");
        expect(candidate.dedupeKey).toMatch(/^retryable_failed_task:task-1:/);
        expect(candidate.payload).toHaveProperty("task");
        if ("task" in candidate.payload) {
            expect(candidate.payload.task.goalId).toBe("goal-1");
        }
    });
});

// ---------------------------------------------------------------------------
// Sprint 3: blockedGoalSupplement
// ---------------------------------------------------------------------------

describe("blockedGoalSupplement", () => {
    it("builds a requiresHuman=false read-only investigation task", () => {
        const goal = {
            id: "goal-1",
            title: "Ship v2.0",
            description: "Release version 2.0",
            blocker: {
                kind: "task_failed" as const,
                summary: "API call returned 503",
                requiresHuman: false,
                sourceTaskId: "task-9",
            },
        };
        const candidate = blockedGoalSupplement(goal);

        expect(candidate.type).toBe("suggested_task");
        expect(candidate.requiresHuman).toBe(false);
        expect(candidate.bucket).toBe("next_step");
        expect(candidate.dedupeKey).toMatch(/^blocked_goal_supplement:goal-1:/);
        expect(candidate.payload).toHaveProperty("task");
        if ("task" in candidate.payload) {
            expect(candidate.payload.task.goalId).toBe("goal-1");
        }
    });
});

// ---------------------------------------------------------------------------
// Sprint 3: buildSuggestionCandidates route selection
// ---------------------------------------------------------------------------

describe("buildSuggestionCandidates Sprint 3 routing", () => {
    it("emits retryableFailedTask for transient error (attempt < maxAttempts)", () => {
        const candidates = buildSuggestionCandidates({
            failedTasks: [{
                id: "task-1",
                title: "Call API",
                errorMessage: "timeout: upstream unreachable",
                goalId: null,
                attempt: 1,
                maxAttempts: 3,
            }],
            blockedGoals: [],
            attentionDecisions: [],
            completedTaskSkills: [],
        });
        expect(candidates).toHaveLength(1);
        expect(candidates[0].dedupeKey).toMatch(/^retryable_failed_task:/);
        expect(candidates[0].requiresHuman).toBe(false);
    });

    it("emits failedTaskFollowup for non-transient error (attempt < maxAttempts)", () => {
        const candidates = buildSuggestionCandidates({
            failedTasks: [{
                id: "task-2",
                title: "Parse data",
                errorMessage: "SyntaxError: unexpected token",
                goalId: null,
                attempt: 1,
                maxAttempts: 3,
            }],
            blockedGoals: [],
            attentionDecisions: [],
            completedTaskSkills: [],
        });
        expect(candidates).toHaveLength(1);
        expect(candidates[0].dedupeKey).toMatch(/^failed_task_followup:/);
    });

    it("emits both blockedGoalAttention and blockedGoalSupplement for non-human blocker", () => {
        const candidates = buildSuggestionCandidates({
            failedTasks: [],
            blockedGoals: [{
                id: "goal-1",
                title: "Ship feature",
                description: null,
                blocker: {
                    kind: "task_failed" as const,
                    summary: "connection refused",
                    requiresHuman: false,
                    sourceTaskId: "task-9",
                },
            }],
            attentionDecisions: [],
            completedTaskSkills: [],
        });
        expect(candidates).toHaveLength(2);
        expect(candidates.some((c) => c.dedupeKey.startsWith("blocked_goal_attention:"))).toBe(true);
        expect(candidates.some((c) => c.dedupeKey.startsWith("blocked_goal_supplement:"))).toBe(true);
    });

    it("emits only blockedGoalAttention for requires-human blocker", () => {
        const candidates = buildSuggestionCandidates({
            failedTasks: [],
            blockedGoals: [{
                id: "goal-2",
                title: "Decide scope",
                description: null,
                blocker: {
                    kind: "agent_request" as const,
                    summary: "needs human decision",
                    requiresHuman: true,
                },
            }],
            attentionDecisions: [],
            completedTaskSkills: [],
        });
        expect(candidates).toHaveLength(1);
        expect(candidates[0].dedupeKey).toMatch(/^blocked_goal_attention:/);
    });
});
