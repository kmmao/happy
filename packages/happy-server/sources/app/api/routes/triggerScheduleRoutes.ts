import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { assertOwnedMachine, assertOwnedProject, ownedTriggerSchedule } from "../ownership";
import { log } from "@/utils/log";
import { emitSyncUpdate } from "@/app/events/syncUpdate";
import { CronExpressionParser } from "cron-parser";

const TaskPrioritySchema = z.enum(["urgent", "user", "background"]);

const CreateTriggerScheduleBodySchema = z.object({
    machineId: z.string(),
    projectId: z.string().optional(),
    name: z.string().max(200).optional(),
    prompt: z.string().min(1),
    cronExpression: z.string().min(1),
    priority: TaskPrioritySchema.default("background"),
    skillIds: z.array(z.string()).max(10).default([]),
    // Profile binding (wire 0.14.0). Business key — built-in id or
    // AiBackendProfile.profileKey. Resolved server-side by
    // triggerScheduleRunner (C4) when the cron fires.
    profileId: z.string().optional(),
});

const UpdateTriggerScheduleBodySchema = z.object({
    name: z.string().max(200).nullable().optional(),
    prompt: z.string().min(1).optional(),
    cronExpression: z.string().min(1).optional(),
    priority: TaskPrioritySchema.optional(),
    skillIds: z.array(z.string()).max(10).optional(),
    profileId: z.string().nullable().optional(),
});

