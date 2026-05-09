import { type Fastify } from "../types";
import { db } from "@/storage/db";
import { z } from "zod";

/**
 * Unified world event feed — aggregates Tasks, InboxItems, SupervisorActions
 * into a single sorted endpoint for the World Shell.
 * SessionEvents are skipped (they require a session join and are already
 * delivered real-time via Socket.IO).
 */

type WorldEventSeverity = "info" | "warning" | "critical";
type WorldEventSourceType = "project" | "machine" | "session" | "trigger" | "agent" | "system";

interface WorldEvent {
    id: string;
    eventType: string;
    title: string;
    summary: string;
    occurredAt: number;
    severity: WorldEventSeverity;
    source: {
        type: WorldEventSourceType;
        projectId?: string | null;
        projectPath?: string | null;
        machineId?: string | null;
        sessionId?: string | null;
    };
    originalId: string;
    parentTaskId?: string | null;
}

function mapSeverity(raw: string): WorldEventSeverity {
    if (raw === "critical" || raw === "high" || raw === "error") return "critical";
    if (raw === "medium" || raw === "warning") return "warning";
    return "info";
}

function taskEventType(status: string, triggerType?: string): string {
    const prefix = (triggerType === "cron" || triggerType === "webhook")
        ? `trigger.${triggerType}`
        : "task";
    switch (status) {
        case "queued":
        case "dispatching":
            return `${prefix}.queued`;
        case "running":
            return `${prefix}.running`;
        case "completed":
            return `${prefix}.completed`;
        case "failed":
            return `${prefix}.failed`;
        case "cancelled":
            return `${prefix}.cancelled`;
        default:
            return `${prefix}.updated`;
    }
}

function taskSeverity(status: string): WorldEventSeverity {
    if (status === "failed") return "critical";
    return "info";
}

export function worldEventRoutes(app: Fastify) {
    app.get(
        "/v1/world/events",
        {
            preHandler: app.authenticate,
            schema: {
                querystring: z.object({
                    projectId: z.string().optional(),
                    machineId: z.string().optional(),
                    eventType: z.string().optional(),
                    severity: z.enum(["info", "warning", "critical"]).optional(),
                    limit: z.coerce.number().int().min(1).max(200).default(100),
                    offset: z.coerce.number().int().min(0).default(0),
                }),
            },
        },
        async (request, reply) => {
            const userId = request.userId;
            const { projectId, machineId, severity, limit, offset } = request.query;
            const eventTypePrefix = request.query.eventType;

            // Task filter
            const taskWhere: Record<string, unknown> = { accountId: userId };
            if (projectId) taskWhere.projectId = projectId;
            if (machineId) taskWhere.machineId = machineId;

            // InboxItem filter
            const inboxWhere: Record<string, unknown> = { accountId: userId };
            if (projectId) {
                inboxWhere.refType = "project";
                inboxWhere.refId = projectId;
            }

            // SupervisorAction filter
            const actionWhere: Record<string, unknown> = { accountId: userId };
            if (projectId) actionWhere.projectId = projectId;

            // Knowledge filter (via project.accountId join)
            const knowledgeWhere: Record<string, unknown> = {
                project: { accountId: userId },
                status: "active",
            };
            if (projectId) knowledgeWhere.projectId = projectId;

            // Parallel fetch — each source capped at limit to bound memory
            const [tasks, inboxItems, supervisorActions, knowledgeEntries] = await Promise.all([
                db.task.findMany({
                    where: taskWhere,
                    orderBy: { updatedAt: "desc" },
                    take: limit,
                    select: {
                        id: true,
                        status: true,
                        title: true,
                        prompt: true,
                        projectId: true,
                        machineId: true,
                        sessionId: true,
                        triggerType: true,
                        directory: true,
                        parentTaskId: true,
                        updatedAt: true,
                        completedAt: true,
                    },
                }),
                db.inboxItem.findMany({
                    where: inboxWhere,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    select: {
                        id: true,
                        eventType: true,
                        severity: true,
                        title: true,
                        body: true,
                        refType: true,
                        refId: true,
                        createdAt: true,
                    },
                }),
                db.supervisorAction.findMany({
                    where: actionWhere,
                    orderBy: { createdAt: "desc" },
                    take: limit,
                    select: {
                        id: true,
                        title: true,
                        description: true,
                        severity: true,
                        projectId: true,
                        createdAt: true,
                    },
                }),
                db.projectKnowledge.findMany({
                    where: knowledgeWhere,
                    orderBy: { createdAt: "desc" },
                    take: Math.min(limit, 20), // cap knowledge entries separately
                    select: {
                        id: true,
                        entryType: true,
                        tags: true,
                        projectId: true,
                        confidence: true,
                        createdAt: true,
                    },
                }),
            ]);

            const events: WorldEvent[] = [];

            for (const task of tasks) {
                events.push({
                    id: `task-${task.id}`,
                    originalId: task.id,
                    eventType: taskEventType(task.status, task.triggerType),
                    title: task.title ?? task.prompt.slice(0, 80),
                    summary: task.status,
                    occurredAt: (task.completedAt ?? task.updatedAt).getTime(),
                    severity: taskSeverity(task.status),
                    source: {
                        type: task.projectId ? "project" : "machine",
                        projectId: task.projectId,
                        projectPath: task.directory ?? null,
                        machineId: task.machineId,
                        sessionId: task.sessionId,
                    },
                    parentTaskId: task.parentTaskId ?? null,
                });
            }

            for (const item of inboxItems) {
                events.push({
                    id: `inbox-${item.id}`,
                    originalId: item.id,
                    eventType: `decision.${item.eventType}`,
                    title: item.title,
                    summary: item.body ?? "",
                    occurredAt: item.createdAt.getTime(),
                    severity: mapSeverity(item.severity),
                    source: {
                        type: item.refType === "project" ? "project" : "system",
                        projectId: item.refType === "project" ? item.refId : null,
                    },
                });
            }

            for (const action of supervisorActions) {
                events.push({
                    id: `supervisor-${action.id}`,
                    originalId: action.id,
                    eventType: "supervisor.action_found",
                    title: action.title,
                    summary: action.description,
                    occurredAt: action.createdAt.getTime(),
                    severity: mapSeverity(action.severity),
                    source: {
                        type: "project",
                        projectId: action.projectId,
                    },
                });
            }

            for (const entry of knowledgeEntries) {
                // title is encrypted — use entryType + tags as a human-readable label
                let tags: string[] = [];
                try { tags = JSON.parse(entry.tags) as string[]; } catch { /* empty */ }
                const label = tags.length > 0
                    ? `${entry.entryType}: ${tags.slice(0, 3).join(", ")}`
                    : entry.entryType;
                events.push({
                    id: `memory-${entry.id}`,
                    originalId: entry.id,
                    eventType: "memory.created",
                    title: label,
                    summary: `${entry.entryType} · ${entry.confidence}`,
                    occurredAt: entry.createdAt.getTime(),
                    severity: "info",
                    source: {
                        type: "project",
                        projectId: entry.projectId,
                    },
                });
            }

            // Sort by time descending
            events.sort((a, b) => b.occurredAt - a.occurredAt);

            // Apply eventType prefix filter
            const afterType = eventTypePrefix
                ? events.filter((e) => e.eventType.startsWith(eventTypePrefix))
                : events;

            // Apply severity filter
            const afterSeverity = severity
                ? afterType.filter((e) => e.severity === severity)
                : afterType;

            const total = afterSeverity.length;
            const page = afterSeverity.slice(offset, offset + limit);

            return reply.send({ events: page, total });
        },
    );
}
