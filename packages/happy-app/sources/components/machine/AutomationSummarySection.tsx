import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, View, Text, Pressable, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
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
import { fetchTasks } from "@/sync/apiTasks";
import { fetchTriggerSchedules } from "@/sync/apiTriggerSchedules";
import { fetchWebhookTriggers } from "@/sync/apiWebhookTriggers";
import { TokenStorage } from "@/auth/tokenStorage";
import { sync } from "@/sync/sync";
import {
    formatRate,
    getGuardianStateLabel,
    getJobSubtitle,
    getJobTitle,
    getStatusColor,
    getStatusLabel,
    truncateGuardianKey,
    type AutomationJobLike,
} from "./automationSummaryFormatters";

type Props = {
    machine: Machine;
    machineId: string;
};

type PendingJobAction =
    | { type: "retry"; jobId: string }
    | { type: "cancel"; jobId: string }
    | { type: "stop"; jobId: string; sessionId: string }
    | null;

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

export const AutomationGroupTitle = React.memo(function AutomationGroupTitle({
    machine,
    label,
    activeTaskCount,
}: {
    machine: Machine;
    label: string;
    activeTaskCount?: number | null;
}) {
    const { theme } = useUnistyles();
    const automation = machine.daemonState?.automation as any;

    const activeCount = useMemo(() => {
        if (!automation) return activeTaskCount ?? 0;
        const counts = automation.counts ?? {};
        const running = (counts.running ?? 0) + (counts.dispatching ?? 0);
        const guardians = Array.isArray(automation.guardians) ? automation.guardians.length : 0;
        return running + guardians + (activeTaskCount ?? 0);
    }, [automation, activeTaskCount]);

    return (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text
                style={{
                    color: theme.colors.groupped.sectionTitle,
                    fontSize: Platform.select({ ios: 13, default: 14 }),
                    letterSpacing: Platform.select({ ios: -0.08, default: 0.1 }),
                    textTransform: "uppercase",
                    fontWeight: Platform.select({ ios: "normal", default: "500" }),
                }}
            >
                {label}
            </Text>
            {activeCount > 0 && (
                <View
                    style={{
                        backgroundColor: theme.colors.primary + "22",
                        borderRadius: 8,
                        paddingHorizontal: 6,
                        paddingVertical: 1,
                        minWidth: 18,
                        alignItems: "center",
                    }}
                >
                    <Text
                        style={{
                            color: theme.colors.primary,
                            fontSize: 10,
                            fontWeight: "700",
                            letterSpacing: 0,
                        }}
                    >
                        {activeCount}
                    </Text>
                </View>
            )}
        </View>
    );
});

type GridMetric = {
    label: string;
    value: number;
    activeColor: string;
};

type GridCardConfig = {
    id: string;
    iconName: React.ComponentProps<typeof Ionicons>["name"];
    iconColor: string;
    title: string;
    route: string;
    metrics?: GridMetric[];
    emptyLabel?: string;
};

function GridCard({
    card,
    onPress,
}: {
    card: GridCardConfig;
    onPress: () => void;
}) {
    const { theme } = useUnistyles();
    const hasActiveMetric = card.metrics?.some((m) => m.value > 0) ?? false;

    return (
        <Pressable
            style={({ pressed }) => ({
                flex: 1,
                borderRadius: 12,
                borderWidth: 1,
                padding: 12,
                gap: 6,
                backgroundColor: theme.colors.surfaceHigh,
                borderColor: hasActiveMetric ? theme.colors.primary + "33" : theme.colors.divider,
                opacity: pressed ? 0.75 : 1,
            })}
            onPress={onPress}
        >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View
                    style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: card.iconColor + "18",
                    }}
                >
                    <Ionicons name={card.iconName} size={16} color={card.iconColor} />
                </View>
                <Ionicons name="chevron-forward" size={12} color={theme.colors.textSecondary} />
            </View>
            <Text style={{ fontSize: 13, fontWeight: "600", letterSpacing: -0.1, color: theme.colors.text }} numberOfLines={1}>
                {card.title}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {card.metrics && card.metrics.length > 0 ? (
                    card.metrics.map((m) => (
                        <View key={m.label} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <View
                                style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: 3,
                                    backgroundColor: m.value > 0 ? m.activeColor : theme.colors.textSecondary + "60",
                                }}
                            />
                            <Text
                                style={{
                                    fontSize: 12,
                                    fontWeight: "500",
                                    color: m.value > 0 ? m.activeColor : theme.colors.textSecondary,
                                }}
                            >
                                {m.value}
                            </Text>
                        </View>
                    ))
                ) : (
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                        {card.emptyLabel ?? "–"}
                    </Text>
                )}
            </View>
        </Pressable>
    );
}

