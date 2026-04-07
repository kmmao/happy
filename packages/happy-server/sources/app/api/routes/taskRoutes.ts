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

// Inline schemas (mirrored from @kmmao/happy-wire/tasks — will import after wire publish)
const TaskPrioritySchema = z.enum(["urgent", "user", "background"]);
const TaskStatusSchema = z.enum(["queued", "dispatching", "running", "completed", "failed", "cancelled"]);

const CreateTaskBodySchema = z.object({
    projectId: z.string().optional(),
    machineId: z.string(),
    prompt: z.string().min(1),
    priority: TaskPrioritySchema.default("user"),
    maxAttempts: z.number().int().min(1).max(10).default(3),
    skillIds: z.array(z.string()).max(10).default([]),
    /** Optional absolute directory on the machine (e.g. Git worktree). Must be under project.path when projectId is set. */
    directory: z.string().min(1).max(4096).optional(),
});

function isDirectoryUnderProject(projectPath: string, candidate: string): boolean {
    if (!candidate || candidate.includes("..")) {
        return false;
    }
    const base = projectPath.replace(/\/+$/, "") || projectPath;
    const dir = candidate.replace(/\/+$/, "") || candidate;
    return dir === base || dir.startsWith(`${base}/`);
}

const TaskStatusReportSchema = z.object({
    taskId: z.string(),
    status: TaskStatusSchema,
    sessionId: z.string().optional(),
    errorMessage: z.string().optional(),
});

const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "cancelled"]);
const TASK_STATUS_PROGRESS: Record<string, number> = {
    queued: 0,
    dispatching: 1,
    running: 2,
};

function shouldApplyTaskStatus(current: string, incoming: string): boolean {
    if (current === incoming) return true;
    if (TERMINAL_TASK_STATUSES.has(current)) {
        // Terminal status is final: only idempotent repeats are accepted.
        return false;
    }
    if (TERMINAL_TASK_STATUSES.has(incoming)) {
        return true;
    }

    const currentOrder = TASK_STATUS_PROGRESS[current];
    const incomingOrder = TASK_STATUS_PROGRESS[incoming];
    if (currentOrder == null || incomingOrder == null) {
        return true;
    }
    return incomingOrder >= currentOrder;
}

/**
 * Task queue routes — create, list, cancel, retry tasks.
 * Tasks are dispatched to CLI daemons via ephemeral events.
 * The prompt field is E2E encrypted (opaque to Server).
 */
