import * as React from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { layout } from "@/components/layout";
import { Modal } from "@/modal";
import { BaseModal } from "@/modal/components/BaseModal";
import {
    machineAutomationStatus,
    machineCancelAutomationJob,
    machineListAgentLoops,
    machineClearAutomationAudit,
    machineClearAutomationGuardians,
    machineClearAutomationJobs,
    machineRetryAutomationJob,
    machineStopSession,
    type MachineAutomationAuditEvent,
    type MachineAutomationGuardian,
    type MachineAutomationGuardianUsage,
    type MachineAutomationJob,
    type MachineAutomationStatus,
    type MachineAgentLoop,
} from "@/sync/ops";
import { useMachine } from "@/sync/storage";
import { t } from "@/text";
import {
    buildAutomationAlerts,
    buildAutomationOverviewCards,
    getRecentJobPreview,
} from "./automationLayout";

type TimelineEntry = {
    key: string;
    jobId: string;
    timestamp: number;
    title: string;
    subtitle: string;
    kind: "queued" | "dispatched" | "running" | "terminal";
};
type JobFilter = "all" | "running" | "failed" | "terminal" | "recovered";
type GuardianFilter = "all" | "attached" | "persisted" | "recovered";
type AuditFilter = "all" | "anomalies" | "guardian" | "jobs" | "recovered";
type DetailSheetState =
    | { kind: "job"; job: MachineAutomationJob; relatedEvents: MachineAutomationAuditEvent[] }
    | { kind: "guardian"; guardian: MachineAutomationGuardian; usage?: MachineAutomationGuardianUsage; relatedEvents: MachineAutomationAuditEvent[] }
    | { kind: "audit"; event: MachineAutomationAuditEvent; relatedJob?: MachineAutomationJob }
    | null;

const JOB_FILTER_VALUES: readonly JobFilter[] = ["all", "running", "failed", "terminal", "recovered"];
const GUARDIAN_FILTER_VALUES: readonly GuardianFilter[] = ["all", "attached", "persisted", "recovered"];
const AUDIT_FILTER_VALUES: readonly AuditFilter[] = ["all", "anomalies", "guardian", "jobs", "recovered"];

function parseFilterValue<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
    return value && allowed.includes(value as T) ? (value as T) : fallback;
}

function isRpcMethodUnavailableError(error: unknown): boolean {
    return error instanceof Error && error.message === "RPC method not available";
}

function matchesSearch(values: Array<string | undefined>, query: string): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return true;
    }
    return values.some((value) => value?.toLowerCase().includes(normalized));
}

