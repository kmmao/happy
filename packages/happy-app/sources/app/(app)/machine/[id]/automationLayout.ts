import type { MachineAutomationAuditEvent, MachineAutomationJob } from "@/sync/ops";

type AutomationCountsLike = {
    queued?: number;
    running?: number;
    dispatching?: number;
    completed?: number;
};

export type AutomationOverviewCard = {
    kind: "running" | "queued" | "completed" | "alerts" | "guardians";
    value: string;
    accent?: string;
};

export type AutomationAlert = {
    kind: "anomalies" | "recovered" | "guardians";
    count: number;
};

export type RecentJobPreview = MachineAutomationJob & {
    relatedEventCount: number;
};

export function buildAutomationOverviewCards(options: {
    counts: AutomationCountsLike;
    guardianCount: number;
    alertCount: number;
}): AutomationOverviewCard[] {
    const { counts, guardianCount, alertCount } = options;
    const runningCount = (counts.running ?? 0) + (counts.dispatching ?? 0);

    return [
        { kind: "running", value: String(runningCount), accent: "#0A84FF" },
        { kind: "queued", value: String(counts.queued ?? 0), accent: "#FF9500" },
        { kind: "completed", value: String(counts.completed ?? 0), accent: "#34C759" },
        { kind: "alerts", value: String(alertCount), accent: "#FF3B30" },
        { kind: "guardians", value: String(guardianCount) },
    ];
}

export function buildAutomationAlerts(options: {
    persistedGuardianCount: number;
    anomalyCount: number;
    recoveredSessionCount: number;
}): AutomationAlert[] {
    const alerts: AutomationAlert[] = [];

    if (options.anomalyCount > 0) {
        alerts.push({ kind: "anomalies", count: options.anomalyCount });
    }
    if (options.recoveredSessionCount > 0) {
        alerts.push({ kind: "recovered", count: options.recoveredSessionCount });
    }
    if (options.persistedGuardianCount > 0) {
        alerts.push({ kind: "guardians", count: options.persistedGuardianCount });
    }

    return alerts;
}

function countRelatedEvents(job: MachineAutomationJob, events: MachineAutomationAuditEvent[]): number {
    return events.filter((event) => event.jobId === job.id
        || event.dedupeKey === job.dedupeKey
        || (job.sessionId ? event.sessionId === job.sessionId : false)
        || (job.runId ? event.runId === job.runId : false)).length;
}

export function getRecentJobPreview(
    jobs: MachineAutomationJob[],
    limit: number,
    events: MachineAutomationAuditEvent[] = [],
): RecentJobPreview[] {
    return jobs
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit)
        .map((job) => ({
            ...job,
            relatedEventCount: countRelatedEvents(job, events),
        }));
}
