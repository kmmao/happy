import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";
import { log } from "@/utils/log";
import { decisionCreate } from "@/modules/decisionCreate";
import { inboxCreate } from "@/modules/inboxCreate";
import {
    eventRouter,
    buildAgentMessageEphemeral,
} from "@/app/events/eventRouter";

const MsgTypeSchema = z.enum(["request", "report", "conflict", "law_suggestion"]);

const CreateMessageBodySchema = z.object({
    fromRole: z.string().min(1).max(200),
    toRole: z.string().max(200).optional(),
    msgType: MsgTypeSchema,
    content: z.string().min(1).max(10000),
    sessionId: z.string().optional(),
});

const UserWritableMessageStatusSchema = z.enum(["unread", "read"]);

const QueryMessagesSchema = z.object({
    msgType: MsgTypeSchema.optional(),
    status: z.enum(["unread", "read", "resolved"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
});


/**
 * AgentMessage CRUD — inter-agent communication records.
 */
export function agentMessageRoutes(app: Fastify) {
    // POST /v1/projects/:id/agent-messages — create a message
    app.post(
        "/v1/projects/:id/agent-messages",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                body: CreateMessageBodySchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;

            const project = await db.project.findFirst({
                where: { id: projectId, accountId: userId },
                select: { id: true },
            });
            if (!project) {
                return reply.code(404).send({ error: "Project not found" });
            }

            const { fromRole, toRole, msgType, content, sessionId } = request.body;

            const message = await db.agentMessage.create({
                data: {
                    accountId: userId,
                    projectId,
                    fromRole,
                    toRole: toRole ?? null,
                    msgType,
                    content,
                    sessionId: sessionId ?? null,
                },
            });

            // Emit ephemeral to App
            eventRouter.emitEphemeral({
                userId,
                payload: buildAgentMessageEphemeral({
                    messageId: message.id,
                    projectId,
                    fromRole,
                    toRole: toRole ?? null,
                    msgType,
                }),
                recipientFilter: { type: "user-scoped-only" },
            });

            // Auto-create Decision for conflict messages
            if (msgType === "conflict") {
                const decisionResult = await decisionCreate({
                    accountId: userId,
                    projectId,
                    question: `Agent conflict: ${fromRole}${toRole ? ` → ${toRole}` : ""}: ${content.length > 200 ? content.substring(0, 197) + "..." : content}`,
                    options: JSON.stringify([
                        { id: "resolve_a", description: `Side with ${fromRole}` },
                        { id: "resolve_b", description: toRole ? `Side with ${toRole}` : "Alternative approach" },
                        { id: "dismiss", description: "Dismiss conflict" },
                    ]),
                    context: content,
                    precedentKey: `conflict:${fromRole}:${toRole ?? "broadcast"}`,
                    agentRole: fromRole,
                    sessionId,
                });

                await db.agentMessage.update({
                    where: { id: message.id },
                    data: { decisionId: decisionResult.id },
                });

                log({ module: "agent-message" }, `Conflict escalated to decision ${decisionResult.id}`);
            }

            // Auto-create Decision for law_suggestion messages
            if (msgType === "law_suggestion") {
                const decisionResult = await decisionCreate({
                    accountId: userId,
                    projectId,
                    question: `Law suggestion from ${fromRole}: ${content.length > 150 ? content.substring(0, 147) + "..." : content}`,
                    options: JSON.stringify([
                        { id: "approve", description: "Approve and add to project laws" },
                        { id: "reject", description: "Reject this suggestion" },
                    ]),
                    context: content,
                    precedentKey: `law_suggestion:${fromRole}`,
                    agentRole: fromRole,
                    sessionId,
                });

                await db.agentMessage.update({
                    where: { id: message.id },
                    data: { decisionId: decisionResult.id },
                });

                log({ module: "agent-message" }, `Law suggestion escalated to decision ${decisionResult.id}`);
            }

            // Create InboxItem for conflict and law_suggestion
            if (msgType === "conflict" || msgType === "law_suggestion") {
                void inboxCreate({
                    accountId: userId,
                    category: "agent",
                    eventType: `agent.${msgType}`,
                    severity: msgType === "conflict" ? "warning" : "info",
                    title: msgType === "conflict"
                        ? `Agent conflict: ${fromRole}${toRole ? ` → ${toRole}` : ""}`
                        : `Law suggestion from ${fromRole}`,
                    body: content.length > 200 ? content.substring(0, 197) + "..." : content,
                    referenceUrl: `/project/${projectId}?tab=world`,
                    refType: "agent-message",
                    refId: message.id,
                    groupKey: `agent:${msgType}:${projectId}:${fromRole}`,
                });
            }

            log({ module: "agent-message" }, `Created ${msgType} message from ${fromRole} in project ${projectId}`);

            return reply.code(201).send({ message: serializeMessage(message) });
        },
    );

    // GET /v1/projects/:id/agent-messages — list messages
    app.get(
        "/v1/projects/:id/agent-messages",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string() }),
                querystring: QueryMessagesSchema,
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const projectId = request.params.id;
            const { msgType, status, limit, offset } = request.query;

            const where: Record<string, unknown> = {
                accountId: userId,
                projectId,
            };
            if (msgType) where.msgType = msgType;
            if (status) where.status = status;

            const [messages, total] = await Promise.all([
                db.agentMessage.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    skip: offset,
                }),
                db.agentMessage.count({ where }),
            ]);

            return reply.send({
                messages: messages.map(serializeMessage),
                total,
            });
        },
    );

    // PATCH /v1/projects/:id/agent-messages/:msgId — update status
    app.patch(
        "/v1/projects/:id/agent-messages/:msgId",
        {
            preHandler: app.authenticate,
            schema: {
                params: z.object({ id: z.string(), msgId: z.string() }),
                body: z.object({
                    status: UserWritableMessageStatusSchema,
                }),
            },
        },
        async (request, reply) => {
            const message = await db.agentMessage.findFirst({
                where: {
                    id: request.params.msgId,
                    projectId: request.params.id,
                    accountId: request.userId,
                },
            });
            if (!message) {
                return reply.code(404).send({ error: "Message not found" });
            }

            const updated = await db.agentMessage.update({
                where: { id: message.id },
                data: { status: request.body.status },
            });

            return reply.send({ message: serializeMessage(updated) });
        },
    );
}

// === Serialization ===

function serializeMessage(m: {
    id: string;
    projectId: string;
    fromRole: string;
    toRole: string | null;
    msgType: string;
    content: string;
    status: string;
    sessionId: string | null;
    decisionId: string | null;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: m.id,
        projectId: m.projectId,
        fromRole: m.fromRole,
        toRole: m.toRole,
        msgType: m.msgType,
        content: m.content,
        status: m.status,
        sessionId: m.sessionId,
        decisionId: m.decisionId,
        createdAt: m.createdAt.getTime(),
        updatedAt: m.updatedAt.getTime(),
    };
}
