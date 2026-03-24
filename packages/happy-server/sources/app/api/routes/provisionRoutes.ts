import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { auth } from "@/app/auth/auth";
import { log } from "@/utils/log";

function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export function provisionRoutes(app: Fastify) {
    // Create a new provision token
    app.post('/v1/provision', {
        preHandler: app.authenticate,
        schema: {
            body: z.object({
                label: z.string().max(200).nullish(),
                ttlHours: z.number().int().min(1).max(8760).default(72), // max 1 year
            }),
            response: {
                200: z.object({
                    id: z.string(),
                    provisionToken: z.string(),
                    expiresAt: z.string(),
                }),
            },
        },
    }, async (request, reply) => {
        const accountId = request.userId;
        const { label, ttlHours } = request.body;

        // Generate a new bearer token for this account
        const bearerToken = await auth.createToken(accountId, { provision: true });

        // Store hash only (never store the actual bearer token)
        const tokenHash = hashToken(bearerToken);
        const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

        const record = await db.provisionToken.create({
            data: {
                accountId,
                label: label ?? null,
                tokenHash,
            },
        });

        // Package: bearer token is the provision token itself
        // CLI will decode and use it directly as credentials
        const packed = Buffer.from(JSON.stringify({
            t: bearerToken,
            x: expiresAt.toISOString(),
        })).toString("base64url");

        const provisionToken = `hp_${packed}`;

        log({ module: "provision" }, `Created provision token ${record.id} for account ${accountId}`);

        return reply.send({
            id: record.id,
            provisionToken,
            expiresAt: expiresAt.toISOString(),
        });
    });

    // List provision tokens for the current account
    app.get('/v1/provision', {
        preHandler: app.authenticate,
        schema: {
            response: {
                200: z.array(z.object({
                    id: z.string(),
                    label: z.string().nullable(),
                    revokedAt: z.string().nullable(),
                    createdAt: z.string(),
                })),
            },
        },
    }, async (request, reply) => {
        const tokens = await db.provisionToken.findMany({
            where: { accountId: request.userId },
            orderBy: { createdAt: "desc" },
            take: 100,
        });

        return reply.send(tokens.map(t => ({
            id: t.id,
            label: t.label,
            revokedAt: t.revokedAt?.toISOString() ?? null,
            createdAt: t.createdAt.toISOString(),
        })));
    });

    // Revoke a provision token
    app.delete('/v1/provision/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({
                id: z.string(),
            }),
            response: {
                200: z.object({ success: z.literal(true) }),
                404: z.object({ error: z.string() }),
            },
        },
    }, async (request, reply) => {
        const { id } = request.params;
        const accountId = request.userId;

        const token = await db.provisionToken.findFirst({
            where: { id, accountId },
        });

        if (!token) {
            return reply.code(404).send({ error: "Token not found" });
        }

        if (token.revokedAt) {
            // Already revoked — delete permanently
            await db.provisionToken.delete({ where: { id } });
            log({ module: "provision" }, `Deleted provision token ${id} for account ${accountId}`);
        } else {
            // First call — revoke (soft delete)
            await db.provisionToken.update({
                where: { id },
                data: { revokedAt: new Date() },
            });
            log({ module: "provision" }, `Revoked provision token ${id} for account ${accountId}`);
        }

        return reply.send({ success: true });
    });
}
