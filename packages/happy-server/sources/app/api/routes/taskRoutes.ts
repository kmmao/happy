import {
    eventRouter,
    buildTaskTriggerEphemeral,
    buildTaskStatusChangedEphemeral,
} from "@/app/events/eventRouter";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { log } from "@/utils/log";
import { goalProgressUpdate } from "@/modules/goalProgressUpdate";
import { auth } from "@/app/auth/auth";
import { inTx } from "@/storage/inTx";
import { fetchRepeatKey, saveRepeatKey } from "@/storage/repeatKey";
import {
    normalizeTaskStatusReport,
    shouldApplyTaskStatus,
} from "@/modules/taskStatusLogic";

const TaskPrioritySchema = z.enum(["urgent", "user", "background"]);
const TaskStatusSchema = z.enum(["queued", "dispatching", "running", "completed", "failed", "cancelled"]);
const TaskOutcomeSchema = z.enum(["completed", "failed", "blocked"]);

const CreateTaskBodySchema = z.object({
    projectId: z.string().optional(),
    machineId: z.string(),
    prompt: z.string().min(1),
    priority: TaskPrioritySchema.default("user"),
    maxAttempts: z.number().int().min(1).max(10).default(3),
    skillIds: z.array(z.string()).max(10).default([]),
    directory: z.string().min(1).max(4096).optional(),
});

const TaskStatusReportSchema = z.object({
    taskId: z.string(),
    status: TaskStatusSchema,
    outcome: TaskOutcomeSchema.optional(),
    sessionId: z.string().optional(),
    errorMessage: z.string().optional(),
});

const TaskResultReportSchema = z.object({
    taskId: z.string(),
    outcome: TaskOutcomeSchema,
    summary: z.string().min(1).max(1000).optional(),
    sessionId: z.string().optional(),
    errorMessage: z.string().optional(),
});

function isDirectoryUnderProject(projectPath: string, candidate: string): boolean {
    if (!candidate || candidate.includes("..")) {
        return false;
    }
    const base = projectPath.replace(/\/+$/, "") || projectPath;
    const dir = candidate.replace(/\/+$/, "") || candidate;
    return dir === base || dir.startsWith(`${base}/`);
}

function buildTaskStatusPayload(input: {
    status?: z.infer<typeof TaskStatusSchema>;
    outcome?: z.infer<typeof TaskOutcomeSchema>;
    summary?: string;
    errorMessage?: string;
}): { status: z.infer<typeof TaskStatusSchema>; outcome?: z.infer<typeof TaskOutcomeSchema>; errorMessage?: string } {
    if (!input.outcome && input.status) {
        return {
            status: input.status,
            outcome: undefined,
            errorMessage: input.errorMessage,
        };
    }

    const normalized = normalizeTaskStatusReport({
        status: input.status ?? (input.outcome === "blocked" ? "failed" : input.outcome ?? "failed"),
        outcome: input.outcome,
    });
    return {
        status: normalized.status,
        outcome: normalized.outcome,
        errorMessage: normalized.status === "completed" ? undefined : (input.errorMessage ?? input.summary),
    };
}

interface TaskResultAuthInfo {
    userId: string;
    jti?: string;
}

async function authenticateTaskResult(request: any, reply: any): Promise<TaskResultAuthInfo | null> {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Missing authorization header" }) as any;
    }

    const token = authHeader.substring(7);
    const taskToken = await auth.verifyTaskResultToken(token);
    if (taskToken) {
        if (taskToken.taskId !== request.body.taskId) {
            return reply.code(403).send({ error: "Task token does not match taskId" }) as any;
        }
        request.userId = taskToken.userId;
        (request as any).taskResultJti = taskToken.jti;
        return { userId: taskToken.userId, jti: taskToken.jti };
    }

    await appAuthenticate(request, reply);
    if (!request.userId) {
        return null;
    }
    return { userId: request.userId };
}

let appAuthenticate: (request: any, reply: any) => Promise<void>;

/**
 * Task queue routes — create, list, cancel, retry tasks.
 * Tasks are dispatched to CLI daemons via ephemeral events.
 * The prompt field is E2E encrypted (opaque to Server).
 */
