import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { MachineNavigationSummaryItem } from "@/components/machine/MachineNavigationSummaryItem";
import type { Machine } from "@/sync/storageTypes";
import {
    machineCancelAutomationJob,
    machineClearAutomationGuardians,
    machineClearAutomationJobs,
    machineRetryAutomationJob,
    machineStopSession,
} from "@/sync/ops";
import { t } from "@/text";
import { useUnistyles } from "react-native-unistyles";
import { Modal } from "@/modal";
import { projectManager } from "@/sync/projectManager";
import { useHappyAction } from "@/hooks/useHappyAction";

type Props = {
    machine: Machine;
    machineId: string;
};

type PendingJobAction =
    | { type: "retry"; jobId: string }
    | { type: "cancel"; jobId: string }
    | { type: "stop"; jobId: string; sessionId: string }
    | null;

type AutomationJobLike = {
    id: string;
    dedupeKey: string;
    status: string;
    updatedAt: number;
    nextRunAt?: number;
    sessionId?: string;
    errorMessage?: string;
    label?: string;
    projectId?: string;
    loopId?: string;
    loopIteration?: number;
    continuityKey?: string;
    recovered?: boolean;
};

type AutomationGuardianLike = {
    key: string;
    projectId: string;
    loopId?: string;
    sessionId: string;
    updatedAt: number;
    lastRunId?: string;
    attached?: boolean;
    recovered?: boolean;
};

function truncateGuardianKey(key: string): string {
    const prefix = "agent-loop:";
    if (key.startsWith(prefix)) {
        return `${prefix}${key.slice(prefix.length, prefix.length + 8)}`;
    }
    return key;
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

function getJobTitle(job: AutomationJobLike): string {
    return job.label || job.dedupeKey;
}

function getJobSubtitle(job: AutomationJobLike): string {
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
        const shortKey = job.continuityKey.startsWith("agent-loop:")
            ? job.continuityKey.slice(0, "agent-loop:".length + 8)
            : job.continuityKey;
        parts.push(`${t("machine.automationContinuity")}: ${shortKey}`);
    }
    if (job.sessionId) {
        parts.push(`${t("machine.automationSession")}: ${job.sessionId.slice(0, 12)}…`);
    }
    if (job.nextRunAt) {
        parts.push(`${t("machine.automationNextRunAt")}: ${new Date(job.nextRunAt).toLocaleString()}`);
    }
    if (job.recovered) {
        parts.push(t("machine.automationRecoveredShort"));
    }
    if (parts.length === 0) {
        parts.push(new Date(job.updatedAt).toLocaleString());
    }
    return parts.join(" • ");
}

function formatRate(value?: number): string {
    if (value == null || Number.isNaN(value)) {
        return "0%";
    }
    return `${Math.round(value * 100)}%`;
}

export const AutomationSummaryItem = React.memo(function AutomationSummaryItem({
    machine,
    machineId,
}: Props) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const automation = machine.daemonState?.automation as any;

    const subtitle = useMemo(() => {
        if (!automation) {
            return t("machine.automationViewAllHint");
        }
        const counts = automation.counts ?? {};
        const runningCount = (counts.running ?? 0) + (counts.dispatching ?? 0);
        const guardianCount = Array.isArray(automation.guardians) ? automation.guardians.length : 0;
        const loopRollup = automation.loopRollup ?? {};
        const parts = [
            `${t("machine.automationQueued")} (${counts.queued ?? 0})`,
            `${t("machine.automationRunning")} (${runningCount})`,
        ];
        if ((loopRollup.total ?? 0) > 0) {
            parts.push(`${t("machine.automationLoopsTotal")} (${loopRollup.total ?? 0})`);
        }
        if (guardianCount > 0) {
            parts.push(`${t("machine.automationGuardians")} (${guardianCount})`);
        }
        return parts.join("  ·  ");
    }, [automation]);

    return (
        <Item
            title={t("machine.automation")}
            subtitle={subtitle}
            icon={<Ionicons name="sparkles-outline" size={20} color={theme.colors.textLink} />}
            onPress={() => router.push(`/machine/${machineId}/automation` as any)}
            showChevron
        />
    );
});

function getGuardianStateLabel(attached?: boolean, recovered?: boolean): string {
    if (attached && recovered) {
        return t("machine.automationGuardianRecovered");
    }
    return attached ? t("machine.automationGuardianAttached") : t("machine.automationGuardianPersisted");
}

