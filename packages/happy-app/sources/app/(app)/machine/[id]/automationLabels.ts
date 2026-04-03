import type { MachineAutomationAuditEvent, MachineAutomationGuardian, MachineAutomationGuardianUsage, MachineAutomationJob } from "@/sync/ops";
import { t } from "@/text";

// ── Types ───────────────────────────────────────────────────────────────

export type TimelineEntry = {
    key: string;
    jobId: string;
    timestamp: number;
    title: string;
    subtitle: string;
    kind: "queued" | "dispatched" | "running" | "terminal";
};
export type JobFilter = "all" | "running" | "failed" | "terminal" | "recovered";
export type GuardianFilter = "all" | "attached" | "persisted" | "recovered";
export type AuditFilter = "all" | "anomalies" | "guardian" | "jobs" | "recovered";
export type DetailSheetState =
    | { kind: "job"; job: MachineAutomationJob; relatedEvents: MachineAutomationAuditEvent[] }
    | { kind: "guardian"; guardian: MachineAutomationGuardian; usage?: MachineAutomationGuardianUsage; relatedEvents: MachineAutomationAuditEvent[] }
    | { kind: "audit"; event: MachineAutomationAuditEvent; relatedJob?: MachineAutomationJob }
    | null;

// ── Constants ───────────────────────────────────────────────────────────

export const JOB_FILTER_VALUES: readonly JobFilter[] = ["all", "running", "failed", "terminal", "recovered"];
export const GUARDIAN_FILTER_VALUES: readonly GuardianFilter[] = ["all", "attached", "persisted", "recovered"];
export const AUDIT_FILTER_VALUES: readonly AuditFilter[] = ["all", "anomalies", "guardian", "jobs", "recovered"];
export const AUTOMATION_SECTION_PREVIEW_LIMIT = 6;
export const AUTOMATION_TIMELINE_PREVIEW_LIMIT = 8;

// ── Pure utility functions ──────────────────────────────────────────────

export function parseFilterValue<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
    return value && allowed.includes(value as T) ? (value as T) : fallback;
}

export function isRpcMethodUnavailableError(error: unknown): boolean {
    return error instanceof Error && error.message === "RPC method not available";
}

export function matchesSearch(values: Array<string | undefined>, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return true;
    }
    return values.some((value) => value?.toLowerCase().includes(normalized));
}

export function matchesJobFilter(job: MachineAutomationJob, filter: JobFilter): boolean {
    switch (filter) {
        case "running":
            return job.status === "running" || job.status === "dispatching";
        case "failed":
            return job.status === "failed";
        case "terminal":
            return job.status === "completed" || job.status === "failed" || job.status === "cancelled";
        case "recovered":
            return job.recovered === true;
        default:
            return true;
    }
}

export function matchesGuardianFilter(guardian: MachineAutomationGuardian, filter: GuardianFilter): boolean {
    switch (filter) {
        case "attached":
            return guardian.attached === true;
        case "persisted":
            return guardian.attached === false;
        case "recovered":
            return guardian.recovered === true;
        default:
            return true;
    }
}

export function matchesAuditFilter(event: MachineAutomationAuditEvent, filter: AuditFilter): boolean {
    switch (filter) {
        case "anomalies":
            return event.kind === "watchdog_stopped"
                || event.kind === "session_stop_requested"
                || event.kind === "guardian_cleared"
                || event.status === "failed"
                || event.status === "cancelled";
        case "guardian":
            return event.kind.startsWith("guardian_");
        case "jobs":
            return event.kind.startsWith("job_") || event.kind === "session_reattached" || event.kind === "watchdog_stopped" || event.kind === "session_stop_requested";
        case "recovered":
            return event.kind === "session_reattached";
        default:
            return true;
    }
}

// ── Label / formatting functions ────────────────────────────────────────

