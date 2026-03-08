import { z } from "zod";
import { type Fastify } from "../types";
import { log } from "@/utils/log";
import { db } from "@/storage/db";
import { encryptString, decryptString } from "@/modules/encrypt";
import { dispatchWebhook } from "@/app/webhook/webhookDispatch";

export function webhookRoutes(app: Fastify) {
    // ── Receive webhook from GitHub/Gitea/GitLab ────────────
    // No JWT auth — verified by webhook signature instead.

    app.post(
        "/v1/webhooks/:provider",
        {
            schema: {
                params: z.object({
                    provider: z.enum(["github", "gitea", "gitlab"]),
                }),
                response: {
                    200: z.object({ received: z.boolean() }),
                },
            },
        },
        async (request, reply) => {
            const { provider } = request.params as { provider: string };
            const rawBody = (request as any).rawBody as string;
            const headers = request.headers as Record<
                string,
                string | undefined
            >;

            try {
                const result = await dispatchWebhook(
                    provider,
                    rawBody,
                    headers,
                    request.body,
                );
                log(
                    { module: "webhook" },
                    `Webhook ${provider}: dispatched=${result.dispatched}, reason=${result.reason ?? "ok"}`,
                );
            } catch (error) {
                log(
                    { module: "webhook", level: "error" },
                    `Webhook ${provider} error: ${error}`,
                );
            }

            // Always return 200 to avoid leaking info
            reply.send({ received: true });
        },
    );

    // ── List webhook routes for current user ────────────────

    app.get(
        "/v1/webhooks/routes",
        {
            preHandler: app.authenticate,
            schema: {
                response: {
                    200: z.array(
                        z.object({
                            id: z.string(),
                            provider: z.string(),
                            repoUrl: z.string(),
                            labels: z.array(z.string()),
                            authors: z.array(z.string()),
                            machineId: z.string(),
                            repoPath: z.string(),
                            enabled: z.boolean(),
                            createdAt: z.string(),
                        }),
                    ),
                },
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const routes = await db.webhookRoute.findMany({
                where: { accountId: userId },
                orderBy: { createdAt: "desc" },
            });

            reply.send(
                routes.map((r) => ({
                    id: r.id,
                    provider: r.provider,
                    repoUrl: r.repoUrl,
                    labels: r.labels,
                    authors: r.authors,
                    machineId: r.machineId,
                    repoPath: r.repoPath,
                    enabled: r.enabled,
                    createdAt: r.createdAt.toISOString(),
                })),
            );
        },
    );

    // ── Create or update a webhook route ────────────────────

    app.post(
        "/v1/webhooks/routes",
        {
            preHandler: app.authenticate,
            schema: {
                body: z.object({
                    provider: z.enum(["github", "gitea", "gitlab"]),
                    repoUrl: z.string().url(),
                    webhookSecret: z.string().min(1),
                    labels: z.array(z.string()).min(1),
                    authors: z.array(z.string()).min(1),
                    machineId: z.string().min(1),
                    repoPath: z.string().min(1),
                    enabled: z.boolean().default(true),
                }),
                response: {
                    200: z.object({
                        id: z.string(),
                        repoUrl: z.string(),
                    }),
                },
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const body = request.body as {
                provider: string;
                repoUrl: string;
                webhookSecret: string;
                labels: string[];
                authors: string[];
                machineId: string;
                repoPath: string;
                enabled: boolean;
            };

            const normalizedUrl = body.repoUrl
                .replace(/\.git$/, "")
                .replace(/\/+$/, "")
                .toLowerCase();

            const encryptedSecret = encryptString(
                ["webhook-route", `${userId}:${normalizedUrl}`],
                body.webhookSecret,
            );

            const route = await db.webhookRoute.upsert({
                where: {
                    accountId_repoUrl: {
                        accountId: userId,
                        repoUrl: normalizedUrl,
                    },
                },
                create: {
                    accountId: userId,
                    provider: body.provider,
                    repoUrl: normalizedUrl,
                    webhookSecret: Buffer.from(encryptedSecret),
                    labels: body.labels.map((l) =>
                        l.trim().toLowerCase(),
                    ),
                    authors: body.authors.map((a) =>
                        a.trim().toLowerCase(),
                    ),
                    machineId: body.machineId,
                    repoPath: body.repoPath,
                    enabled: body.enabled,
                },
                update: {
                    provider: body.provider,
                    webhookSecret: Buffer.from(encryptedSecret),
                    labels: body.labels.map((l) =>
                        l.trim().toLowerCase(),
                    ),
                    authors: body.authors.map((a) =>
                        a.trim().toLowerCase(),
                    ),
                    machineId: body.machineId,
                    repoPath: body.repoPath,
                    enabled: body.enabled,
                },
            });

            reply.send({ id: route.id, repoUrl: route.repoUrl });
        },
    );

    // ── Delete a webhook route ──────────────────────────────

    app.delete(
        "/v1/webhooks/routes/:id",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({
                    id: z.string(),
                }),
                response: {
                    200: z.object({ deleted: z.boolean() }),
                    404: z.object({ error: z.string() }),
                },
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params as { id: string };

            const route = await db.webhookRoute.findFirst({
                where: { id, accountId: userId },
            });
            if (!route) {
                return reply.code(404).send({ error: "Route not found" });
            }

            await db.webhookRoute.delete({ where: { id } });
            reply.send({ deleted: true });
        },
    );
}
