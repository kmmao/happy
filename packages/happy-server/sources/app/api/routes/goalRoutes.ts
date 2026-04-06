import {
    eventRouter,
    buildGoalProgressEphemeral,
    buildTaskTriggerEphemeral,
    buildTaskStatusChangedEphemeral,
} from "@/app/events/eventRouter";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { log } from "@/utils/log";
import { goalCreate } from "@/modules/goalCreate";
import { goalProgressUpdate } from "@/modules/goalProgressUpdate";

const GoalStatusSchema = z.enum(["planning", "in_progress", "blocked", "completed", "cancelled"]);
const GoalPrioritySchema = z.enum(["urgent", "normal", "low"]);

const CreateGoalBodySchema = z.object({
    title: z.string().min(1).max(500),
    description: z.string().max(5000).optional(),
    priority: GoalPrioritySchema.default("normal"),
    deadline: z.string().datetime().optional(),
    parentGoalId: z.string().optional(),
    machineId: z.string(),
    autoDecompose: z.boolean().default(true),
});

const UpdateGoalBodySchema = z.object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(5000).nullable().optional(),
    priority: GoalPrioritySchema.optional(),
    deadline: z.string().datetime().nullable().optional(),
    status: GoalStatusSchema.optional(),
});

const QueryGoalsSchema = z.object({
    status: GoalStatusSchema.optional(),
    parentGoalId: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

const PlanResultTaskSchema = z.object({
    title: z.string().min(1).max(500),
    prompt: z.string().min(1).max(10000),
    suggestedRole: z.string().max(100).optional(),
    priority: z.enum(["urgent", "normal", "low"]).default("normal"),
    order: z.number().int().min(0).max(100).default(0),
});

const PlanResultBodySchema = z.object({
    goalId: z.string(),
    tasks: z.array(PlanResultTaskSchema).min(1).max(20),
});

/**
 * Goal CRUD + plan-result routes.
 * Goals represent high-level objectives that decompose into Tasks.
 */
export function goalRoutes(app: Fastify) {
    // POST /v1/projects/:id/goals — create a new goal
    app.post(
        "/v1/projects/:id/goals",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: CreateGoalBodySchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;

            // Verify project ownership
            const project = await db.project.findFirst({
                where: { id: projectId, accountId: userId },
                select: { id: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            // Verify machine ownership
            const { machineId } = request.body;
            const machine = await db.machine.findFirst({
                where: { id: machineId, accountId: userId },
                select: { id: true },
            });
            if (!machine) {
                return reply.code(404).send({ error: "Machine not found" });
            }

            try {
                const result = await goalCreate({
                    accountId: userId,
                    projectId,
                    machineId,
                    title: request.body.title,
                    description: request.body.description,
                    priority: request.body.priority,
                    deadline: request.body.deadline ? new Date(request.body.deadline) : undefined,
                    parentGoalId: request.body.parentGoalId,
                    autoDecompose: request.body.autoDecompose,
                });

                const goal = await db.goal.findUnique({
                    where: { id: result.id },
                    include: {
                        tasks: { select: { id: true, status: true }, take: 20 },
                        _count: { select: { subGoals: true, tasks: true, decisions: true } },
                    },
                });

                return reply.code(201).send({ goal: serializeGoal(goal!) });
            } catch (e: any) {
                return reply.code(400).send({ error: e.message ?? "Failed to create goal" });
            }
        },
    );

    // GET /v1/projects/:id/goals — list goals
    app.get(
        "/v1/projects/:id/goals",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                querystring: QueryGoalsSchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;
            const { status, parentGoalId, limit, offset } = request.query;

            const where: Record<string, unknown> = {
                accountId: userId,
                projectId,
            };
            if (status) where.status = status;
            if (parentGoalId !== undefined) {
                where.parentGoalId = parentGoalId || null; // empty string → top-level goals
            }

            const [goals, total] = await Promise.all([
                db.goal.findMany({
                    where,
                    orderBy: [
                        { status: "asc" }, // planning/in_progress first
                        { createdAt: "desc" },
                    ],
                    take: limit,
                    skip: offset,
                    include: {
                        _count: { select: { subGoals: true, tasks: true, decisions: true } },
                    },
                }),
                db.goal.count({ where }),
            ]);

            return reply.send({
                goals: goals.map(serializeGoal),
                total,
            });
        },
    );

    // GET /v1/projects/:id/goals/:goalId — get single goal with details
    app.get(
        "/v1/projects/:id/goals/:goalId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), goalId: z.string() }),
            },
        },
        async (request, reply) => {
            const goal = await db.goal.findFirst({
                where: {
                    id: request.params.goalId,
                    projectId: request.params.id,
                    accountId: request.userId,
                },
                include: {
                    tasks: {
                        select: {
                            id: true,
                            status: true,
                            prompt: true,
                            priority: true,
                            createdAt: true,
                            completedAt: true,
                        },
                        orderBy: { createdAt: "asc" },
                        take: 50,
                    },
                    subGoals: {
                        select: {
                            id: true,
                            title: true,
                            status: true,
                            progress: true,
                            priority: true,
                        },
                        orderBy: { createdAt: "asc" },
                    },
                    decisions: {
                        select: {
                            id: true,
                            question: true,
                            status: true,
                            createdAt: true,
                        },
                        orderBy: { createdAt: "desc" },
                        take: 20,
                    },
                    _count: { select: { subGoals: true, tasks: true, decisions: true } },
                },
            });
            if (!goal) {
                return reply.code(404).send({ error: "Goal not found" });
            }
            return reply.send({ goal: serializeGoalDetail(goal) });
        },
    );

    // PATCH /v1/projects/:id/goals/:goalId — update goal
    app.patch(
        "/v1/projects/:id/goals/:goalId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), goalId: z.string() }),
                body: UpdateGoalBodySchema,
            },
        },
        async (request, reply) => {
            const goal = await db.goal.findFirst({
                where: {
                    id: request.params.goalId,
                    projectId: request.params.id,
                    accountId: request.userId,
                },
            });
            if (!goal) {
                return reply.code(404).send({ error: "Goal not found" });
            }

            const { title, description, priority, deadline, status } = request.body;

            const updated = await db.goal.update({
                where: { id: goal.id },
                data: {
                    ...(title !== undefined ? { title } : {}),
                    ...(description !== undefined ? { description } : {}),
                    ...(priority !== undefined ? { priority } : {}),
                    ...(deadline !== undefined ? { deadline: deadline ? new Date(deadline) : null } : {}),
                    ...(status !== undefined ? { status } : {}),
                },
                include: {
                    _count: { select: { subGoals: true, tasks: true, decisions: true } },
                },
            });

            return reply.send({ goal: serializeGoal(updated) });
        },
    );

    // POST /v1/projects/:id/goals/:goalId/cancel — cancel goal and active tasks
    app.post(
        "/v1/projects/:id/goals/:goalId/cancel",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), goalId: z.string() }),
            },
        },
        async (request, reply) => {
            const goal = await db.goal.findFirst({
                where: {
                    id: request.params.goalId,
                    projectId: request.params.id,
                    accountId: request.userId,
                },
            });
            if (!goal) {
                return reply.code(404).send({ error: "Goal not found" });
            }
            if (["completed", "cancelled"].includes(goal.status)) {
                return reply.code(400).send({ error: `Cannot cancel goal in '${goal.status}' state` });
            }

            // Cancel all active tasks in a transaction
            const now = new Date();
            const activeTasks = await db.task.findMany({
                where: {
                    goalId: goal.id,
                    status: { in: ["queued", "dispatching"] },
                },
                select: { id: true },
            });

            await db.$transaction([
                db.task.updateMany({
                    where: {
                        goalId: goal.id,
                        status: { in: ["queued", "dispatching"] },
                    },
                    data: { status: "cancelled", completedAt: now },
                }),
                db.goal.update({
                    where: { id: goal.id },
                    data: { status: "cancelled", progress: goal.progress },
                }),
            ]);

            // Notify App about cancelled tasks
            for (const task of activeTasks) {
                eventRouter.emitEphemeral({
                    userId: request.userId,
                    payload: buildTaskStatusChangedEphemeral({
                        taskId: task.id,
                        status: "cancelled",
                        completedAt: now.getTime(),
                    }),
                    recipientFilter: { type: "user-scoped-only" },
                });
            }

            // Notify App about goal status
            eventRouter.emitEphemeral({
                userId: request.userId,
                payload: buildGoalProgressEphemeral({
                    goalId: goal.id,
                    projectId: goal.projectId,
                    status: "cancelled",
                    progress: goal.progress,
                }),
                recipientFilter: { type: "user-scoped-only" },
            });

            log({ module: "goal" }, `Cancelled goal ${goal.id} (${activeTasks.length} tasks cancelled)`);

            const updated = await db.goal.findUnique({
                where: { id: goal.id },
                include: {
                    _count: { select: { subGoals: true, tasks: true, decisions: true } },
                },
            });
            return reply.send({ goal: serializeGoal(updated!) });
        },
    );

    // DELETE /v1/projects/:id/goals/:goalId — delete completed/cancelled goal
    app.delete(
        "/v1/projects/:id/goals/:goalId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), goalId: z.string() }),
            },
        },
        async (request, reply) => {
            const goal = await db.goal.findFirst({
                where: {
                    id: request.params.goalId,
                    projectId: request.params.id,
                    accountId: request.userId,
                },
            });
            if (!goal) {
                return reply.code(404).send({ error: "Goal not found" });
            }
            if (["planning", "in_progress", "blocked"].includes(goal.status)) {
                return reply.code(400).send({ error: "Cannot delete active goal — cancel it first" });
            }

            await db.goal.delete({ where: { id: goal.id } });
            return reply.send({ deleted: true });
        },
    );

    // POST /v1/projects/:id/goals/:goalId/plan-result — Planner Agent reports decomposition
    app.post(
        "/v1/projects/:id/goals/:goalId/plan-result",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), goalId: z.string() }),
                body: PlanResultBodySchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { goalId } = request.params;
            const projectId = request.params.id;

            const goal = await db.goal.findFirst({
                where: { id: goalId, projectId, accountId: userId },
            });
            if (!goal) {
                return reply.code(404).send({ error: "Goal not found" });
            }
            if (goal.status !== "planning") {
                return reply.code(400).send({ error: `Goal is in '${goal.status}' state, expected 'planning'` });
            }

            const { tasks: taskDefs } = request.body;

            // Resolve project directory
            const project = await db.project.findFirst({
                where: { id: projectId, accountId: userId },
                select: { path: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            // Map priority from goal format to task format
            const priorityMap: Record<string, string> = {
                urgent: "urgent",
                normal: "user",
                low: "background",
            };

            // Create tasks in order
            const createdTasks: Array<{ id: string; prompt: string; priority: string }> = [];
            for (const taskDef of taskDefs) {
                const task = await db.task.create({
                    data: {
                        accountId: userId,
                        projectId,
                        machineId: goal.machineId,
                        prompt: taskDef.prompt,
                        priority: priorityMap[taskDef.priority] ?? "user",
                        maxAttempts: 3,
                        triggerType: "manual",
                        status: "dispatching",
                        goalId: goal.id,
                    },
                });
                createdTasks.push({ id: task.id, prompt: task.prompt, priority: task.priority });
            }

            // Update goal status
            await db.goal.update({
                where: { id: goal.id },
                data: { status: "in_progress" },
            });

            // Dispatch all tasks to CLI
            for (const task of createdTasks) {
                eventRouter.emitEphemeral({
                    userId,
                    payload: buildTaskTriggerEphemeral({
                        taskId: task.id,
                        prompt: task.prompt,
                        directory: project.path,
                        priority: task.priority,
                        projectId,
                    }),
                    recipientFilter: {
                        type: "machine-scoped-only",
                        machineId: goal.machineId,
                    },
                });
            }

            // Notify goal progress
            eventRouter.emitEphemeral({
                userId,
                payload: buildGoalProgressEphemeral({
                    goalId: goal.id,
                    projectId,
                    status: "in_progress",
                    progress: 0,
                }),
                recipientFilter: { type: "user-scoped-only" },
            });

            log({ module: "goal" }, `Plan result: created ${createdTasks.length} tasks for goal ${goal.id}`);

            return reply.send({
                tasksCreated: createdTasks.length,
                taskIds: createdTasks.map((t) => t.id),
            });
        },
    );
}