export function getStatusLabel(status: string): string {
    switch (status) {
        case "queued":
            return t("machine.automationQueued");
        case "dispatching":
        case "running":
            return t("machine.automationRunning");
        case "completed":
            return t("machine.automationCompleted");
        case "failed":
            return t("machine.automationFailed");
        case "cancelled":
            return t("machine.automationCancelled");
        default:
            return status;
    }
}

export function getStatusColor(status: string): string | undefined {
    switch (status) {
        case "queued":
            return "#FF9500";
        case "dispatching":
        case "running":
            return "#0A84FF";
        case "completed":
            return "#34C759";
        case "failed":
            return "#FF3B30";
        case "cancelled":
            return "#8E8E93";
        default:
            return undefined;
    }
}

export function getJobTitle(job: MachineAutomationJob): string {
    return job.label || job.dedupeKey;
}

export function formatTimestamp(value: number): string {
    return new Date(value).toLocaleString();
}

export function formatRate(value?: number): string {
    if (value == null || Number.isNaN(value)) {
        return "0%";
    }
    return `${Math.round(value * 100)}%`;
}

export function getGuardianStateLabel(attached?: boolean, recovered?: boolean): string {
    if (attached && recovered) {
        return t("machine.automationGuardianRecovered");
    }
    return attached ? t("machine.automationGuardianAttached") : t("machine.automationGuardianPersisted");
}

export function getGuardianUsageSubtitle(entry: MachineAutomationGuardianUsage): string {
    const parts = [
        `${t("machine.automationGuardianReuseCount")}: ${entry.reuseCount}`,
        `${t("machine.automationGuardianRememberCount")}: ${entry.rememberCount}`,
        `${t("machine.automationGuardianResetCount")}: ${entry.resetCount}`,
    ];
    if (entry.projectId) {
        parts.push(`${t("machine.automationOpenProject")}: ${entry.projectId}`);
    }
    if (entry.loopId) {
        parts.push(`${t("machine.automationOpenLoop")}: ${entry.loopId}`);
    }
    if (entry.currentSessionId) {
        parts.push(`${t("machine.automationGuardianSession")}: ${entry.currentSessionId}`);
    }
    return parts.join(" • ");
}

export function getAuditEventTitle(event: MachineAutomationAuditEvent): string {
    switch (event.kind) {
        case "job_enqueued":
            return t("machine.automationAuditEventQueued");
        case "job_session_started":
            return t("machine.automationAuditEventSessionStarted");
        case "job_terminal":
            return t("machine.automationAuditEventTerminal");
        case "guardian_reused":
            return t("machine.automationAuditEventGuardianReused");
        case "guardian_remembered":
            return t("machine.automationAuditEventGuardianRemembered");
        case "guardian_cleared":
            return t("machine.automationAuditEventGuardianCleared");
        case "session_reattached":
            return t("machine.automationAuditEventSessionReattached");
        case "watchdog_stopped":
            return t("machine.automationAuditEventWatchdogStopped");
        case "session_stop_requested":
            return t("machine.automationAuditEventStopRequested");
        case "loop_policy_gated":
            return t("machine.automationAuditEventLoopPolicyGated");
        case "loop_downstream_emitted":
            return t("machine.automationAuditEventLoopDownstreamEmitted");
        default:
            return event.kind;
    }
}

export function getAuditEventSubtitle(event: MachineAutomationAuditEvent): string {
    const parts: string[] = [];
    if (event.message) {
        parts.push(event.message);
    }
    if (event.projectId) {
        parts.push(`${t("machine.automationAuditProject")}: ${event.projectId}`);
    }
    if (event.loopId) {
        parts.push(`${t("machine.automationAuditLoop")}: ${event.loopId}`);
    }
    if (event.sessionId) {
        parts.push(`${t("machine.automationAuditSession")}: ${event.sessionId}`);
    }
    if (event.jobId) {
        parts.push(`${t("machine.automationAuditJob")}: ${event.jobId}`);
    }
    if (event.guardianKey) {
        parts.push(`${t("machine.automationAuditGuardian")}: ${event.guardianKey}`);
    }
    return parts.join(" • ");
}

