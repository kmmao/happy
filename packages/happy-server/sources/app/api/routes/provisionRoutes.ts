import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import tweetnacl from "tweetnacl";
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
                ttlHours: z.number().int().min(1).max(8760).default(72),
                webappUrl: z.string().max(2000).nullish(),
                ttydUrl: z.string().max(2000).nullish(),
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
        const adminAccountId = request.userId;
        const { label, ttlHours, webappUrl, ttydUrl } = request.body;

        // Create a NEW independent account for this container
        const secret = new Uint8Array(randomBytes(32));
        const keypair = tweetnacl.box.keyPair.fromSecretKey(secret);
        const publicKeyHex = Buffer.from(keypair.publicKey).toString("hex");

        const newAccount = await db.account.create({
            data: { publicKey: publicKeyHex },
        });

        // Generate bearer token for the NEW account (not admin's)
        const bearerToken = await auth.createToken(newAccount.id, { provision: true });
        const tokenHash = hashToken(bearerToken);
        const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

        // Store provision record under admin (for management)
        const record = await db.provisionToken.create({
            data: {
                accountId: adminAccountId,
                label: label ?? null,
                tokenHash,
                webappUrl: webappUrl ?? null,
                ttydUrl: ttydUrl ?? null,
            },
        });

        // Pack token with the account secret (so CLI/webapp can encrypt/decrypt)
        const secretBase64 = Buffer.from(secret).toString("base64");
        const packed = Buffer.from(JSON.stringify({
            t: bearerToken,
            s: secretBase64,
            x: expiresAt.toISOString(),
        })).toString("base64url");

        const provisionToken = `hp_${packed}`;

        log({ module: "provision" }, `Created provision token ${record.id} (new account ${newAccount.id}) by admin ${adminAccountId}`);

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
                    webappUrl: z.string().nullable(),
                    ttydUrl: z.string().nullable(),
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
            webappUrl: t.webappUrl,
            ttydUrl: t.ttydUrl,
            revokedAt: t.revokedAt?.toISOString() ?? null,
            createdAt: t.createdAt.toISOString(),
        })));
    });

    // Update URLs on an existing provision token
    app.patch('/v1/provision/:id', {
        preHandler: app.authenticate,
        schema: {
            params: z.object({ id: z.string() }),
            body: z.object({
                webappUrl: z.string().max(2000).nullish(),
                ttydUrl: z.string().max(2000).nullish(),
            }),
            response: {
                200: z.object({ success: z.literal(true) }),
                404: z.object({ error: z.string() }),
            },
        },
    }, async (request, reply) => {
        const { id } = request.params;
        const { webappUrl, ttydUrl } = request.body;

        const token = await db.provisionToken.findFirst({
            where: { id, accountId: request.userId },
        });
        if (!token) {
            return reply.code(404).send({ error: "Token not found" });
        }

        await db.provisionToken.update({
            where: { id },
            data: {
                ...(webappUrl !== undefined ? { webappUrl } : {}),
                ...(ttydUrl !== undefined ? { ttydUrl } : {}),
            },
        });

        return reply.send({ success: true });
    });

    // Revoke or delete a provision token
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
            await db.provisionToken.delete({ where: { id } });
            log({ module: "provision" }, `Deleted provision token ${id} for account ${accountId}`);
        } else {
            await db.provisionToken.update({
                where: { id },
                data: { revokedAt: new Date() },
            });
            log({ module: "provision" }, `Revoked provision token ${id} for account ${accountId}`);
        }

        return reply.send({ success: true });
    });
}