const QueryTriggerSchedulesSchema = z.object({
    machineId: z.string().optional(),
    projectId: z.string().optional(),
    enabled: z.preprocess(
        (val) => val === "true" ? true : val === "false" ? false : undefined,
        z.boolean().optional(),
    ),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

/** Compute next run time from a cron expression. Returns null if invalid. */
function computeNextRunAt(cronExpression: string): Date | null {
    try {
        const interval = CronExpressionParser.parse(cronExpression);
        return interval.next().toDate();
    } catch {
        return null;
    }
}

/**
 * TriggerSchedule CRUD routes.
 * Cron-based task creation — schedules are checked on machine heartbeat.
 */
export function triggerScheduleRoutes(app: Fastify) {
    // POST /v1/trigger-schedules — create
    app.post(
        "/v1/trigger-schedules",
        {
            preHandler: app.authenticate,
            schema: { body: CreateTriggerScheduleBodySchema },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { machineId, projectId, name, prompt, cronExpression, priority, skillIds, profileId } = request.body;

            // Validate cron expression
            const nextRunAt = computeNextRunAt(cronExpression);
            if (!nextRunAt) {
                return reply.code(400).send({ error: "Invalid cron expression" });
            }

            // Verify machine belongs to user
            await assertOwnedMachine(userId, machineId);

            // Verify project if scoped
            if (projectId) {
                await assertOwnedProject(userId, projectId);
            }

            const schedule = await db.triggerSchedule.create({
                data: {
                    accountId: userId,
                    machineId,
                    projectId: projectId ?? null,
                    name: name ?? null,
                    prompt,
                    cronExpression,
                    priority,
                    skillIds: JSON.stringify(skillIds),
                    nextRunAt,
                    profileId: profileId ?? null,
                },
            });

            log({ module: "trigger" }, `TriggerSchedule created: ${schedule.id} cron=${cronExpression}`);
            const serialized = serializeTriggerSchedule(schedule);
            await emitSyncUpdate(userId, {
                t: "trigger-schedule-updated",
                schedule: serialized,
            });
            return reply.code(201).send({ triggerSchedule: serialized });
        },
    );

    // GET /v1/trigger-schedules — list
    app.get(
        "/v1/trigger-schedules",
        {
            preHandler: app.authenticate,
            schema: { querystring: QueryTriggerSchedulesSchema },
        },
        async (request, reply) => {
            const { machineId, projectId, enabled, limit, offset } = request.query;

            const where: Record<string, unknown> = { accountId: request.userId };
            if (machineId) where.machineId = machineId;
            if (projectId !== undefined) where.projectId = projectId;
            if (enabled !== undefined) where.enabled = enabled;

            const [schedules, total] = await Promise.all([
                db.triggerSchedule.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    skip: offset,
                }),
                db.triggerSchedule.count({ where }),
            ]);

            return reply.send({
                triggerSchedules: schedules.map(serializeTriggerSchedule),
                total,
            });
        },
    );

    // GET /v1/trigger-schedules/:id — single
    app.get(
        "/v1/trigger-schedules/:id",
        {
            preHandler: app.authenticate,
            schema: { params: z.object({ id: z.string() }) },
        },
        async (request, reply) => {
            const schedule = await ownedTriggerSchedule(request.userId, request.params.id);
            return reply.send({ triggerSchedule: serializeTriggerSchedule(schedule) });
        },
    );

    // PATCH /v1/trigger-schedules/:id — update
    app.patch(
        "/v1/trigger-schedules/:id",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: UpdateTriggerScheduleBodySchema,
            },
        },
        async (request, reply) => {
            const schedule = await ownedTriggerSchedule(request.userId, request.params.id);

            const { name, prompt, cronExpression, priority, skillIds, profileId } = request.body;
            const data: Record<string, unknown> = {};

            if (name !== undefined) data.name = name;
            if (prompt !== undefined) data.prompt = prompt;
            if (priority !== undefined) data.priority = priority;
            if (skillIds !== undefined) data.skillIds = JSON.stringify(skillIds);
            if (profileId !== undefined) data.profileId = profileId;

            if (cronExpression !== undefined) {
                const nextRunAt = computeNextRunAt(cronExpression);
                if (!nextRunAt) {
                    return reply.code(400).send({ error: "Invalid cron expression" });
                }
                data.cronExpression = cronExpression;
                if (schedule.enabled) {
                    data.nextRunAt = nextRunAt;
                }
            }

            const updated = await db.triggerSchedule.update({
                where: { id: schedule.id },
                data,
            });

            const serialized = serializeTriggerSchedule(updated);
            await emitSyncUpdate(request.userId, {
                t: "trigger-schedule-updated",
                schedule: serialized,
            });
            return reply.send({ triggerSchedule: serialized });
        },
    );

    // POST /v1/trigger-schedules/:id/toggle — toggle enabled/disabled
    app.post(
        "/v1/trigger-schedules/:id/toggle",
        {
            preHandler: app.authenticate,
            schema: { params: z.object({ id: z.string() }) },
        },
        async (request, reply) => {
            const schedule = await ownedTriggerSchedule(request.userId, request.params.id);

            const newEnabled = !schedule.enabled;
            const data: Record<string, unknown> = { enabled: newEnabled };

            if (newEnabled) {
                // Re-enable: compute next run time
                const nextRunAt = computeNextRunAt(schedule.cronExpression);
                if (!nextRunAt) {
                    return reply.code(400).send({ error: "Stored cron expression is invalid" });
                }
                data.nextRunAt = nextRunAt;
            } else {
                // Disable: clear next run
                data.nextRunAt = null;
            }

            const updated = await db.triggerSchedule.update({
                where: { id: schedule.id },
                data,
            });

            log({ module: "trigger" }, `TriggerSchedule ${schedule.id} ${newEnabled ? "enabled" : "disabled"}`);
            const serialized = serializeTriggerSchedule(updated);
            await emitSyncUpdate(request.userId, {
                t: "trigger-schedule-updated",
                schedule: serialized,
            });
            return reply.send({ triggerSchedule: serialized });
        },
    );

    // DELETE /v1/trigger-schedules/:id — hard delete
    app.delete(
        "/v1/trigger-schedules/:id",
        {
            preHandler: app.authenticate,
            schema: { params: z.object({ id: z.string() }) },
        },
        async (request, reply) => {
            const schedule = await ownedTriggerSchedule(request.userId, request.params.id);

            await db.triggerSchedule.delete({ where: { id: schedule.id } });
            await emitSyncUpdate(request.userId, {
                t: "trigger-schedule-deleted",
                scheduleId: schedule.id,
            });
            return reply.send({ deleted: true });
        },
    );
}

// === Serialization ===

function serializeTriggerSchedule(schedule: Record<string, unknown>): Record<string, unknown> {
    const s = schedule as {
        id: string;
        accountId: string;
        projectId: string | null;
        machineId: string;
        name: string | null;
        prompt: string;
        cronExpression: string;
        priority: string;
        enabled: boolean;
        skillIds: string;
        nextRunAt: Date | null;
        lastRunAt: Date | null;
        lastTaskId: string | null;
        runCount: number;
        profileId: string | null;
        createdAt: Date;
        updatedAt: Date;
    };

    return {
        id: s.id,
        projectId: s.projectId,
        machineId: s.machineId,
        name: s.name,
        prompt: s.prompt,
        cronExpression: s.cronExpression,
        priority: s.priority,
        enabled: s.enabled,
        skillIds: safeParseJsonArray(s.skillIds),
        nextRunAt: s.nextRunAt?.getTime() ?? null,
        lastRunAt: s.lastRunAt?.getTime() ?? null,
        lastTaskId: s.lastTaskId,
        runCount: s.runCount,
        profileId: s.profileId,
        createdAt: s.createdAt.getTime(),
        updatedAt: s.updatedAt.getTime(),
    };
}

function safeParseJsonArray(json: string): string[] {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}
