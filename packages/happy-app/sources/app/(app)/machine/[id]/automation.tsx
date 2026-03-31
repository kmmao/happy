import * as React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { ItemList } from "@/components/ItemList";
import { layout } from "@/components/layout";
import { Modal } from "@/modal";
import {
    machineAutomationStatus,
    machineCancelAutomationJob,
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
} from "@/sync/ops";
import { useMachine } from "@/sync/storage";
import { t } from "@/text";

type TimelineEntry = {
    key: string;
    jobId: string;
    timestamp: number;
    title: string;
    subtitle: string;
    kind: "queued" | "dispatched" | "running" | "terminal";
};
type JobFilter = "all" | "running" | "failed" | "terminal";
type AuditFilter = "all" | "anomalies" | "guardian" | "jobs";

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
            return event.kind.startsWith("job_") || event.kind === "watchdog_stopped" || event.kind === "session_stop_requested";
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

function getGuardianStateLabel(attached?: boolean): string {
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
        case "watchdog_stopped":
            return t("machine.automationAuditEventWatchdogStopped");
        case "session_stop_requested":
            return t("machine.automationAuditEventStopRequested");
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

export default React.memo(function MachineAutomationPage() {
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const machine = useMachine(machineId!);
    const router = useRouter();
    const { theme } = useUnistyles();
    const [status, setStatus] = React.useState<MachineAutomationStatus | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [activeJobId, setActiveJobId] = React.useState<string | null>(null);
    const [clearing, setClearing] = React.useState(false);
    const [clearingGuardians, setClearingGuardians] = React.useState(false);
    const [clearingAudit, setClearingAudit] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState("");
    const [jobFilter, setJobFilter] = React.useState<JobFilter>("all");
    const [auditFilter, setAuditFilter] = React.useState<AuditFilter>("all");

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
            const fresh = await machineAutomationStatus(machineId);
            setStatus(fresh);
        } catch {
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
        } finally {
            if (kind === "initial") {
                setLoading(false);
            } else {
                setRefreshing(false);
            }
        }
    }, [machineId, machine?.daemonState?.automation]);

    React.useEffect(() => {
        void load("initial");
    }, [load]);

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

    const filteredGuardians = React.useMemo(() => guardians.filter((guardian) => matchesSearch([
        guardian.key,
        guardian.projectId,
        guardian.loopId,
        guardian.sessionId,
        guardian.lastRunId,
    ], searchQuery)), [guardians, searchQuery]);

    const filteredGuardianUsage = React.useMemo(() => guardianUsage.filter((entry) => matchesSearch([
        entry.key,
        entry.projectId,
        entry.loopId,
        entry.currentSessionId,
    ], searchQuery)), [guardianUsage, searchQuery]);

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

    const timeline = React.useMemo(() => buildTimelineEntries(filteredJobs).slice(0, 30), [filteredJobs]);
    const counts = status?.counts ?? machine?.daemonState?.automation?.counts ?? {};
    const persistedGuardianCount = React.useMemo(() => guardians.filter((guardian) => guardian.attached === false).length, [guardians]);
    const anomalyCount = (auditStats?.watchdogStopCount ?? 0) + (auditStats?.stopRequestCount ?? 0) + (counts.failed ?? 0);

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
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
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
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
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
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
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
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
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

        if (job.projectId && job.loopId) {
            buttons.push({
                text: t("machine.automationOpenLoop"),
                onPress: () => router.push(`/project/${job.projectId}/supervisor-loop/${job.loopId}` as any),
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
        buttons.push({
            text: t("machine.automationOpenProject"),
            onPress: () => router.push(`/project/${guardian.projectId}` as any),
        });
        if (guardian.loopId) {
            buttons.push({
                text: t("machine.automationOpenLoop"),
                onPress: () => router.push(`/project/${guardian.projectId}/supervisor-loop/${guardian.loopId}` as any),
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
            `${getGuardianDetailMessage(guardian, usage, relatedEvents)}\n${t("machine.automationStatusLabel")}: ${getGuardianStateLabel(guardian.attached)}`,
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
        if (event.projectId && event.loopId) {
            buttons.push({
                text: t("machine.automationOpenLoop"),
                onPress: () => router.push(`/project/${event.projectId}/supervisor-loop/${event.loopId}` as any),
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
            <View style={styles.filterPanel}>
                <TextInput
                    style={styles.searchInput}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder={t("machine.automationSearchPlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                />
                <Text style={styles.filterLabel}>{t("machine.automationJobFilters")}</Text>
                <View style={styles.filterChipRow}>
                    {([
                        ["all", t("machine.automationFilterAll")],
                        ["running", t("machine.automationFilterRunning")],
                        ["failed", t("machine.automationFilterFailed")],
                        ["terminal", t("machine.automationFilterTerminal")],
                    ] as Array<[JobFilter, string]>).map(([value, label]) => (
                        <Pressable
                            key={value}
                            style={[styles.filterChip, jobFilter === value && styles.filterChipSelected]}
                            onPress={() => setJobFilter(value)}
                        >
                            <Text style={[styles.filterChipText, jobFilter === value && styles.filterChipTextSelected]}>{label}</Text>
                        </Pressable>
                    ))}
                </View>
                <Text style={styles.filterLabel}>{t("machine.automationAuditFilters")}</Text>
                <View style={styles.filterChipRow}>
                    {([
                        ["all", t("machine.automationFilterAll")],
                        ["anomalies", t("machine.automationFilterAnomalies")],
                        ["guardian", t("machine.automationFilterGuardian")],
                        ["jobs", t("machine.automationFilterJobs")],
                    ] as Array<[AuditFilter, string]>).map(([value, label]) => (
                        <Pressable
                            key={value}
                            style={[styles.filterChip, auditFilter === value && styles.filterChipSelected]}
                            onPress={() => setAuditFilter(value)}
                        >
                            <Text style={[styles.filterChipText, auditFilter === value && styles.filterChipTextSelected]}>{label}</Text>
                        </Pressable>
                    ))}
                </View>
                <Text style={styles.filterSummary}>{`${filteredJobs.length}/${jobs.length} jobs • ${filteredAuditEvents.length}/${recentAuditEvents.length} audit`}</Text>
            </View>

            <ItemList>
                {persistedGuardianCount > 0 || anomalyCount > 0 ? (
                    <ItemGroup title={t("machine.automationAlerts")}>
                        {persistedGuardianCount > 0 ? (
                            <Item
                                title={t("machine.automationGuardianRecoveryNeeded")}
                                subtitle={t("machine.automationGuardianRecoveryNeededMessage")}
                                detail={String(persistedGuardianCount)}
                                detailStyle={{ color: "#FF9500" }}
                                showChevron={false}
                            />
                        ) : null}
                        {anomalyCount > 0 ? (
                            <Item
                                title={t("machine.automationAnomaliesDetected")}
                                subtitle={`${t("machine.automationFailed")}: ${counts.failed ?? 0} • ${t("machine.automationWatchdogStops")}: ${auditStats?.watchdogStopCount ?? 0} • ${t("machine.automationStopRequests")}: ${auditStats?.stopRequestCount ?? 0}`}
                                detail={String(anomalyCount)}
                                detailStyle={{ color: "#FF3B30" }}
                                showChevron={false}
                            />
                        ) : null}
                    </ItemGroup>
                ) : null}
                <ItemGroup title={t("machine.automation")}>
                    <Item title={t("machine.automationQueued")} detail={String(counts.queued ?? 0)} showChevron={false} />
                    <Item title={t("machine.automationRunning")} detail={String((counts.running ?? 0) + (counts.dispatching ?? 0))} detailStyle={{ color: "#0A84FF" }} showChevron={false} />
                    <Item title={t("machine.automationGuardians")} detail={String(filteredGuardians.length)} showChevron={false} />
                    <Item title={t("machine.automationFailed")} detail={String(counts.failed ?? 0)} detailStyle={{ color: "#FF3B30" }} showChevron={false} />
                    <Item title={t("machine.automationCompleted")} detail={String(counts.completed ?? 0)} detailStyle={{ color: "#34C759" }} showChevron={false} />
                    <Item title={t("machine.automationCancelled")} detail={String(counts.cancelled ?? 0)} detailStyle={{ color: theme.colors.textSecondary }} showChevron={false} />
                    <Item
                        title={t("machine.automationClearTerminal")}
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

                <ItemGroup title={t("machine.automationGuardians")}>
                    <Item
                        title={t("machine.automationResetGuardians")}
                        titleStyle={{ color: theme.colors.textLink }}
                        onPress={() => {
                            Modal.alert(
                                t("machine.automationResetGuardians"),
                                t("machine.automationResetGuardiansMessage"),
                                [
                                    { text: t("common.cancel"), style: "cancel" },
                                    {
                                        text: t("machine.automationResetGuardians"),
                                        style: "destructive",
                                        onPress: () => void clearGuardians({ clearAll: true }),
                                    },
                                ],
                            );
                        }}
                        rightElement={clearingGuardians ? <ActivityIndicator size="small" color={theme.colors.textSecondary} /> : undefined}
                    />
                    {filteredGuardians.length === 0 ? (
                        <Item title={searchQuery.trim() ? t("machine.automationNoMatches") : t("machine.automationGuardiansEmpty")} showChevron={false} />
                    ) : filteredGuardians.map((guardian: MachineAutomationGuardian) => (
                        <Item
                            key={guardian.key}
                            title={guardian.key}
                            subtitle={`${t("machine.automationGuardianSession")}: ${guardian.sessionId} • ${getGuardianStateLabel(guardian.attached)}`}
                            detail={formatTimestamp(guardian.updatedAt)}
                            onPress={() => handleGuardianPress(guardian)}
                            showChevron
                        />
                    ))}
                </ItemGroup>

                <ItemGroup title={t("machine.automationAuditStats")}>
                    <Item title={t("machine.automationTotalAuditEvents")} detail={String(auditStats?.totalEvents ?? 0)} showChevron={false} />
                    <Item title={t("machine.automationGuardianReuseCount")} detail={String(auditStats?.guardianReuseCount ?? 0)} showChevron={false} />
                    <Item title={t("machine.automationGuardianReuseRate")} detail={formatRate(auditStats?.guardianReuseRate)} showChevron={false} />
                    <Item title={t("machine.automationGuardianResetCount")} detail={String(auditStats?.guardianResetCount ?? 0)} showChevron={false} />
                    <Item title={t("machine.automationWatchdogStops")} detail={String(auditStats?.watchdogStopCount ?? 0)} showChevron={false} />
                    <Item title={t("machine.automationStopRequests")} detail={String(auditStats?.stopRequestCount ?? 0)} showChevron={false} />
                    {auditStats?.lastEventAt ? (
                        <Item title={t("machine.automationLastAuditEvent")} detail={formatTimestamp(auditStats.lastEventAt)} showChevron={false} />
                    ) : null}
                </ItemGroup>

                <ItemGroup title={t("machine.automationGuardianUsage")}>
                    {filteredGuardianUsage.length === 0 ? (
                        <Item title={searchQuery.trim() ? t("machine.automationNoMatches") : t("machine.automationGuardianUsageEmpty")} showChevron={false} />
                    ) : filteredGuardianUsage.map((entry: MachineAutomationGuardianUsage) => {
                        const matchingGuardian = guardians.find((guardian) => guardian.key === entry.key);
                        return (
                            <Item
                                key={entry.key}
                                title={entry.key}
                                subtitle={getGuardianUsageSubtitle(entry)}
                                detail={formatTimestamp(entry.lastUsedAt)}
                                onPress={matchingGuardian
                                    ? () => handleGuardianPress(matchingGuardian)
                                    : entry.currentSessionId
                                        ? () => router.push(`/session/${entry.currentSessionId}` as any)
                                        : undefined}
                                showChevron={Boolean(matchingGuardian || entry.currentSessionId)}
                            />
                        );
                    })}
                </ItemGroup>

                <ItemGroup title={t("machine.automationAudit")}>
                    <Item
                        title={t("machine.automationClearAudit")}
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
                        <Item title={(searchQuery.trim() || auditFilter !== "all") ? t("machine.automationNoMatches") : t("machine.automationAuditEmpty")} showChevron={false} />
                    ) : filteredAuditEvents.map((event: MachineAutomationAuditEvent) => (
                        <Item
                            key={event.id}
                            title={getAuditEventTitle(event)}
                            subtitle={getAuditEventSubtitle(event)}
                            detail={formatTimestamp(event.occurredAt)}
                            onPress={() => handleAuditEventPress(event)}
                            showChevron
                        />
                    ))}
                </ItemGroup>

                <ItemGroup title={t("machine.automationTimeline")}>
                    {timeline.length === 0 ? (
                        <Item title={t("machine.automationTimelineEmpty")} showChevron={false} />
                    ) : timeline.map((entry) => {
                        const job = jobs.find((candidate) => candidate.id === entry.jobId);
                        return (
                            <Item
                                key={entry.key}
                                title={entry.title}
                                subtitle={entry.subtitle}
                                detail={formatTimestamp(entry.timestamp)}
                                detailStyle={{ color: entry.kind === "terminal" ? theme.colors.textSecondary : undefined }}
                                onPress={job ? () => handleJobPress(job) : undefined}
                                showChevron={Boolean(job)}
                            />
                        );
                    })}
                </ItemGroup>

                <ItemGroup title={t("machine.automationJobs")}>
                    {filteredJobs.length === 0 ? (
                        <Item title={(searchQuery.trim() || jobFilter !== "all") ? t("machine.automationNoMatches") : t("machine.automationDetailsEmpty")} showChevron={false} />
                    ) : filteredJobs.map((job) => (
                        <Item
                            key={job.id}
                            title={getJobTitle(job)}
                            subtitle={formatJobSubtitle(job)}
                            detail={getStatusLabel(job.status)}
                            detailStyle={{ color: getStatusColor(job.status) }}
                            onPress={() => handleJobPress(job)}
                            showChevron
                            rightElement={
                                activeJobId === job.id ? (
                                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                ) : undefined
                            }
                        />
                    ))}
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
    filterChipRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
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
    centered: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.surface,
    },
}));
