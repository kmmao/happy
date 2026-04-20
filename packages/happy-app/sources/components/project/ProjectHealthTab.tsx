import * as React from "react";
import {
    View,
    Text,
    ScrollView,
    Pressable,
    ActivityIndicator,
    RefreshControl,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Project } from "@/sync/projectManager";
import { TokenStorage } from "@/auth/tokenStorage";
import { DEFAULT_PROFILES } from "@/sync/profileUtils";
import { onProjectEvent } from "@/utils/projectEvents";
import { useHappyAction } from "@/hooks/useHappyAction";
import {
    type RelatedProject,
    fetchRelatedProjects,
} from "@/sync/apiProjects";
import { SupervisorCostSection } from "./SupervisorCostSection";
import { SupervisorRelatedProjects } from "./SupervisorRelatedProjects";
import {
    SupervisorRun,
    triggerSupervisorRun,
    fetchSupervisorRuns,
    cancelSupervisorRun,
    SupervisorAlreadyRunningError,
    fetchSupervisorActions,
    type SupervisorCostSummary,
    fetchSupervisorCost,
    type SupervisorTrendData,
    fetchSupervisorTrend,
    type SupervisorSummary,
    fetchSupervisorSummary,
    clearAllActions,
    deleteSupervisorRun,
    deleteSupervisorLoop,
    type SupervisorLoop,
    fetchActiveLoop,
    fetchLoopHistory,
} from "@/sync/apiSupervisor";
import { ItemGroup } from "@/components/ItemGroup";
import { useRouter } from "expo-router";
import { sync } from "@/sync/sync";
import { useSession, useSettings } from "@/sync/storage";
import { SupervisorSummaryCard } from "./SupervisorSummaryCard";
import { SupervisorTrendChart } from "./SupervisorTrendChart";
import { SupervisorRunHistoryItem } from "./SupervisorRunHistoryItem";
import { Modal } from "@/modal";
import { useElapsedSeconds, type DimensionProgress } from "./supervisorUtils";
import { SupervisorProgressView } from "./SupervisorProgressView";
import { SupervisorLoopStatusCard } from "./SupervisorLoopStatusCard";
import { SupervisorLoopConfigPanel } from "./SupervisorLoopConfigPanel";
import { DayRangeSelector } from "./DayRangeSelector";
import { SupervisorLoopHistoryItem } from "./SupervisorLoopHistoryItem";
import {
    getSupervisorAvailableProfiles,
    getMissingSupervisorProfileName,
    getSupervisorDefaultProfileId,
} from "./supervisorProfileSelection";
import { buildSupervisorRequestProfile } from "./supervisorRequestProfile";


interface ProjectHealthTabProps {
    project: Project;
}

function formatCompactDuration(durationMs: number): string {
    const diffMins = Math.floor(durationMs / 60000);
    if (diffMins < 60) return `${Math.max(diffMins, 1)}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d`;
}

