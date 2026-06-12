import { emitSyncUpdate } from "@/app/events/syncUpdate";
import { Fastify } from "../types";
import { z } from "zod";
import { db } from "@/storage/db";
import { log } from "@/utils/log";
import { ownedMachine } from "../ownership";

export function machinesRoutes(app: Fastify) {
    app.post('/v1/machines', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                id: z.string(),
                metadata: z.string(), // Encrypted metadata
                daemonState: z.string().optional(), // Encrypted daemon state
                dataEncryptionKey: z.string().nullish()
            })
        }
    }, async (request, reply) => {
        const userId = request.userId;
        const { id, metadata, daemonState, dataEncryptionKey } = request.body;

        // Check if machine exists (like sessions do)
        const machine = await db.machine.findFirst({
            where: {
                accountId: userId,
                id: id
            }
        });

        if (machine) {
            // Machine exists - just return it
            log({ module: 'machines', machineId: id, userId }, 'Found existing machine');
            return reply.send({
                machine: {
                    id: machine.id,
                    metadata: machine.metadata,
                    metadataVersion: machine.metadataVersion,
                    daemonState: machine.daemonState,
                    daemonStateVersion: machine.daemonStateVersion,
                    dataEncryptionKey: machine.dataEncryptionKey ? Buffer.from(machine.dataEncryptionKey).toString('base64') : null,
                    active: machine.active,
                    activeAt: machine.lastActiveAt.getTime(),  // Return as activeAt for API consistency
                    createdAt: machine.createdAt.getTime(),
                    updatedAt: machine.updatedAt.getTime()
                }
            });
        } else {
            // Create new machine
            log({ module: 'machines', machineId: id, userId }, 'Creating new machine');

            const newMachine = await db.machine.create({
                data: {
                    id,
                    accountId: userId,
                    metadata,
                    metadataVersion: 1,
                    daemonState: daemonState || null,
                    daemonStateVersion: daemonState ? 1 : 0,
                    dataEncryptionKey: dataEncryptionKey ? new Uint8Array(Buffer.from(dataEncryptionKey, 'base64')) : undefined,
                    // Default to offline - in case the user does not start daemon
                    active: false,
                    // lastActiveAt and activeAt defaults to now() in schema
                }
            });

            // Emit both new-machine and update-machine events for backward
            // compatibility. Two SyncUpdates, two seqs — each emitSyncUpdate
            // call owns its own seq allocation (ADR-0023). Recipient is
            // derived from body.t: new-machine -> user-scoped-only;
            // update-machine -> machine-scoped-only.
            await emitSyncUpdate(userId, { t: "new-machine", machine: newMachine });
            await emitSyncUpdate(userId, {
                t: "update-machine",
                machineId: newMachine.id,
                metadata: { value: metadata, version: 1 },
            });

            return reply.send({
                machine: {
                    id: newMachine.id,
                    metadata: newMachine.metadata,
                    metadataVersion: newMachine.metadataVersion,
                    daemonState: newMachine.daemonState,
                    daemonStateVersion: newMachine.daemonStateVersion,
                    dataEncryptionKey: newMachine.dataEncryptionKey ? Buffer.from(newMachine.dataEncryptionKey).toString('base64') : null,
                    active: newMachine.active,
                    activeAt: newMachine.lastActiveAt.getTime(),  // Return as activeAt for API consistency
                    createdAt: newMachine.createdAt.getTime(),
                    updatedAt: newMachine.updatedAt.getTime()
                }
            });
        }
    });


    // Machines API
    app.get('/v1/machines', {
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

        const rows = await db.machine.findMany({
            where: { accountId: userId },
            orderBy: { lastActiveAt: 'desc' },
            take: limit + 1,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
        });

        const hasNextPage = rows.length > limit;
        const machines = hasNextPage ? rows.slice(0, limit) : rows;
        const nextCursor = hasNextPage ? machines[machines.length - 1].id : null;

        return reply.send({
            machines: machines.map(m => ({
                id: m.id,
                metadata: m.metadata,
                metadataVersion: m.metadataVersion,
                daemonState: m.daemonState,
                daemonStateVersion: m.daemonStateVersion,
                dataEncryptionKey: m.dataEncryptionKey ? Buffer.from(m.dataEncryptionKey).toString('base64') : null,
                seq: m.seq,
                active: m.active,
                activeAt: m.lastActiveAt.getTime(),
                createdAt: m.createdAt.getTime(),
                updatedAt: m.updatedAt.getTime()
            })),
            nextCursor
        });
    });

    // GET /v1/machines/:id - Get single machine by ID
    app.get('/v1/machines/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string()
            })
        }
    }, async (request) => {
        const userId = request.userId;
        const { id } = request.params;

        const machine = await ownedMachine(userId, id);

        return {
            machine: {
                id: machine.id,
                metadata: machine.metadata,
                metadataVersion: machine.metadataVersion,
                daemonState: machine.daemonState,
                daemonStateVersion: machine.daemonStateVersion,
                dataEncryptionKey: machine.dataEncryptionKey ? Buffer.from(machine.dataEncryptionKey).toString('base64') : null,
                seq: machine.seq,
                active: machine.active,
                activeAt: machine.lastActiveAt.getTime(),
                createdAt: machine.createdAt.getTime(),
                updatedAt: machine.updatedAt.getTime()
            }
        };
    });

}