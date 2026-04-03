import * as React from "react";
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
import { Modal } from "@/modal";
import { t } from "@/text";
import {
    buildAutomationAlerts,
    buildAutomationOverviewCards,
    getRecentJobPreview,
} from "./automationLayout";
import {
    type AuditFilter,
    type GuardianFilter,
    type JobFilter,
    AUDIT_FILTER_VALUES,
    AUTOMATION_SECTION_PREVIEW_LIMIT,
    AUTOMATION_TIMELINE_PREVIEW_LIMIT,
    GUARDIAN_FILTER_VALUES,
    JOB_FILTER_VALUES,
    buildTimelineEntries,
    isRpcMethodUnavailableError,
    matchesAuditFilter,
    matchesGuardianFilter,
    matchesJobFilter,
    matchesSearch,
    parseFilterValue,
} from "./automationLabels";

export function useAutomationData(params: {
    machineId: string | undefined;
    initialQueryParam: string | undefined;
    initialJobFilterParam: string | undefined;
    initialAuditFilterParam: string | undefined;
    initialGuardianFilterParam: string | undefined;
}) {
    const { machineId, initialQueryParam, initialJobFilterParam, initialAuditFilterParam, initialGuardianFilterParam } = params;
    const machine = useMachine(machineId!);
    const rpcReady = machine?.rpcReady ?? false;

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
    const [overviewFiltersExpanded, setOverviewFiltersExpanded] = React.useState(() =>
        initialJobFilter !== "all"
        || initialAuditFilter !== "all"
        || initialGuardianFilter !== "all"
        || Boolean((typeof initialQueryParam === "string" ? initialQueryParam : "").trim()),
    );

    const [showAllJobs, setShowAllJobs] = React.useState(false);
    const [showAllGuardians, setShowAllGuardians] = React.useState(false);
    const [showAllGuardianUsage, setShowAllGuardianUsage] = React.useState(false);
    const [showAllAuditEvents, setShowAllAuditEvents] = React.useState(false);
    const [showAllTimeline, setShowAllTimeline] = React.useState(false);

    // ── Data loading ────────────────────────────────────────────────────

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

    // ── Derived data ────────────────────────────────────────────────────

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

    const loopNameMap = React.useMemo(() => {
        const map = new Map<string, string>();
        for (const loop of loopStatus) {
            if (loop.name) {
                map.set(loop.id, loop.name);
            }
        }
        return map;
    }, [loopStatus]);

    const resolveLoopName = React.useCallback((loopId: string | undefined | null): string | undefined => {
        if (!loopId) return undefined;
        return loopNameMap.get(loopId);
    }, [loopNameMap]);

    const resolveGuardianKeyLabel = React.useCallback((key: string): string => {
        const loopPrefix = "agent-loop:";
        if (key.startsWith(loopPrefix)) {
            const loopId = key.slice(loopPrefix.length);
            const name = loopNameMap.get(loopId);
            return name ?? key;
        }
        return key;
    }, [loopNameMap]);

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

    // ── Filtered data ───────────────────────────────────────────────────

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

    // ── Timeline ────────────────────────────────────────────────────────

    const fullTimelineEntries = React.useMemo(() => buildTimelineEntries(filteredJobs), [filteredJobs]);
    const visibleTimelineEntries = React.useMemo(() => {
        if (showAllTimeline || fullTimelineEntries.length <= AUTOMATION_TIMELINE_PREVIEW_LIMIT) {
            return fullTimelineEntries;
        }
        return fullTimelineEntries.slice(0, AUTOMATION_TIMELINE_PREVIEW_LIMIT);
    }, [fullTimelineEntries, showAllTimeline]);

    // ── Computed values ─────────────────────────────────────────────────

    const counts = status?.counts ?? machine?.daemonState?.automation?.counts ?? {};
    const persistedGuardianCount = React.useMemo(() => guardians.filter((guardian) => guardian.attached === false).length, [guardians]);
    const anomalyCount = (auditStats?.watchdogStopCount ?? 0) + (counts.failed ?? 0);
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

    // ── Visible slices ──────────────────────────────────────────────────

    const visibleJobs = showAllJobs ? filteredJobs : recentJobPreview;
    const visibleGuardians = React.useMemo(() => {
        if (showAllGuardians || filteredGuardians.length <= AUTOMATION_SECTION_PREVIEW_LIMIT) {
            return filteredGuardians;
        }
        return filteredGuardians.slice(0, AUTOMATION_SECTION_PREVIEW_LIMIT);
    }, [filteredGuardians, showAllGuardians]);
    const visibleGuardianUsage = React.useMemo(() => {
        if (showAllGuardianUsage || filteredGuardianUsage.length <= AUTOMATION_SECTION_PREVIEW_LIMIT) {
            return filteredGuardianUsage;
        }
        return filteredGuardianUsage.slice(0, AUTOMATION_SECTION_PREVIEW_LIMIT);
    }, [filteredGuardianUsage, showAllGuardianUsage]);
    const visibleAuditEvents = React.useMemo(() => {
        if (showAllAuditEvents || filteredAuditEvents.length <= AUTOMATION_SECTION_PREVIEW_LIMIT) {
            return filteredAuditEvents;
        }
        return filteredAuditEvents.slice(0, AUTOMATION_SECTION_PREVIEW_LIMIT);
    }, [filteredAuditEvents, showAllAuditEvents]);

    React.useEffect(() => {
        setShowAllJobs(false);
        setShowAllGuardians(false);
        setShowAllGuardianUsage(false);
        setShowAllAuditEvents(false);
        setShowAllTimeline(false);
    }, [searchQuery, jobFilter, auditFilter, guardianFilter]);

    // ── Mutations ───────────────────────────────────────────────────────

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

    const clearGuardians = React.useCallback(async (clearParams: { key?: string; sessionId?: string; clearAll?: boolean }) => {
        setClearingGuardians(true);
        try {
            const result = await machineClearAutomationGuardians(machineId!, clearParams);
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

    const stopJobSession = React.useCallback(async (jobId: string, sessionId: string) => {
        setActiveJobId(jobId);
        try {
            await machineStopSession(machineId!, sessionId);
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), error instanceof Error ? error.message : String(error));
        } finally {
            setActiveJobId(null);
        }
    }, [load, machineId]);

    return {
        machine,
        rpcReady,
        status,
        loading,
        refreshing,
        activeJobId,
        clearing,
        clearingGuardians,
        clearingAudit,
        searchQuery,
        setSearchQuery,
        jobFilter,
        setJobFilter,
        auditFilter,
        setAuditFilter,
        guardianFilter,
        setGuardianFilter,
        overviewFiltersExpanded,
        setOverviewFiltersExpanded,
        showAllJobs,
        setShowAllJobs,
        showAllGuardians,
        setShowAllGuardians,
        showAllGuardianUsage,
        setShowAllGuardianUsage,
        showAllAuditEvents,
        setShowAllAuditEvents,
        showAllTimeline,
        setShowAllTimeline,
        load,
        jobs,
        guardians,
        guardianUsage,
        auditStats,
        loopRollup,
        recentAuditEvents,
        filteredJobs,
        filteredGuardians,
        filteredGuardianUsage,
        filteredAuditEvents,
        fullTimelineEntries,
        visibleTimelineEntries,
        counts,
        alertCards,
        overviewCards,
        recentJobPreview,
        visibleJobs,
        visibleGuardians,
        visibleGuardianUsage,
        visibleAuditEvents,
        resolveLoopName,
        resolveGuardianKeyLabel,
        mutateAndReload,
        clearGuardians,
        clearAudit,
        clearTerminal,
        stopJobSession,
    };
}