export const ProjectHealthTab = React.memo(
    ({ project }: ProjectHealthTabProps) => {
        const { theme } = useUnistyles();
        const router = useRouter();
        const [runs, setRuns] = React.useState<SupervisorRun[]>([]);
        const [total, setTotal] = React.useState(0);
        const [pendingActionsTotal, setPendingActionsTotal] =
            React.useState(0);
        const [costSummary, setCostSummary] =
            React.useState<SupervisorCostSummary | null>(null);
        const [trendData, setTrendData] =
            React.useState<SupervisorTrendData | null>(null);
        const [relatedProjects, setRelatedProjects] = React.useState<
            RelatedProject[]
        >([]);
        const [summary, setSummary] =
            React.useState<SupervisorSummary | null>(null);
        const [loaded, setLoaded] = React.useState(false);
        const [refreshing, setRefreshing] = React.useState(false);
        const [dimensionProgress, setDimensionProgress] =
            React.useState<DimensionProgress | null>(null);
        const [activeLoop, setActiveLoop] =
            React.useState<SupervisorLoop | null>(null);
        const [loopHistory, setLoopHistory] = React.useState<SupervisorLoop[]>([]);
        const [loopHistoryTotal, setLoopHistoryTotal] = React.useState(0);
        const [showLoopConfig, setShowLoopConfig] = React.useState(false);
        const [analyticsDays, setAnalyticsDays] = React.useState(3);
        const analyticsDaysRef = React.useRef(3);
        const [analyticsLoading, setAnalyticsLoading] = React.useState(false);
        const settings = useSettings();

        const serverId = project.serverId;
        const allProfiles = React.useMemo(() => {
            const userProfiles = settings.profiles ?? [];
            const builtInProfiles = DEFAULT_PROFILES.map((profile) => ({
                id: profile.id,
                name: profile.name,
                isBuiltIn: true as const,
            }));
            const userDefinedProfiles = userProfiles.map((profile) => ({
                id: profile.id,
                name: profile.name,
            }));
            return getSupervisorAvailableProfiles(
                builtInProfiles,
                userDefinedProfiles,
            );
        }, [settings.profiles]);

        // Read defaultProfileId from supervisorConfig JSON
        const defaultProfileId = React.useMemo<string | null>(() => {
            return getSupervisorDefaultProfileId(project.supervisorConfig);
        }, [project.supervisorConfig]);

        const missingDefaultProfileName = React.useMemo(() => {
            return getMissingSupervisorProfileName(defaultProfileId, allProfiles);
        }, [allProfiles, defaultProfileId]);
        const runRequestProfile = React.useMemo(
            () =>
                buildSupervisorRequestProfile(
                    defaultProfileId,
                    settings.profiles ?? [],
                ),
            [defaultProfileId, settings.profiles],
        );
        const attemptedProfileRefreshRef = React.useRef<string | null>(null);

        React.useEffect(() => {
            if (!defaultProfileId || !missingDefaultProfileName) {
                return;
            }

            if (attemptedProfileRefreshRef.current === defaultProfileId) {
                return;
            }

            attemptedProfileRefreshRef.current = defaultProfileId;
            sync.refreshAccountProfiles().catch(() => {
                // Best-effort: keep existing banner if refresh fails
            });
        }, [defaultProfileId, missingDefaultProfileName]);

        const loadData = React.useCallback(async () => {
            if (!serverId) return;
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const [runsResult, actionsResult, costResult, trendResult, relatedResult, summaryResult, loopResult, loopHistoryResult] =
                    await Promise.all([
                        fetchSupervisorRuns(credentials, serverId, {
                            limit: 20,
                        }),
                        fetchSupervisorActions(credentials, serverId, {
                            approval: "pending",
                            limit: 20,
                        }),
                        fetchSupervisorCost(credentials, serverId, analyticsDaysRef.current).catch(
                            () => null,
                        ),
                        fetchSupervisorTrend(credentials, serverId, analyticsDaysRef.current).catch(
                            () => null,
                        ),
                        fetchRelatedProjects(credentials, serverId).catch(
                            () => [],
                        ),
                        fetchSupervisorSummary(credentials, serverId).catch(
                            () => null,
                        ),
                        fetchActiveLoop(credentials, serverId).catch(
                            () => null,
                        ),
                        fetchLoopHistory(credentials, serverId, { limit: 5 }).catch(
                            () => ({ loops: [], total: 0 }),
                        ),
                    ]);
                setRuns(runsResult.runs);
                setTotal(runsResult.total);
                setPendingActionsTotal(actionsResult.total);
                setCostSummary(costResult);
                setTrendData(trendResult);
                setRelatedProjects(relatedResult);
                setSummary(summaryResult);
                setActiveLoop(loopResult);
                setLoopHistory(loopHistoryResult.loops);
                setLoopHistoryTotal(loopHistoryResult.total);
            } catch (e) {
                // Silently fail — user can pull to refresh
            } finally {
                setLoaded(true);
            }
        }, [serverId]);

        React.useEffect(() => {
            loadData();
        }, [loadData]);

        // Listen for actions tab changes to refresh pending actions count
        React.useEffect(() => {
            return onProjectEvent("actions-changed", () => {
                loadData();
            });
        }, [loadData]);

        // Track known non-research runIds via ref to avoid effect dependency on runs
        const healthRunIdsRef = React.useRef(new Set<string>());
        React.useEffect(() => {
            healthRunIdsRef.current = new Set(
                runs.filter((r) => r.trigger !== "research").map((r) => r.id),
            );
        }, [runs]);

        // Subscribe to real-time supervisor status updates
        React.useEffect(() => {
            if (!serverId) return;
            const unsubscribe = sync.onSupervisorStatus((event) => {
                if (event.projectId !== serverId) return;
                // Terminal states: always refresh (loadData returns all, activeRun filters)
                if (event.status === "completed" || event.status === "failed" || event.status === "cancelled") {
                    setDimensionProgress(null);
                    loadData();
                    return;
                }
                // Running state: only update progress if this is a health run
                if (event.status === "running" && healthRunIdsRef.current.has(event.runId)) {
                    if (event.currentDimension && event.dimensionIndex && event.totalDimensions) {
                        setDimensionProgress({
                            currentDimension: event.currentDimension,
                            dimensionIndex: event.dimensionIndex,
                            totalDimensions: event.totalDimensions,
                        });
                    }
                    setRuns((prev) => {
                        const exists = prev.some((r) => r.id === event.runId);
                        if (exists) {
                            return prev.map((r) =>
                                r.id === event.runId ? { ...r, status: "running" } : r,
                            );
                        }
                        return prev;
                    });
                    loadData();
                }
            });
            return unsubscribe;
        }, [serverId, loadData]);

        // Subscribe to real-time loop status updates
        React.useEffect(() => {
            if (!serverId) return;
            const unsubscribe = sync.onSupervisorLoopStatus((event) => {
                if (event.projectId !== serverId) return;
                setActiveLoop((prev) => {
                    if (!prev || prev.id !== event.loopId) return prev;
                    return {
                        ...prev,
                        status: event.status,
                        currentIteration: event.currentIteration,
                        maxIterations: event.maxIterations,
                        currentPhase: event.currentPhase,
                        totalCostUsd: event.totalCostUsd,
                        totalActionsFound: event.totalActionsFound,
                        totalActionsFixed: event.totalActionsFixed,
                        currentHealthScore: event.currentHealthScore,
                        initialHealthScore: event.initialHealthScore,
                        exitReason: event.exitReason,
                        consecutiveFailures: event.consecutiveFailures,
                    };
                });
                // Refresh data when loop completes
                if (event.status === "completed" || event.status === "failed" || event.status === "stopped") {
                    loadData();
                }
            });
            return unsubscribe;
        }, [serverId, loadData]);

        const handleAnalyticsDaysChange = React.useCallback(
            async (days: number) => {
                setAnalyticsDays(days);
                analyticsDaysRef.current = days;
                if (!serverId) return;
                setAnalyticsLoading(true);
                try {
                    const credentials = await TokenStorage.getCredentials();
                    if (!credentials) return;
                    const [costResult, trendResult] = await Promise.all([
                        fetchSupervisorCost(credentials, serverId, days).catch(() => null),
                        fetchSupervisorTrend(credentials, serverId, days).catch(() => null),
                    ]);
                    if (costResult) setCostSummary(costResult);
                    if (trendResult) setTrendData(trendResult);
                } finally {
                    setAnalyticsLoading(false);
                }
            },
            [serverId],
        );

        const onRefresh = React.useCallback(async () => {
            setRefreshing(true);
            await loadData();
            setRefreshing(false);
        }, [loadData]);

        // Filter out research runs — they belong to the Research tab
        const healthRuns = React.useMemo(
            () => runs.filter((r) => r.trigger !== "research"),
            [runs],
        );

        const activeRun = React.useMemo(
            () =>
                healthRuns.find(
                    (r) => r.status === "pending" || r.status === "running",
                ),
            [healthRuns],
        );

        // Check if the active run's linked session still exists
        const activeRunSession = useSession(activeRun?.sessionId ?? "");

        const elapsedSeconds = useElapsedSeconds(
            activeRun ? activeRun.createdAt : null,
        );

        const currentLoopPhaseLabel = activeLoop
            ? activeLoop.currentPhase === "analyzing"
                ? t("supervisor.loopPhase_analyzing")
                : activeLoop.currentPhase === "fixing"
                    ? t("supervisor.loopPhase_fixing")
                    : activeLoop.currentPhase === "deciding"
                        ? t("supervisor.loopPhase_deciding")
                        : t("supervisor.loopPhase_idle")
            : null;

        const autonomyBanner = React.useMemo(() => {
            if (activeLoop && (activeLoop.status === "running" || activeLoop.status === "paused")) {
                return {
                    icon: activeLoop.status === "paused" ? "pause-circle-outline" as const : "sync-outline" as const,
                    color: activeLoop.status === "paused" ? "#FF9500" : "#0A84FF",
                    title: activeLoop.status === "paused"
                        ? t("supervisor.autonomyBannerLoopPaused", { iteration: activeLoop.currentIteration })
                        : t("supervisor.autonomyBannerLoopRunning", { iteration: activeLoop.currentIteration }),
                    subtitle: t("supervisor.autonomyBannerLoopDetail", {
                        phase: currentLoopPhaseLabel ?? t("supervisor.loopPhase_idle"),
                    }),
                    action: t("supervisor.viewActiveLoop", { iteration: activeLoop.currentIteration }),
                    onPress: () =>
                        router.push({
                            pathname: "/project/[id]/supervisor-loop/[loopId]",
                            params: { id: project.id, loopId: activeLoop.id },
                        }),
                };
            }

            if (activeRun) {
                return {
                    icon: "pulse-outline" as const,
                    color: "#0A84FF",
                    title: t("supervisor.autonomyBannerRunActive"),
                    subtitle: activeRunSession && activeRun.sessionId
                        ? `${t("supervisor.viewSession")}: ${activeRun.sessionId}`
                        : t("supervisor.statusAnalyzing"),
                    action: activeRun.sessionId ? t("supervisor.viewSession") : undefined,
                    onPress: activeRun.sessionId
                        ? () => router.push(`/session/${activeRun.sessionId}` as any)
                        : undefined,
                };
            }

            if (summary?.scheduleOverdueByMs != null) {
                return {
                    icon: "warning-outline" as const,
                    color: "#FF9500",
                    title: t("supervisor.autonomyBannerOverdue", {
                        duration: formatCompactDuration(summary.scheduleOverdueByMs),
                    }),
                    subtitle: summary.scheduleMissedRuns > 0
                        ? t("supervisor.scheduleMissedRuns", { count: summary.scheduleMissedRuns })
                        : t("supervisor.autonomyBannerScheduled", { hours: summary.scheduleIntervalHours ?? 24 }),
                    action: t("supervisor.settings"),
                    onPress: () => router.push(`/project/${project.id}/supervisor-settings` as any),
                };
            }

            if (summary?.scheduleEnabled) {
                return {
                    icon: "calendar-outline" as const,
                    color: "#34C759",
                    title: t("supervisor.autonomyBannerScheduled", { hours: summary.scheduleIntervalHours ?? 24 }),
                    subtitle: summary.nextRunAt
                        ? `${t("supervisor.nextRun")}: ${new Date(summary.nextRunAt).toLocaleString()}`
                        : t("supervisor.autonomyBannerHealthy"),
                    action: t("supervisor.settings"),
                    onPress: () => router.push(`/project/${project.id}/supervisor-settings` as any),
                };
            }

            return {
                icon: "scan-outline" as const,
                color: theme.colors.textSecondary,
                title: t("supervisor.autonomyBannerManualOnly"),
                subtitle: t("supervisor.autonomyBannerManualOnlyDetail"),
                action: t("supervisor.settings"),
                onPress: () => router.push(`/project/${project.id}/supervisor-settings` as any),
            };
        }, [activeLoop, activeRun, activeRunSession, currentLoopPhaseLabel, project.id, router, serverId, summary, theme.colors.textSecondary]);

        const [triggerLoading, doTrigger] = useHappyAction(
            React.useCallback(async () => {
                if (!serverId) return;
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                try {
                    const run = await triggerSupervisorRun(
                        credentials,
                        serverId,
                        runRequestProfile,
                    );
                    // Optimistic: add the new run to the list immediately
                    setRuns((prev) => [run, ...prev]);
                } catch (e) {
                    if (e instanceof SupervisorAlreadyRunningError) {
                        throw new Error(t("supervisor.alreadyRunning"));
                    }
                    throw e;
                }
            }, [serverId, runRequestProfile]),
        );

        const handleLoopStarted = React.useCallback((loop: SupervisorLoop) => {
            setActiveLoop(loop);
            setShowLoopConfig(false);
        }, []);

        const [cancelLoading, doCancel] = useHappyAction(
            React.useCallback(async () => {
                if (!serverId || !activeRun) return;
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await cancelSupervisorRun(
                    credentials,
                    serverId,
                    activeRun.id,
                );
                await loadData();
            }, [serverId, activeRun, loadData]),
        );

        const [clearAllLoading, doClearAll] = useHappyAction(
            React.useCallback(async () => {
                if (!serverId) return;
                const confirmed = await Modal.confirm(
                    t("supervisor.clearAll"),
                    t("supervisor.clearAllConfirm"),
                    { confirmText: t("common.delete"), destructive: true },
                );
                if (!confirmed) return;
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const result = await clearAllActions(credentials, serverId);
                Modal.toast(
                    t("supervisor.clearAllSuccess", {
                        count: result.deletedCount,
                    }),
                );
                await loadData();
            }, [serverId, loadData]),
        );

        const handleDeleteRun = React.useCallback(
            async (runId: string) => {
                const confirmed = await Modal.confirm(
                    t("supervisor.deleteRun"),
                    t("supervisor.deleteRunConfirm"),
                    { confirmText: t("common.delete"), destructive: true },
                );
                if (!confirmed) return;
                if (!serverId) return;
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await deleteSupervisorRun(credentials, serverId, runId);
                setRuns((prev) => prev.filter((r) => r.id !== runId));
                setTotal((prev) => Math.max(0, prev - 1));
            },
            [serverId],
        );

        const handleDeleteLoop = React.useCallback(
            async (loopId: string) => {
                const confirmed = await Modal.confirm(
                    t("supervisor.deleteLoop"),
                    t("supervisor.deleteLoopConfirm"),
                    { confirmText: t("common.delete"), destructive: true },
                );
                if (!confirmed) return;
                if (!serverId) return;
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                await deleteSupervisorLoop(credentials, serverId, loopId);
                setLoopHistory((prev) => prev.filter((l) => l.id !== loopId));
                setLoopHistoryTotal((prev) => Math.max(0, prev - 1));
            },
            [serverId],
        );

        // Compute health score delta from trend data
        const scoreDelta = React.useMemo(() => {
            if (!trendData || trendData.points.length < 2) return null;
            const pts = trendData.points.filter((p) => p.score != null);
            if (pts.length < 2) return null;
            const current = pts[pts.length - 1].score!;
            const previous = pts[pts.length - 2].score!;
            return current - previous;
        }, [trendData]);

        // Not synced to server yet
        if (!serverId) {
            return (
                <View style={styles.emptyContainer}>
                    <Ionicons
                        name="pulse-outline"
                        size={64}
                        color={theme.colors.textSecondary}
                    />
                    <Text style={styles.emptyTitle}>
                        {t("supervisor.title")}
                    </Text>
                    <Text style={styles.emptySubtitle}>
                        {t("supervisor.notSynced")}
                    </Text>
                </View>
            );
        }

        return (
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                    />
                }
            >
                {/* Header card */}
                <ItemGroup title={t("supervisor.title")}>
                    <View style={styles.headerCard}>
                        <Ionicons
                            name="shield-checkmark-outline"
                            size={40}
                            color={theme.colors.header.tint}
                        />
                        <Text style={styles.headerDescription}>
                            {t("supervisor.description")}
                        </Text>

                        <Pressable
                            style={[styles.autonomyBanner, { borderColor: `${autonomyBanner.color}33` }]}
                            onPress={autonomyBanner.onPress}
                        >
                            <View style={[styles.autonomyIconWrap, { backgroundColor: `${autonomyBanner.color}18` }]}>
                                <Ionicons
                                    name={autonomyBanner.icon}
                                    size={18}
                                    color={autonomyBanner.color}
                                />
                            </View>
                            <View style={styles.autonomyContent}>
                                <Text style={styles.autonomyTitle}>{autonomyBanner.title}</Text>
                                <Text style={styles.autonomySubtitle}>{autonomyBanner.subtitle}</Text>
                            </View>
                            {autonomyBanner.action ? (
                                <View style={styles.autonomyActionWrap}>
                                    <Text style={[styles.autonomyActionText, { color: autonomyBanner.color }]}>
                                        {autonomyBanner.action}
                                    </Text>
                                    <Ionicons name="chevron-forward" size={14} color={autonomyBanner.color} />
                                </View>
                            ) : null}
                        </Pressable>

                        {missingDefaultProfileName && (
                            <View style={styles.missingProfileBanner}>
                                <Ionicons
                                    name="alert-circle-outline"
                                    size={16}
                                    color="#FF9500"
                                />
                                <Text style={styles.missingProfileBannerText}>
                                    {t("supervisor.defaultProfileMissing", {
                                        profileName: missingDefaultProfileName,
                                    })}
                                </Text>
                            </View>
                        )}

                        {/* Action buttons */}
                        <View style={styles.actionRow}>
                            {!loaded ? (
                                <View style={styles.initialLoadingContainer}>
                                    <ActivityIndicator
                                        size="small"
                                        color={theme.colors.textSecondary}
                                    />
                                    <Text style={styles.initialLoadingText}>
                                        {t("supervisor.loading")}
                                    </Text>
                                </View>
                            ) : activeLoop && (activeLoop.status === "running" || activeLoop.status === "paused") ? (
                                <SupervisorLoopStatusCard
                                    loop={activeLoop}
                                    projectId={serverId}
                                    onUpdate={loadData}
                                />
                            ) : activeRun ? (
                                <View style={styles.activeRunContainer}>
                                    <SupervisorProgressView
                                        status={activeRun.status}
                                        elapsedSeconds={elapsedSeconds}
                                        dimensionProgress={dimensionProgress}
                                    />
                                    {activeRunSession && activeRun?.sessionId && (
                                        <Pressable
                                            style={styles.sessionLink}
                                            onPress={() =>
                                                router.push(
                                                    `/session/${activeRun.sessionId}` as any,
                                                )
                                            }
                                        >
                                            <Ionicons
                                                name="terminal-outline"
                                                size={14}
                                                color={theme.colors.header.tint}
                                            />
                                            <Text style={styles.sessionLinkText}>
                                                {t("supervisor.viewSession")}
                                            </Text>
                                        </Pressable>
                                    )}
                                    <Pressable
                                        style={[
                                            styles.actionButton,
                                            styles.cancelButton,
                                        ]}
                                        onPress={doCancel}
                                        disabled={cancelLoading}
                                    >
                                        <Text style={styles.cancelButtonText}>
                                            {t("common.cancel")}
                                        </Text>
                                    </Pressable>
                                </View>
                            ) : showLoopConfig ? (
                                <SupervisorLoopConfigPanel
                                    projectId={serverId}
                                    defaultProfileId={defaultProfileId}
                                    onStarted={handleLoopStarted}
                                    onCancel={() => setShowLoopConfig(false)}
                                />
                            ) : (
                                <View style={styles.buttonRow}>
                                    <Pressable
                                        style={styles.scanButton}
                                        onPress={doTrigger}
                                        disabled={triggerLoading}
                                    >
                                        {triggerLoading ? (
                                            <>
                                                <ActivityIndicator
                                                    size="small"
                                                    color="#FFFFFF"
                                                />
                                                <Text style={styles.scanButtonText}>
                                                    {t("supervisor.scanStarting")}
                                                </Text>
                                            </>
                                        ) : (
                                            <>
                                                <Ionicons
                                                    name="scan-outline"
                                                    size={18}
                                                    color="#FFFFFF"
                                                />
                                                <Text style={styles.scanButtonText}>
                                                    {t("supervisor.scanNow")}
                                                </Text>
                                            </>
                                        )}
                                    </Pressable>
                                    <Pressable
                                        style={styles.loopButton}
                                        onPress={() => setShowLoopConfig(true)}
                                        disabled={triggerLoading}
                                    >
                                        <Ionicons
                                            name="repeat-outline"
                                            size={18}
                                            color={theme.colors.header.tint}
                                        />
                                        <Text
                                            style={[
                                                styles.loopButtonText,
                                                { color: theme.colors.header.tint },
                                            ]}
                                        >
                                            {t("supervisor.loopMode")}
                                        </Text>
                                    </Pressable>
                                </View>
                            )}
                        </View>
                    </View>
                </ItemGroup>

                {/* Quick access: pending actions + clear all */}
                {serverId && loaded && (
                    <ItemGroup>
                        <Pressable
                            style={styles.quickActionCard}
                            onPress={() =>
                                router.push(
                                    `/project/${project.id}/supervisor-actions` as any,
                                )
                            }
                        >
                            <View style={styles.quickActionLeft}>
                                <View
                                    style={[
                                        styles.quickActionIconWrap,
                                        pendingActionsTotal > 0
                                            ? styles.quickActionIconActive
                                            : styles.quickActionIconInactive,
                                    ]}
                                >
                                    <Ionicons
                                        name="clipboard-outline"
                                        size={20}
                                        color={
                                            pendingActionsTotal > 0
                                                ? "#FFFFFF"
                                                : theme.colors.textSecondary
                                        }
                                    />
                                </View>
                                <View>
                                    <Text style={styles.quickActionTitle}>
                                        {t("supervisor.viewAllActions")}
                                    </Text>
                                    {pendingActionsTotal > 0 && (
                                        <Text style={styles.quickActionSubtitle}>
                                            {t("supervisor.pendingActions", {
                                                count: pendingActionsTotal,
                                            })}
                                        </Text>
                                    )}
                                </View>
                            </View>
                            <View style={styles.quickActionRight}>
                                {pendingActionsTotal > 0 && (
                                    <View style={styles.quickActionBadge}>
                                        <Text style={styles.quickActionBadgeText}>
                                            {pendingActionsTotal}
                                        </Text>
                                    </View>
                                )}
                                <Ionicons
                                    name="chevron-forward"
                                    size={18}
                                    color={theme.colors.textSecondary}
                                />
                            </View>
                        </Pressable>
                        <Pressable
                            style={styles.quickActionClearAll}
                            onPress={doClearAll}
                            disabled={clearAllLoading}
                        >
                            {clearAllLoading ? (
                                <ActivityIndicator size="small" color="#FF3B30" />
                            ) : (
                                <>
                                    <Ionicons
                                        name="trash-outline"
                                        size={16}
                                        color="#FF3B30"
                                    />
                                    <Text style={styles.clearAllLinkText}>
                                        {t("supervisor.clearAll")}
                                    </Text>
                                </>
                            )}
                        </Pressable>
                    </ItemGroup>
                )}

                {/* Health Summary */}
                {summary && (
                    <ItemGroup>
                        <SupervisorSummaryCard
                            summary={summary}
                            scoreDelta={scoreDelta}
                            activeLoop={activeLoop}
                            onPressLoop={activeLoop ? () =>
                                router.push({
                                    pathname: "/project/[id]/supervisor-loop/[loopId]",
                                    params: { id: project.id, loopId: activeLoop.id },
                                }) : undefined
                            }
                            onPressSettings={() =>
                                router.push(`/project/${project.id}/supervisor-settings` as any)
                            }
                        />
                    </ItemGroup>
                )}

                {/* Settings & Webhook links (quick access) */}
                <ItemGroup>
                    <Pressable
                        style={styles.settingsLink}
                        onPress={() =>
                            router.push(
                                `/project/${project.id}/supervisor-settings` as any,
                            )
                        }
                    >
                        <Ionicons
                            name="settings-outline"
                            size={20}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={styles.settingsLinkText}>
                            {t("supervisor.settings")}
                        </Text>
                        <Ionicons
                            name="chevron-forward"
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                    </Pressable>
                    <View style={styles.linkDivider} />
                    <Pressable
                        style={styles.settingsLink}
                        onPress={() =>
                            router.push(
                                `/project/${project.id}/webhook-events` as any,
                            )
                        }
                    >
                        <Ionicons
                            name="git-pull-request-outline"
                            size={20}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={styles.settingsLinkText}>
                            {t("webhook.eventHistory")}
                        </Text>
                        <Ionicons
                            name="chevron-forward"
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                    </Pressable>
                </ItemGroup>



                {/* Analytics Day Range Selector */}
                {loaded && (costSummary || (trendData && trendData.points.length >= 2)) && (
                    <DayRangeSelector
                        selectedDays={analyticsDays}
                        loading={analyticsLoading}
                        onDaysChange={handleAnalyticsDaysChange}
                    />
                )}

                {/* Cost Summary */}
                {costSummary && (
                    <SupervisorCostSection costSummary={costSummary} />
                )}

                {/* Trend Chart */}
                {trendData &&
                    trendData.points.length >= 2 && (
                        <ItemGroup
                            title={t("supervisor.trendSection")}
                        >
                            <SupervisorTrendChart points={trendData.points} />
                        </ItemGroup>
                    )}

                {/* Loop History */}
                {loaded && loopHistory.length > 0 && (
                    <ItemGroup title={t("supervisor.loopHistory")}>
                        {loopHistory.slice(0, 3).map((loop, index) => (
                            <SupervisorLoopHistoryItem
                                key={loop.id}
                                loop={loop}
                                isLast={index === Math.min(loopHistory.length, 3) - 1}
                                onPress={() =>
                                    router.push({
                                        pathname: "/project/[id]/supervisor-loop/[loopId]",
                                        params: { id: project.id, loopId: loop.id },
                                    })
                                }
                                onDelete={() => handleDeleteLoop(loop.id)}
                            />
                        ))}
                        {loopHistoryTotal > 3 && (
                            <View style={styles.loopHistoryFooter}>
                                <Text style={styles.loopHistoryFooterText}>
                                    {t("supervisor.moreRuns", {
                                        count: loopHistoryTotal - 3,
                                    })}
                                </Text>
                            </View>
                        )}
                    </ItemGroup>
                )}

                {/* Run History */}
                <ItemGroup title={t("supervisor.runHistory")}>
                    {!loaded ? (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="small" />
                        </View>
                    ) : healthRuns.length === 0 ? (
                        <View style={styles.emptyHistoryCard}>
                            <Text style={styles.emptyHistoryText}>
                                {t("supervisor.noRuns")}
                            </Text>
                        </View>
                    ) : (
                        <>
                            {healthRuns.slice(0, 3).map((run, index) => (
                                <SupervisorRunHistoryItem
                                    key={run.id}
                                    run={run}
                                    isLast={index === Math.min(healthRuns.length, 3) - 1}
                                    onPress={
                                        run.status !== "pending" && run.status !== "running" && serverId
                                            ? () =>
                                                  router.push({
                                                      pathname:
                                                          "/project/[id]/supervisor-run/[runId]",
                                                      params: {
                                                          id: project.id,
                                                          runId: run.id,
                                                      },
                                                  })
                                            : undefined
                                    }
                                    onDelete={
                                        run.status !== "pending" && run.status !== "running"
                                            ? () => handleDeleteRun(run.id)
                                            : undefined
                                    }
                                />
                            ))}
                            {(healthRuns.length > 3 || total > healthRuns.length) && (
                                <Pressable
                                    style={styles.showMoreRow}
                                    onPress={() =>
                                        router.push(
                                            `/project/${project.id}/supervisor-actions` as any,
                                        )
                                    }
                                >
                                    <Text style={styles.showMoreText}>
                                        {t("supervisor.showMoreRuns", {
                                            count: Math.max(total, healthRuns.length) - 3,
                                        })}
                                    </Text>
                                    <Ionicons
                                        name="chevron-forward"
                                        size={16}
                                        color={theme.colors.header.tint}
                                    />
                                </Pressable>
                            )}
                        </>
                    )}
                </ItemGroup>

                {/* Related Projects (Cross-Machine) */}
                <SupervisorRelatedProjects relatedProjects={relatedProjects} />
            </ScrollView>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 32,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 32,
    },
    emptyTitle: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        color: theme.colors.text,
        marginTop: 16,
        textAlign: "center",
    },
    emptySubtitle: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        marginTop: 8,
        textAlign: "center",
    },
    headerCard: {
        padding: 20,
        alignItems: "center",
        gap: 12,
    },
    headerDescription: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
        textAlign: "center",
        lineHeight: 20,
    },
    autonomyBanner: {
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
        backgroundColor: theme.colors.surface,
    },
    autonomyIconWrap: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
    },
    autonomyContent: {
        flex: 1,
        gap: 2,
    },
    autonomyTitle: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
    },
    autonomySubtitle: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    autonomyActionWrap: {
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
    },
    autonomyActionText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
    },
    missingProfileBanner: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: "#FF950014",
        marginTop: 12,
    },
    missingProfileBannerText: {
        ...Typography.default(),
        flex: 1,
        fontSize: 12,
        lineHeight: 18,
        color: theme.colors.text,
    },
    actionRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginTop: 4,
    },
    buttonRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    scanButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: theme.dark ? theme.colors.accentPurple : theme.colors.header.tint,
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    scanButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: "#FFFFFF",
    },
    loopButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
    },
    loopButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
    },
    activeRunContainer: {
        alignItems: "center",
        gap: 8,
        width: "100%",
    },
    actionButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
    },
    cancelButton: {
        backgroundColor: theme.colors.surface,
    },
    cancelButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: "#FF3B30",
    },
    sessionLink: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 4,
    },
    sessionLinkText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.header.tint,
    },
    initialLoadingContainer: {
        alignItems: "center",
        gap: 8,
    },
    initialLoadingText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    loadingContainer: {
        padding: 24,
        alignItems: "center",
    },
    emptyHistoryCard: {
        padding: 24,
        alignItems: "center",
    },
    emptyHistoryText: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    moreRow: {
        padding: 12,
        alignItems: "center",
    },
    moreText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
    },
    showMoreRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        paddingVertical: 12,
        borderTopWidth: 0.5,
        borderTopColor: theme.colors.divider,
    },
    showMoreText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.header.tint,
    },
    loopHistoryFooter: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        alignItems: "center",
    },
    loopHistoryFooterText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    linkDivider: {
        height: 0.5,
        backgroundColor: theme.colors.divider,
        marginHorizontal: 16,
    },
    settingsLink: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    settingsLinkText: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.text,
        flex: 1,
    },
    quickActionCard: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    quickActionLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        flex: 1,
    },
    quickActionIconWrap: {
        width: 36,
        height: 36,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    quickActionIconActive: {
        backgroundColor: theme.dark ? theme.colors.accentPurple : theme.colors.header.tint,
    },
    quickActionIconInactive: {
        backgroundColor: theme.colors.surface,
    },
    quickActionTitle: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
    },
    quickActionSubtitle: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        marginTop: 2,
    },
    quickActionRight: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    quickActionBadge: {
        backgroundColor: "#FF3B30",
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 6,
    },
    quickActionBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: "#FFFFFF",
    },
    quickActionClearAll: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopWidth: 0.5,
        borderTopColor: theme.colors.divider,
    },
    clearAllLinkText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: "#FF3B30",
    },
}));