export function getJobDetailMessage(job: MachineAutomationJob, relatedEvents: MachineAutomationAuditEvent[]): string {
    const lifecycle = buildTimelineEntries([job])
        .slice()
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((entry) => `• ${formatTimestamp(entry.timestamp)} — ${entry.subtitle}`);
    const lines = [
        `${t("machine.automationJobDetails")}: ${job.id}`
        ,`${t("machine.automationPriority")}: ${job.priority}`
        ,`${t("machine.automationCreatedAt")}: ${formatTimestamp(job.createdAt)}`
        ,job.dispatchedAt ? `${t("machine.automationDispatchedAt")}: ${formatTimestamp(job.dispatchedAt)}` : undefined
        ,job.completedAt ? `${t("machine.automationCompletedAt")}: ${formatTimestamp(job.completedAt)}` : undefined
        ,job.sessionId ? `${t("machine.automationSession")}: ${job.sessionId}` : undefined
        ,job.projectId ? `${t("machine.automationAuditProject")}: ${job.projectId}` : undefined
        ,job.loopId ? `${t("machine.automationAuditLoop")}: ${job.loopId}` : undefined
        ,job.errorMessage ? `${t("machine.automationFailed")}: ${job.errorMessage}` : undefined
        ,job.recovered ? t("machine.automationRecoveredAfterRestart") : undefined
        ,lifecycle.length > 0 ? t("machine.automationLifecycle") : undefined
        ,...lifecycle
        ,relatedEvents.length > 0 ? t("machine.automationRelatedEvents") : undefined
        ,...relatedEvents.slice(0, 6).map((event) => `• ${formatTimestamp(event.occurredAt)} — ${getAuditEventTitle(event)}${event.message ? ` — ${event.message}` : ""}`),
    ].filter(Boolean);
    return lines.join("\n");
}

export function getGuardianDetailMessage(
    guardian: MachineAutomationGuardian,
    usage: MachineAutomationGuardianUsage | undefined,
    relatedEvents: MachineAutomationAuditEvent[],
): string {
    const lines = [
        `${t("machine.automationGuardianDetails")}: ${guardian.key}`
        ,`${t("machine.automationGuardianSession")}: ${guardian.sessionId}`
        ,`${t("machine.automationUpdatedAt")}: ${formatTimestamp(guardian.updatedAt)}`
        ,guardian.recovered ? t("machine.automationRecoveredAfterRestart") : undefined
        ,guardian.projectId ? `${t("machine.automationAuditProject")}: ${guardian.projectId}` : undefined
        ,guardian.loopId ? `${t("machine.automationAuditLoop")}: ${guardian.loopId}` : undefined
        ,usage ? `${t("machine.automationGuardianReuseCount")}: ${usage.reuseCount}` : undefined
        ,usage ? `${t("machine.automationGuardianRememberCount")}: ${usage.rememberCount}` : undefined
        ,usage ? `${t("machine.automationGuardianResetCount")}: ${usage.resetCount}` : undefined
        ,relatedEvents.length > 0 ? t("machine.automationRelatedEvents") : undefined
        ,...relatedEvents.slice(0, 6).map((event) => `• ${formatTimestamp(event.occurredAt)} — ${getAuditEventTitle(event)}${event.message ? ` — ${event.message}` : ""}`),
    ].filter(Boolean);
    return lines.join("\n");
}

export function getAuditEventDetailMessage(event: MachineAutomationAuditEvent): string {
    const lines = [
        `${t("machine.automationUpdatedAt")}: ${formatTimestamp(event.occurredAt)}`
        ,event.status ? `${t("machine.automationStatusLabel")}: ${event.status}` : undefined
        ,event.trigger ? `${t("machine.automationTrigger")}: ${event.trigger}` : undefined
        ,event.message
        ,event.projectId ? `${t("machine.automationAuditProject")}: ${event.projectId}` : undefined
        ,event.loopId ? `${t("machine.automationAuditLoop")}: ${event.loopId}` : undefined
        ,event.sessionId ? `${t("machine.automationAuditSession")}: ${event.sessionId}` : undefined
        ,event.jobId ? `${t("machine.automationAuditJob")}: ${event.jobId}` : undefined
        ,event.guardianKey ? `${t("machine.automationAuditGuardian")}: ${event.guardianKey}` : undefined
    ].filter(Boolean);
    return lines.join("\n");
}

