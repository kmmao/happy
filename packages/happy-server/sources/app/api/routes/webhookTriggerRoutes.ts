import { emitSyncEphemeral } from "@/app/events/syncEphemeral";
import { emitSyncUpdate } from "@/app/events/syncUpdate";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { ownedWebhookTrigger } from "../ownership";
import { log } from "@/utils/log";
import crypto from "crypto";
import { inTx } from "@/storage/inTx";
import { inboxCreate } from "@/modules/inboxCreate";
import {
    isUnifiedRuntimeProfileResolverEnabled,
    notifyRuntimeProfileFailure,
    resolveRuntimeProfile,
} from "@/modules/runtimeProfileResolver";
import { WEBHOOK_INBOUND_RATE_LIMIT } from "../utils/enableRateLimit";

const MAX_WEBHOOK_PAYLOAD_SIZE = 65536; // 64KB
const MAX_PROMPT_LENGTH = 50000;
const TaskPrioritySchema = z.enum(["urgent", "user", "background"]);

const CreateWebhookTriggerBodySchema = z.object({
    machineId: z.string(),
    projectId: z.string().optional(),
    name: z.string().max(200).optional(),
    slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
    prompt: z.string().min(1),
    priority: TaskPrioritySchema.default("background"),
    skillIds: z.array(z.string()).max(10).default([]),
    // Profile binding (wire 0.14.0). Business key — built-in id or
    // AiBackendProfile.profileKey. When null/omitted the inbound handler
    // falls back to project default via runtimeProfileResolver (C4).
    profileId: z.string().optional(),
});

const UpdateWebhookTriggerBodySchema = z.object({
    name: z.string().max(200).nullable().optional(),
    prompt: z.string().min(1).optional(),
    priority: TaskPrioritySchema.optional(),
    enabled: z.boolean().optional(),
    skillIds: z.array(z.string()).max(10).optional(),
    profileId: z.string().nullable().optional(),
});

