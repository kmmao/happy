import { emitSyncUpdate } from "@/app/events/syncUpdate";
import { db } from "@/storage/db";
import { Fastify } from "../types";
import { z } from "zod";
import { log } from "@/utils/log";
import * as privacyKit from "privacy-kit";
import { artifactVersionedUpdate } from "@/app/api/artifact/artifactVersionedUpdate";
import { artifactCreate } from "@/app/api/artifact/artifactCreate";
import { assertOwnedArtifact, ownedArtifact } from "../ownership";

export function artifactsRoutes(app: Fastify) {
    // GET /v1/artifacts - List all artifacts for the account
    app.get('/v1/artifacts', {
        preHandler: app.authenticate,
        schema: {
            querystring: z.object({
                limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
                cursor: z.string().optional()
            }).optional(),
            response: {
                200: z.object({
                    artifacts: z.array(z.object({
                        id: z.string(),
                        header: z.string(),
                        headerVersion: z.number(),
                        dataEncryptionKey: z.string(),
                        seq: z.number(),
                        createdAt: z.number(),
                        updatedAt: z.number()
                    })),
                    nextCursor: z.string().nullable()
                }),
                500: z.object({
                    error: z.literal('Failed to get artifacts')
                })
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const limit = request.query?.limit ?? 50;
        const cursor = request.query?.cursor;

        try {
            const rows = await db.artifact.findMany({
                where: { accountId: userId },
                orderBy: { updatedAt: 'desc' },
                take: limit + 1,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                select: {
                    id: true,
                    header: true,
                    headerVersion: true,
                    dataEncryptionKey: true,
                    seq: true,
                    createdAt: true,
                    updatedAt: true
                }
            });

            const hasNextPage = rows.length > limit;
            const artifacts = hasNextPage ? rows.slice(0, limit) : rows;
            const nextCursor = hasNextPage ? artifacts[artifacts.length - 1].id : null;

            return reply.send({
                artifacts: artifacts.map(a => ({
                    id: a.id,
                    header: privacyKit.encodeBase64(a.header),
                    headerVersion: a.headerVersion,
                    dataEncryptionKey: privacyKit.encodeBase64(a.dataEncryptionKey),
                    seq: a.seq,
                    createdAt: a.createdAt.getTime(),
                    updatedAt: a.updatedAt.getTime()
                })),
                nextCursor
            });
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to get artifacts: ${error}`);
            return reply.code(500).send({ error: 'Failed to get artifacts' });
        }
    });

    // GET /v1/artifacts/:id - Get single artifact with full body
    app.get('/v1/artifacts/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string()
            }),
            response: {
                200: z.object({
                    id: z.string(),
                    header: z.string(),
                    headerVersion: z.number(),
                    body: z.string(),
                    bodyVersion: z.number(),
                    dataEncryptionKey: z.string(),
                    seq: z.number(),
                    createdAt: z.number(),
                    updatedAt: z.number()
                }),
                404: z.object({
                    error: z.literal('Artifact not found')
                }),
                500: z.object({
                    error: z.literal('Failed to get artifact')
                })
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;

        try {
            const artifact = await ownedArtifact(userId, id);

            return reply.send({
                id: artifact.id,
                header: privacyKit.encodeBase64(artifact.header),
                headerVersion: artifact.headerVersion,
                body: privacyKit.encodeBase64(artifact.body),
                bodyVersion: artifact.bodyVersion,
                dataEncryptionKey: privacyKit.encodeBase64(artifact.dataEncryptionKey),
                seq: artifact.seq,
                createdAt: artifact.createdAt.getTime(),
                updatedAt: artifact.updatedAt.getTime()
            });
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to get artifact: ${error}`);
            return reply.code(500).send({ error: 'Failed to get artifact' });
        }
    });

    // POST /v1/artifacts - Create new artifact
    app.post('/v1/artifacts', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                id: z.string().uuid(),
                header: z.string(),
                body: z.string(),
                dataEncryptionKey: z.string()
            }),
            response: {
                200: z.object({
                    id: z.string(),
                    header: z.string(),
                    headerVersion: z.number(),
                    body: z.string(),
                    bodyVersion: z.number(),
                    dataEncryptionKey: z.string(),
                    seq: z.number(),
                    createdAt: z.number(),
                    updatedAt: z.number()
                }),
                409: z.object({
                    error: z.literal('Artifact with this ID already exists for another account')
                }),
                500: z.object({
                    error: z.literal('Failed to create artifact')
                })
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id, header, body, dataEncryptionKey } = request.body;

        try {
            // Intake (existence check, conflict rule, idempotency, initial row
            // shape, new-artifact broadcast) lives in the artifactCreate seam.
            const result = await artifactCreate({
                accountId: userId,
                id,
                header,
                body,
                dataEncryptionKey,
            });

            if (result.status === 'conflict') {
                return reply.code(409).send({
                    error: 'Artifact with this ID already exists for another account'
                });
            }

            const artifact = result.artifact;
            return reply.send({
                id: artifact.id,
                header: privacyKit.encodeBase64(artifact.header),
                headerVersion: artifact.headerVersion,
                body: privacyKit.encodeBase64(artifact.body),
                bodyVersion: artifact.bodyVersion,
                dataEncryptionKey: privacyKit.encodeBase64(artifact.dataEncryptionKey),
                seq: artifact.seq,
                createdAt: artifact.createdAt.getTime(),
                updatedAt: artifact.updatedAt.getTime()
            });
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to create artifact: ${error}`);
            return reply.code(500).send({ error: 'Failed to create artifact' });
        }
    });

    // POST /v1/artifacts/:id - Update artifact with version control
    app.post('/v1/artifacts/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string()
            }),
            body: z.object({
                header: z.string().optional(),
                expectedHeaderVersion: z.number().int().min(0).optional(),
                body: z.string().optional(),
                expectedBodyVersion: z.number().int().min(0).optional()
            }),
            response: {
                200: z.object({
                    success: z.literal(true),
                    headerVersion: z.number().optional(),
                    bodyVersion: z.number().optional()
                }),
                404: z.object({
                    error: z.literal('Artifact not found')
                }),
                409: z.object({
                    success: z.literal(false),
                    error: z.literal('version-mismatch'),
                    currentHeaderVersion: z.number().optional(),
                    currentBodyVersion: z.number().optional(),
                    currentHeader: z.string().optional(),
                    currentBody: z.string().optional()
                }),
                500: z.object({
                    error: z.literal('Failed to update artifact')
                })
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;
        const { header, expectedHeaderVersion, body, expectedBodyVersion } = request.body;

        try {
            // A field counts as "provided" only when both its data and its
            // expected version are present; delegate the CAS to the deep module.
            const headerArg =
                header !== undefined && expectedHeaderVersion !== undefined
                    ? { data: header, expectedVersion: expectedHeaderVersion }
                    : undefined;
            const bodyArg =
                body !== undefined && expectedBodyVersion !== undefined
                    ? { data: body, expectedVersion: expectedBodyVersion }
                    : undefined;

            const result = await artifactVersionedUpdate({
                artifactId: id,
                userId,
                header: headerArg,
                body: bodyArg,
            });

            if (!result.applied) {
                if (result.reason === 'not-found') {
                    return reply.code(404).send({ error: 'Artifact not found' });
                }
                return reply.code(409).send({
                    success: false,
                    error: 'version-mismatch',
                    ...(result.header && {
                        currentHeaderVersion: result.header.currentVersion,
                        currentHeader: result.header.currentData,
                    }),
                    ...(result.body && {
                        currentBodyVersion: result.body.currentVersion,
                        currentBody: result.body.currentData,
                    }),
                });
            }

            // Emit update-artifact event
            const headerUpdate = result.headerVersion !== undefined && headerArg
                ? { value: headerArg.data, version: result.headerVersion }
                : undefined;
            const bodyUpdate = result.bodyVersion !== undefined && bodyArg
                ? { value: bodyArg.data, version: result.bodyVersion }
                : undefined;
            await emitSyncUpdate(userId, {
                t: "update-artifact",
                artifactId: id,
                header: headerUpdate,
                body: bodyUpdate,
            });

            return reply.send({
                success: true,
                ...(headerUpdate && { headerVersion: headerUpdate.version }),
                ...(bodyUpdate && { bodyVersion: bodyUpdate.version })
            });
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to update artifact: ${error}`);
            return reply.code(500).send({ error: 'Failed to update artifact' });
        }
    });

    // DELETE /v1/artifacts/:id - Delete artifact
    app.delete('/v1/artifacts/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string()
            }),
            response: {
                200: z.object({
                    success: z.literal(true)
                }),
                404: z.object({
                    error: z.literal('Artifact not found')
                }),
                500: z.object({
                    error: z.literal('Failed to delete artifact')
                })
            }
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id } = request.params;

        try {
            await assertOwnedArtifact(userId, id);

            // Delete artifact
            await db.artifact.delete({
                where: { id }
            });

            // Broadcast delete-artifact. Seam owns seq + id + recipient (ADR-0023).
            await emitSyncUpdate(userId, { t: "delete-artifact", artifactId: id });

            return reply.send({ success: true });
        } catch (error) {
            log({ module: 'api', level: 'error' }, `Failed to delete artifact: ${error}`);
            return reply.code(500).send({ error: 'Failed to delete artifact' });
        }
    });
}