import type { ServerTask } from "@/sync/apiTasks";
import type { ServerInboxItem } from "@/sync/apiInbox";
import type { SupervisorAction } from "@/sync/apiSupervisor";
import type { ServerSessionEvent } from "@/sync/apiSessionEvents";
// adaptSupervisorActionToEvent and adaptSessionEventToEvent are available for future use
import type { WorldEvent, WorldEventSeverity } from "./worldTypes";

function mapSeverity(raw: string): WorldEventSeverity {
    if (raw === "critical" || raw === "high") return "critical";
    if (raw === "medium" || raw === "warning") return "warning";
    return "info";
}

function mapTaskStatus(status: string): WorldEventSeverity {
    if (status === "failed") return "critical";
    return "info";
}

function taskEventType(status: string, triggerType?: string): string {
    const prefix = (triggerType === "cron" || triggerType === "webhook")
        ? `trigger.${triggerType}`
        : "task";
    switch (status) {
        case "queued": return `${prefix}.queued`;
        case "running": return `${prefix}.running`;
        case "completed": return `${prefix}.completed`;
        case "failed": return `${prefix}.failed`;
        case "cancelled": return `${prefix}.cancelled`;
        default: return `${prefix}.updated`;
    }
}

export function adaptTaskToEvent(task: ServerTask): WorldEvent {
    return {
        id: `task-${task.id}`,
        originalId: task.id,
        eventType: taskEventType(task.status, task.triggerType),
        title: task.title ?? task.promptPreview.slice(0, 80),
        summary: task.status,
        occurredAt: task.updatedAt,
        severity: mapTaskStatus(task.status),
        source: {
            type: task.projectId ? "project" : "machine",
            projectId: task.projectId,
            projectPath: task.directory,
            machineId: task.machineId,
            sessionId: task.sessionId,
        },
        parentTaskId: task.parentTaskId,
    };
}

export function adaptInboxToEvent(item: ServerInboxItem): WorldEvent {
    return {
        id: `inbox-${item.id}`,
        originalId: item.id,
        eventType: `decision.${item.eventType}`,
        title: item.title,
        summary: item.body ?? "",
        occurredAt: item.createdAt,
        severity: mapSeverity(item.severity),
        source: {
            type: item.refType === "project" ? "project" : "system",
            projectId: item.refType === "project" ? item.refId : null,
        },
    };
}

export function adaptSupervisorActionToEvent(action: SupervisorAction): WorldEvent {
    return {
        id: `supervisor-${action.id}`,
        originalId: action.id,
        eventType: "supervisor.action_found",
        title: action.title,
        summary: action.description,
        occurredAt: action.createdAt,
        severity: mapSeverity(action.severity),
        source: {
            type: "project",
            projectId: action.projectId,
        },
    };
}

export function adaptSessionEventToEvent(
    event: ServerSessionEvent,
    sessionProjectId: string | null,
    sessionMachineId: string | null,
): WorldEvent {
    return {
        id: `session-event-${event.id}`,
        originalId: event.id,
        eventType: `session.${event.eventType}`,
        title: event.summary,
        summary: "",
        occurredAt: event.createdAt,
        severity: "info",
        source: {
            type: "session",
            projectId: sessionProjectId,
            machineId: sessionMachineId,
            sessionId: event.sessionId,
        },
    };
}

export function filterWorldEvents(
    events: WorldEvent[],
    filter: {
        projectId?: string | null;
        machineId?: string | null;
        eventTypePrefix?: string | null;
        severity?: WorldEventSeverity | null;
    },
): WorldEvent[] {
    return events.filter((e) => {
        if (filter.projectId && e.source.projectId !== filter.projectId) return false;
        if (filter.machineId && e.source.machineId !== filter.machineId) return false;
        if (filter.eventTypePrefix && !e.eventType.startsWith(filter.eventTypePrefix)) return false;
        if (filter.severity && e.severity !== filter.severity) return false;
        return true;
    });
}

export function sortEventsByTime(events: WorldEvent[]): WorldEvent[] {
    return [...events].sort((a, b) => b.occurredAt - a.occurredAt);
}
