import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { assertOwnedSession } from "../ownership";

const SessionEventTypeSchema = z.enum([
    "file_edit", "bash_command", "tool_call", "git_operation",
    "error", "session_start", "session_end",
]);

function serializeSessionEvent(event: {
    id: string;
    sessionId: string;
    eventType: string;
    summary: string;
    detail: unknown;
    createdAt: Date;
}) {
    return {
        id: event.id,
        sessionId: event.sessionId,
        eventType: event.eventType,
        summary: event.summary,
        detail: event.detail ?? undefined,
        createdAt: event.createdAt.getTime(),
    };
}

/**
 * Session timeline event routes — list events for a session.
 * Events are reported by CLI daemons via socket (plaintext metadata).
 */
export function sessionEventRoutes(app: Fastify) {
    // GET /v1/sessions/:sessionId/events — List timeline events
    app.get(
        "/v1/sessions/:sessionId/events",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ sessionId: z.string() }),
                querystring: z.object({
                    eventType: SessionEventTypeSchema.optional(),
                    limit: z.coerce.number().int().min(1).max(200).default(100),
                    offset: z.coerce.number().int().min(0).default(0),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { sessionId } = request.params;
            const { eventType, limit, offset } = request.query;

            await assertOwnedSession(userId, sessionId);

            const where: Record<string, unknown> = { sessionId };
            if (eventType) where.eventType = eventType;

            const [events, total] = await Promise.all([
                db.sessionEvent.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    skip: offset,
                }),
                db.sessionEvent.count({ where }),
            ]);

            return reply.send({
                events: events.map(serializeSessionEvent),
                total,
            });
        },
    );
}