export function taskRoutes(app: Fastify) {
    appAuthenticate = app.authenticate;

    app.post(
        "/v1/tasks",
        {
            preHandler: app.authenticate,
            schema: {
                body: CreateTaskBodySchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { machineId, prompt, priority, maxAttempts, skillIds, projectId, directory: bodyDirectory } = request.body;

            const machine = await db.machine.findFirst({
                where: { id: machineId, accountId: userId },
            });
            if (!machine) {
                return reply.code(404).send({ error: "Machine not found" });
            }

            let directory = "~";
            let resolvedProjectId: string | null = null;
            if (projectId) {
                const project = await db.project.findFirst({
                    where: { id: projectId, accountId: userId },
                });
                if (!project) {
                    return reply.code(404).send({ error: "Project not found" });
                }
                resolvedProjectId = project.id;
                if (bodyDirectory?.trim()) {
                    const candidate = bodyDirectory.trim();
                    if (!isDirectoryUnderProject(project.path, candidate)) {
                        return reply.code(400).send({ error: "directory must be under the selected project path" });
                    }
                    directory = candidate;
                } else {
                    directory = project.path;
                }
            } else if (bodyDirectory?.trim()) {
                return reply.code(400).send({ error: "directory override requires projectId" });
            }

            let skillContents: Array<{ name: string; content: string }> | undefined;
            if (skillIds.length > 0) {
                const skills = await db.skill.findMany({
                    where: {
                        id: { in: skillIds },
                        accountId: userId,
                        archived: false,
                    },
                    orderBy: { name: "asc" },
                });
                if (skills.length > 0) {
                    skillContents = skills.map((s) => ({ name: s.name, content: s.content }));
                }
            }

            const task = await db.task.create({
                data: {
                    accountId: userId,
                    projectId: resolvedProjectId,
                    machineId,
                    prompt,
                    directory,
                    priority,
                    maxAttempts,
                    triggerType: "manual",
                    status: "dispatching",
                    ...(skillIds.length > 0
                        ? {
                              skillBindings: {
                                  create: skillIds.map((sid, idx) => ({ skillId: sid, order: idx })),
                              },
                          }
                        : {}),
                },
                include: {
                    skillBindings: { include: { skill: { select: { name: true } } } },
                },
            });

            const resultToken = await auth.createTaskResultToken({
                userId,
                taskId: task.id,
            });

            eventRouter.emitEphemeral({
                userId,
                payload: buildTaskTriggerEphemeral({
                    taskId: task.id,
                    prompt: task.prompt,
                    directory,
                    priority: task.priority,
                    projectId: resolvedProjectId ?? undefined,
                    resultToken,
                    skillContents,
                }),
                recipientFilter: {
                    type: "machine-scoped-only",
                    machineId,
                },
            });

            log({ module: "task" }, `Created task ${task.id} for machine ${machineId} (priority=${priority})`);
            return reply.code(201).send({ task: serializeTask(task) });
        },
    );

    app.get(
        "/v1/tasks",
        {
            preHandler: app.authenticate,
            schema: {
                querystring: z.object({
                    status: z.string().optional(),
                    machineId: z.string().optional(),
                    projectId: z.string().optional(),
                    limit: z.coerce.number().int().min(1).max(100).default(50),
                    offset: z.coerce.number().int().min(0).default(0),
                }).optional(),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { status, machineId, projectId, limit, offset } = request.query ?? { limit: 50, offset: 0 };

            const where: Record<string, unknown> = { accountId: userId };
            if (status) where.status = status;
            if (machineId) where.machineId = machineId;
            if (projectId) where.projectId = projectId;

            const [tasks, total] = await Promise.all([
                db.task.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take: limit ?? 50,
                    skip: offset ?? 0,
                    include: {
                        skillBindings: { include: { skill: { select: { name: true } } } },
                    },
                }),
                db.task.count({ where }),
            ]);

            return reply.send({
                tasks: tasks.map(serializeTask),
                total,
            });
        },
    );

    app.get(
        "/v1/tasks/:id",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const task = await db.task.findFirst({
                where: { id: request.params.id, accountId: request.userId },
                include: {
                    skillBindings: { include: { skill: { select: { name: true } } } },
                },
            });
            if (!task) {
                return reply.code(404).send({ error: "Task not found" });
            }
            return reply.send({ task: serializeTask(task) });
        },
    );

    app.post(
        "/v1/tasks/:id/cancel",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const task = await db.task.findFirst({
                where: { id: request.params.id, accountId: request.userId },
            });
            if (!task) {
                return reply.code(404).send({ error: "Task not found" });
            }
            if (!["queued", "dispatching", "running"].includes(task.status)) {
                return reply.code(400).send({ error: `Cannot cancel task in '${task.status}' state` });
            }

            const updated = await db.task.update({
                where: { id: task.id },
                data: { status: "cancelled", completedAt: new Date() },
            });

            eventRouter.emitEphemeral({
                userId: request.userId,
                payload: buildTaskStatusChangedEphemeral({
                    taskId: task.id,
                    machineId: task.machineId,
                    status: "cancelled",
                    completedAt: updated.completedAt?.getTime(),
                }),
                recipientFilter: { type: "user-scoped-only" },
            });

            log({ module: "task" }, `Cancelled task ${task.id}`);
            return reply.send({ task: serializeTask(updated) });
        },
    );

    app.post(
        "/v1/tasks/:id/retry",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const task = await db.task.findFirst({
                where: { id: request.params.id, accountId: request.userId },
            });
            if (!task) {
                return reply.code(404).send({ error: "Task not found" });
            }
            if (task.status !== "failed") {
                return reply.code(400).send({ error: `Can only retry failed tasks, current: '${task.status}'` });
            }

            let directory = task.directory ?? "~";
            if (task.projectId) {
                const project = await db.project.findFirst({
                    where: { id: task.projectId, accountId: request.userId },
                });
                if (!project) {
                    return reply.code(404).send({ error: "Project not found" });
                }
                if (!task.directory) {
                    directory = project.path;
                }
            }

            let skillContents: Array<{ name: string; content: string }> | undefined;
            const bindings = await db.taskSkillBinding.findMany({
                where: { taskId: task.id },
                include: { skill: true },
                orderBy: { order: "asc" },
            });
            if (bindings.length > 0) {
                skillContents = bindings.map((b) => ({ name: b.skill.name, content: b.skill.content }));
            }

            const updated = await db.task.update({
                where: { id: task.id },
                data: {
                    status: "dispatching",
                    attempt: { increment: 1 },
                    errorMessage: null,
                    sessionId: null,
                    dispatchedAt: null,
                    completedAt: null,
                },
            });

            const resultToken = await auth.createTaskResultToken({
                userId: request.userId,
                taskId: task.id,
            });

            eventRouter.emitEphemeral({
                userId: request.userId,
                payload: buildTaskTriggerEphemeral({
                    taskId: task.id,
                    prompt: task.prompt,
                    directory,
                    priority: task.priority,
                    projectId: task.projectId ?? undefined,
                    resultToken,
                    skillContents,
                }),
                recipientFilter: {
                    type: "machine-scoped-only",
                    machineId: task.machineId,
                },
            });

            log({ module: "task" }, `Retrying task ${task.id} (attempt ${updated.attempt})`);
            return reply.send({ task: serializeTask(updated) });
        },
    );

    app.delete(
        "/v1/tasks/:id",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const task = await db.task.findFirst({
                where: { id: request.params.id, accountId: request.userId },
            });
            if (!task) {
                return reply.code(404).send({ error: "Task not found" });
            }
            if (["queued", "dispatching", "running"].includes(task.status)) {
                return reply.code(400).send({ error: "Cannot delete active task — cancel it first" });
            }

            await db.task.delete({ where: { id: task.id } });
            return reply.send({ deleted: true });
        },
    );

    app.post(
        "/v1/tasks/result",
        {
            preHandler: authenticateTaskResult,
            schema: {
                body: TaskResultReportSchema,
            },
        },
        async (request, reply) => {
            const { taskId, outcome, summary, sessionId, errorMessage } = request.body;
            const payload = buildTaskStatusPayload({ outcome, summary, errorMessage });
            const resolvedStatus = payload.status;
            const replayKey = (request as any).taskResultJti ? `task-result-jti:${(request as any).taskResultJti}` : null;

            if (replayKey) {
                const existing = await fetchRepeatKey(db as any, replayKey).catch(() => null);
                if (existing) {
                    return reply.code(409).send({ error: "Task result token already consumed" });
                }
            }

            const task = await db.task.findFirst({
                where: { id: taskId, accountId: request.userId },
            });
            if (!task) {
                return reply.code(404).send({ error: "Task not found" });
            }

            if (task.status === resolvedStatus && ["completed", "failed", "cancelled"].includes(task.status)) {
                return reply.send({ task: serializeTask(task), ignored: true });
            }

            if (!shouldApplyTaskStatus(task.status, resolvedStatus)) {
                log(
                    { module: "task", level: "warn" },
                    `Ignored stale task result transition ${taskId}: ${task.status} -> ${resolvedStatus}`,
                );
                return reply.send({ task: serializeTask(task), ignored: true });
            }

            const updated = replayKey
                ? await inTx(async (tx) => {
                    await saveRepeatKey(tx, replayKey, taskId, Date.now() + 6 * 60 * 60 * 1000);
                    return await tx.task.update({
                        where: { id: taskId },
                        data: {
                            status: resolvedStatus,
                            sessionId: sessionId ?? task.sessionId,
                            errorMessage: payload.errorMessage ?? task.errorMessage,
                            completedAt: new Date(),
                        },
                    });
                })
                : await db.task.update({
                    where: { id: taskId },
                    data: {
                        status: resolvedStatus,
                        sessionId: sessionId ?? task.sessionId,
                        errorMessage: payload.errorMessage ?? task.errorMessage,
                        completedAt: new Date(),
                    },
                });

            eventRouter.emitEphemeral({
                userId: request.userId,
                payload: buildTaskStatusChangedEphemeral({
                    taskId,
                    machineId: task.machineId,
                    status: resolvedStatus,
                    sessionId: updated.sessionId ?? undefined,
                    errorMessage: updated.errorMessage ?? undefined,
                    completedAt: updated.completedAt?.getTime(),
                }),
                recipientFilter: { type: "user-scoped-only" },
            });

            if (updated.goalId) {
                void goalProgressUpdate({
                    goalId: updated.goalId,
                    accountId: request.userId,
                });
            }

            log({ module: "task" }, `Task ${taskId} outcome → ${outcome} (status=${resolvedStatus})`);
            return reply.send({ task: serializeTask(updated) });
        },
    );

    app.post(
        "/v1/tasks/status",
        {
            preHandler: app.authenticate,
            schema: {
                body: TaskStatusReportSchema,
            },
        },
        async (request, reply) => {
            const { taskId, status, outcome, sessionId, errorMessage } = request.body;
            const payload = buildTaskStatusPayload({
                status,
                outcome: outcome as z.infer<typeof TaskOutcomeSchema> | undefined,
                errorMessage,
            });
            const resolvedStatus = payload.status;

            const task = await db.task.findFirst({
                where: { id: taskId, accountId: request.userId },
            });
            if (!task) {
                return reply.code(404).send({ error: "Task not found" });
            }

            if (task.status === resolvedStatus && ["completed", "failed", "cancelled"].includes(task.status)) {
                return reply.send({ task: serializeTask(task), ignored: true });
            }

            if (!shouldApplyTaskStatus(task.status, resolvedStatus)) {
                log(
                    { module: "task", level: "warn" },
                    `Ignored stale task status transition ${taskId}: ${task.status} -> ${resolvedStatus}`,
                );
                return reply.send({ task: serializeTask(task), ignored: true });
            }

            const isTerminal = ["completed", "failed", "cancelled"].includes(resolvedStatus);

            const updated = await db.task.update({
                where: { id: taskId },
                data: {
                    status: resolvedStatus,
                    sessionId: sessionId ?? task.sessionId,
                    errorMessage: errorMessage ?? task.errorMessage,
                    dispatchedAt: resolvedStatus === "running" && !task.dispatchedAt ? new Date() : task.dispatchedAt,
                    completedAt: isTerminal ? new Date() : task.completedAt,
                },
            });

            eventRouter.emitEphemeral({
                userId: request.userId,
                payload: buildTaskStatusChangedEphemeral({
                    taskId,
                    machineId: task.machineId,
                    status: resolvedStatus,
                    sessionId: updated.sessionId ?? undefined,
                    errorMessage: updated.errorMessage ?? undefined,
                    completedAt: updated.completedAt?.getTime(),
                }),
                recipientFilter: { type: "user-scoped-only" },
            });

            if (isTerminal && updated.goalId) {
                void goalProgressUpdate({
                    goalId: updated.goalId,
                    accountId: request.userId,
                });
            }

            log({ module: "task" }, `Task ${taskId} status → ${resolvedStatus}`);
            return reply.send({ task: serializeTask(updated) });
        },
    );
}

