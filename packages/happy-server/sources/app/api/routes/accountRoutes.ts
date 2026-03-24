import { eventRouter, buildUpdateAccountUpdate } from "@/app/events/eventRouter";
import { db } from "@/storage/db";
import { Prisma } from "@prisma/client";
import { Fastify } from "../types";
import { getPublicUrl } from "@/storage/files";
import { z } from "zod";
import { randomKeyNaked } from "@/utils/randomKeyNaked";
import { allocateUserSeq } from "@/storage/seq";
import { log } from "@/utils/log";
import { AccountProfile } from "@/types";

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
                githubUser: true
            }
        });
        const connectedVendors = new Set((await db.serviceAccountToken.findMany({ where: { accountId: userId }, take: 100 })).map(t => t.vendor));
        return reply.send({
            id: userId,
            timestamp: Date.now(),
            firstName: user.firstName,
            lastName: user.lastName,
            username: user.username,
            avatar: user.avatar ? { ...user.avatar, url: getPublicUrl(user.avatar.path) } : null,
            github: user.githubUser ? user.githubUser.profile : null,
            connectedServices: Array.from(connectedVendors)
        });
    });

    // Get Account Settings API
    app.get('/v1/account/settings', {
        preHandler: app.authenticate,
        schema: {
            response: {
                200: z.object({
                    settings: z.string().nullable(),
                    settingsVersion: z.number()
                }),
                500: z.object({
                    error: z.literal('Failed to get account settings')
                })
            }
        }
    }, async (request, reply) => {
        try {
            const user = await db.account.findUnique({
                where: { id: request.userId },
                select: { settings: true, settingsVersion: true }
            });

            if (!user) {
                return reply.code(500).send({ error: 'Failed to get account settings' });
            }

            return reply.send({
                settings: user.settings,
                settingsVersion: user.settingsVersion
            });
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to get account settings' });
        }
    });

    // Update Account Settings API
    app.post('/v1/account/settings', {
        schema: {
            body: z.object({
                settings: z.string().nullable(),
                expectedVersion: z.number().int().min(0)
            }),
            response: {
                200: z.union([z.object({
                    success: z.literal(true),
                    version: z.number()
                }), z.object({
                    success: z.literal(false),
                    error: z.literal('version-mismatch'),
                    currentVersion: z.number(),
                    currentSettings: z.string().nullable()
                })]),
                500: z.object({
                    success: z.literal(false),
                    error: z.literal('Failed to update account settings')
                })
            }
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { settings, expectedVersion } = request.body;

        try {
            // Get current user data for version check
            const currentUser = await db.account.findUnique({
                where: { id: userId },
                select: { settings: true, settingsVersion: true }
            });

            if (!currentUser) {
                return reply.code(500).send({
                    success: false,
                    error: 'Failed to update account settings'
                });
            }

            // Check current version
            if (currentUser.settingsVersion !== expectedVersion) {
                return reply.code(200).send({
                    success: false,
                    error: 'version-mismatch',
                    currentVersion: currentUser.settingsVersion,
                    currentSettings: currentUser.settings
                });
            }

            // Update settings with version check
            const { count } = await db.account.updateMany({
                where: {
                    id: userId,
                    settingsVersion: expectedVersion
                },
                data: {
                    settings: settings,
                    settingsVersion: expectedVersion + 1,
                    updatedAt: new Date()
                }
            });

            if (count === 0) {
                // Re-fetch to get current version
                const account = await db.account.findUnique({
                    where: { id: userId }
                });
                return reply.code(200).send({
                    success: false,
                    error: 'version-mismatch',
                    currentVersion: account?.settingsVersion || 0,
                    currentSettings: account?.settings || null
                });
            }

            // Generate update for connected clients
            const updSeq = await allocateUserSeq(userId);
            const settingsUpdate = {
                value: settings,
                version: expectedVersion + 1
            };

            // Send account update to user-scoped connections only
            const updatePayload = buildUpdateAccountUpdate(userId, { settings: settingsUpdate }, updSeq, randomKeyNaked(12));
            eventRouter.emitUpdate({
                userId,
                payload: updatePayload,
                recipientFilter: { type: 'user-scoped-only' }
            });

            return reply.send({
                success: true,
                version: expectedVersion + 1
            });
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to update account settings: ${error}`);
            return reply.code(500).send({
                success: false,
                error: 'Failed to update account settings'
            });
        }
    });

    app.post('/v1/usage/query', {
        schema: {
            body: z.object({
                sessionId: z.string().nullish(),
                startTime: z.number().int().positive().nullish(),
                endTime: z.number().int().positive().nullish(),
                groupBy: z.enum(['hour', 'day']).nullish(),
                timezone: z.string().min(1).nullish()
            })
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId, startTime, endTime, groupBy, timezone } = request.body;
        const actualGroupBy = groupBy || 'day';

        // Validate timezone: Intl check + strict character allowlist to prevent SQL injection.
        // IANA timezone names only contain [A-Za-z0-9/_\-+], so anything else is rejected.
        let validTz = 'UTC';
        if (timezone && /^[A-Za-z0-9/_\-+]{1,64}$/.test(timezone)) {
            try {
                Intl.DateTimeFormat(undefined, { timeZone: timezone });
                validTz = timezone;
            } catch {
                // Invalid timezone — fall back to UTC
            }
        }

        try {
            if (sessionId) {
                const session = await db.session.findFirst({
                    where: { id: sessionId, accountId: userId }
                });
                if (!session) {
                    return reply.code(404).send({ error: 'Session not found' });
                }
            }

            const startDate = startTime ? new Date(startTime * 1000) : null;
            const endDate = endTime ? new Date(endTime * 1000) : null;

            // Use date_trunc with timezone for correct local-day bucketing.
            // jsonb_each_text expands dynamic keys (model names, token types)
            // so we don't hardcode field names.
            // Prisma.raw() is used for date_trunc unit and AT TIME ZONE because
            // PostgreSQL does not accept parameterized bindings ($1) for these.
            // Safety: truncUnit is from a hardcoded enum, validTz is verified via Intl API.
            const truncExpr = actualGroupBy === 'hour'
                ? Prisma.raw(`date_trunc('hour', "createdAt" AT TIME ZONE '${validTz}')`)
                : Prisma.raw(`date_trunc('day', "createdAt" AT TIME ZONE '${validTz}')`);

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
                FROM "UsageReport" ur,
                LATERAL (
                    VALUES ('tokens', COALESCE(ur.data->'tokens', '{}'::jsonb)),
                           ('cost', COALESCE(ur.data->'cost', '{}'::jsonb))
                ) AS cat(category, obj),
                LATERAL jsonb_each_text(cat.obj) AS kv(key, value)
                WHERE ur."accountId" = ${userId}
                    AND (${sessionId}::text IS NULL OR ur."sessionId" = ${sessionId})
                    AND (${startDate}::timestamp IS NULL OR ur."createdAt" >= ${startDate})
                    AND (${endDate}::timestamp IS NULL OR ur."createdAt" <= ${endDate})
                GROUP BY bucket_epoch, cat.category, kv.key
                ORDER BY bucket_epoch ASC
            `;

            // Aggregate rows into the expected response format.
            // Each SQL row is one (bucket, category, key) tuple. We merge them
            // into { timestamp, tokens: {...}, cost: {...}, reportCount } objects.
            // reportCount uses MAX across keys because COUNT(DISTINCT ur.id) per key
            // may vary if some reports lack certain keys.
            const bucketMap = new Map<number, {
                tokens: Record<string, number>;
                cost: Record<string, number>;
                reportCount: number;
            }>();

            for (const row of rows) {
                const ts = Number(row.bucket_epoch);

                if (!bucketMap.has(ts)) {
                    bucketMap.set(ts, { tokens: {}, cost: {}, reportCount: 0 });
                }

                const entry = bucketMap.get(ts)!;

                if (row.category === 'tokens') {
                    entry.tokens[row.key] = (entry.tokens[row.key] || 0) + row.total_value;
                } else {
                    entry.cost[row.key] = (entry.cost[row.key] || 0) + row.total_value;
                }

                const rc = Number(row.report_count);
                if (rc > entry.reportCount) {
                    entry.reportCount = rc;
                }
            }

            const result = Array.from(bucketMap.entries())
                .map(([timestamp, data]) => ({
                    timestamp,
                    tokens: data.tokens,
                    cost: data.cost,
                    reportCount: data.reportCount
                }))
                .sort((a, b) => a.timestamp - b.timestamp);

            return reply.send({
                usage: result,
                groupBy: actualGroupBy
            });
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to query usage reports: ${error}`);
            return reply.code(500).send({ error: 'Failed to query usage reports' });
        }
    });
}