export function taskRoutes(app: Fastify) {
    // POST /v1/tasks — Create a new task and dispatch to CLI
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
            const { machineId, prompt, priority, maxAttempts, skillIds, projectId, directory: bodyDirectory } =
                request.body;

            // Verify machine belongs to user
            const machine = await db.machine.findFirst({
                where: { id: machineId, accountId: userId },
            });
            if (!machine) {
                return reply.code(404).send({ error: "Machine not found" });
            }

            // Resolve project directory (if projectId given)
            let directory = "~";
            let resolvedProjectId: string | null = null;
            if (projectId) {
                const project = await db.project.findFirst({
                    where: { id: projectId, accountId: userId },
                });
                if (project) {
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
                }
            } else if (bodyDirectory?.trim()) {
                return reply.code(400).send({ error: "directory override requires projectId" });
            }

            // Load skills if bound
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
                    skillContents = skills.map((s) => ({
                        name: s.name,
                        content: s.content,
                    }));
                }
            }

            // Create task in DB
            const task = await db.task.create({
                data: {
                    accountId: userId,
                    projectId: resolvedProjectId,
                    machineId,
                    prompt,
                    priority,
                    maxAttempts,
                    triggerType: "manual",
                    status: "dispatching",
                    ...(skillIds.length > 0
                        ? {
                              skillBindings: {
                                  create: skillIds.map((sid, idx) => ({
                                      skillId: sid,
                                      order: idx,
                                  })),
                              },
                          }
                        : {}),
                },
                include: {
                    skillBindings: { include: { skill: { select: { name: true } } } },
                },
            });

            // Dispatch to CLI daemon via ephemeral
            eventRouter.emitEphemeral({
                userId,
                payload: buildTaskTriggerEphemeral({
                    taskId: task.id,
                    prompt: task.prompt,
                    directory,
                    priority: task.priority,
                    projectId: resolvedProjectId ?? undefined,
                    skillContents,
                }),
                recipientFilter: {
                    type: "machine-scoped-only",
                    machineId,
                },
            });

            log(
                { module: "task" },
                `Created task ${task.id} for machine ${machineId} (priority=${priority})`,
            );

            return reply.code(201).send({
                task: serializeTask(task),
            });
        },
    );

    // GET /v1/tasks — List tasks for the authenticated user
    app.get(
        "/v1/tasks",
        {
            preHandler: app.authenticate,
            schema: {
                querystring: z
                    .object({
                        status: z.string().optional(),
                        machineId: z.string().optional(),
                        projectId: z.string().optional(),
                        limit: z.coerce.number().int().min(1).max(100).default(50),
                        offset: z.coerce.number().int().min(0).default(0),
                    })
                    .optional(),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { status, machineId, projectId, limit, offset } = request.query ?? {
                limit: 50,
                offset: 0,
            };

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

    // GET /v1/tasks/:id — Get a single task
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

    // POST /v1/tasks/:id/cancel — Cancel a queued/dispatching task
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

            // Notify App clients
            eventRouter.emitEphemeral({
                userId: request.userId,
                payload: buildTaskStatusChangedEphemeral({
                    taskId: task.id,
                    status: "cancelled",
                    completedAt: updated.completedAt?.getTime(),
                }),
                recipientFilter: { type: "user-scoped-only" },
            });

            log({ module: "task" }, `Cancelled task ${task.id}`);
            return reply.send({ task: serializeTask(updated) });
        },
    );

    // POST /v1/tasks/:id/retry — Retry a failed task
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

            // Resolve directory
            let directory = "~";
            if (task.projectId) {
                const project = await db.project.findFirst({
                    where: { id: task.projectId, accountId: request.userId },
                });
                if (project) directory = project.path;
            }

            // Load skills
            let skillContents: Array<{ name: string; content: string }> | undefined;
            const bindings = await db.taskSkillBinding.findMany({
                where: { taskId: task.id },
                include: { skill: true },
                orderBy: { order: "asc" },
            });
            if (bindings.length > 0) {
                skillContents = bindings.map((b) => ({
                    name: b.skill.name,
                    content: b.skill.content,
                }));
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

            // Re-dispatch
            eventRouter.emitEphemeral({
                userId: request.userId,
                payload: buildTaskTriggerEphemeral({
                    taskId: task.id,
                    prompt: task.prompt,
                    directory,
                    priority: task.priority,
                    projectId: task.projectId ?? undefined,
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

    // DELETE /v1/tasks/:id — Delete a completed/failed/cancelled task
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

    // POST /v1/tasks/status — CLI reports task status change (called via socket handler, but also as REST fallback)
    app.post(
        "/v1/tasks/status",
        {
            preHandler: app.authenticate,
            schema: {
                body: TaskStatusReportSchema,
            },
        },
        async (request, reply) => {
            const { taskId, status, sessionId, errorMessage } = request.body;

            const task = await db.task.findFirst({
                where: { id: taskId, accountId: request.userId },
            });
            if (!task) {
                return reply.code(404).send({ error: "Task not found" });
            }

            if (!shouldApplyTaskStatus(task.status, status)) {
                log(
                    { module: "task", level: "warn" },
                    `Ignored stale task status transition ${taskId}: ${task.status} -> ${status}`,
                );
                return reply.send({ task: serializeTask(task), ignored: true });
            }

            const isTerminal = ["completed", "failed", "cancelled"].includes(status);

            const updated = await db.task.update({
                where: { id: taskId },
                data: {
                    status,
                    sessionId: sessionId ?? task.sessionId,
                    errorMessage: errorMessage ?? task.errorMessage,
                    dispatchedAt: status === "running" && !task.dispatchedAt ? new Date() : task.dispatchedAt,
                    completedAt: isTerminal ? new Date() : task.completedAt,
                },
            });

            // Notify App
            eventRouter.emitEphemeral({
                userId: request.userId,
                payload: buildTaskStatusChangedEphemeral({
                    taskId,
                    status,
                    sessionId: updated.sessionId ?? undefined,
                    errorMessage: updated.errorMessage ?? undefined,
                    completedAt: updated.completedAt?.getTime(),
                }),
                recipientFilter: { type: "user-scoped-only" },
            });

            // Update goal progress if task is bound to a goal
            if (isTerminal && updated.goalId) {
                void goalProgressUpdate({
                    goalId: updated.goalId,
                    accountId: request.userId,
                });
            }

            log({ module: "task" }, `Task ${taskId} status → ${status}`);
            return reply.send({ task: serializeTask(updated) });
        },
    );
}

// === Serialization ===

function serializeTask(task: Record<string, unknown>): Record<string, unknown> {
    const t = task as {
        id: string;
        accountId: string;
        projectId: string | null;
        machineId: string;
        prompt: string;
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
        // Prompt preview: first 100 chars (still encrypted — App decrypts)
        promptPreview: t.prompt.length > 100 ? t.prompt.slice(0, 100) : t.prompt,
        skillNames: t.skillBindings?.map((b) => b.skill.name) ?? [],
    };
}