// === Serialization ===

function serializeGoal(goal: Record<string, unknown>): Record<string, unknown> {
    const g = goal as {
        id: string;
        projectId: string;
        title: string;
        description: string | null;
        status: string;
        progress: number;
        priority: string;
        deadline: Date | null;
        parentGoalId: string | null;
        machineId: string;
        createdBy: string;
        plannerTaskId: string | null;
        createdAt: Date;
        updatedAt: Date;
        _count?: { subGoals: number; tasks: number; decisions: number };
    };

    return {
        id: g.id,
        projectId: g.projectId,
        title: g.title,
        description: g.description,
        status: g.status,
        progress: g.progress,
        priority: g.priority,
        deadline: g.deadline?.getTime() ?? null,
        parentGoalId: g.parentGoalId,
        machineId: g.machineId,
        createdBy: g.createdBy,
        plannerTaskId: g.plannerTaskId,
        createdAt: g.createdAt.getTime(),
        updatedAt: g.updatedAt.getTime(),
        subGoalCount: g._count?.subGoals ?? 0,
        taskCount: g._count?.tasks ?? 0,
        decisionCount: g._count?.decisions ?? 0,
    };
}

function serializeGoalDetail(goal: Record<string, unknown>): Record<string, unknown> {
    const base = serializeGoal(goal);
    const g = goal as {
        tasks?: Array<{
            id: string;
            status: string;
            prompt: string;
            priority: string;
            createdAt: Date;
            completedAt: Date | null;
        }>;
        subGoals?: Array<{
            id: string;
            title: string;
            status: string;
            progress: number;
            priority: string;
        }>;
        decisions?: Array<{
            id: string;
            question: string;
            status: string;
            createdAt: Date;
        }>;
    };

    return {
        ...base,
        tasks: g.tasks?.map((t) => ({
            id: t.id,
            status: t.status,
            promptPreview: t.prompt.length > 100 ? t.prompt.slice(0, 100) : t.prompt,
            priority: t.priority,
            createdAt: t.createdAt.getTime(),
            completedAt: t.completedAt?.getTime() ?? null,
        })) ?? [],
        subGoals: g.subGoals ?? [],
        decisions: g.decisions?.map((d) => ({
            id: d.id,
            question: d.question,
            status: d.status,
            createdAt: d.createdAt.getTime(),
        })) ?? [],
    };
}