function serializeTask(task: Record<string, unknown>): Record<string, unknown> {
    const t = task as {
        id: string;
        accountId: string;
        projectId: string | null;
        machineId: string;
        prompt: string;
        directory: string | null;
        priority: string;
        status: string;
        triggerType: string;
        triggerRef: string | null;
        attempt: number;
        maxAttempts: number;
        sessionId: string | null;
        errorMessage: string | null;
        dispatchedAt: Date | null;
        completedAt: Date | null;
        createdAt: Date;
        updatedAt: Date;
        skillBindings?: Array<{ skill: { name: string } }>;
    };

    return {
        id: t.id,
        projectId: t.projectId,
        machineId: t.machineId,
        directory: t.directory,
        priority: t.priority,
        status: t.status,
        triggerType: t.triggerType,
        triggerRef: t.triggerRef,
        attempt: t.attempt,
        maxAttempts: t.maxAttempts,
        sessionId: t.sessionId,
        errorMessage: t.errorMessage,
        dispatchedAt: t.dispatchedAt?.getTime() ?? null,
        completedAt: t.completedAt?.getTime() ?? null,
        createdAt: t.createdAt.getTime(),
        updatedAt: t.updatedAt.getTime(),
        promptPreview: t.prompt.length > 100 ? t.prompt.slice(0, 100) : t.prompt,
        skillNames: t.skillBindings?.map((b) => b.skill.name) ?? [],
    };
}
