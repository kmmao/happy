import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { log } from "@/utils/log";
import { auth } from "@/app/auth/auth";
import { inTx } from "@/storage/inTx";
import { claimRepeatKey } from "@/storage/repeatKey";
import {
    decideTaskTransition,
    buildTaskStatusPayload,
} from "@/modules/taskStatusLogic";
import { taskStatusApply } from "@/app/api/task/taskStatusApply";
import {
    buildTaskCreateData,
    dispatchTaskTrigger,
    loadTaskSkillContents,
    resolveSkillContents,
    profileUnavailableBody,
    resolveTaskRuntimeProfile,
    resolveTaskRuntimeProfileBestEffort,
    taskProfileFields,
} from "@/app/api/task/taskCreate";
import { assertOwnedMachine, ownedProject, ownedTask } from "../ownership";
import {
    TaskPrioritySchema,
    TaskOutcomeSchema,
    TaskStatusReportSchema,
} from "@kmmao/happy-wire";

const CreateTaskBodySchema = z.object({
    projectId: z.string().optional(),
    machineId: z.string(),
    prompt: z.string().min(1),
    priority: TaskPrioritySchema.default("user"),
    maxAttempts: z.number().int().min(1).max(10).default(3),
    skillIds: z.array(z.string()).max(10).default([]),
    directory: z.string().min(1).max(4096).optional(),
    profileId: z.string().optional(),
    worktreeIsolation: z.boolean().optional(),
    parentTaskId: z.string().optional(),
});

const UpdateTaskBodySchema = z.object({
    prompt: z.string().min(1).optional(),
    priority: TaskPrioritySchema.optional(),
});

const TaskResultReportSchema = z.object({
    taskId: z.string(),
    outcome: TaskOutcomeSchema,
    summary: z.string().min(1).max(1000).optional(),
    sessionId: z.string().optional(),
    errorMessage: z.string().optional(),
});

const PROMPT_PREVIEW_LIMIT = 100;

function truncateTaskPrompt(input: string, max: number): string {
    if (input.length <= max) return input;
    return input.slice(0, max - 3) + "...";
}

