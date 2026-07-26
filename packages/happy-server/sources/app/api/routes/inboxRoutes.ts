import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { apiError } from "../utils/apiError";

const InboxCategorySchema = z.enum([
    "task", "trigger", "supervisor", "session", "system", "decision",
]);

function serializeInboxItem(item: {
    id: string;
    category: string;
    eventType: string;
    severity: string;
    title: string;
    body: string | null;
    read: boolean;
    referenceUrl: string | null;
    refType: string | null;
    refId: string | null;
    groupKey: string | null;
    createdAt: Date;
}) {
    return {
        id: item.id,
        category: item.category,
        eventType: item.eventType,
        severity: item.severity,
        title: item.title,
        body: item.body ?? undefined,
        read: item.read,
        referenceUrl: item.referenceUrl ?? undefined,
        refType: item.refType ?? undefined,
        refId: item.refId ?? undefined,
        groupKey: item.groupKey ?? undefined,
        createdAt: item.createdAt.getTime(),
    };
}

export function inboxRoutes(app: Fastify) {
    // GET /v1/inbox — List inbox items (paginated)
    app.get(
        "/v1/inbox",
        {
            preHandler: app.authenticate,
            schema: {
                querystring: z.object({
                    category: InboxCategorySchema.optional(),
                    read: z.enum(["true", "false"]).optional(),
                    limit: z.coerce.number().int().min(1).max(100).default(50),
                    offset: z.coerce.number().int().min(0).default(0),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { category, read, limit, offset } = request.query;

            const where: Record<string, unknown> = { accountId: userId };
            if (category) where.category = category;
            if (read !== undefined) where.read = read === "true";

            const [items, total] = await Promise.all([
                db.inboxItem.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    skip: offset,
                }),
                db.inboxItem.count({ where }),
            ]);

            return reply.send({
                items: items.map(serializeInboxItem),
                total,
            });
        },
    );

    // GET /v1/inbox/count — Unread count
    app.get(
        "/v1/inbox/count",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const count = await db.inboxItem.count({
                where: { accountId: request.userId, read: false },
            });
            return reply.send({ count });
        },
    );

    // POST /v1/inbox/:id/read — Mark single item as read
    app.post(
        "/v1/inbox/:id/read",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;

            const item = await db.inboxItem.findFirst({
                where: { id, accountId: userId },
            });
            if (!item) {
                return reply.status(404).send(apiError('not-found', 'Item not found'));
            }

            await db.inboxItem.update({
                where: { id },
                data: { read: true },
            });

            return reply.send({ ok: true });
        },
    );

    // POST /v1/inbox/read-all — Mark all items as read
    app.post(
        "/v1/inbox/read-all",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = request.userId;

            await db.inboxItem.updateMany({
                where: { accountId: userId, read: false },
                data: { read: true },
            });

            return reply.send({ ok: true });
        },
    );

    // DELETE /v1/inbox/:id — Delete single item
    app.delete(
        "/v1/inbox/:id",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { id } = request.params;

            const item = await db.inboxItem.findFirst({
                where: { id, accountId: userId },
            });
            if (!item) {
                return reply.status(404).send(apiError('not-found', 'Item not found'));
            }

            await db.inboxItem.delete({ where: { id } });

            return reply.send({ ok: true });
        },
    );

    // DELETE /v1/inbox — Delete all items for current account (idempotent)
    app.delete(
        "/v1/inbox",
        { preHandler: app.authenticate },
        async (request, reply) => {
            const userId = request.userId;

            const result = await db.inboxItem.deleteMany({
                where: { accountId: userId },
            });

            return reply.send({ ok: true, deleted: result.count });
        },
    );
}