export function formatJobSubtitle(job: MachineAutomationJob): string {
    if (job.errorMessage) {
        return job.errorMessage;
    }

    const parts: string[] = [];
    if (job.loopIteration != null) {
        parts.push(
            t("supervisor.loopIterationUnlimited", {
                current: job.loopIteration,
            }),
        );
    }
    if (job.continuityKey) {
        parts.push(`${t("machine.automationContinuity")}: ${job.continuityKey}`);
    }
    if (job.sessionId) {
        parts.push(`${t("machine.automationSession")}: ${job.sessionId}`);
    }
    if (job.recovered) {
        parts.push(t("machine.automationRecoveredShort"));
    }
    if (job.nextRunAt) {
        parts.push(`${t("machine.automationNextRunAt")}: ${formatTimestamp(job.nextRunAt)}`);
    }
    if (parts.length === 0) {
        parts.push(formatTimestamp(job.updatedAt));
    }
    return parts.join(" • ");
}

export function buildTimelineEntries(jobs: MachineAutomationJob[]): TimelineEntry[] {
    const entries: TimelineEntry[] = [];
    jobs.forEach((job) => {
        const title = getJobTitle(job);
        entries.push({
            key: `${job.id}:queued`,
            jobId: job.id,
            timestamp: job.createdAt,
            title,
            subtitle: t("machine.automationTimelineQueued"),
            kind: "queued",
        });
        if (job.dispatchedAt) {
            entries.push({
                key: `${job.id}:dispatched`,
                jobId: job.id,
                timestamp: job.dispatchedAt,
                title,
                subtitle: t("machine.automationTimelineDispatched"),
                kind: "dispatched",
            });
        }
        if (job.status === "running") {
            entries.push({
                key: `${job.id}:running`,
                jobId: job.id,
                timestamp: job.updatedAt,
                title,
                subtitle: job.sessionId
                    ? `${t("machine.automationTimelineRunning")} • ${t("machine.automationSession")}: ${job.sessionId}`
                    : t("machine.automationTimelineRunning"),
                kind: "running",
            });
        }
        if (job.completedAt) {
            const terminalLabel = job.status === "failed"
                ? `${t("machine.automationTimelineFailed")}${job.errorMessage ? ` • ${job.errorMessage}` : ""}`
                : job.status === "cancelled"
                    ? t("machine.automationTimelineCancelled")
                    : t("machine.automationTimelineCompleted");
            entries.push({
                key: `${job.id}:terminal`,
                jobId: job.id,
                timestamp: job.completedAt,
                title,
                subtitle: terminalLabel,
                kind: "terminal",
            });
        }
    });
    return entries.sort((a, b) => b.timestamp - a.timestamp);
}

export function getJobKindLabel(kind: MachineAutomationJob["kind"]): string {
    switch (kind) {
        case "agent_loop":
            return "Agent Loop";
        case "webhook":
            return "Webhook";
        default:
            return "Supervisor";
    }
}

export function getPriorityLabel(priority: MachineAutomationJob["priority"]): string {
    switch (priority) {
        case "urgent":
            return "Urgent";
        case "background":
            return "Background";
        default:
            return "User";
    }
}

export function getAuditKindAccent(event: MachineAutomationAuditEvent): string | undefined {
    if (event.status === "failed" || event.kind === "watchdog_stopped" || event.kind === "session_stop_requested") {
        return "#FF3B30";
    }
    if (event.kind.startsWith("guardian_") || event.kind === "session_reattached") {
        return "#0A84FF";
    }
    if (event.kind === "loop_policy_gated") {
        return "#FF9500";
    }
    return undefined;
}
