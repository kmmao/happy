export type WorldEventSeverity = "info" | "warning" | "critical";

export type WorldEventSourceType =
    | "project"
    | "machine"
    | "session"
    | "trigger"
    | "agent"
    | "system";

export interface WorldEventSource {
    type: WorldEventSourceType;
    projectId?: string | null;
    projectPath?: string | null;
    machineId?: string | null;
    sessionId?: string | null;
}

export interface WorldEvent {
    id: string;
    eventType: string;
    title: string;
    summary: string;
    occurredAt: number;
    severity: WorldEventSeverity;
    source: WorldEventSource;
    originalId: string;
}

export interface WorldFilter {
    projectId?: string | null;
    machineId?: string | null;
    eventTypePrefix?: string | null;
    severity?: WorldEventSeverity | null;
}

export interface WorldDefinition {
    narrative: string | null;
    laws: string | null;
    policy: string | null;
}