function isDirectoryUnderProject(projectPath: string, candidate: string): boolean {
    if (!candidate || candidate.includes("..")) {
        return false;
    }
    const base = projectPath.replace(/\/+$/, "") || projectPath;
    const dir = candidate.replace(/\/+$/, "") || candidate;
    return dir === base || dir.startsWith(`${base}/`);
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
            const { machineId, prompt, priority, maxAttempts, skillIds, projectId, profileId: bodyProfileId, directory: bodyDirectory, worktreeIsolation, parentTaskId } = request.body;

            await assertOwnedMachine(userId, machineId);

            let directory = "~";
            let resolvedProjectId: string | null = null;
            let projectSupervisorConfig: string | null = null;
            if (projectId) {
                const project = await ownedProject(userId, projectId);
                resolvedProjectId = project.id;
                projectSupervisorConfig = project.supervisorConfig ?? null;
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

            const profileResolution = await resolveTaskRuntimeProfile({
                accountId: userId,
                explicitProfileId: bodyProfileId,
                projectSupervisorConfig,
                purpose: "task-manual",
                failureNotice: {
                    referenceUrl: `/machine/${machineId}/tasks`,
                    refType: "machine",
                    refId: machineId,
                },
            });
            if (profileResolution.kind === "failed") {
                return reply.code(400).send(profileUnavailableBody(profileResolution.failure));
            }
            const { profileId: taskProfileId, runtimeProfile } = taskProfileFields(profileResolution);

            const skillContents = await loadTaskSkillContents(userId, skillIds, {
                interactive: true,
            });

            const task = await db.task.create({
                data: buildTaskCreateData({
                    accountId: userId,
                    projectId: resolvedProjectId,
                    machineId,
                    prompt,
                    directory,
                    priority,
                    maxAttempts,
                    triggerType: "manual",
                    profileId: taskProfileId,
                    skillIds,
                    worktreeIsolation,
                    parentTaskId,
                }),
                include: {
                    skillBindings: { include: { skill: { select: { name: true } } } },
                },
            });

            const resultToken = await auth.createTaskResultToken({
                userId,
                taskId: task.id,
            });

            await dispatchTaskTrigger(userId, {
                taskId: task.id,
                machineId,
                prompt: task.prompt,
                directory,
                priority: task.priority,
                projectId: resolvedProjectId,
                resultToken,
                skillContents,
                profileId: taskProfileId,
                runtimeProfile,
                worktreeIsolation: task.worktreeIsolation,
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
            const task = await ownedTask(request.userId, request.params.id);
            if (!["queued", "dispatching", "running"].includes(task.status)) {
                return reply.code(400).send({ error: `Cannot cancel task in '${task.status}' state` });
            }

            const updated = await db.task.update({
                where: { id: task.id },
                data: { status: "cancelled", completedAt: new Date() },
            });

            // Notify App (UI update)
            await emitSyncEphemeral(request.userId, {
                t: "task-status-changed",
                taskId: task.id,
                machineId: task.machineId,
                status: "cancelled",
                completedAt: updated.completedAt?.getTime(),
                triggerType: task.triggerType,
            });

            // Notify CLI daemon to abort the running session
            if (task.status === "running" || task.status === "dispatching") {
                await emitSyncEphemeral(request.userId, {
                    t: "task-cancel",
                    taskId: task.id,
                    sessionId: task.sessionId ?? undefined,
                    machineId: task.machineId,
                });
            }

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
            const task = await ownedTask(request.userId, request.params.id);
            if (task.status !== "failed") {
                return reply.code(400).send({ error: `Can only retry failed tasks, current: '${task.status}'` });
            }

            let directory = task.directory ?? "~";
            let projectSupervisorConfig: string | null = null;
            if (task.projectId) {
                const project = await ownedProject(request.userId, task.projectId);
                if (!task.directory) {
                    directory = project.path;
                }
                projectSupervisorConfig = project.supervisorConfig ?? null;
            }

            // Re-resolve profile on retry: the original binding (task.profileId)
            // wins, with project default as a fallback path. If the referenced
            // profile has since been archived / broken, fail loudly with 400
            // + Inbox rather than silently spawning with stale env.
            const retryResolution = await resolveTaskRuntimeProfile({
                accountId: request.userId,
                explicitProfileId: task.profileId,
                projectSupervisorConfig,
                purpose: "task-retry",
                failureNotice: {
                    referenceUrl: `/machine/${task.machineId}/tasks`,
                    refType: "task",
                    refId: task.id,
                },
            });
            if (retryResolution.kind === "failed") {
                return reply.code(400).send(profileUnavailableBody(retryResolution.failure));
            }
            const { profileId: retryProfileId, runtimeProfile: retryRuntimeProfile } =
                taskProfileFields(retryResolution);

            let skillContents:
                | Array<{ name: string; content: string; model?: string }>
                | undefined;
            const bindings = await db.taskSkillBinding.findMany({
                where: { taskId: task.id },
                include: { skill: true },
                orderBy: { order: "asc" },
            });
            if (bindings.length > 0) {
                skillContents = resolveSkillContents(
                    bindings.map((b) => ({ name: b.skill.name, content: b.skill.content })),
                    { interactive: true },
                );
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
                    // Refresh profileId so future retries surface the latest
                    // binding resolution (e.g. if the user moved project
                    // default to a new profile).
                    ...(retryProfileId ? { profileId: retryProfileId } : {}),
                },
            });

            const resultToken = await auth.createTaskResultToken({
                userId: request.userId,
                taskId: task.id,
            });

            await dispatchTaskTrigger(request.userId, {
                taskId: task.id,
                machineId: task.machineId,
                prompt: task.prompt,
                directory,
                priority: task.priority,
                projectId: task.projectId,
                resultToken,
                skillContents,
                profileId: retryProfileId,
                runtimeProfile: retryRuntimeProfile,
                worktreeIsolation: task.worktreeIsolation,
            });

            log({ module: "task" }, `Retrying task ${task.id} (attempt ${updated.attempt})`);
            return reply.send({ task: serializeTask(updated) });
        },
    );

    app.patch(
        "/v1/tasks/:id",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: UpdateTaskBodySchema,
            },
        },
        async (request, reply) => {
            const task = await ownedTask(request.userId, request.params.id);
            if (task.status !== "queued") {
                return reply.code(400).send({ error: `Can only edit queued tasks, current: '${task.status}'` });
            }

            const { prompt, priority } = request.body;
            const updated = await db.task.update({
                where: { id: task.id },
                data: {
                    ...(prompt !== undefined ? { prompt } : {}),
                    ...(priority !== undefined ? { priority } : {}),
                },
                include: {
                    skillBindings: { include: { skill: { select: { name: true } } } },
                },
            });

            log({ module: "task" }, `Updated task ${task.id}`);
            return reply.send({ task: serializeTask(updated) });
        },
    );

    app.post(
        "/v1/tasks/:id/restore",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const task = await ownedTask(request.userId, request.params.id);
            if (task.status !== "cancelled") {
                return reply.code(400).send({ error: `Can only restore cancelled tasks, current: '${task.status}'` });
            }

            const updated = await db.task.update({
                where: { id: task.id },
                data: {
                    status: "queued",
                    completedAt: null,
                    errorMessage: null,
                    sessionId: null,
                    dispatchedAt: null,
                },
                include: {
                    skillBindings: { include: { skill: { select: { name: true } } } },
                },
            });

            await emitSyncEphemeral(request.userId, {
                t: "task-status-changed",
                taskId: task.id,
                machineId: task.machineId,
                status: "queued",
                triggerType: task.triggerType,
            });

            log({ module: "task" }, `Restored task ${task.id} to queued`);
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
            const task = await ownedTask(request.userId, request.params.id);
            if (["queued", "dispatching", "running"].includes(task.status)) {
                return reply.code(400).send({ error: "Cannot delete active task — cancel it first" });
            }

            await db.task.delete({ where: { id: task.id } });
            return reply.send({ deleted: true });
        },
    );

    const SyncFromFileBodySchema = z.object({
        machineId: z.string(),
        projectId: z.string(),
        entries: z.array(
            z.object({
                taskId: z.string().optional(),
                checked: z.boolean(),
                text: z.string().min(1).max(4096),
            }),
        ).max(500),
    });

    app.patch(
        "/v1/tasks/sync-from-file",
        {
            preHandler: app.authenticate,
            schema: { body: SyncFromFileBodySchema },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { machineId, projectId, entries } = request.body;

            await assertOwnedMachine(userId, machineId);

            const project = await ownedProject(userId, projectId);

            let created = 0;
            let updated = 0;
            const resultTasks: Record<string, unknown>[] = [];

            for (const entry of entries) {
                if (entry.taskId) {
                    const task = await db.task.findFirst({
                        where: { id: entry.taskId, accountId: userId, projectId },
                    });
                    if (!task) continue;

                    const targetStatus = entry.checked ? "completed" : "queued";
                    if (task.status === targetStatus) {
                        resultTasks.push(serializeTask(task));
                        continue;
                    }

                    const canComplete = entry.checked && ["queued", "dispatching", "running"].includes(task.status);
                    const canRestore = !entry.checked && task.status === "completed";
                    if (!canComplete && !canRestore) {
                        resultTasks.push(serializeTask(task));
                        continue;
                    }

                    const updatedTask = await db.task.update({
                        where: { id: task.id },
                        data: {
                            status: targetStatus,
                            completedAt: entry.checked ? new Date() : null,
                        },
                        include: { skillBindings: { include: { skill: { select: { name: true } } } } },
                    });

                    await emitSyncEphemeral(userId, {
                        t: "task-status-changed",
                        taskId: task.id,
                        machineId: task.machineId,
                        status: targetStatus,
                        completedAt: updatedTask.completedAt?.getTime(),
                        triggerType: task.triggerType,
                    });

                    resultTasks.push(serializeTask(updatedTask));
                    updated++;
                } else {
                    const newTask = await db.task.create({
                        data: {
                            accountId: userId,
                            projectId,
                            machineId,
                            prompt: entry.text,
                            directory: project.path,
                            priority: "user",
                            maxAttempts: 3,
                            triggerType: "todo-file",
                            status: "queued",
                        },
                        include: { skillBindings: { include: { skill: { select: { name: true } } } } },
                    });

                    await emitSyncEphemeral(userId, {
                        t: "task-status-changed",
                        taskId: newTask.id,
                        machineId,
                        status: "queued",
                        triggerType: "todo-file",
                    });

                    resultTasks.push(serializeTask(newTask));
                    created++;
                }
            }

            log({ module: "task" }, `todo-file sync for project ${projectId}: created=${created} updated=${updated}`);
            return reply.send({ tasks: resultTasks, created, updated });
        },
    );

    /**
     * Spawn a child task from within a running task session.
     * Auth: HAPPY_TASK_RESULT_TOKEN (same token used for /v1/tasks/result).
     * The spawned task inherits machineId, projectId, and directory from the parent
     * unless overridden. parentTaskId is automatically set to the authenticated task.
     */
    app.post(
        "/v1/tasks/spawn-child",
        {
            preHandler: authenticateTaskResult,
            schema: {
                body: z.object({
                    taskId: z.string(),
                    prompt: z.string().min(1),
                    directory: z.string().min(1).max(4096).optional(),
                    priority: TaskPrioritySchema.default("background"),
                    maxAttempts: z.number().int().min(1).max(10).default(3),
                }),
            },
        },
        async (request, reply) => {
            const { taskId, prompt, directory: bodyDirectory, priority, maxAttempts } = request.body;
            const userId = request.userId;

            const parent = await ownedTask(userId, taskId);

            const directory = bodyDirectory ?? parent.directory ?? "~";

            const child = await db.task.create({
                data: {
                    accountId: userId,
                    projectId: parent.projectId,
                    machineId: parent.machineId,
                    prompt,
                    directory,
                    priority,
                    maxAttempts,
                    triggerType: "manual",
                    status: "dispatching",
                    profileId: parent.profileId,
                    parentTaskId: parent.id,
                },
            });

            const resultToken = await auth.createTaskResultToken({ userId, taskId: child.id });

            await emitSyncEphemeral(userId, {
                t: "task-trigger",
                machineId: parent.machineId,
                taskId: child.id,
                prompt: child.prompt,
                directory,
                priority: child.priority,
                projectId: parent.projectId ?? undefined,
                resultToken,
                profileId: parent.profileId ?? undefined,
            });

            await emitSyncEphemeral(userId, {
                t: "task-status-changed",
                taskId: child.id,
                machineId: child.machineId,
                status: "queued",
                triggerType: child.triggerType,
            });

            return reply.code(201).send({ task: serializeTask(child) });
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

            const task = await ownedTask(request.userId, taskId);

            const persistCompletedResult = async (tx: typeof db) => {
                if (replayKey) {
                    const claimed = await claimRepeatKey(tx as any, replayKey, taskId, Date.now() + 6 * 60 * 60 * 1000);
                    if (!claimed) {
                        return null;
                    }
                }

                const decision = decideTaskTransition({
                    current: { status: task.status, dispatchedAt: task.dispatchedAt },
                    resolvedStatus,
                    now: new Date(),
                });
                if (!decision.apply) {
                    if (decision.reason === "stale") {
                        log(
                            { module: "task", level: "warn" },
                            `Ignored stale task result transition ${taskId}: ${task.status} -> ${resolvedStatus}`,
                        );
                    }
                    return { task, ignored: true } as const;
                }

                const updated = await tx.task.update({
                    where: { id: taskId },
                    data: {
                        status: resolvedStatus,
                        sessionId: sessionId ?? task.sessionId,
                        errorMessage: payload.errorMessage ?? task.errorMessage,
                        ...decision.timestamps,
                    },
                });

                const persistedSessionId = updated.sessionId ?? task.sessionId;
                if (resolvedStatus === "completed" && persistedSessionId && summary?.trim()) {
                    await tx.sessionEvent.create({
                        data: {
                            sessionId: persistedSessionId,
                            eventType: "session_end",
                            summary: summary.trim(),
                        },
                    });
                }

                return { task: updated, ignored: false } as const;
            };

            const persisted = await inTx(async (tx) => await persistCompletedResult(tx as typeof db));
            if (!persisted) {
                return reply.code(409).send({ error: "Task result token already consumed" });
            }
            if (persisted.ignored) {
                return reply.send({ task: serializeTask(persisted.task), ignored: true });
            }

            const updated = persisted.task;

            await emitSyncEphemeral(request.userId, {
                t: "task-status-changed",
                taskId,
                machineId: task.machineId,
                status: resolvedStatus,
                sessionId: updated.sessionId ?? undefined,
                errorMessage: updated.errorMessage ?? undefined,
                completedAt: updated.completedAt?.getTime(),
                triggerType: task.triggerType,
            });

            log({ module: "task" }, `Task ${taskId} outcome → ${outcome} (status=${resolvedStatus})`);
            return reply.send({ task: serializeTask(updated) });
        },
    );

    const SwarmTasksBodySchema = z.object({
        taskIds: z.array(z.string().min(1)).min(1).max(20),
        machineId: z.string(),
    });

    app.post(
        "/v1/tasks/swarm",
        {
            preHandler: app.authenticate,
            schema: { body: SwarmTasksBodySchema },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { taskIds, machineId } = request.body;

            await assertOwnedMachine(userId, machineId);

            const tasks = await db.task.findMany({
                where: { id: { in: taskIds }, accountId: userId, machineId },
                include: {
                    skillBindings: { include: { skill: true } },
                },
            });

            const dispatchable = tasks.filter((t) =>
                ["queued", "failed"].includes(t.status),
            );

            await Promise.all(
                dispatchable.map(async (task) => {
                    let directory = task.directory ?? "~";
                    let projectSupervisorConfig: string | null = null;
                    if (task.projectId) {
                        try {
                            const project = await ownedProject(userId, task.projectId);
                            if (!task.directory) directory = project.path;
                            projectSupervisorConfig = project.supervisorConfig ?? null;
                        } catch {
                            // Project not found - skip project-specific config
                        }
                    }

                    const { profileId: swarmProfileId, runtimeProfile: swarmRuntimeProfile } =
                        await resolveTaskRuntimeProfileBestEffort({
                            accountId: userId,
                            explicitProfileId: task.profileId,
                            projectSupervisorConfig,
                            purpose: "task-manual",
                            fallbackProfileId: task.profileId ?? undefined,
                        });

                    const skillContents =
                        task.skillBindings.length > 0
                            ? resolveSkillContents(
                                  task.skillBindings.map((b) => ({
                                      name: b.skill.name,
                                      content: b.skill.content,
                                  })),
                                  { interactive: true },
                              )
                            : undefined;

                    await db.task.update({
                        where: { id: task.id },
                        data: { status: "dispatching", errorMessage: null },
                    });

                    const resultToken = await auth.createTaskResultToken({
                        userId,
                        taskId: task.id,
                    });

                    await dispatchTaskTrigger(userId, {
                        taskId: task.id,
                        machineId: task.machineId,
                        prompt: task.prompt,
                        directory,
                        priority: task.priority,
                        projectId: task.projectId,
                        resultToken,
                        skillContents,
                        profileId: swarmProfileId,
                        runtimeProfile: swarmRuntimeProfile,
                        worktreeIsolation: true,
                    });
                }),
            );

            log(
                { module: "task" },
                `Swarm dispatched ${dispatchable.length}/${taskIds.length} tasks for machine ${machineId}`,
            );
            return reply.send({
                dispatched: dispatchable.length,
                taskIds: dispatchable.map((t) => t.id),
            });
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

            const result = await taskStatusApply({
                userId: request.userId,
                taskId,
                resolvedStatus,
                sessionId,
                errorMessage,
            });

            if (!result.ok) {
                if (result.reason === "not-found") {
                    return reply.code(404).send({ error: "Task not found" });
                }
                if (result.reason === "stale") {
                    log(
                        { module: "task", level: "warn" },
                        `Ignored stale task status transition ${taskId}: ${result.task.status} -> ${resolvedStatus}`,
                    );
                }
                return reply.send({ task: serializeTask(result.task), ignored: true });
            }

            log({ module: "task" }, `Task ${taskId} status → ${resolvedStatus}`);
            return reply.send({ task: serializeTask(result.task) });
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
        title?: string | null;
        worktreeIsolation?: boolean;
        parentTaskId?: string | null;
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
        title: t.title ?? null,
        worktreeIsolation: t.worktreeIsolation ?? false,
        parentTaskId: t.parentTaskId ?? null,
        promptPreview: truncateTaskPrompt(t.prompt, PROMPT_PREVIEW_LIMIT),
        skillNames: t.skillBindings?.map((b) => b.skill.name) ?? [],
    };
}
