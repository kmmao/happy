import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fastify } from "../types";

type GoalRecord = {
    id: string;
    projectId: string;
    accountId: string;
    title: string;
    description: string | null;
    status: "planning" | "in_progress" | "blocked" | "completed" | "cancelled";
    progress: number;
    priority: "urgent" | "normal" | "low";
    deadline: Date | null;
    parentGoalId: string | null;
    machineId: string;
    createdBy: string;
    plannerTaskId: string | null;
    createdAt: Date;
    updatedAt: Date;
};

const { state, dbMock, resetState, seedGoal } = vi.hoisted(() => {
    const state = {
        goals: [] as GoalRecord[],
    };

    const resetState = () => {
        state.goals = [];
    };

    const seedGoal = (input: Partial<GoalRecord> & Pick<GoalRecord, "id" | "projectId" | "accountId">) => {
        const now = new Date();
        state.goals.push({
            id: input.id,
            projectId: input.projectId,
            accountId: input.accountId,
            title: input.title ?? "Goal",
            description: input.description ?? null,
            status: input.status ?? "in_progress",
            progress: input.progress ?? 50,
            priority: input.priority ?? "normal",
            deadline: input.deadline ?? null,
            parentGoalId: input.parentGoalId ?? null,
            machineId: input.machineId ?? "machine-1",
            createdBy: input.createdBy ?? "user",
            plannerTaskId: input.plannerTaskId ?? null,
            createdAt: input.createdAt ?? now,
            updatedAt: input.updatedAt ?? now,
        });
    };

    const goalFindFirst = vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        return state.goals.find((goal) => (
            goal.id === where.id
            && goal.projectId === where.projectId
            && goal.accountId === where.accountId
        )) ?? null;
    });

    const goalUpdate = vi.fn(async (args: any) => {
        const goal = state.goals.find((item) => item.id === args.where.id);
        if (!goal) {
            throw new Error("Goal not found");
        }
        Object.assign(goal, args.data, { updatedAt: new Date() });
        return {
            ...goal,
            _count: { subGoals: 0, tasks: 0, decisions: 0 },
        };
    });

    const dbMock = {
        goal: {
            findFirst: goalFindFirst,
            update: goalUpdate,
        },
    };

    return { state, dbMock, resetState, seedGoal };
});

vi.mock("@/storage/db", () => ({ db: dbMock }));
vi.mock("@/utils/log", () => ({ log: vi.fn() }));
vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitEphemeral: vi.fn() },
    buildGoalProgressEphemeral: vi.fn((payload: unknown) => payload),
    buildTaskTriggerEphemeral: vi.fn((payload: unknown) => payload),
    buildTaskStatusChangedEphemeral: vi.fn((payload: unknown) => payload),
}));
vi.mock("@/modules/goalCreate", () => ({
    goalCreate: vi.fn(),
    goalDecompose: vi.fn(),
}));
vi.mock("@/modules/goalProgressUpdate", () => ({
    goalProgressUpdate: vi.fn(),
}));
vi.mock("@/modules/goalSummary", () => ({
    buildGoalBlockerSummary: vi.fn(() => null),
    buildGoalTaskStatusSummary: vi.fn(() => ({
        dispatching: 0,
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
    })),
    selectLatestGoalSession: vi.fn(() => null),
}));

import { goalRoutes } from "./goalRoutes";

async function createApp() {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;

    typed.decorate("authenticate", async (request: any, reply: any) => {
        const userId = request.headers["x-user-id"];
        if (typeof userId !== "string") {
            return reply.code(401).send({ error: "Unauthorized" });
        }
        request.userId = userId;
    });

    goalRoutes(typed);
    await typed.ready();
    return typed;
}

describe("goalRoutes PATCH /v1/projects/:id/goals/:goalId", () => {
    let app: Fastify;

    beforeEach(() => {
        resetState();
        vi.clearAllMocks();
    });

    afterEach(async () => {
        if (app) await app.close();
    });

    it("rejects direct status changes", async () => {
        seedGoal({
            id: "goal-1",
            projectId: "project-1",
            accountId: "user-1",
            status: "in_progress",
        });
        app = await createApp();

        const res = await app.inject({
            method: "PATCH",
            url: "/v1/projects/project-1/goals/goal-1",
            headers: { "x-user-id": "user-1" },
            payload: { status: "completed" },
        });

        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: "Goal status is system-managed; use dedicated actions instead" });
        expect(dbMock.goal.update).not.toHaveBeenCalled();
        expect(state.goals[0]?.status).toBe("in_progress");
    });

    it("still allows metadata updates", async () => {
        seedGoal({
            id: "goal-1",
            projectId: "project-1",
            accountId: "user-1",
            title: "Old title",
        });
        app = await createApp();

        const res = await app.inject({
            method: "PATCH",
            url: "/v1/projects/project-1/goals/goal-1",
            headers: { "x-user-id": "user-1" },
            payload: { title: "New title" },
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().goal.title).toBe("New title");
        expect(state.goals[0]?.title).toBe("New title");
    });
});
