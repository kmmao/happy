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
import {
    buildGoalBlockerSummary,
    buildGoalTaskStatusSummary,
    selectLatestGoalSession,
} from "@/modules/goalSummary";
import { goalCreate, goalDecompose } from "@/modules/goalCreate";
import { goalProgressUpdate } from "@/modules/goalProgressUpdate";
import { truncateText, TEXT_LIMITS, TIME_MS } from "@/modules/worldConstants";

const GoalStatusSchema = z.enum(["planning", "in_progress", "blocked", "completed", "cancelled"]);
const GoalPrioritySchema = z.enum(["urgent", "normal", "low"]);
const BLOCKER_MESSAGE_TYPES = ["conflict", "request"] as const;

type GoalAgentMessageSummary = {
    id: string;
    fromRole: string;
    msgType: string;
    content: string;
    status: string;
    sessionId: string | null;
    decisionId: string | null;
    createdAt: Date;
};

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

const PLANNING_RESULT_TIMEOUT_MINUTES = 10;
const PLANNING_RESULT_TIMEOUT_MS = TIME_MS.PLANNING_TIMEOUT;
const DISPATCHING_RECOVERY_MS = TIME_MS.DISPATCHING_RECOVERY;

async function applyPlanningTimeoutFallback(opts: {
    goals: Array<{
        id: string;
        status: string;
        plannerTaskId: string | null;
        updatedAt: Date;
    }>;
    userId: string;
    projectId: string;
}): Promise<Set<string>> {
    const now = Date.now();
    const timedOutGoalIds = opts.goals
        .filter((goal) => (
            goal.status === "planning"
            && goal.plannerTaskId
            && (now - goal.updatedAt.getTime()) > PLANNING_RESULT_TIMEOUT_MS
        ))
        .map((goal) => goal.id);

    if (timedOutGoalIds.length === 0) {
        return new Set<string>();
    }

    await db.goal.updateMany({
        where: {
            id: { in: timedOutGoalIds },
            accountId: opts.userId,
            projectId: opts.projectId,
            status: "planning",
        },
        data: { status: "blocked" },
    });

    for (const goalId of timedOutGoalIds) {
        eventRouter.emitEphemeral({
            userId: opts.userId,
            payload: buildGoalProgressEphemeral({
                goalId,
                projectId: opts.projectId,
                status: "blocked",
                progress: 0,
            }),
            recipientFilter: { type: "user-scoped-only" },
        });
    }

    log(
        { module: "goal" },
        `Marked ${timedOutGoalIds.length} planning goals as blocked due to plan-result timeout (${PLANNING_RESULT_TIMEOUT_MINUTES}m)`,
    );
    return new Set(timedOutGoalIds);
}

/**
 * Re-dispatch tasks stuck in "dispatching" for longer than DISPATCHING_RECOVERY_MS.
 * Ephemeral events are fire-and-forget; if CLI was offline when the event was sent,
 * the task stays in "dispatching" forever. This recovers from that.
 */
async function recoverStuckDispatchingTasks(opts: {
    goalIds: string[];
    userId: string;
    projectId: string;
}): Promise<void> {
    if (opts.goalIds.length === 0) return;

    const now = Date.now();
    const stuckTasks = await db.task.findMany({
        where: {
            goalId: { in: opts.goalIds },
            accountId: opts.userId,
            status: "dispatching",
            createdAt: { lt: new Date(now - DISPATCHING_RECOVERY_MS) },
        },
        select: { id: true, prompt: true, priority: true, machineId: true, projectId: true },
    });

    if (stuckTasks.length === 0) return;

    const project = await db.project.findFirst({
        where: { id: opts.projectId, accountId: opts.userId },
        select: { path: true },
    });
    if (!project) return;

    for (const task of stuckTasks) {
        eventRouter.emitEphemeral({
            userId: opts.userId,
            payload: buildTaskTriggerEphemeral({
                taskId: task.id,
                prompt: task.prompt,
                directory: project.path,
                priority: task.priority,
                projectId: task.projectId ?? undefined,
            }),
            recipientFilter: {
                type: "machine-scoped-only",
                machineId: task.machineId,
            },
        });
    }

    log(
        { module: "goal" },
        `Re-dispatched ${stuckTasks.length} stuck tasks for project ${opts.projectId}`,
    );
}

