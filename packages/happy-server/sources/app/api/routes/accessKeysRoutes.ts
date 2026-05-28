import { Fastify } from "../types";
import { z } from "zod";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { versionedUpdate } from "@/modules/versionedUpdate";

export function accessKeysRoutes(app: Fastify) {
    // Get Access Key API
    app.get('/v1/access-keys/:sessionId/:machineId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string(),
                machineId: z.string()
            }),
            response: {
                200: z.object({
                    accessKey: z.object({
                        data: z.string(),
                        dataVersion: z.number(),
                        createdAt: z.number(),
                        updatedAt: z.number()
                    }).nullable()
                }),
                404: z.object({
                    error: z.literal('Session or machine not found')
                }),
                500: z.object({
                    error: z.literal('Failed to get access key')
                })
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId, machineId } = request.params;

        try {
            // Verify session and machine belong to user
            const [session, machine] = await Promise.all([
                db.session.findFirst({
                    where: { id: sessionId, accountId: userId }
                }),
                db.machine.findFirst({
                    where: { id: machineId, accountId: userId }
                })
            ]);

            if (!session || !machine) {
                return reply.code(404).send({ error: 'Session or machine not found' });
            }

            // Get access key
            const accessKey = await db.accessKey.findUnique({
                where: {
                    accountId_machineId_sessionId: {
                        accountId: userId,
                        machineId,
                        sessionId
                    }
                }
            });

            if (!accessKey) {
                return reply.send({ accessKey: null });
            }

            return reply.send({
                accessKey: {
                    data: accessKey.data,
                    dataVersion: accessKey.dataVersion,
                    createdAt: accessKey.createdAt.getTime(),
                    updatedAt: accessKey.updatedAt.getTime()
                }
            });
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to get access key: ${error}`);
            return reply.code(500).send({ error: 'Failed to get access key' });
        }
    });

    // Create Access Key API
    app.post('/v1/access-keys/:sessionId/:machineId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string(),
                machineId: z.string()
            }),
            body: z.object({
                data: z.string()
            }),
            response: {
                200: z.object({
                    success: z.boolean(),
                    accessKey: z.object({
                        data: z.string(),
                        dataVersion: z.number(),
                        createdAt: z.number(),
                        updatedAt: z.number()
                    }).optional(),
                    error: z.string().optional()
                }),
                404: z.object({
                    error: z.literal('Session or machine not found')
                }),
                409: z.object({
                    error: z.literal('Access key already exists')
                }),
                500: z.object({
                    error: z.literal('Failed to create access key')
                })
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId, machineId } = request.params;
        const { data } = request.body;

        try {
            // Verify session and machine belong to user
            const [session, machine] = await Promise.all([
                db.session.findFirst({
                    where: { id: sessionId, accountId: userId }
                }),
                db.machine.findFirst({
                    where: { id: machineId, accountId: userId }
                })
            ]);

            if (!session || !machine) {
                return reply.code(404).send({ error: 'Session or machine not found' });
            }

            // Check if access key already exists
            const existing = await db.accessKey.findUnique({
                where: {
                    accountId_machineId_sessionId: {
                        accountId: userId,
                        machineId,
                        sessionId
                    }
                }
            });

            if (existing) {
                return reply.code(409).send({ error: 'Access key already exists' });
            }

            // Create access key
            const accessKey = await db.accessKey.create({
                data: {
                    accountId: userId,
                    machineId,
                    sessionId,
                    data,
                    dataVersion: 1
                }
            });

            log({ module: 'access-keys', userId, sessionId, machineId }, 'Created new access key');

            return reply.send({
                success: true,
                accessKey: {
                    data: accessKey.data,
                    dataVersion: accessKey.dataVersion,
                    createdAt: accessKey.createdAt.getTime(),
                    updatedAt: accessKey.updatedAt.getTime()
                }
            });
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to create access key: ${error}`);
            return reply.code(500).send({ error: 'Failed to create access key' });
        }
    });

    // Update Access Key API
    app.put('/v1/access-keys/:sessionId/:machineId', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                sessionId: z.string(),
                machineId: z.string()
            }),
            body: z.object({
                data: z.string(),
                expectedVersion: z.number().int().min(0)
            }),
            response: {
                200: z.object({
                    success: z.literal(true),
                    version: z.number()
                }),
                404: z.object({
                    error: z.literal('Access key not found')
                }),
                409: z.object({
                    success: z.literal(false),
                    error: z.literal('version-mismatch'),
                    currentVersion: z.number(),
                    currentData: z.string()
                }),
                500: z.object({
                    success: z.literal(false),
                    error: z.literal('Failed to update access key')
                })
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { sessionId, machineId } = request.params;
        const { data, expectedVersion } = request.body;

        try {
            const result = await versionedUpdate<string>({
                expectedVersion,
                read: async () => {
                    const key = await db.accessKey.findUnique({
                        where: {
                            accountId_machineId_sessionId: { accountId: userId, machineId, sessionId }
                        }
                    });
                    return key ? { version: key.dataVersion, value: key.data } : null;
                },
                write: async (expected) => {
                    const { count } = await db.accessKey.updateMany({
                        where: { accountId: userId, machineId, sessionId, dataVersion: expected },
                        data: { data, dataVersion: expected + 1, updatedAt: new Date() }
                    });
                    return count;
                }
            });

            if (!result.applied) {
                if (result.reason === 'not-found') {
                    return reply.code(404).send({ error: 'Access key not found' });
                }
                return reply.code(409).send({
                    success: false,
                    error: 'version-mismatch',
                    currentVersion: result.currentVersion,
                    currentData: result.currentValue
                });
            }

            log({ module: 'access-keys', userId, sessionId, machineId }, `Updated access key to version ${result.newVersion}`);

            return reply.send({
                success: true,
                version: result.newVersion
            });
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to update access key: ${error}`);
            return reply.code(500).send({
                success: false,
                error: 'Failed to update access key'
            });
        }
    });
}