export const AgentLoopsSummaryItem = React.memo(function AgentLoopsSummaryItem({
    machine,
    machineId,
}: Props) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const automation = machine.daemonState?.automation as any;

    const subtitle = useMemo(() => {
        const loopRollup = automation?.loopRollup;
        if (!loopRollup) {
            return t("machine.agentLoopsViewAllHint");
        }
        const parts = [
            `${t("machine.automationLoopsTotal")} (${loopRollup.total ?? 0})`,
            `${t("machine.automationLoopsActive")} (${loopRollup.active ?? 0})`,
        ];
        if ((loopRollup.blocked ?? 0) > 0) {
            parts.push(`${t("machine.automationLoopsBlocked")} (${loopRollup.blocked ?? 0})`);
        }
        if ((loopRollup.paused ?? 0) > 0) {
            parts.push(`${t("machine.automationLoopsPaused")} (${loopRollup.paused ?? 0})`);
        }
        if ((loopRollup.pendingEvents ?? 0) > 0) {
            parts.push(`${t("machine.automationLoopsPendingEvents")} (${loopRollup.pendingEvents ?? 0})`);
        }
        return parts.join("  ·  ");
    }, [automation]);

    return (
        <Item
            title={t("machine.agentLoopsViewAll")}
            subtitle={subtitle}
            icon={<Ionicons name="repeat-outline" size={20} color={theme.colors.textLink} />}
            onPress={() => router.push(`/machine/${machineId}/loops` as any)}
            showChevron
        />
    );
});