const QueryWebhookTriggersSchema = z.object({
    machineId: z.string().optional(),
    projectId: z.string().optional(),
    enabled: z.preprocess(
        (val) => val === "true" ? true : val === "false" ? false : undefined,
        z.boolean().optional(),
    ),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

/** Generate a random secret and its SHA-256 hash. */
function generateSecret(): { secret: string; secretHash: string } {
    const secret = crypto.randomBytes(32).toString("hex");
    const secretHash = crypto.createHash("sha256").update(secret).digest("hex");
    return { secret, secretHash };
}

/** Timing-safe verification: hash the provided token and compare to stored hash. */
function verifySecretHash(provided: string, stored: string): boolean {
    const providedBuf = crypto.createHash("sha256").update(provided).digest();
    const storedBuf = Buffer.from(stored, "hex");
    // If stored is not a valid 32-byte SHA-256 hash, always fail (constant-time)
    const expected = storedBuf.length === 32 ? storedBuf : Buffer.alloc(32);
    return crypto.timingSafeEqual(providedBuf, expected);
}

/**
 * WebhookTrigger CRUD routes + public inbound endpoint.
 * External systems POST to /v1/triggers/:slug with Bearer token to create Tasks.
 */
export function webhookTriggerRoutes(app: Fastify) {

    // =============================================
    // Public inbound endpoint (no app.authenticate)
    // =============================================

    app.post(
        "/v1/triggers/:slug",
        {
            schema: {
                params: z.object({ slug: z.string() }),
            },
            config: { rawBody: true, rateLimit: WEBHOOK_INBOUND_RATE_LIMIT } as Record<string, unknown>,
        },
        async (request, reply) => {
            const { slug } = request.params as { slug: string };

            // Extract bearer token FIRST — prevent slug enumeration via 404 vs 401
            const authHeader = (request.headers as Record<string, string>).authorization;
            if (!authHeader?.startsWith("Bearer ")) {
                return reply.code(401).send({ error: "Unauthorized" });
            }
            const token = authHeader.slice(7);

            const trigger = await db.webhookTrigger.findFirst({
                where: { slug, enabled: true },
            });

            // Uniform 401 for both "slug not found" and "bad token" — prevents enumeration
            if (!trigger || !verifySecretHash(token, trigger.secretHash)) {
                return reply.code(401).send({ error: "Unauthorized" });
            }

            // Build prompt — substitute {{payload}} if present
            const rawBody = request.body;
            const payloadStr = typeof rawBody === "string"
                ? rawBody
                : JSON.stringify(rawBody ?? {});

            // Limit payload size to prevent memory abuse
            if (payloadStr.length > MAX_WEBHOOK_PAYLOAD_SIZE) {
                return reply.code(413).send({ error: "Payload too large" });
            }

            const prompt = trigger.prompt.replace(/\{\{payload\}\}/g, payloadStr);

            // Limit final prompt length
            if (prompt.length > MAX_PROMPT_LENGTH) {
                return reply.code(413).send({ error: "Resulting prompt too large" });
            }

            // Resolve project directory (+ supervisorConfig needed for
            // runtime profile resolution below)
            let directory = "~";
            let resolvedProjectId: string | null = null;
            let projectSupervisorConfig: string | null = null;
            if (trigger.projectId) {
                const project = await db.project.findFirst({
                    where: { id: trigger.projectId, accountId: trigger.accountId },
                    select: { id: true, path: true, supervisorConfig: true },
                });
                if (project) {
                    directory = project.path;
                    resolvedProjectId = project.id;
                    projectSupervisorConfig = project.supervisorConfig ?? null;
                }
            }

            // Resolve the runtime profile before creating the Task. When
            // the unified resolver is disabled (feature flag off) we keep
            // the pre-0.14.0 behavior of dispatching without a profile,
            // matching Cron/Task routes. When enabled, a missing / stale
            // binding results in a 503 + Inbox notification so the
            // external caller knows to fix the binding and retry; we do
            // NOT silently dispatch a Task that would run with stale env.
            let resolvedProfileId: string | undefined;
            let resolvedRuntimeProfile:
                | Awaited<ReturnType<typeof resolveRuntimeProfile>>
                | null = null;
            if (isUnifiedRuntimeProfileResolverEnabled()) {
                resolvedRuntimeProfile = await resolveRuntimeProfile({
                    accountId: trigger.accountId,
                    explicitProfileId: trigger.profileId,
                    projectSupervisorConfig,
                    purpose: "webhook",
                });
                if (!resolvedRuntimeProfile.ok) {
                    notifyRuntimeProfileFailure({
                        accountId: trigger.accountId,
                        purpose: "webhook",
                        failure: resolvedRuntimeProfile,
                        referenceUrl: `/machine/${trigger.machineId}/tasks`,
                        refType: "webhookTrigger",
                        refId: trigger.id,
                    });
                    return reply.code(503).send({
                        error: "profile_unavailable",
                        reason: resolvedRuntimeProfile.reason,
                        message: resolvedRuntimeProfile.message,
                    });
                }
                resolvedProfileId = resolvedRuntimeProfile.profileId;
            }

            // Load skills if bound
            let skillContents: Array<{ name: string; content: string }> | undefined;
            const skillIds: string[] = safeParseJsonArray(trigger.skillIds);
            if (skillIds.length > 0) {
                const skills = await db.skill.findMany({
                    where: {
                        id: { in: skillIds },
                        accountId: trigger.accountId,
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

            // Create Task + update trigger stats in a single transaction
            const task = await inTx(async (tx) => {
                const created = await tx.task.create({
                    data: {
                        accountId: trigger.accountId,
                        projectId: resolvedProjectId,
                        machineId: trigger.machineId,
                        prompt,
                        priority: trigger.priority,
                        maxAttempts: 3,
                        triggerType: "webhook",
                        triggerRef: trigger.id,
                        status: "dispatching",
                        profileId: resolvedProfileId,
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
                });

                await tx.webhookTrigger.update({
                    where: { id: trigger.id },
                    data: {
                        lastTriggeredAt: new Date(),
                        triggerCount: { increment: 1 },
                    },
                });

                return created;
            });

            // Dispatch to CLI daemon (after transaction commits).
            await emitSyncEphemeral(trigger.accountId, {
                t: "task-trigger",
                machineId: trigger.machineId,
                taskId: task.id,
                prompt,
                directory,
                priority: trigger.priority,
                projectId: resolvedProjectId ?? undefined,
                skillContents,
                profileId: resolvedProfileId,
                runtimeProfile:
                    resolvedRuntimeProfile?.ok
                        ? resolvedRuntimeProfile.runtimeProfile
                        : undefined,
            });

            void inboxCreate({
                accountId: trigger.accountId,
                category: "trigger",
                eventType: "trigger.webhook_fired",
                severity: "info",
                title: `Webhook '${trigger.slug}' triggered`,
                body: trigger.name ?? undefined,
                referenceUrl: `/machine/${trigger.machineId}/tasks`,
                refType: "webhookTrigger",
                refId: trigger.id,
                groupKey: `webhook:${trigger.id}:triggered`,
                skipPush: true,
            });

            log(
                { module: "trigger" },
                `Webhook trigger ${trigger.id} (slug=${slug}) created task ${task.id}`,
            );

            // Phase C — real-time push so the App's Event Workflow card
            // updates triggerCount + lastTriggeredAt the moment the
            // webhook fires. Reload to get the post-increment row.
            const fresh = await db.webhookTrigger.findUnique({
                where: { id: trigger.id },
            });
            if (fresh) {
                await emitSyncUpdate(trigger.accountId, {
                    t: "webhook-trigger-updated",
                    trigger: serializeWebhookTrigger(fresh),
                });
            }

            return reply.code(201).send({
                taskId: task.id,
                status: "dispatching",
            });
        },
    );

    // =============================================
    // Authenticated CRUD routes
    // =============================================

    // POST /v1/webhook-triggers — create (returns secret once)
    app.post(
        "/v1/webhook-triggers",
        {
            preHandler: app.authenticate,
            schema: { body: CreateWebhookTriggerBodySchema },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { machineId, projectId, name, slug, prompt, priority, skillIds, profileId } = request.body;

            // Verify machine
            const machine = await db.machine.findFirst({
                where: { id: machineId, accountId: userId },
                select: { id: true },
            });
            if (!machine) {
                return reply.code(404).send({ error: "Machine not found" });
            }

            // Verify project if scoped
            if (projectId) {
                const project = await db.project.findFirst({
                    where: { id: projectId, accountId: userId },
                    select: { id: true },
                });
                if (!project) {
                    return reply.code(404).send({ error: "Project not found" });
                }
            }

            // Check slug uniqueness
            const existingSlug = await db.webhookTrigger.findFirst({
                where: { slug },
                select: { id: true },
            });
            if (existingSlug) {
                return reply.code(409).send({ error: "slug-conflict" });
            }

            const { secret, secretHash } = generateSecret();

            const trigger = await db.webhookTrigger.create({
                data: {
                    accountId: userId,
                    machineId,
                    projectId: projectId ?? null,
                    name: name ?? null,
                    slug,
                    secretHash,
                    prompt,
                    priority,
                    skillIds: JSON.stringify(skillIds),
                    profileId: profileId ?? null,
                },
            });

            log({ module: "trigger" }, `WebhookTrigger created: ${trigger.id} slug=${slug}`);
            const serialized = serializeWebhookTrigger(trigger);
            await emitSyncUpdate(userId, {
                t: "webhook-trigger-updated",
                trigger: serialized,
            });
            return reply.code(201).send({
                webhookTrigger: serialized,
                secret, // One-time reveal
            });
        },
    );

    // GET /v1/webhook-triggers — list
    app.get(
        "/v1/webhook-triggers",
        {
            preHandler: app.authenticate,
            schema: { querystring: QueryWebhookTriggersSchema },
        },
        async (request, reply) => {
            const { machineId, projectId, enabled, limit, offset } = request.query;

            const where: Record<string, unknown> = { accountId: request.userId };
            if (machineId) where.machineId = machineId;
            if (projectId !== undefined) where.projectId = projectId;
            if (enabled !== undefined) where.enabled = enabled;

            const [triggers, total] = await Promise.all([
                db.webhookTrigger.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    skip: offset,
                }),
                db.webhookTrigger.count({ where }),
            ]);

            return reply.send({
                webhookTriggers: triggers.map(serializeWebhookTrigger),
                total,
            });
        },
    );

    // GET /v1/webhook-triggers/:id — single (no secret)
    app.get(
        "/v1/webhook-triggers/:id",
        {
            preHandler: app.authenticate,
            schema: { params: z.object({ id: z.string() }) },
        },
        async (request, reply) => {
            const trigger = await ownedWebhookTrigger(request.userId, request.params.id);
            return reply.send({ webhookTrigger: serializeWebhookTrigger(trigger) });
        },
    );

    // PATCH /v1/webhook-triggers/:id — update
    app.patch(
        "/v1/webhook-triggers/:id",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: UpdateWebhookTriggerBodySchema,
            },
        },
        async (request, reply) => {
            const trigger = await ownedWebhookTrigger(request.userId, request.params.id);

            const { name, prompt, priority, enabled, skillIds, profileId } = request.body;
            const data: Record<string, unknown> = {};

            if (name !== undefined) data.name = name;
            if (prompt !== undefined) data.prompt = prompt;
            if (priority !== undefined) data.priority = priority;
            if (enabled !== undefined) data.enabled = enabled;
            if (skillIds !== undefined) data.skillIds = JSON.stringify(skillIds);
            if (profileId !== undefined) data.profileId = profileId;

            const updated = await db.webhookTrigger.update({
                where: { id: trigger.id },
                data,
            });

            const serialized = serializeWebhookTrigger(updated);
            await emitSyncUpdate(request.userId, {
                t: "webhook-trigger-updated",
                trigger: serialized,
            });
            return reply.send({ webhookTrigger: serialized });
        },
    );

    // POST /v1/webhook-triggers/:id/regenerate-secret — regenerate secret (returns new secret once)
    app.post(
        "/v1/webhook-triggers/:id/regenerate-secret",
        {
            preHandler: app.authenticate,
            schema: { params: z.object({ id: z.string() }) },
        },
        async (request, reply) => {
            const trigger = await ownedWebhookTrigger(request.userId, request.params.id);

            const { secret, secretHash } = generateSecret();

            await db.webhookTrigger.update({
                where: { id: trigger.id },
                data: { secretHash },
            });

            log({ module: "trigger" }, `WebhookTrigger ${trigger.id} secret regenerated`);
            return reply.send({ secret });
        },
    );

    // DELETE /v1/webhook-triggers/:id — hard delete
    app.delete(
        "/v1/webhook-triggers/:id",
        {
            preHandler: app.authenticate,
            schema: { params: z.object({ id: z.string() }) },
        },
        async (request, reply) => {
            const trigger = await ownedWebhookTrigger(request.userId, request.params.id);

            await db.webhookTrigger.delete({ where: { id: trigger.id } });
            await emitSyncUpdate(request.userId, {
                t: "webhook-trigger-deleted",
                triggerId: trigger.id,
            });
            return reply.send({ deleted: true });
        },
    );
}

// === Serialization ===

function serializeWebhookTrigger(trigger: Record<string, unknown>): Record<string, unknown> {
    const t = trigger as {
        id: string;
        accountId: string;
        projectId: string | null;
        machineId: string;
        name: string | null;
        slug: string;
        prompt: string;
        priority: string;
        enabled: boolean;
        skillIds: string;
        lastTriggeredAt: Date | null;
        triggerCount: number;
        profileId: string | null;
        createdAt: Date;
        updatedAt: Date;
    };

    return {
        id: t.id,
        projectId: t.projectId,
        machineId: t.machineId,
        name: t.name,
        slug: t.slug,
        prompt: t.prompt,
        priority: t.priority,
        enabled: t.enabled,
        skillIds: safeParseJsonArray(t.skillIds),
        lastTriggeredAt: t.lastTriggeredAt?.getTime() ?? null,
        triggerCount: t.triggerCount,
        profileId: t.profileId,
        createdAt: t.createdAt.getTime(),
        updatedAt: t.updatedAt.getTime(),
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