function safeParseJsonArray(json: string): string[] {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function fetchAgentMessagesBySessions(opts: {
    accountId: string;
    projectId: string;
    sessionIds: string[];
}): Promise<Map<string, GoalAgentMessageSummary[]>> {
    const sessionIds = Array.from(new Set(opts.sessionIds.filter(Boolean)));
    if (sessionIds.length === 0) {
        return new Map();
    }

    const messages = await db.agentMessage.findMany({
        where: {
            accountId: opts.accountId,
            projectId: opts.projectId,
            status: { in: ["unread", "read"] },
            msgType: { in: [...BLOCKER_MESSAGE_TYPES] },
            sessionId: { in: sessionIds },
        },
        select: {
            id: true,
            fromRole: true,
            msgType: true,
            content: true,
            status: true,
            sessionId: true,
            decisionId: true,
            createdAt: true,
        },
        orderBy: { createdAt: "desc" },
    });

    const bySessionId = new Map<string, GoalAgentMessageSummary[]>();
    for (const message of messages) {
        if (!message.sessionId) continue;
        const current = bySessionId.get(message.sessionId) ?? [];
        current.push(message);
        bySessionId.set(message.sessionId, current);
    }
    return bySessionId;
}

function dedupeAgentMessages(messages: GoalAgentMessageSummary[]): GoalAgentMessageSummary[] {
    const seen = new Set<string>();
    const deduped: GoalAgentMessageSummary[] = [];
    for (const message of messages) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        deduped.push(message);
    }
    return deduped;
}

async function fetchAgentMessagesForGoalDetail(opts: {
    accountId: string;
    projectId: string;
    sessionIds: string[];
    decisionIds: string[];
}): Promise<GoalAgentMessageSummary[]> {
    const sessionIds = Array.from(new Set(opts.sessionIds.filter(Boolean)));
    const decisionIds = Array.from(new Set(opts.decisionIds.filter(Boolean)));
    if (sessionIds.length === 0 && decisionIds.length === 0) {
        return [];
    }

    const messages = await db.agentMessage.findMany({
        where: {
            accountId: opts.accountId,
            projectId: opts.projectId,
            status: { in: ["unread", "read"] },
            msgType: { in: [...BLOCKER_MESSAGE_TYPES] },
            OR: [
                ...(sessionIds.length > 0 ? [{ sessionId: { in: sessionIds } }] : []),
                ...(decisionIds.length > 0 ? [{ decisionId: { in: decisionIds } }] : []),
            ],
        },
        select: {
            id: true,
            fromRole: true,
            msgType: true,
            content: true,
            status: true,
            sessionId: true,
            decisionId: true,
            createdAt: true,
        },
        orderBy: { createdAt: "desc" },
    });

    return dedupeAgentMessages(messages);
}

/**
 * Narrative + laws are the universal baseline for all sessions; injected once at the top of each task prompt.
 */
function buildWorldSessionBaseline(project: { narrative: string | null; laws: string | null }): string | null {
    const narrative = project.narrative?.trim();
    const laws = project.laws?.trim();
    if (!narrative && !laws) {
        return null;
    }
    const parts: string[] = [
        "## World session baseline",
        "",
        "The **narrative** and **laws** below apply to every agent session for this project. Formal decisions, inter-role messages, and any context not shown here must be fetched on demand (e.g. via app/API tools) when a workflow requires them.",
        "",
    ];
    if (narrative) {
        parts.push("### Narrative", narrative, "");
    }
    if (laws) {
        parts.push("### Laws", laws, "");
    }
    return parts.join("\n").trimEnd();
}

/**
 * Role-specific slice for a task (on-demand). World narrative/laws are not repeated here — see baseline above.
 */
