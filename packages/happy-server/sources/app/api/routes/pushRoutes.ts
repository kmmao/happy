import { z } from "zod";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { pushSend } from "@/modules/pushSend";

export function pushRoutes(app: Fastify) {
    
    // Push Token Registration API
    app.post('/v1/push-tokens', {
        schema: {
            body: z.object({
                token: z.string()
            }),
            response: {
                200: z.object({
                    success: z.literal(true)
                }),
                500: z.object({
                    error: z.literal('Failed to register push token')
                })
            }
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { token } = request.body;

        try {
            await db.accountPushToken.upsert({
                where: {
                    accountId_token: {
                        accountId: userId,
                        token: token
                    }
                },
                update: {
                    updatedAt: new Date()
                },
                create: {
                    accountId: userId,
                    token: token
                }
            });

            return reply.send({ success: true });
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to register push token' });
        }
    });

    // Send Push Notification API
    app.post('/v1/push/send', {
        schema: {
            body: z.object({
                title: z.string(),
                body: z.string(),
                data: z.record(z.string(), z.unknown()).optional(),
            }),
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { title, body, data } = request.body;
        void pushSend(userId, { title, body, data });
        return reply.send({ success: true });
    });

    // Delete Push Token API
    app.delete('/v1/push-tokens/:token', {
        schema: {
            params: z.object({
                token: z.string()
            }),
            response: {
                200: z.object({
                    success: z.literal(true)
                }),
                500: z.object({
                    error: z.literal('Failed to delete push token')
                })
            }
        },
        preHandler: app.authenticate
    }, async (request, reply) => {
        const userId = request.userId;
        const { token } = request.params;

        try {
            await db.accountPushToken.deleteMany({
                where: {
                    accountId: userId,
                    token: token
                }
            });

            return reply.send({ success: true });
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to delete push token' });
        }
    });

    // Get Push Tokens API
    app.get('/v1/push-tokens', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                limit: z.coerce.number().int().min(1).max(100).optional(),
                cursor: z.string().optional()
            }).optional()
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const limit = request.query?.limit ?? 50;
        const cursor = request.query?.cursor;

        try {
            const rows = await db.accountPushToken.findMany({
                where: {
                    accountId: userId
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: limit + 1,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
            });

            const hasNextPage = rows.length > limit;
            const tokens = hasNextPage ? rows.slice(0, limit) : rows;
            const nextCursor = hasNextPage ? tokens[tokens.length - 1].id : null;

            return reply.send({
                tokens: tokens.map(t => ({
                    id: t.id,
                    token: t.token,
                    createdAt: t.createdAt.getTime(),
                    updatedAt: t.updatedAt.getTime()
                })),
                nextCursor
            });
        } catch (error) {
            return reply.code(500).send({ error: 'Failed to get push tokens' });
        }
    });
}