export const AutomationSummarySection = React.memo(function AutomationSummarySection({
    machine,
    machineId,
}: Props) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const automation = machine.daemonState?.automation as any;
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const pendingActionRef = useRef<PendingJobAction>(null);

    const [isMutatingJob, doMutateJob] = useHappyAction(async () => {
        const pending = pendingActionRef.current;
        if (!pending) {
            return;
        }
        if (pending.type === "retry") {
            const result = await machineRetryAutomationJob(machineId, pending.jobId);
            if (!result.success) {
                throw new Error(result.errorMessage || t("machine.automationRetryFailed"));
            }
            return;
        }
        if (pending.type === "stop") {
            await machineStopSession(machineId, pending.sessionId);
            return;
        }
        const result = await machineCancelAutomationJob(machineId, pending.jobId);
        if (!result.success) {
            throw new Error(result.errorMessage || t("machine.automationCancelFailed"));
        }
    });

    const [isClearingGuardians, doClearGuardians] = useHappyAction(async () => {
        const result = await machineClearAutomationGuardians(machineId, { clearAll: true });
        if (!result.success) {
            throw new Error(result.errorMessage || t("machine.automationResetGuardianFailed"));
        }
    });

    const [isClearing, doClear] = useHappyAction(async () => {
        const result = await machineClearAutomationJobs(machineId);
        if (!result.success) {
            throw new Error(result.errorMessage || t("machine.automationClearFailed"));
        }
    });

    React.useEffect(() => {
        if (!isMutatingJob) {
            setActiveJobId(null);
            pendingActionRef.current = null;
        }
    }, [isMutatingJob]);

    const recentJobs = useMemo<AutomationJobLike[]>(() => {
        if (!Array.isArray(automation?.recentJobs)) {
            return [];
        }
        return automation.recentJobs.slice(0, 5);
    }, [automation]);

    const guardians = useMemo<AutomationGuardianLike[]>(() => {
        if (!Array.isArray(automation?.guardians)) {
            return [];
        }
        return automation.guardians.slice().sort((a: AutomationGuardianLike, b: AutomationGuardianLike) => b.updatedAt - a.updatedAt).slice(0, 2);
    }, [automation]);

    const guardianCount = Array.isArray(automation?.guardians) ? automation.guardians.length : 0;
    const recoveredGuardianCount = Array.isArray(automation?.guardians)
        ? automation.guardians.filter((guardian: AutomationGuardianLike) => guardian.recovered).length
        : 0;
    const recoveredJobCount = Array.isArray(automation?.recentJobs)
        ? automation.recentJobs.filter((job: AutomationJobLike) => job.recovered).length
        : 0;
    const auditStats = automation?.auditStats;
    const guardianUsagePreview = Array.isArray(automation?.guardianUsage)
        ? automation.guardianUsage.slice().sort((a: any, b: any) => b.lastUsedAt - a.lastUsedAt).slice(0, 1)
        : [];

    if (!automation) {
        return null;
    }

    const counts = automation.counts ?? {};
    const persistedGuardianCount = guardians.filter((guardian) => guardian.attached === false).length;
    const anomalyCount = (auditStats?.watchdogStopCount ?? 0) + (counts.failed ?? 0);
    const activeRunningCount = (counts.running ?? 0) + (counts.dispatching ?? 0);

    const getLocalProjectId = React.useCallback((serverProjectId?: string) => {
        if (!serverProjectId) return null;
        return projectManager.getProjectByServerId(serverProjectId)?.id ?? null;
    }, []);

    const triggerJobAction = (action: PendingJobAction) => {
        pendingActionRef.current = action;
        setActiveJobId(action?.jobId ?? null);
        doMutateJob();
    };

    const handleJobPress = (job: AutomationJobLike) => {
        const canRetry = job.status === "failed" || job.status === "cancelled" || job.status === "completed";
        const canCancel = job.status === "queued";
        const canStop = (job.status === "running" || job.status === "dispatching") && !!job.sessionId;

        const buttons: Array<{ text: string; style?: "cancel" | "default" | "destructive"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
        ];

        if (job.projectId && job.loopId) {
            buttons.push({
                text: t("machine.automationOpenLoop"),
                onPress: () => {
                    const localProjectId = getLocalProjectId(job.projectId);
                    if (localProjectId) {
                        router.push(`/project/${localProjectId}/supervisor-loop/${job.loopId}` as any);
                    }
                },
            });
        }

        if (job.projectId) {
            buttons.push({
                text: t("machine.automationOpenProject"),
                onPress: () => {
                    const localProjectId = getLocalProjectId(job.projectId);
                    if (localProjectId) {
                        router.push(`/project/${localProjectId}` as any);
                    }
                },
            });
        }

        if (job.sessionId) {
            buttons.push({
                text: t("machine.automationOpenSession"),
                onPress: () => router.push(`/session/${job.sessionId}` as any),
            });
        }

        if (canRetry) {
            buttons.push({
                text: t("machine.automationRetry"),
                onPress: () => triggerJobAction({ type: "retry", jobId: job.id }),
            });
        }

        if (canCancel) {
            buttons.push({
                text: t("machine.automationCancel"),
                style: "destructive",
                onPress: () => triggerJobAction({ type: "cancel", jobId: job.id }),
            });
        }

        if (canStop && job.sessionId) {
            buttons.push({
                text: t("machine.automationStop"),
                style: "destructive",
                onPress: () => triggerJobAction({ type: "stop", jobId: job.id, sessionId: job.sessionId! }),
            });
        }

        Modal.alert(getJobTitle(job), getJobSubtitle(job), buttons);
    };

    const handleGuardianPress = (guardian: AutomationGuardianLike) => {
        const buttons: Array<{ text: string; style?: "cancel" | "default"; onPress?: () => void }> = [
            { text: t("common.cancel"), style: "cancel" },
            {
                text: t("machine.automationOpenSession"),
                onPress: () => router.push(`/session/${guardian.sessionId}` as any),
            },
        ];

        buttons.push({
            text: t("machine.automationOpenProject"),
            onPress: () => {
                const localProjectId = getLocalProjectId(guardian.projectId);
                if (localProjectId) {
                    router.push(`/project/${localProjectId}` as any);
                }
            },
        });

        if (guardian.loopId) {
            buttons.push({
                text: t("machine.automationOpenLoop"),
                onPress: () => {
                    const localProjectId = getLocalProjectId(guardian.projectId);
                    if (localProjectId) {
                        router.push(`/project/${localProjectId}/supervisor-loop/${guardian.loopId}` as any);
                    }
                },
            });
        }

        Modal.alert(
            guardian.key,
            `${t("machine.automationGuardianSession")}: ${guardian.sessionId} • ${getGuardianStateLabel(guardian.attached, guardian.recovered)} • ${new Date(guardian.updatedAt).toLocaleString()}`,
            buttons,
        );
    };

    return (
        <ItemGroup title={t("machine.automation")}>
            <Item
                title={t("machine.automationViewAll")}
                subtitle={t("machine.automationViewAllHint")}
                onPress={() => router.push(`/machine/${machineId}/automation` as any)}
                showChevron
            />
            <Item
                title={t("machine.agentLoopsViewAll")}
                subtitle={t("machine.agentLoopsViewAllHint")}
                onPress={() => router.push(`/machine/${machineId}/loops` as any)}
                showChevron
            />
            <Item title={t("machine.automationQueued")} detail={String(counts.queued ?? 0)} showChevron={false} />
            <Item
                title={t("machine.automationRunning")}
                detail={String(activeRunningCount)}
                detailStyle={{ color: "#0A84FF" }}
                showChevron={false}
            />
            <Item
                title={t("machine.automationFailed")}
                detail={String(counts.failed ?? 0)}
                detailStyle={{ color: "#FF3B30" }}
                showChevron={false}
            />
            <Item
                title={t("machine.automationCompleted")}
                detail={String(counts.completed ?? 0)}
                detailStyle={{ color: "#34C759" }}
                showChevron={false}
            />
            <Item
                title={t("machine.automationCancelled")}
                detail={String(counts.cancelled ?? 0)}
                detailStyle={{ color: theme.colors.textSecondary }}
                showChevron={false}
            />
            <Item
                title={t("machine.automationGuardians")}
                detail={String(guardianCount)}
                showChevron={false}
            />
            {persistedGuardianCount > 0 ? (
                <Item
                    title={t("machine.automationGuardianRecoveryNeeded")}
                    subtitle={t("machine.automationGuardianRecoveryNeededMessage")}
                    detail={String(persistedGuardianCount)}
                    detailStyle={{ color: "#FF9500" }}
                    showChevron={false}
                />
            ) : null}
            {auditStats && auditStats.sessionReattachedCount > 0 ? (
                <Item
                    title={t("machine.automationRecoveredSessions")}
                    subtitle={`${t("machine.automationRecoveredGuardians")}: ${recoveredGuardianCount} • ${t("machine.automationRecoveredJobs")}: ${recoveredJobCount}`}
                    detail={String(auditStats.sessionReattachedCount)}
                    detailStyle={{ color: "#34C759" }}
                    onPress={() => router.push(`/machine/${machineId}/automation?jobFilter=recovered&auditFilter=recovered&guardianFilter=recovered` as any)}
                    showChevron
                />
            ) : null}
            {anomalyCount > 0 ? (
                <Item
                    title={t("machine.automationAlerts")}
                    subtitle={t("machine.automationAnomaliesDetected")}
                    detail={String(anomalyCount)}
                    detailStyle={{ color: "#FF3B30" }}
                    showChevron={false}
                />
            ) : null}
            {auditStats ? (
                <Item
                    title={t("machine.automationGuardianReuseRate")}
                    subtitle={`${t("machine.automationGuardianReuseCount")}: ${auditStats.guardianReuseCount} • ${t("machine.automationGuardianResetCount")}: ${auditStats.guardianResetCount}`}
                    detail={formatRate(auditStats.guardianReuseRate)}
                    showChevron={false}
                />
            ) : null}
            {auditStats ? (
                <Item
                    title={t("machine.automationWatchdogStops")}
                    subtitle={`${t("machine.automationStopRequests")}: ${auditStats.stopRequestCount}`}
                    detail={String(auditStats.watchdogStopCount)}
                    showChevron={false}
                />
            ) : null}
            {automation.updatedAt ? (
                <Item
                    title={t("machine.automationUpdatedAt")}
                    subtitle={new Date(automation.updatedAt).toLocaleString()}
                    showChevron={false}
                />
            ) : null}
            {guardianUsagePreview.map((entry: any) => (
                <Item
                    key={entry.key}
                    title={t("machine.automationGuardianUsage")}
                    subtitle={`${t("machine.automationGuardianReuseCount")}: ${entry.reuseCount} • ${t("machine.automationGuardianRememberCount")}: ${entry.rememberCount}`}
                    detail={new Date(entry.lastUsedAt).toLocaleString()}
                    showChevron={false}
                />
            ))}
            {guardians.map((guardian) => (
                <Item
                    key={guardian.key}
                    title={truncateGuardianKey(guardian.key)}
                    subtitle={`${getGuardianStateLabel(guardian.attached, guardian.recovered)} • ${new Date(guardian.updatedAt).toLocaleString()}`}
                    onPress={() => handleGuardianPress(guardian)}
                    showChevron
                />
            ))}
            {recentJobs.length === 0 ? (
                <Item title={t("machine.automationNoJobs")} showChevron={false} />
            ) : (
                recentJobs.map((job) => (
                    <Item
                        key={job.id}
                        title={getJobTitle(job)}
                        subtitle={getJobSubtitle(job)}
                        detail={getStatusLabel(job.status)}
                        detailStyle={{ color: getStatusColor(job.status) }}
                        showChevron
                        onPress={() => handleJobPress(job)}
                        rightElement={
                            activeJobId === job.id && isMutatingJob ? (
                                <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                            ) : undefined
                        }
                    />
                ))
            )}
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
                                onPress: () => doClearGuardians(),
                            },
                        ],
                    );
                }}
                rightElement={
                    isClearingGuardians ? (
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    ) : undefined
                }
            />
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
                                onPress: () => doClear(),
                            },
                        ],
                    );
                }}
                rightElement={
                    isClearing ? (
                        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                    ) : undefined
                }
            />
        </ItemGroup>
    );
});
