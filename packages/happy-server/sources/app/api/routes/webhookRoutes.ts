import { z } from "zod";
import { type Fastify } from "../types";
import { log } from "@/utils/log";
import { db } from "@/storage/db";
import { encryptString, decryptString } from "@/modules/encrypt";
import { dispatchWebhook } from "@/app/webhook/webhookDispatch";
import {
    ensureRemoteWebhook,
    deleteRemoteWebhook,
} from "@/app/webhook/webhookProviderApi";

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
      const headers = request.headers as Record<string, string | undefined>;

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
        take: 1000,
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
          apiToken: z.string().optional(),
          labels: z.array(z.string()),
          authors: z.array(z.string()),
          machineId: z.string().min(1),
          repoPath: z.string().min(1),
          enabled: z.boolean().default(true),
          callbackUrl: z.string().url().optional(),
        }),
        response: {
          200: z.object({
            id: z.string(),
            repoUrl: z.string(),
            remoteWebhookId: z.string().nullable(),
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
        apiToken?: string;
        labels: string[];
        authors: string[];
        machineId: string;
        repoPath: string;
        enabled: boolean;
        callbackUrl?: string;
      };

      const normalizedUrl = body.repoUrl
        .replace(/\.git$/, "")
        .replace(/\/+$/, "")
        .toLowerCase();

      const encryptedSecret = encryptString(
        ["webhook-route", `${userId}:${normalizedUrl}`],
        body.webhookSecret,
      );

      const encryptedApiToken = body.apiToken
        ? encryptString(
            ["webhook-route-token", `${userId}:${normalizedUrl}`],
            body.apiToken,
          )
        : undefined;

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
          apiToken: encryptedApiToken
            ? Buffer.from(encryptedApiToken)
            : undefined,
          labels: body.labels.map((l) => l.trim().toLowerCase()),
          authors: body.authors.map((a) => a.trim().toLowerCase()),
          machineId: body.machineId,
          repoPath: body.repoPath,
          enabled: body.enabled,
        },
        update: {
          provider: body.provider,
          webhookSecret: Buffer.from(encryptedSecret),
          apiToken: encryptedApiToken
            ? Buffer.from(encryptedApiToken)
            : undefined,
          labels: body.labels.map((l) => l.trim().toLowerCase()),
          authors: body.authors.map((a) => a.trim().toLowerCase()),
          machineId: body.machineId,
          repoPath: body.repoPath,
          enabled: body.enabled,
        },
      });

      // Auto-create/update webhook on the Git platform (best-effort)
      let remoteWebhookId = route.remoteWebhookId;
      if (body.callbackUrl && body.apiToken && body.enabled) {
        remoteWebhookId = await ensureRemoteWebhook(
          body.provider,
          normalizedUrl,
          body.apiToken,
          body.webhookSecret,
          body.callbackUrl,
          route.remoteWebhookId,
        );
        if (remoteWebhookId !== route.remoteWebhookId) {
          await db.webhookRoute.update({
            where: { id: route.id },
            data: { remoteWebhookId },
          });
        }
      }

      reply.send({ id: route.id, repoUrl: route.repoUrl, remoteWebhookId: remoteWebhookId ?? null });
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

      // Delete remote webhook from Git platform (best-effort)
      if (route.remoteWebhookId && route.apiToken) {
        const apiToken = decryptString(
          ["webhook-route-token", `${route.accountId}:${route.repoUrl}`],
          route.apiToken as unknown as Uint8Array<ArrayBuffer>,
        );
        await deleteRemoteWebhook(
          route.provider,
          route.repoUrl,
          apiToken,
          route.remoteWebhookId,
        );
      }

      await db.webhookRoute.delete({ where: { id } });
      reply.send({ deleted: true });
    },
  );

  // ── List webhook events ─────────────────────────────────

  app.get(
    "/v1/webhooks/events",
    {
      preHandler: app.authenticate,
      schema: {
        querystring: z
          .object({
            projectId: z.string().optional(),
            limit: z.coerce.number().int().min(1).max(100).default(20),
            offset: z.coerce.number().int().min(0).default(0),
          })
          .optional(),
      },
    },
    async (request, reply) => {
      const userId = request.userId;
      const limit = request.query?.limit ?? 20;
      const offset = request.query?.offset ?? 0;
      const projectId = request.query?.projectId;

      // Build where clause
      const where: { accountId: string; repoUrl?: string } = {
        accountId: userId,
      };

      // If projectId given, find project's repoUrl to filter
      if (projectId) {
        const project = await db.project.findFirst({
          where: { id: projectId, accountId: userId },
          select: { repoUrl: true },
        });
        if (project?.repoUrl) {
          where.repoUrl = project.repoUrl;
        }
        // If project has no repoUrl, fall through to show all events
      }

      const [events, total] = await Promise.all([
        db.webhookEvent.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
        }),
        db.webhookEvent.count({ where }),
      ]);

      reply.send({
        events: events.map((e) => ({
          id: e.id,
          provider: e.provider,
          repoUrl: e.repoUrl,
          issueNumber: e.issueNumber,
          issueTitle: e.issueTitle,
          issueUrl: e.issueUrl,
          status: e.status,
          errorMessage: e.errorMessage,
          createdAt: e.createdAt.getTime(),
        })),
        total,
      });
    },
  );
}