function buildRoleIdentityPrefix(
    suggestedRole: string | undefined,
    roleMap: Map<string, { name: string; type: string; description: string | null; duties: string }>,
): string | null {
    if (!suggestedRole) return null;
    const role = roleMap.get(suggestedRole);
    if (!role) return null;

    const parts: string[] = [];
    parts.push(`## Your Role: ${role.name} (${role.type})`);
    if (role.description) {
        parts.push(`\n${role.description}`);
    }

    const duties = safeParseJsonArray(role.duties);
    if (duties.length > 0) {
        parts.push(`\n### Duties`);
        for (const duty of duties) {
            parts.push(`- ${duty}`);
        }
    }

    return parts.join("\n");
}

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
                        tasks: {
                            select: {
                                id: true,
                                title: true,
                                status: true,
                                sessionId: true,
                                roleType: true,
                                createdAt: true,
                                completedAt: true,
                            },
                            orderBy: { createdAt: "asc" },
                            take: 30,
                        },
                        _count: { select: { subGoals: true, tasks: true, decisions: true } },
                    },
                }),
                db.goal.count({ where }),
            ]);

            const timedOutGoalIds = await applyPlanningTimeoutFallback({
                goals: goals.map((goal) => ({
                    id: goal.id,
                    status: goal.status,
                    plannerTaskId: goal.plannerTaskId,
                    updatedAt: goal.updatedAt,
                })),
                userId,
                projectId,
            });

            const sessionIds = goals.flatMap((goal) => goal.tasks.map((task) => task.sessionId).filter(Boolean) as string[]);
            const agentMessagesBySessionId = await fetchAgentMessagesBySessions({
                accountId: userId,
                projectId,
                sessionIds,
            });

            const activeGoalIds = goals
                .filter((g) => !["completed", "cancelled"].includes(g.status))
                .map((g) => g.id);
            void recoverStuckDispatchingTasks({ goalIds: activeGoalIds, userId, projectId });

            return reply.send({
                goals: goals.map((goal) => serializeGoal(
                    timedOutGoalIds.has(goal.id) ? { ...goal, status: "blocked" } : goal,
                    dedupeAgentMessages(goal.tasks.flatMap((task) => task.sessionId ? (agentMessagesBySessionId.get(task.sessionId) ?? []) : [])),
                )),
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
                            title: true,
                            status: true,
                            sessionId: true,
                            roleType: true,
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
            const timedOutGoalIds = await applyPlanningTimeoutFallback({
                goals: [{
                    id: goal.id,
                    status: goal.status,
                    plannerTaskId: goal.plannerTaskId,
                    updatedAt: goal.updatedAt,
                }],
                userId: request.userId,
                projectId: request.params.id,
            });
            const relatedAgentMessages = await fetchAgentMessagesForGoalDetail({
                accountId: request.userId,
                projectId: request.params.id,
                sessionIds: goal.tasks.map((task) => task.sessionId).filter(Boolean) as string[],
                decisionIds: goal.decisions.map((decision) => decision.id),
            });
            const normalizedGoal = timedOutGoalIds.has(goal.id) ? { ...goal, status: "blocked" } : goal;
            return reply.send({ goal: serializeGoalDetail(normalizedGoal, relatedAgentMessages) });
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

            if (status !== undefined) {
                return reply.code(400).send({
                    error: "Goal status is system-managed; use dedicated actions instead",
                });
            }

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

    // POST /v1/projects/:id/goals/:goalId/decompose — manually trigger planner decomposition
    app.post(
        "/v1/projects/:id/goals/:goalId/decompose",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), goalId: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;
            const goalId = request.params.goalId;

            const goal = await db.goal.findFirst({
                where: { id: goalId, projectId, accountId: userId },
            });
            if (!goal) {
                return reply.code(404).send({ error: "Goal not found" });
            }

            const taskCount = await db.task.count({
                where: { goalId: goal.id, accountId: userId, projectId },
            });
            if (taskCount > 0) {
                return reply.code(400).send({ error: "Goal already has tasks" });
            }

            try {
                const result = await goalDecompose({ accountId: userId, projectId, goalId });
                if (!result.plannerTaskId) {
                    return reply.code(400).send({ error: "Planner unavailable, unable to dispatch decomposition" });
                }

                const updated = await db.goal.findUnique({
                    where: { id: goal.id },
                    include: {
                        _count: { select: { subGoals: true, tasks: true, decisions: true } },
                    },
                });

                return reply.send({ goal: serializeGoal(updated!) });
            } catch (e: any) {
                return reply.code(400).send({ error: e.message ?? "Failed to trigger decomposition" });
            }
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
                select: { id: true, machineId: true },
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
                        machineId: task.machineId,
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
                select: { path: true, narrative: true, laws: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            // Load all enabled roles for role identity injection
            const roles = await db.agentRole.findMany({
                where: { accountId: userId, projectId, enabled: true },
                select: { name: true, type: true, description: true, duties: true },
            });
            const roleMap = new Map(roles.map((r) => [r.type, r]));

            // Map priority from goal format to task format
            const priorityMap: Record<string, string> = {
                urgent: "urgent",
                normal: "user",
                low: "background",
            };

            // Create tasks in order, injecting role identity and branch instructions
            const createdTasks: Array<{ id: string; prompt: string; priority: string }> = [];
            for (const taskDef of taskDefs) {
                const worldBaseline = buildWorldSessionBaseline(project);
                const roleIdentity = buildRoleIdentityPrefix(taskDef.suggestedRole, roleMap);
                const branchName = `goal/${goal.id.slice(-8)}/${taskDef.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
                const branchInstructions = [
                    `## Git Branch Policy`,
                    `Before making any code changes, you MUST:`,
                    `1. Create and switch to a new branch: \`git checkout -b ${branchName}\``,
                    `2. Do all your work on this branch`,
                    `3. Commit your changes on this branch`,
                    `4. Do NOT push to or modify the main/master branch directly`,
                ].join("\n");
                const promptParts: string[] = [];
                if (worldBaseline) promptParts.push(worldBaseline);
                promptParts.push(branchInstructions);
                if (roleIdentity) promptParts.push(roleIdentity);
                promptParts.push(`## Your Task\n\n${taskDef.prompt}`);
                const fullPrompt = promptParts.join("\n\n---\n\n");

                const task = await db.task.create({
                    data: {
                        accountId: userId,
                        projectId,
                        machineId: goal.machineId,
                        title: taskDef.title,
                        prompt: fullPrompt,
                        priority: priorityMap[taskDef.priority] ?? "user",
                        maxAttempts: 3,
                        triggerType: "manual",
                        status: "dispatching",
                        goalId: goal.id,
                        roleType: taskDef.suggestedRole ?? null,
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

function serializeGoal(goal: Record<string, unknown>, agentMessages: GoalAgentMessageSummary[] = []): Record<string, unknown> {
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
        tasks?: Array<{
            id: string;
            title: string | null;
            status: string;
            sessionId: string | null;
            roleType: string | null;
            errorMessage: string | null;
            createdAt: Date;
            completedAt: Date | null;
        }>;
        _count?: { subGoals: number; tasks: number; decisions: number };
    };

    const tasks = g.tasks ?? [];
    const taskStatusSummary = buildGoalTaskStatusSummary(tasks);
    const latestSession = selectLatestGoalSession(tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        sessionId: task.sessionId,
        updatedAt: task.completedAt ?? task.createdAt,
    })));
    const blocker = buildGoalBlockerSummary({
        goalStatus: g.status,
        plannerTimedOut: g.status === "blocked" && Boolean(g.plannerTaskId) && tasks.length === 0,
        tasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            errorMessage: task.errorMessage,
        })),
        agentMessages,
    });

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
        taskStatusSummary,
        latestSession,
        blocker,
        tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            sessionId: t.sessionId,
            roleType: t.roleType,
        })),
    };
}

function serializeGoalDetail(goal: Record<string, unknown>, agentMessages: GoalAgentMessageSummary[] = []): Record<string, unknown> {
    const base = serializeGoal(goal, agentMessages);
    const g = goal as {
        tasks?: Array<{
            id: string;
            title: string | null;
            status: string;
            sessionId: string | null;
            roleType: string | null;
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
            title: t.title,
            status: t.status,
            sessionId: t.sessionId,
            roleType: t.roleType,
            promptPreview: truncateText(t.prompt, TEXT_LIMITS.PROMPT_PREVIEW),
            priority: t.priority,
            createdAt: t.createdAt.getTime(),
            completedAt: t.completedAt?.getTime() ?? null,
        })) ?? [],
        subGoals: g.subGoals ?? [],
        blockers: base.blocker ? [base.blocker] : [],
        decisions: g.decisions?.map((d) => ({
            id: d.id,
            question: d.question,
            status: d.status,
            createdAt: d.createdAt.getTime(),
        })) ?? [],
    };
}