type SummaryCounts = {
    activeTaskCount: number | null;
    triggerCount: number | null;
};

export function useAutomationSummaryCounts(machineId: string): SummaryCounts {
    const [activeTaskCount, setActiveTaskCount] = React.useState<number | null>(null);
    const [triggerCount, setTriggerCount] = React.useState<number | null>(null);

    const load = React.useCallback(async () => {
        const credentials = await TokenStorage.getCredentials().catch(() => null);
        if (!credentials) return;

        // Tasks: fetch all, count active statuses client-side
        fetchTasks(credentials, { machineId, limit: 100 })
            .then(({ tasks }) => {
                const count = tasks.filter((task) =>
                    ["queued", "dispatching", "running"].includes(task.status),
                ).length;
                setActiveTaskCount(count);
            })
            .catch(() => {});

        // Triggers: enabled cron schedules + enabled webhooks
        Promise.all([
            fetchTriggerSchedules(credentials, { machineId, enabled: true }),
            fetchWebhookTriggers(credentials, { machineId, enabled: true }),
        ])
            .then(([cron, webhooks]) => {
                setTriggerCount(cron.total + webhooks.total);
            })
            .catch(() => {});
    }, [machineId]);

    React.useEffect(() => {
        void load();
    }, [load]);

    React.useEffect(() => {
        return sync.onTaskStatusChanged((event) => {
            if (event.machineId && event.machineId !== machineId) return;
            void load();
        });
    }, [machineId, load]);

    return { activeTaskCount, triggerCount };
}

type GridSectionProps = Props & { summaryCounts: SummaryCounts };

export const AutomationGridSection = React.memo(function AutomationGridSection({
    machine,
    machineId,
    summaryCounts,
}: GridSectionProps) {
    const router = useRouter();
    const automation = machine.daemonState?.automation as any;
    const { activeTaskCount, triggerCount } = summaryCounts;

    const automationCounts = useMemo(() => {
        const counts = automation?.counts ?? {};
        return {
            queued: counts.queued ?? 0,
            running: (counts.running ?? 0) + (counts.dispatching ?? 0),
            guardians: Array.isArray(automation?.guardians) ? automation.guardians.length : 0,
        };
    }, [automation]);

    const loopCounts = useMemo(() => {
        const r = automation?.loopRollup ?? {};
        return { total: r.total ?? 0, active: r.active ?? 0 };
    }, [automation]);

    const cards: GridCardConfig[] = [
        {
            id: "automation",
            iconName: "sparkles-outline",
            iconColor: "#0A84FF",
            title: t("machine.automation"),
            route: `/machine/${machineId}/automation`,
            metrics: [
                { label: t("machine.automationQueued"), value: automationCounts.queued, activeColor: "#FF9500" },
                { label: t("machine.automationRunning"), value: automationCounts.running, activeColor: "#0A84FF" },
                ...(automationCounts.guardians > 0
                    ? [{ label: t("machine.automationGuardians"), value: automationCounts.guardians, activeColor: "#34C759" }]
                    : []),
            ],
        },
        {
            id: "loops",
            iconName: "repeat-outline",
            iconColor: "#BF5AF2",
            title: t("machine.agentLoopsViewAll"),
            route: `/machine/${machineId}/loops`,
            metrics: [
                { label: t("machine.automationLoopsTotal"), value: loopCounts.total, activeColor: "#BF5AF2" },
                { label: t("machine.automationLoopsActive"), value: loopCounts.active, activeColor: "#34C759" },
            ],
        },
        {
            id: "tasks",
            iconName: "list-outline",
            iconColor: "#FF9500",
            title: t("tasks.title"),
            route: `/machine/${machineId}/tasks`,
            metrics: [
                { label: "active", value: activeTaskCount ?? 0, activeColor: "#FF9500" },
            ],
        },
        {
            id: "triggers",
            iconName: "timer-outline",
            iconColor: "#34C759",
            title: t("triggers.title"),
            route: `/machine/${machineId}/triggers`,
            metrics: [
                { label: "enabled", value: triggerCount ?? 0, activeColor: "#34C759" },
            ],
        },
    ];

    return (
        <View style={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8, gap: 8 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
                <GridCard card={cards[0]} onPress={() => router.push(cards[0].route as any)} />
                <GridCard card={cards[1]} onPress={() => router.push(cards[1].route as any)} />
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
                <GridCard card={cards[2]} onPress={() => router.push(cards[2].route as any)} />
                <GridCard card={cards[3]} onPress={() => router.push(cards[3].route as any)} />
            </View>
        </View>
    );
});
