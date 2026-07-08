import { emitSyncUpdate } from "@/app/events/syncUpdate";
import { db } from "@/storage/db";
import { versionedUpdate } from "@/modules/versionedUpdate";
import { Prisma } from "@prisma/client";
import { Fastify } from "../types";
import { getPublicUrl } from "@/storage/files";
import { z } from "zod";
import { log } from "@/utils/log";
import { assertOwnedProject, assertOwnedSession } from "../ownership";

export function accountRoutes(app: Fastify) {
    app.get('/v1/account/profile', {
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;
        const user = await db.account.findUniqueOrThrow({
            where: { id: userId },
            select: {
                firstName: true,
                lastName: true,
                username: true,
                avatar: true,
                githubUser: true,
            },
        });
        const connectedVendors = new Set((await db.serviceAccountToken.findMany({ where: { accountId: userId }, take: 100 })).map((t) => t.vendor));
        return reply.send({
            id: userId,
            timestamp: Date.now(),
            firstName: user.firstName,
            lastName: user.lastName,
            username: user.username,
            avatar: user.avatar ? { ...user.avatar, url: getPublicUrl(user.avatar.path) } : null,
            github: user.githubUser ? user.githubUser.profile : null,
            connectedServices: Array.from(connectedVendors),
        });
    });

    app.get('/v1/account/settings', {
        preHandler: app.authenticate,
        schema: {
            response: {
                200: z.object({
                    settings: z.string().nullable(),
                    settingsVersion: z.number(),
                }),
                500: z.object({
                    error: z.literal('Failed to get account settings'),
                }),
            },
        },
    }, async (request, reply) => {
        try {
            const user = await db.account.findUnique({
                where: { id: request.userId },
                select: { settings: true, settingsVersion: true },
            });

            if (!user) {
                return reply.code(500).send({ error: 'Failed to get account settings' });
            }

            return reply.send({
                settings: user.settings,
                settingsVersion: user.settingsVersion,
            });
        } catch (e) {
            request.log.error(e, 'Failed to get account settings');
            return reply.code(500).send({ error: 'Failed to get account settings' });
        }
    });

    app.post('/v1/account/settings', {
        schema: {
            body: z.object({
                settings: z.string().nullable(),
                expectedVersion: z.number().int().min(0),
            }),
            response: {
                200: z.object({
                    success: z.literal(true),
                    version: z.number(),
                }),
                409: z.object({
                    success: z.literal(false),
                    error: z.literal('version-mismatch'),
                    currentVersion: z.number(),
                    currentSettings: z.string().nullable(),
                }),
                500: z.object({
                    success: z.literal(false),
                    error: z.literal('Failed to update account settings'),
                }),
            },
        },
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;
        const { settings, expectedVersion } = request.body;

        try {
            // Account.settings is a versioned blob under optimistic concurrency;
            // the compare-and-swap dance (read → guarded updateMany → count===0
            // re-read) is owned by the shared seam so this route cannot drift
            // from the Session/Machine versioned-field writers (ADR-0075).
            const result = await versionedUpdate<string | null>({
                expectedVersion,
                read: async () => {
                    const currentUser = await db.account.findUnique({
                        where: { id: userId },
                        select: { settings: true, settingsVersion: true },
                    });
                    if (!currentUser) {
                        return null;
                    }
                    return { version: currentUser.settingsVersion, value: currentUser.settings };
                },
                write: async (expected) => {
                    const { count } = await db.account.updateMany({
                        where: { id: userId, settingsVersion: expected },
                        data: {
                            settings,
                            settingsVersion: expected + 1,
                            updatedAt: new Date(),
                        },
                    });
                    return count;
                },
            });

            if (!result.applied) {
                if (result.reason === 'version-mismatch') {
                    return reply.code(409).send({
                        success: false,
                        error: 'version-mismatch',
                        currentVersion: result.currentVersion,
                        currentSettings: result.currentValue,
                    });
                }
                return reply.code(500).send({
                    success: false,
                    error: 'Failed to update account settings',
                });
            }

            // Broadcast settings change. Seam owns seq + id + recipient +
            // payload (ADR-0023); we only express the domain delta.
            const settingsUpdate = {
                value: settings,
                version: result.newVersion,
            };
            await emitSyncUpdate(userId, {
                t: "update-account",
                profile: { settings: settingsUpdate },
            });

            return reply.send({
                success: true,
                version: result.newVersion,
            });
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to update account settings: ${error}`);
            return reply.code(500).send({
                success: false,
                error: 'Failed to update account settings',
            });
        }
    });

    app.post('/v1/usage/query', {
        schema: {
            body: z.object({
                sessionId: z.string().nullish(),
                projectId: z.string().nullish(),
                startTime: z.number().int().positive().nullish(),
                endTime: z.number().int().positive().nullish(),
                groupBy: z.enum(['hour', 'day']).nullish(),
                timezone: z.string().min(1).nullish(),
            }),
        },
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId, projectId, startTime, endTime, groupBy, timezone } = request.body;
        const actualGroupBy = groupBy || 'day';

        let validTz = 'UTC';
        if (timezone && /^[A-Za-z0-9/_\-+]{1,64}$/.test(timezone)) {
            try {
                Intl.DateTimeFormat(undefined, { timeZone: timezone });
                validTz = timezone;
            } catch (err) {
                log({ module: 'api', level: 'warn' }, `Invalid timezone "${timezone}", falling back to UTC: ${String(err)}`);
            }
        }

        try {
            if (sessionId) {
                await assertOwnedSession(userId, sessionId);
            }

            if (projectId) {
                await assertOwnedProject(userId, projectId);
            }

            const startDate = startTime ? new Date(startTime * 1000) : null;
            const endDate = endTime ? new Date(endTime * 1000) : null;
            const truncExpr = actualGroupBy === 'hour'
                ? Prisma.raw(`date_trunc('hour', ur."createdAt" AT TIME ZONE '${validTz}')`)
                : Prisma.raw(`date_trunc('day', ur."createdAt" AT TIME ZONE '${validTz}')`);

            interface BucketRow {
                bucket_epoch: number;
                category: string;
                key: string;
                total_value: number;
                report_count: bigint;
            }

            const rows = await db.$queryRaw<BucketRow[]>`
                SELECT
                    EXTRACT(EPOCH FROM ${truncExpr})::bigint AS bucket_epoch,
                    cat.category,
                    kv.key,
                    SUM(kv.value::double precision) AS total_value,
                    COUNT(DISTINCT ur.id) AS report_count
                FROM "UsageReport" ur
                LEFT JOIN "Session" s ON s.id = ur."sessionId"
                ,
                LATERAL (
                    VALUES ('tokens', COALESCE(ur.data->'tokens', '{}'::jsonb)),
                           ('cost', COALESCE(ur.data->'cost', '{}'::jsonb))
                ) AS cat(category, obj),
                LATERAL jsonb_each_text(cat.obj) AS kv(key, value)
                WHERE ur."accountId" = ${userId}
                    AND (${sessionId}::text IS NULL OR ur."sessionId" = ${sessionId})
                    AND (${projectId}::text IS NULL OR s."projectId" = ${projectId})
                    AND (${startDate}::timestamp IS NULL OR ur."createdAt" >= ${startDate})
                    AND (${endDate}::timestamp IS NULL OR ur."createdAt" <= ${endDate})
                GROUP BY bucket_epoch, cat.category, kv.key
                ORDER BY bucket_epoch ASC
            `;

            const bucketMap = new Map<number, { tokens: Record<string, number>; cost: Record<string, number>; reportCount: number }>();
            for (const row of rows) {
                const ts = Number(row.bucket_epoch);
                if (!bucketMap.has(ts)) bucketMap.set(ts, { tokens: {}, cost: {}, reportCount: 0 });
                const entry = bucketMap.get(ts)!;
                if (row.category === 'tokens') entry.tokens[row.key] = (entry.tokens[row.key] || 0) + row.total_value;
                else entry.cost[row.key] = (entry.cost[row.key] || 0) + row.total_value;
                const rc = Number(row.report_count);
                if (rc > entry.reportCount) entry.reportCount = rc;
            }

            const result = Array.from(bucketMap.entries())
                .map(([timestamp, data]) => ({ timestamp, tokens: data.tokens, cost: data.cost, reportCount: data.reportCount }))
                .sort((a, b) => a.timestamp - b.timestamp);

            return reply.send({ usage: result, groupBy: actualGroupBy });
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to query usage reports: ${error}`);
            return reply.code(500).send({ error: 'Failed to query usage reports' });
        }
    });
}