function matchesJobFilter(job: MachineAutomationJob, filter: JobFilter): boolean {
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

function matchesGuardianFilter(guardian: MachineAutomationGuardian, filter: GuardianFilter): boolean {
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

function matchesAuditFilter(event: MachineAutomationAuditEvent, filter: AuditFilter): boolean {
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

function getStatusLabel(status: string): string {
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

function getStatusColor(status: string): string | undefined {
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

function getJobTitle(job: MachineAutomationJob): string {
    return job.label || job.dedupeKey;
}

function formatTimestamp(value: number): string {
    return new Date(value).toLocaleString();
}

function formatRate(value?: number): string {
    if (value == null || Number.isNaN(value)) {
        return "0%";
    }
    return `${Math.round(value * 100)}%`;
}

function getGuardianStateLabel(attached?: boolean, recovered?: boolean): string {
    if (attached && recovered) {
        return t("machine.automationGuardianRecovered");
    }
    return attached ? t("machine.automationGuardianAttached") : t("machine.automationGuardianPersisted");
}

function getGuardianUsageSubtitle(entry: MachineAutomationGuardianUsage): string {
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

function getAuditEventTitle(event: MachineAutomationAuditEvent): string {
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

function getAuditEventSubtitle(event: MachineAutomationAuditEvent): string {
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
function getJobDetailMessage(job: MachineAutomationJob, relatedEvents: MachineAutomationAuditEvent[]): string {
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

function getGuardianDetailMessage(
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

function getAuditEventDetailMessage(event: MachineAutomationAuditEvent): string {
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

function formatJobSubtitle(job: MachineAutomationJob): string {
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

function buildTimelineEntries(jobs: MachineAutomationJob[]): TimelineEntry[] {
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

function getJobKindLabel(kind: MachineAutomationJob["kind"]): string {
    switch (kind) {
        case "agent_loop":
            return "Agent Loop";
        case "webhook":
            return "Webhook";
        default:
            return "Supervisor";
    }
}

function getPriorityLabel(priority: MachineAutomationJob["priority"]): string {
    switch (priority) {
        case "urgent":
            return "Urgent";
        case "background":
            return "Background";
        default:
            return "User";
    }
}

function getAuditKindAccent(event: MachineAutomationAuditEvent): string | undefined {
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

function renderSummaryCard(options: {
    title: string;
    value: string;
    hint: string;
    accent?: string;
}) {
    const { title, value, hint, accent } = options;
    return (
        <View style={[styles.summaryCard, accent ? { borderColor: accent } : null]}>
            <Text style={styles.summaryCardTitle}>{title}</Text>
            <Text style={[styles.summaryCardValue, accent ? { color: accent } : null]}>{value}</Text>
            <Text style={styles.summaryCardHint}>{hint}</Text>
        </View>
    );
}

function renderSectionBanner(options: {
    title: string;
    subtitle: string;
    detail?: string;
}) {
    const { title, subtitle, detail } = options;
    return (
        <View style={styles.sectionBanner}>
            <View style={styles.sectionBannerTextWrap}>
                <Text style={styles.sectionBannerTitle}>{title}</Text>
                <Text style={styles.sectionBannerSubtitle}>{subtitle}</Text>
            </View>
            {detail ? (
                <View style={styles.sectionBannerBadge}>
                    <Text style={styles.sectionBannerBadgeText}>{detail}</Text>
                </View>
            ) : null}
        </View>
    );
}

export default React.memo(function MachineAutomationPage() {
    const {
        id: machineId,
        q: initialQueryParam,
        jobFilter: initialJobFilterParam,
        auditFilter: initialAuditFilterParam,
        guardianFilter: initialGuardianFilterParam,
    } = useLocalSearchParams<{
        id: string;
        q?: string;
        jobFilter?: JobFilter;
        auditFilter?: AuditFilter;
        guardianFilter?: GuardianFilter;
    }>();
    const machine = useMachine(machineId!);
    const rpcReady = machine?.rpcReady ?? false;
    const router = useRouter();
    const { theme } = useUnistyles();
    const [status, setStatus] = React.useState<MachineAutomationStatus | null>(null);
    const [loopStatus, setLoopStatus] = React.useState<MachineAgentLoop[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [activeJobId, setActiveJobId] = React.useState<string | null>(null);
    const [clearing, setClearing] = React.useState(false);
    const [clearingGuardians, setClearingGuardians] = React.useState(false);
    const [clearingAudit, setClearingAudit] = React.useState(false);
    const initialSearchQuery = typeof initialQueryParam === "string" ? initialQueryParam : "";
    const initialJobFilter = parseFilterValue(typeof initialJobFilterParam === "string" ? initialJobFilterParam : undefined, JOB_FILTER_VALUES, "all");
    const initialAuditFilter = parseFilterValue(typeof initialAuditFilterParam === "string" ? initialAuditFilterParam : undefined, AUDIT_FILTER_VALUES, "all");
    const initialGuardianFilter = parseFilterValue(typeof initialGuardianFilterParam === "string" ? initialGuardianFilterParam : undefined, GUARDIAN_FILTER_VALUES, "all");
    const [searchQuery, setSearchQuery] = React.useState(initialSearchQuery);
    const [jobFilter, setJobFilter] = React.useState<JobFilter>(initialJobFilter);
    const [auditFilter, setAuditFilter] = React.useState<AuditFilter>(initialAuditFilter);
    const [guardianFilter, setGuardianFilter] = React.useState<GuardianFilter>(initialGuardianFilter);
    const [detailSheet, setDetailSheet] = React.useState<DetailSheetState>(null);
    const [showAllJobs, setShowAllJobs] = React.useState(false);
    const closeDetailSheet = React.useCallback(() => setDetailSheet(null), []);

    const applyCachedAutomationState = React.useCallback(() => {
        const fallback = machine?.daemonState?.automation;
        if (fallback) {
            setStatus({
                counts: fallback.counts ?? {},
                jobs: fallback.recentJobs ?? [],
                guardians: fallback.guardians ?? [],
                guardianUsage: fallback.guardianUsage ?? [],
                auditStats: fallback.auditStats,
                recentAuditEvents: fallback.recentAuditEvents ?? [],
            });
        }
        setLoopStatus([]);
    }, [machine?.daemonState?.automation]);

    const load = React.useCallback(async (kind: "initial" | "refresh") => {
        if (!machineId) {
            return;
        }
        if (kind === "initial") {
            setLoading(true);
        } else {
            setRefreshing(true);
        }
        try {
            if (!rpcReady) {
                applyCachedAutomationState();
                return;
            }
            const [fresh, loopsResult] = await Promise.all([
                machineAutomationStatus(machineId),
                machineListAgentLoops(machineId),
            ]);
            setStatus(fresh);
            setLoopStatus(loopsResult.loops ?? []);
        } catch (error) {
            if (isRpcMethodUnavailableError(error)) {
                applyCachedAutomationState();
            } else {
                applyCachedAutomationState();
            }
        } finally {
            if (kind === "initial") {
                setLoading(false);
            } else {
                setRefreshing(false);
            }
        }
    }, [applyCachedAutomationState, machineId, rpcReady]);

    React.useEffect(() => {
        void load("initial");
    }, [load]);

    React.useEffect(() => {
        if (typeof initialQueryParam === "string") {
            setSearchQuery(initialQueryParam);
        }
    }, [initialQueryParam]);

    React.useEffect(() => {
        setJobFilter(parseFilterValue(typeof initialJobFilterParam === "string" ? initialJobFilterParam : undefined, JOB_FILTER_VALUES, "all"));
    }, [initialJobFilterParam]);

    React.useEffect(() => {
        setAuditFilter(parseFilterValue(typeof initialAuditFilterParam === "string" ? initialAuditFilterParam : undefined, AUDIT_FILTER_VALUES, "all"));
    }, [initialAuditFilterParam]);

    React.useEffect(() => {
        setGuardianFilter(parseFilterValue(typeof initialGuardianFilterParam === "string" ? initialGuardianFilterParam : undefined, GUARDIAN_FILTER_VALUES, "all"));
    }, [initialGuardianFilterParam]);

    const jobs = React.useMemo(() => {
        return (status?.jobs ?? []).slice().sort((a, b) => b.updatedAt - a.updatedAt);
    }, [status]);

    const guardians = React.useMemo<MachineAutomationGuardian[]>(() => {
        const source = (status?.guardians ?? machine?.daemonState?.automation?.guardians ?? []) as MachineAutomationGuardian[];
        return source.slice().sort((a: MachineAutomationGuardian, b: MachineAutomationGuardian) => b.updatedAt - a.updatedAt);
    }, [machine?.daemonState?.automation?.guardians, status?.guardians]);

    const guardianUsage = React.useMemo<MachineAutomationGuardianUsage[]>(() => {
        const source = (status?.guardianUsage ?? machine?.daemonState?.automation?.guardianUsage ?? []) as MachineAutomationGuardianUsage[];
        return source.slice().sort((a: MachineAutomationGuardianUsage, b: MachineAutomationGuardianUsage) => b.lastUsedAt - a.lastUsedAt);
    }, [machine?.daemonState?.automation?.guardianUsage, status?.guardianUsage]);

    const auditStats = status?.auditStats ?? machine?.daemonState?.automation?.auditStats;

    const loopRollup = React.useMemo(() => {
        const total = loopStatus.length;
        const active = loopStatus.filter((loop) => loop.runtimeState === "active").length;
        const blocked = loopStatus.filter((loop) => loop.runtimeState === "blocked").length;
        const paused = loopStatus.filter((loop) => loop.runtimeState === "paused" || (loop.enabled === false && loop.runtimeState !== "blocked")).length;
        const pendingEvents = loopStatus.filter((loop) => (loop.recentEvents?.some((event) => event.status === "pending") ?? false)).length;
        const policyStopped = loopStatus.filter((loop) => Boolean(loop.stopReason || loop.lastPolicyGateReason)).length;
        return { total, active, blocked, paused, pendingEvents, policyStopped };
    }, [loopStatus]);

    const recentAuditEvents = React.useMemo<MachineAutomationAuditEvent[]>(() => {
        const source = (status?.recentAuditEvents ?? machine?.daemonState?.automation?.recentAuditEvents ?? []) as MachineAutomationAuditEvent[];
        return source.slice().sort((a: MachineAutomationAuditEvent, b: MachineAutomationAuditEvent) => b.occurredAt - a.occurredAt).slice(0, 30);
    }, [machine?.daemonState?.automation?.recentAuditEvents, status?.recentAuditEvents]);

    const filteredJobs = React.useMemo(() => jobs.filter((job) => matchesJobFilter(job, jobFilter) && matchesSearch([
        job.id,
        job.label,
        job.dedupeKey,
        job.sessionId,
        job.projectId,
        job.loopId,
        job.errorMessage,
        job.continuityKey,
    ], searchQuery)), [jobFilter, jobs, searchQuery]);

    const filteredGuardians = React.useMemo(() => guardians.filter((guardian) => matchesGuardianFilter(guardian, guardianFilter) && matchesSearch([
        guardian.key,
        guardian.projectId,
        guardian.loopId,
        guardian.sessionId,
        guardian.lastRunId,
    ], searchQuery)), [guardianFilter, guardians, searchQuery]);

    const filteredGuardianUsage = React.useMemo(() => guardianUsage.filter((entry) => {
        const relatedGuardian = guardians.find((guardian) => guardian.key === entry.key);
        const guardianMatches = guardianFilter === "all"
            ? true
            : relatedGuardian
                ? matchesGuardianFilter(relatedGuardian, guardianFilter)
                : false;
        return guardianMatches && matchesSearch([
            entry.key,
            entry.projectId,
            entry.loopId,
            entry.currentSessionId,
        ], searchQuery);
    }), [guardianFilter, guardianUsage, guardians, searchQuery]);

    const filteredAuditEvents = React.useMemo(() => recentAuditEvents.filter((event) => matchesAuditFilter(event, auditFilter) && matchesSearch([
        event.kind,
        event.message,
        event.jobId,
        event.dedupeKey,
        event.sessionId,
        event.projectId,
        event.runId,
        event.loopId,
        event.guardianKey,
    ], searchQuery)), [auditFilter, recentAuditEvents, searchQuery]);

    const timeline = React.useMemo(() => buildTimelineEntries(filteredJobs).slice(0, 8), [filteredJobs]);
    const counts = status?.counts ?? machine?.daemonState?.automation?.counts ?? {};
    const persistedGuardianCount = React.useMemo(() => guardians.filter((guardian) => guardian.attached === false).length, [guardians]);
    const anomalyCount = (auditStats?.watchdogStopCount ?? 0) + (auditStats?.stopRequestCount ?? 0) + (counts.failed ?? 0);
    const recoveredSessionCount = auditStats?.sessionReattachedCount ?? 0;
    const alertCards = React.useMemo(() => buildAutomationAlerts({
        persistedGuardianCount,
        anomalyCount,
        recoveredSessionCount,
    }), [anomalyCount, persistedGuardianCount, recoveredSessionCount]);
    const overviewCards = React.useMemo(() => buildAutomationOverviewCards({
        counts,
        guardianCount: guardians.length,
        alertCount: alertCards.reduce((total, alert) => total + alert.count, 0),
    }), [alertCards, counts, guardians.length]);
    const recentJobPreview = React.useMemo(() => getRecentJobPreview(filteredJobs, 4, recentAuditEvents), [filteredJobs, recentAuditEvents]);
    const visibleJobs = showAllJobs ? filteredJobs : recentJobPreview;

    React.useEffect(() => {
        setShowAllJobs(false);
    }, [searchQuery, jobFilter]);

    const mutateAndReload = React.useCallback(async (jobId: string, action: "retry" | "cancel") => {
        setActiveJobId(jobId);
        try {
            if (action === "retry") {
                const result = await machineRetryAutomationJob(machineId!, jobId);
                if (!result.success) {
                    throw new Error(result.errorMessage || t("machine.automationRetryFailed"));
                }
            } else {
                const result = await machineCancelAutomationJob(machineId!, jobId);
                if (!result.success) {
                    throw new Error(result.errorMessage || t("machine.automationCancelFailed"));
                }
            }
            await load("refresh");
        } catch (error) {
            if (!isRpcMethodUnavailableError(error)) {
                Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
            }
        } finally {
            setActiveJobId(null);
        }
    }, [load, machineId]);

    const clearGuardians = React.useCallback(async (params: { key?: string; sessionId?: string; clearAll?: boolean }) => {
        setClearingGuardians(true);
        try {
            const result = await machineClearAutomationGuardians(machineId!, params);
            if (!result.success) {
                throw new Error(result.errorMessage || t("machine.automationResetGuardianFailed"));
            }
            await load("refresh");
        } catch (error) {
            if (!isRpcMethodUnavailableError(error)) {
                Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
            }
        } finally {
            setClearingGuardians(false);
        }
    }, [load, machineId]);

    const clearAudit = React.useCallback(async () => {
        setClearingAudit(true);
        try {
            const result = await machineClearAutomationAudit(machineId!);
            if (!result.success) {
                throw new Error(result.errorMessage || t("machine.automationClearAuditFailed"));
            }
            await load("refresh");
        } catch (error) {
            if (!isRpcMethodUnavailableError(error)) {
                Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
            }
        } finally {
            setClearingAudit(false);
        }
    }, [load, machineId]);

    const clearTerminal = React.useCallback(async () => {
        setClearing(true);
        try {
            const result = await machineClearAutomationJobs(machineId!);
            if (!result.success) {
                throw new Error(result.errorMessage || t("machine.automationClearFailed"));
            }
            await load("refresh");
        } catch (error) {
            if (!isRpcMethodUnavailableError(error)) {
                Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
            }
        } finally {
            setClearing(false);
        }
    }, [load, machineId]);

    const handleJobPress = React.useCallback((job: MachineAutomationJob) => {
        const relatedEvents = recentAuditEvents.filter((event) => event.jobId === job.id
            || event.dedupeKey === job.dedupeKey
            || (job.sessionId ? event.sessionId === job.sessionId : false)
            || (job.runId ? event.runId === job.runId : false)
        );
        const buttons: Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
        ];

        if (job.loopId) {
            buttons.push({
                text: t("machine.automationOpenLoop"),
                onPress: () => {
                    if (job.kind === "agent_loop") {
                        router.push(`/machine/${machineId}/loops?loopId=${job.loopId}` as any);
                        return;
                    }
                    if (job.projectId) {
                        router.push(`/project/${job.projectId}/supervisor-loop/${job.loopId}` as any);
                    }
                },
            });
        }
        if (job.projectId) {
            buttons.push({
                text: t("machine.automationOpenProject"),
                onPress: () => router.push(`/project/${job.projectId}` as any),
            });
        }
        if (job.sessionId) {
            buttons.push({
                text: t("machine.automationOpenSession"),
                onPress: () => router.push(`/session/${job.sessionId}` as any),
            });
        }
        if (job.status === "queued") {
            buttons.push({
                text: t("machine.automationCancel"),
                style: "destructive",
                onPress: () => void mutateAndReload(job.id, "cancel"),
            });
        }
        if ((job.status === "running" || job.status === "dispatching") && job.sessionId) {
            buttons.push({
                text: t("machine.automationStop"),
                style: "destructive",
                onPress: () => {
                    setActiveJobId(job.id);
                    void machineStopSession(machineId!, job.sessionId!)
                        .then(() => load("refresh"))
                        .catch((error) => {
                            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
                        })
                        .finally(() => setActiveJobId(null));
                },
            });
        }
        if (job.status === "failed" || job.status === "cancelled" || job.status === "completed") {
            buttons.push({
                text: t("machine.automationRetry"),
                onPress: () => void mutateAndReload(job.id, "retry"),
            });
        }

        Modal.alert(getJobTitle(job), getJobDetailMessage(job, relatedEvents), buttons);
    }, [load, machineId, mutateAndReload, recentAuditEvents, router]);

    const handleGuardianPress = React.useCallback((guardian: MachineAutomationGuardian) => {
        const usage = guardianUsage.find((entry) => entry.key === guardian.key);
        const relatedEvents = recentAuditEvents.filter((event) => event.guardianKey === guardian.key || event.sessionId === guardian.sessionId);
        const buttons: Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
        ];
        if (guardian.projectId) {
            buttons.push({
                text: t("machine.automationOpenProject"),
                onPress: () => router.push(`/project/${guardian.projectId}` as any),
            });
        }
        if (guardian.loopId) {
            buttons.push({
                text: t("machine.automationOpenLoop"),
                onPress: () => {
                    if (guardian.key.startsWith("agent-loop:")) {
                        router.push(`/machine/${machineId}/loops?loopId=${guardian.loopId}` as any);
                        return;
                    }
                    if (guardian.projectId) {
                        router.push(`/project/${guardian.projectId}/supervisor-loop/${guardian.loopId}` as any);
                    }
                },
            });
        }
        buttons.push({
            text: t("machine.automationOpenSession"),
            onPress: () => router.push(`/session/${guardian.sessionId}` as any),
        });
        buttons.push({
            text: t("machine.automationResetGuardian"),
            style: "destructive",
            onPress: () => {
                Modal.alert(
                    t("machine.automationResetGuardian"),
                    t("machine.automationResetGuardianMessage"),
                    [
                        { text: t("common.cancel"), style: "cancel" },
                        {
                            text: t("machine.automationResetGuardian"),
                            style: "destructive",
                            onPress: () => void clearGuardians({ key: guardian.key, sessionId: guardian.sessionId }),
                        },
                    ],
                );
            },
        });
        Modal.alert(
            guardian.key,
            `${getGuardianDetailMessage(guardian, usage, relatedEvents)}\n${t("machine.automationStatusLabel")}: ${getGuardianStateLabel(guardian.attached, guardian.recovered)}`,
            buttons,
        );
    }, [clearGuardians, guardianUsage, recentAuditEvents, router]);

    const handleAuditEventPress = React.useCallback((event: MachineAutomationAuditEvent) => {
        const relatedJob = jobs.find((job) => job.id === event.jobId || job.dedupeKey === event.dedupeKey || (event.sessionId ? job.sessionId === event.sessionId : false));
        const buttons: Array<{ text: string; style?: "cancel" | "default"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
        ];
        if (event.sessionId) {
            buttons.push({
                text: t("machine.automationOpenSession"),
                onPress: () => router.push(`/session/${event.sessionId}` as any),
            });
        }
        if (event.loopId) {
            buttons.push({
                text: t("machine.automationOpenLoop"),
                onPress: () => {
                    if (event.trigger?.startsWith("agent_loop")) {
                        router.push(`/machine/${machineId}/loops?loopId=${event.loopId}` as any);
                        return;
                    }
                    if (event.projectId) {
                        router.push(`/project/${event.projectId}/supervisor-loop/${event.loopId}` as any);
                    }
                },
            });
        }
        if (event.projectId) {
            buttons.push({
                text: t("machine.automationOpenProject"),
                onPress: () => router.push(`/project/${event.projectId}` as any),
            });
        }
        if (relatedJob) {
            buttons.push({
                text: t("machine.automationOpenJob"),
                onPress: () => handleJobPress(relatedJob),
            });
        }
        Modal.alert(getAuditEventTitle(event), getAuditEventDetailMessage(event), buttons);
    }, [handleJobPress, jobs, router]);

    if (loading && !status) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color={theme.colors.text} />
            </View>
        );
    }

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load("refresh")} />}
        >
            {!rpcReady ? (
                <View style={styles.rpcNotice}>
                    <Text style={styles.rpcNoticeTitle}>{t("status.connecting")}</Text>
                    <Text style={styles.rpcNoticeText}>{t("machine.automationViewAllHint")}</Text>
                </View>
            ) : null}
            <View style={styles.filterPanel}>
                <View style={styles.panelHeader}>
                    <Text style={styles.panelTitle}>{t("machine.automationOverviewTitle")}</Text>
                    <Text style={styles.panelSubtitle}>{t("machine.automationOverviewHint")}</Text>
                </View>
                <TextInput
                    style={styles.searchInput}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder={t("machine.automationSearchPlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                />
                <Text style={styles.panelHint}>{t("machine.automationSearchHint")}</Text>
                <Text style={styles.filterLabel}>{t("machine.automationJobFilters")}</Text>
                <Text style={styles.filterHint}>{t("machine.automationJobFiltersHint")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow} style={styles.filterScroll}>
                    {([
                        ["all", t("machine.automationFilterAll")],
                        ["running", t("machine.automationFilterRunning")],
                        ["failed", t("machine.automationFilterFailed")],
                        ["terminal", t("machine.automationFilterTerminal")],
                        ["recovered", t("machine.automationFilterRecovered")],
                    ] as Array<[JobFilter, string]>).map(([value, label]) => (
                        <Pressable
                            key={value}
                            style={[styles.filterChip, jobFilter === value && styles.filterChipSelected]}
                            onPress={() => setJobFilter(value)}
                        >
                            <Text style={[styles.filterChipText, jobFilter === value && styles.filterChipTextSelected]}>{label}</Text>
                        </Pressable>
                    ))}
                </ScrollView>
                <Text style={styles.filterLabel}>{t("machine.automationAuditFilters")}</Text>
                <Text style={styles.filterHint}>{t("machine.automationAuditFiltersHint")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow} style={styles.filterScroll}>
                    {([
                        ["all", t("machine.automationFilterAll")],
                        ["anomalies", t("machine.automationFilterAnomalies")],
                        ["guardian", t("machine.automationFilterGuardian")],
                        ["jobs", t("machine.automationFilterJobs")],
                        ["recovered", t("machine.automationFilterRecovered")],
                    ] as Array<[AuditFilter, string]>).map(([value, label]) => (
                        <Pressable
                            key={value}
                            style={[styles.filterChip, auditFilter === value && styles.filterChipSelected]}
                            onPress={() => setAuditFilter(value)}
                        >
                            <Text style={[styles.filterChipText, auditFilter === value && styles.filterChipTextSelected]}>{label}</Text>
                        </Pressable>
                    ))}
                </ScrollView>
                <Text style={styles.filterLabel}>{t("machine.automationGuardians")}</Text>
                <Text style={styles.filterHint}>{t("machine.automationGuardianFiltersHint")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow} style={styles.filterScroll}>
                    {([
                        ["all", t("machine.automationFilterAll")],
                        ["attached", t("machine.automationGuardianAttached")],
                        ["persisted", t("machine.automationGuardianPersisted")],
                        ["recovered", t("machine.automationFilterRecovered")],
                    ] as Array<[GuardianFilter, string]>).map(([value, label]) => (
                        <Pressable
                            key={value}
                            style={[styles.filterChip, guardianFilter === value && styles.filterChipSelected]}
                            onPress={() => setGuardianFilter(value)}
                        >
                            <Text style={[styles.filterChipText, guardianFilter === value && styles.filterChipTextSelected]}>{label}</Text>
                        </Pressable>
                    ))}
                </ScrollView>
                <Text style={styles.filterSummary}>{`${filteredJobs.length}/${jobs.length} jobs • ${filteredGuardians.length}/${guardians.length} guardians • ${filteredAuditEvents.length}/${recentAuditEvents.length} audit`}</Text>
            </View>

            <ItemList>
                {alertCards.length > 0 ? (
                    <ItemGroup title={t("machine.automationAlerts")}>
                    {renderSectionBanner({ title: t("machine.automationAlerts"), subtitle: t("machine.automationAlertsHint"), detail: String(alertCards.length) })}
                        {alertCards.map((alert) => {
                            if (alert.kind === "anomalies") {
                                return (
                                    <Item
                                        key={alert.kind}
                                        title={t("machine.automationAnomaliesDetected")}
                                        subtitle={`${t("machine.automationFailed")}: ${counts.failed ?? 0} • ${t("machine.automationWatchdogStops")}: ${auditStats?.watchdogStopCount ?? 0} • ${t("machine.automationStopRequests")}: ${auditStats?.stopRequestCount ?? 0}`}
                                        detail={String(alert.count)}
                                        detailStyle={{ color: "#FF3B30" }}
                                        showChevron={false}
                                    />
                                );
                            }
                            if (alert.kind === "recovered") {
                                return (
                                    <Item
                                        key={alert.kind}
                                        title={t("machine.automationRecoveredSessions")}
                                        subtitle={`${t("machine.automationRecoveredGuardians")}: ${guardians.filter((guardian) => guardian.recovered).length} • ${t("machine.automationRecoveredJobs")}: ${jobs.filter((job) => job.recovered).length}`}
                                        detail={String(alert.count)}
                                        detailStyle={{ color: "#34C759" }}
                                        showChevron={false}
                                    />
                                );
                            }
                            return (
                                <Item
                                    key={alert.kind}
                                    title={t("machine.automationGuardianRecoveryNeeded")}
                                    subtitle={t("machine.automationGuardianRecoveryNeededMessage")}
                                    detail={String(alert.count)}
                                    detailStyle={{ color: "#FF9500" }}
                                    showChevron={false}
                                />
                            );
                        })}
                    </ItemGroup>
                ) : null}
                <ItemGroup title={t("machine.automation")}>
                    <View style={styles.summaryGrid}>
                        {overviewCards.map((card) => {
                            const title = card.kind === "running"
                                ? t("machine.automationRunning")
                                : card.kind === "queued"
                                    ? t("machine.automationQueued")
                                    : card.kind === "alerts"
                                        ? t("machine.automationAlerts")
                                        : t("machine.automationGuardians");
                            const hint = card.kind === "running"
                                ? t("machine.automationRunningHint")
                                : card.kind === "queued"
                                    ? t("machine.automationQueuedHint")
                                    : card.kind === "alerts"
                                        ? t("machine.automationAnomaliesDetected")
                                        : t("machine.automationGuardiansHint");
                            return renderSummaryCard({
                                title,
                                value: card.value,
                                hint,
                                accent: card.accent,
                            });
                        })}
                    </View>
                    <Item
                        title={t("machine.automationClearTerminal")}
                        subtitle={t("machine.automationClearTerminalHint")}
                        titleStyle={{ color: theme.colors.textLink }}
                        onPress={() => {
                            Modal.alert(
                                t("machine.automationClearTerminal"),
                                t("machine.automationClearTerminalMessage"),
                                [
                                    { text: t("common.cancel"), style: "cancel" },
                                    {
                                        text: t("machine.automationClearTerminal"),
                                        style: "destructive",
                                        onPress: () => void clearTerminal(),
                                    },
                                ],
                            );
                        }}
                        rightElement={clearing ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                    />
                </ItemGroup>

                <ItemGroup title={t("machine.automationLoopRollup")}>
                    {renderSectionBanner({ title: t("machine.automationLoopRollup"), subtitle: t("machine.automationLoopRollupHint"), detail: `${loopRollup.active}/${loopRollup.total}` })}
                    <View style={styles.summaryGrid}>
                        {renderSummaryCard({ title: t("machine.automationLoopsTotal"), value: String(loopRollup.total), hint: t("machine.automationLoopsTotalHint") })}
                        {renderSummaryCard({ title: t("machine.automationLoopsActive"), value: String(loopRollup.active), hint: t("machine.automationLoopsActiveHint"), accent: "#0A84FF" })}
                        {renderSummaryCard({ title: t("machine.automationLoopsBlocked"), value: String(loopRollup.blocked), hint: t("machine.automationLoopsBlockedHint"), accent: "#FF3B30" })}
                        {renderSummaryCard({ title: t("machine.automationLoopsPaused"), value: String(loopRollup.paused), hint: t("machine.automationLoopsPausedHint"), accent: theme.colors.textSecondary })}
                        {renderSummaryCard({ title: t("machine.automationLoopsPendingEvents"), value: String(loopRollup.pendingEvents), hint: t("machine.automationLoopsPendingEventsHint") })}
                        {renderSummaryCard({ title: t("machine.automationLoopsPolicyStopped"), value: String(loopRollup.policyStopped), hint: t("machine.automationLoopsPolicyStoppedHint"), accent: "#FF9500" })}
                    </View>
                    <Item title={t("machine.automationOpenLoops")} subtitle={t("machine.automationOpenLoopsHint")} titleStyle={{ color: theme.colors.textLink }} onPress={() => router.push(`/machine/${machineId}/loops` as any)} />
                </ItemGroup>

                <ItemGroup title={t("machine.automationGuardians")}>
                    {renderSectionBanner({ title: t("machine.automationGuardians"), subtitle: t("machine.automationGuardiansHint"), detail: String(filteredGuardians.length) })}
                    {filteredGuardians.length === 0 ? (
                        <View style={styles.emptyCard}>
                            <Text style={styles.emptyCardTitle}>{(searchQuery.trim() ? t("machine.automationNoMatches") : t("machine.automationGuardiansEmpty"))}</Text>
                            <Text style={styles.emptyCardSubtitle}>{t("machine.automationGuardiansHint")}</Text>
                        </View>
                    ) : filteredGuardians.map((guardian: MachineAutomationGuardian) => (
                        <Pressable key={guardian.key} style={styles.dataCard} onPress={() => handleGuardianPress(guardian)}>
                            <View style={styles.dataCardHeader}>
                                <View style={styles.dataCardTitleWrap}>
                                    <Text style={styles.dataCardTitle}>{guardian.key}</Text>
                                    <Text style={styles.dataCardSubtitle}>{getGuardianStateLabel(guardian.attached, guardian.recovered)}</Text>
                                </View>
                                <Text style={styles.dataCardTimestamp}>{formatTimestamp(guardian.updatedAt)}</Text>
                            </View>
                            <View style={styles.pillRow}>
                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationGuardianSession")}: ${guardian.sessionId}`}</Text></View>
                                {guardian.projectId ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationAuditProject")}: ${guardian.projectId}`}</Text></View> : null}
                                {guardian.loopId ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationAuditLoop")}: ${guardian.loopId}`}</Text></View> : null}
                            </View>
                        </Pressable>
                    ))}
                </ItemGroup>

                <ItemGroup title={t("machine.automationAuditStats")}>
                    {renderSectionBanner({ title: t("machine.automationAuditStats"), subtitle: t("machine.automationAuditStatsHint"), detail: formatRate(auditStats?.guardianReuseRate) })}
                    <View style={styles.summaryGrid}>
                        {renderSummaryCard({ title: t("machine.automationTotalAuditEvents"), value: String(auditStats?.totalEvents ?? 0), hint: t("machine.automationTotalAuditEventsHint") })}
                        {renderSummaryCard({ title: t("machine.automationGuardianReuseCount"), value: String(auditStats?.guardianReuseCount ?? 0), hint: t("machine.automationGuardianReuseCountHint"), accent: "#0A84FF" })}
                        {renderSummaryCard({ title: t("machine.automationGuardianReuseRate"), value: formatRate(auditStats?.guardianReuseRate), hint: t("machine.automationGuardianReuseRateHint") })}
                        {renderSummaryCard({ title: t("machine.automationGuardianResetCount"), value: String(auditStats?.guardianResetCount ?? 0), hint: t("machine.automationGuardianResetCountHint"), accent: "#FF9500" })}
                        {renderSummaryCard({ title: t("machine.automationSessionReattachedCount"), value: String(auditStats?.sessionReattachedCount ?? 0), hint: t("machine.automationSessionReattachedCountHint"), accent: "#34C759" })}
                        {renderSummaryCard({ title: t("machine.automationWatchdogStops"), value: String(auditStats?.watchdogStopCount ?? 0), hint: t("machine.automationWatchdogStopsHint"), accent: "#FF3B30" })}
                    </View>
                    <Item title={t("machine.automationLastAuditEvent")} subtitle={t("machine.automationLastAuditEventHint")} detail={auditStats?.lastEventAt ? formatTimestamp(auditStats.lastEventAt) : "-"} showChevron={false} />
                </ItemGroup>

                <ItemGroup title={t("machine.automationGuardianUsage")}>
                    {renderSectionBanner({ title: t("machine.automationGuardianUsage"), subtitle: t("machine.automationGuardianUsageHint"), detail: String(filteredGuardianUsage.length) })}
                    {filteredGuardianUsage.length === 0 ? (
                        <View style={styles.emptyCard}>
                            <Text style={styles.emptyCardTitle}>{(searchQuery.trim() ? t("machine.automationNoMatches") : t("machine.automationGuardianUsageEmpty"))}</Text>
                            <Text style={styles.emptyCardSubtitle}>{t("machine.automationGuardianUsageHint")}</Text>
                        </View>
                    ) : filteredGuardianUsage.map((entry: MachineAutomationGuardianUsage) => {
                        const matchingGuardian = guardians.find((guardian) => guardian.key === entry.key);
                        const onPress = matchingGuardian
                            ? () => handleGuardianPress(matchingGuardian)
                            : entry.currentSessionId
                                ? () => router.push(`/session/${entry.currentSessionId}` as any)
                                : undefined;
                        return (
                            <Pressable key={entry.key} style={styles.dataCard} onPress={onPress}>
                                <View style={styles.dataCardHeader}>
                                    <View style={styles.dataCardTitleWrap}>
                                        <Text style={styles.dataCardTitle}>{entry.key}</Text>
                                        <Text style={styles.dataCardSubtitle}>{t("machine.automationGuardianUsage")}</Text>
                                    </View>
                                    <Text style={styles.dataCardTimestamp}>{formatTimestamp(entry.lastUsedAt)}</Text>
                                </View>
                                <View style={styles.pillRow}>
                                    <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationGuardianReuseCount")}: ${entry.reuseCount}`}</Text></View>
                                    <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationGuardianRememberCount")}: ${entry.rememberCount}`}</Text></View>
                                    <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationGuardianResetCount")}: ${entry.resetCount}`}</Text></View>
                                    {entry.projectId ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationAuditProject")}: ${entry.projectId}`}</Text></View> : null}
                                </View>
                            </Pressable>
                        );
                    })}
                </ItemGroup>

                <ItemGroup title={t("machine.automationAudit")}>
                    {renderSectionBanner({ title: t("machine.automationAudit"), subtitle: t("machine.automationAuditHint"), detail: String(filteredAuditEvents.length) })}
                    <Item
                        title={t("machine.automationClearAudit")}
                        subtitle={t("machine.automationClearAuditHint")}
                        titleStyle={{ color: theme.colors.textLink }}
                        onPress={() => {
                            Modal.alert(
                                t("machine.automationClearAudit"),
                                t("machine.automationClearAuditMessage"),
                                [
                                    { text: t("common.cancel"), style: "cancel" },
                                    {
                                        text: t("machine.automationClearAudit"),
                                        style: "destructive",
                                        onPress: () => void clearAudit(),
                                    },
                                ],
                            );
                        }}
                        rightElement={clearingAudit ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                    />
                    {filteredAuditEvents.length === 0 ? (
                        <View style={styles.emptyCard}>
                            <Text style={styles.emptyCardTitle}>{((searchQuery.trim() || auditFilter !== "all") ? t("machine.automationNoMatches") : t("machine.automationAuditEmpty"))}</Text>
                            <Text style={styles.emptyCardSubtitle}>{t("machine.automationAuditHint")}</Text>
                        </View>
                    ) : filteredAuditEvents.map((event: MachineAutomationAuditEvent) => (
                        <Pressable key={event.id} style={styles.dataCard} onPress={() => handleAuditEventPress(event)}>
                            <View style={styles.dataCardHeader}>
                                <View style={styles.dataCardTitleWrap}>
                                    <Text style={styles.dataCardTitle}>{getAuditEventTitle(event)}</Text>
                                    <Text style={styles.dataCardSubtitle}>{event.message || getAuditEventSubtitle(event) || t("machine.automationAudit")}</Text>
                                </View>
                                <Text style={[styles.dataCardTimestamp, getAuditKindAccent(event) ? { color: getAuditKindAccent(event) } : null]}>{formatTimestamp(event.occurredAt)}</Text>
                            </View>
                            <View style={styles.pillRow}>
                                {event.status ? <View style={[styles.pill, { borderColor: getAuditKindAccent(event) ?? theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationStatusLabel")}: ${event.status}`}</Text></View> : null}
                                {event.guardianKey ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationAuditGuardian")}: ${event.guardianKey}`}</Text></View> : null}
                                {event.loopId ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationAuditLoop")}: ${event.loopId}`}</Text></View> : null}
                            </View>
                        </Pressable>
                    ))}
                </ItemGroup>

                <ItemGroup title={t("machine.automationTimeline")}>
                    {renderSectionBanner({ title: t("machine.automationTimeline"), subtitle: t("machine.automationTimelineHint"), detail: String(timeline.length) })}
                    {timeline.length === 0 ? (
                        <View style={styles.emptyCard}>
                            <Text style={styles.emptyCardTitle}>{t("machine.automationTimelineEmpty")}</Text>
                            <Text style={styles.emptyCardSubtitle}>{t("machine.automationTimelineHint")}</Text>
                        </View>
                    ) : timeline.map((entry) => {
                        const job = jobs.find((candidate) => candidate.id === entry.jobId);
                        const accent = entry.kind === "terminal" ? theme.colors.textSecondary : entry.kind === "running" ? "#0A84FF" : "#FF9500";
                        return (
                            <Pressable key={entry.key} style={styles.timelineCard} onPress={job ? () => handleJobPress(job) : undefined}>
                                <View style={styles.timelineRail}>
                                    <View style={[styles.timelineDot, { backgroundColor: accent }]} />
                                    <View style={[styles.timelineLine, { backgroundColor: theme.colors.divider }]} />
                                </View>
                                <View style={styles.timelineContent}>
                                    <View style={styles.dataCardHeader}>
                                        <View style={styles.dataCardTitleWrap}>
                                            <Text style={styles.dataCardTitle}>{entry.title}</Text>
                                            <Text style={styles.dataCardSubtitle}>{entry.subtitle}</Text>
                                        </View>
                                        <Text style={[styles.dataCardTimestamp, { color: accent }]}>{formatTimestamp(entry.timestamp)}</Text>
                                    </View>
                                </View>
                            </Pressable>
                        );
                    })}
                </ItemGroup>

                <ItemGroup title={t("machine.automationJobs")}>
                    {renderSectionBanner({ title: t("machine.automationJobs"), subtitle: recentJobPreview.length < filteredJobs.length ? `${t("machine.automationJobsHint")} · ${t("machine.automationViewAllHint")}` : t("machine.automationJobsHint"), detail: `${visibleJobs.length}/${filteredJobs.length}` })}
                    {filteredJobs.length === 0 ? (
                        <View style={styles.emptyCard}>
                            <Text style={styles.emptyCardTitle}>{((searchQuery.trim() || jobFilter !== "all") ? t("machine.automationNoMatches") : t("machine.automationDetailsEmpty"))}</Text>
                            <Text style={styles.emptyCardSubtitle}>{t("machine.automationJobsHint")}</Text>
                        </View>
                    ) : showAllJobs ? filteredJobs.map((job) => (
                        <Pressable key={job.id} style={styles.dataCard} onPress={() => handleJobPress(job)}>
                            <View style={styles.dataCardHeader}>
                                <View style={styles.dataCardTitleWrap}>
                                    <Text style={styles.dataCardTitle}>{getJobTitle(job)}</Text>
                                    <Text style={styles.dataCardSubtitle}>{formatJobSubtitle(job)}</Text>
                                </View>
                                <View style={styles.statusWrap}>
                                    <View style={[styles.statusBadge, { borderColor: getStatusColor(job.status) ?? theme.colors.divider, backgroundColor: theme.colors.surface }] }>
                                        <Text style={[styles.statusBadgeText, { color: getStatusColor(job.status) ?? theme.colors.text }]}>{getStatusLabel(job.status)}</Text>
                                    </View>
                                    {activeJobId === job.id ? (
                                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                    ) : null}
                                </View>
                            </View>
                            <View style={styles.pillRow}>
                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{getJobKindLabel(job.kind)}</Text></View>
                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationPriority")}: ${getPriorityLabel(job.priority)}`}</Text></View>
                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationCreatedAt")}: ${formatTimestamp(job.createdAt)}`}</Text></View>
                                {job.projectId ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationAuditProject")}: ${job.projectId}`}</Text></View> : null}
                                {job.loopId ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationAuditLoop")}: ${job.loopId}`}</Text></View> : null}
                            </View>
                        </Pressable>
                    )) : recentJobPreview.map((job) => (
                        <Pressable key={job.id} style={styles.dataCard} onPress={() => handleJobPress(job)}>
                            <View style={styles.dataCardHeader}>
                                <View style={styles.dataCardTitleWrap}>
                                    <Text style={styles.dataCardTitle}>{getJobTitle(job)}</Text>
                                    <Text style={styles.dataCardSubtitle}>{formatJobSubtitle(job)}</Text>
                                </View>
                                <View style={styles.statusWrap}>
                                    <View style={[styles.statusBadge, { borderColor: getStatusColor(job.status) ?? theme.colors.divider, backgroundColor: theme.colors.surface }] }>
                                        <Text style={[styles.statusBadgeText, { color: getStatusColor(job.status) ?? theme.colors.text }]}>{getStatusLabel(job.status)}</Text>
                                    </View>
                                    {activeJobId === job.id ? (
                                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                    ) : null}
                                </View>
                            </View>
                            <View style={styles.pillRow}>
                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{getJobKindLabel(job.kind)}</Text></View>
                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationRelatedEvents")}: ${job.relatedEventCount}`}</Text></View>
                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationPriority")}: ${getPriorityLabel(job.priority)}`}</Text></View>
                                <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationCreatedAt")}: ${formatTimestamp(job.createdAt)}`}</Text></View>
                                {job.projectId ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationAuditProject")}: ${job.projectId}`}</Text></View> : null}
                                {job.loopId ? <View style={[styles.pill, { borderColor: theme.colors.divider }]}><Text style={styles.pillText}>{`${t("machine.automationAuditLoop")}: ${job.loopId}`}</Text></View> : null}
                            </View>
                        </Pressable>
                    ))}
                    {filteredJobs.length > recentJobPreview.length ? (
                        <Item
                            title={showAllJobs ? t("machine.automationViewAll") : t("machine.automationViewAll")}
                            subtitle={showAllJobs
                                ? `${t("machine.automationJobs")}: ${filteredJobs.length}`
                                : `${t("machine.automationViewAllHint")} · ${recentJobPreview.length}/${filteredJobs.length}`}
                            onPress={() => setShowAllJobs((current) => !current)}
                            showChevron={false}
                        />
                    ) : null}
                </ItemGroup>
            </ItemList>
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface,
    },
    content: {
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
        paddingBottom: 40,
    },
    rpcNotice: {
        marginHorizontal: 16,
        marginTop: 16,
        marginBottom: -4,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.groupped.background,
        gap: 4,
    },
    rpcNoticeTitle: {
        color: theme.colors.text,
        fontSize: 14,
        fontWeight: "700",
    },
    rpcNoticeText: {
        color: theme.colors.textSecondary,
        fontSize: 12,
    },
    panelHeader: {
        gap: 4,
    },
    panelTitle: {
        color: theme.colors.text,
        fontSize: 16,
        fontWeight: "700",
    },
    panelSubtitle: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
    },
    panelHint: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 17,
        marginTop: -2,
    },
    filterPanel: {
        marginHorizontal: 16,
        marginTop: 16,
        marginBottom: 8,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.groupped.background,
        gap: 10,
    },
    searchInput: {
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.input?.background ?? theme.colors.surface,
        color: theme.colors.text,
        minHeight: 42,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    filterLabel: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        fontWeight: "600",
    },
    filterHint: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 17,
        marginTop: -6,
    },
    filterChipRow: {
        flexDirection: "row",
        flexWrap: "nowrap",
        gap: 8,
        paddingRight: 12,
    },
    filterScroll: {
        flexGrow: 0,
    },
    filterChip: {
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    filterChipSelected: {
        borderColor: theme.colors.textLink,
        backgroundColor: theme.colors.textLink,
    },
    filterChipText: {
        color: theme.colors.text,
        fontSize: 13,
        fontWeight: "600",
    },
    filterChipTextSelected: {
        color: "#FFFFFF",
    },
    filterSummary: {
        color: theme.colors.textSecondary,
        fontSize: 12,
    },
    summaryGrid: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
    },
    summaryCard: {
        width: Platform.OS === "web" ? "31.5%" : "47.5%",
        minHeight: 112,
        padding: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        gap: 6,
    },
    summaryCardTitle: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        fontWeight: "600",
    },
    summaryCardValue: {
        color: theme.colors.text,
        fontSize: 26,
        fontWeight: "800",
    },
    summaryCardHint: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 17,
    },
    sectionBanner: {
        marginHorizontal: 12,
        marginTop: 12,
        marginBottom: 4,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.groupped.background,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
    },
    sectionBannerTextWrap: {
        flex: 1,
        gap: 4,
    },
    sectionBannerTitle: {
        color: theme.colors.text,
        fontSize: 14,
        fontWeight: "700",
    },
    sectionBannerSubtitle: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 17,
    },
    sectionBannerBadge: {
        minHeight: 30,
        minWidth: 44,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        alignItems: "center",
        justifyContent: "center",
    },
    sectionBannerBadgeText: {
        color: theme.colors.text,
        fontSize: 12,
        fontWeight: "700",
    },
    emptyCard: {
        marginHorizontal: 12,
        marginVertical: 8,
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        gap: 4,
    },
    emptyCardTitle: {
        color: theme.colors.text,
        fontSize: 14,
        fontWeight: "700",
    },
    emptyCardSubtitle: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        lineHeight: 17,
    },
    dataCard: {
        marginHorizontal: 12,
        marginVertical: 6,
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
        gap: 10,
    },
    dataCardHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "flex-start",
    },
    dataCardTitleWrap: {
        flex: 1,
        gap: 4,
    },
    dataCardTitle: {
        color: theme.colors.text,
        fontSize: 15,
        fontWeight: "700",
    },
    dataCardSubtitle: {
        color: theme.colors.textSecondary,
        fontSize: 13,
        lineHeight: 18,
    },
    dataCardTimestamp: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        fontWeight: "600",
        textAlign: "right",
        maxWidth: 132,
    },
    pillRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    pill: {
        minHeight: 28,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.surfaceHigh ?? theme.colors.surface,
    },
    pillText: {
        color: theme.colors.textSecondary,
        fontSize: 12,
        fontWeight: "600",
    },
    statusWrap: {
        alignItems: "flex-end",
        gap: 8,
    },
    statusBadge: {
        minHeight: 28,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    statusBadgeText: {
        fontSize: 12,
        fontWeight: "700",
    },
    timelineCard: {
        marginHorizontal: 12,
        marginVertical: 4,
        flexDirection: "row",
        gap: 10,
    },
    timelineRail: {
        width: 16,
        alignItems: "center",
    },
    timelineDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        marginTop: 10,
    },
    timelineLine: {
        width: 2,
        flex: 1,
        marginTop: 4,
        marginBottom: -4,
    },
    timelineContent: {
        flex: 1,
        padding: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.divider,
        backgroundColor: theme.colors.surface,
    },
    centered: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.surface,
    },
}));
