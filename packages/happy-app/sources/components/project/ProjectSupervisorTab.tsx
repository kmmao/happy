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
import { resolveActiveTint } from "@/constants/activeTint";
import { t } from "@/text";
import { Project } from "@/sync/projectManager";
import { TokenStorage } from "@/auth/tokenStorage";
import { DEFAULT_PROFILES } from "@/sync/profileUtils";
import { onProjectEvent } from "@/utils/projectEvents";
import { useHappyAction } from "@/hooks/useHappyAction";
import {
    SupervisorRun,
    triggerSupervisorRun,
    fetchSupervisorRuns,
    cancelSupervisorRun,
    SupervisorAlreadyRunningError,
    type SupervisorLoop,
    fetchActiveLoop,
    fetchSupervisorSummary,
    type SupervisorSummary,
} from "@/sync/apiSupervisor";
import { ItemGroup } from "@/components/ItemGroup";
import { useRouter } from "expo-router";
import { sync } from "@/sync/sync";
import { useSession, useSettings } from "@/sync/storage";
import { useElapsedSeconds, type DimensionProgress } from "./supervisorUtils";
import { SupervisorSummaryCard } from "./SupervisorSummaryCard";
import { SupervisorProgressView } from "./SupervisorProgressView";
import { SupervisorLoopStatusCard } from "./SupervisorLoopStatusCard";
import { SupervisorLoopConfigPanel } from "./SupervisorLoopConfigPanel";
import { SharedStateView } from "@/components/SharedStateView";
import {
    getSupervisorAvailableProfiles,
    getMissingSupervisorProfileName,
    getSupervisorDefaultProfileId,
} from "./supervisorProfileSelection";
import { buildSupervisorRequestProfile } from "./supervisorRequestProfile";

function formatCompactDuration(durationMs: number): string {
    const diffMins = Math.floor(durationMs / 60000);
    if (diffMins < 60) return `${Math.max(diffMins, 1)}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d`;
}

interface ProjectSupervisorTabProps {
    project: Project;
}

export const ProjectSupervisorTab = React.memo(
    ({ project }: ProjectSupervisorTabProps) => {
        const { theme } = useUnistyles();
        const router = useRouter();
        const [runs, setRuns] = React.useState<SupervisorRun[]>([]);
        const [summary, setSummary] = React.useState<SupervisorSummary | null>(null);
        const [loaded, setLoaded] = React.useState(false);
        const [refreshing, setRefreshing] = React.useState(false);
        const [dimensionProgress, setDimensionProgress] =
            React.useState<DimensionProgress | null>(null);
        const [activeLoop, setActiveLoop] = React.useState<SupervisorLoop | null>(null);
        const [showLoopConfig, setShowLoopConfig] = React.useState(false);
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
            return getSupervisorAvailableProfiles(builtInProfiles, userDefinedProfiles);
        }, [settings.profiles]);

        const defaultProfileId = React.useMemo<string | null>(() => {
            return getSupervisorDefaultProfileId(project.supervisorConfig);
        }, [project.supervisorConfig]);

        const missingDefaultProfileName = React.useMemo(() => {
            return getMissingSupervisorProfileName(defaultProfileId, allProfiles);
        }, [allProfiles, defaultProfileId]);

        const runRequestProfile = React.useMemo(
            () => buildSupervisorRequestProfile(defaultProfileId, settings.profiles ?? []),
            [defaultProfileId, settings.profiles],
        );

        const attemptedProfileRefreshRef = React.useRef<string | null>(null);
        React.useEffect(() => {
            if (!defaultProfileId || !missingDefaultProfileName) return;
            if (attemptedProfileRefreshRef.current === defaultProfileId) return;
            attemptedProfileRefreshRef.current = defaultProfileId;
            sync.refreshAccountProfiles().catch(() => {});
        }, [defaultProfileId, missingDefaultProfileName]);

        const loadData = React.useCallback(async () => {
            if (!serverId) return;
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const [runsResult, loopResult, summaryResult] =
                    await Promise.all([
                        fetchSupervisorRuns(credentials, serverId, { limit: 20 }),
                        fetchActiveLoop(credentials, serverId).catch(() => null),
                        fetchSupervisorSummary(credentials, serverId).catch(() => null),
                    ]);
                setRuns(runsResult.runs);
                setActiveLoop(loopResult);
                setSummary(summaryResult);
            } catch {
                // Silently fail — user can pull to refresh
            } finally {
                setLoaded(true);
            }
        }, [serverId]);

        React.useEffect(() => {
            loadData();
        }, [loadData]);

        React.useEffect(() => {
            return onProjectEvent("actions-changed", () => {
                loadData();
            });
        }, [loadData]);

        const healthRunIdsRef = React.useRef(new Set<string>());
        React.useEffect(() => {
            healthRunIdsRef.current = new Set(
                runs.filter((r) => r.trigger !== "research").map((r) => r.id),
            );
        }, [runs]);

        React.useEffect(() => {
            if (!serverId) return;
            const unsubscribe = sync.onSupervisorStatus((event) => {
                if (event.projectId !== serverId) return;
                if (
                    event.status === "completed" ||
                    event.status === "failed" ||
                    event.status === "cancelled"
                ) {
                    setDimensionProgress(null);
                    loadData();
                    return;
                }
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
                if (
                    event.status === "completed" ||
                    event.status === "failed" ||
                    event.status === "stopped"
                ) {
                    loadData();
                }
            });
            return unsubscribe;
        }, [serverId, loadData]);

        const onRefresh = React.useCallback(async () => {
            setRefreshing(true);
            await loadData();
            setRefreshing(false);
        }, [loadData]);

        const healthRuns = React.useMemo(
            () => runs.filter((r) => r.trigger !== "research"),
            [runs],
        );

        const activeRun = React.useMemo(
            () => healthRuns.find((r) => r.status === "pending" || r.status === "running"),
            [healthRuns],
        );

        const activeRunSession = useSession(activeRun?.sessionId ?? "");

        const elapsedSeconds = useElapsedSeconds(activeRun ? activeRun.createdAt : null);

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
                    icon: activeLoop.status === "paused"
                        ? "pause-circle-outline" as const
                        : "sync-outline" as const,
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
                    subtitle:
                        activeRunSession && activeRun.sessionId
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
                    subtitle:
                        summary.scheduleMissedRuns > 0
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
        }, [activeLoop, activeRun, activeRunSession, currentLoopPhaseLabel, project.id, router, summary, theme.colors.textSecondary]);

        const [triggerLoading, doTrigger] = useHappyAction(
            React.useCallback(async () => {
                if (!serverId) return;
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                try {
                    const run = await triggerSupervisorRun(credentials, serverId, runRequestProfile);
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
                await cancelSupervisorRun(credentials, serverId, activeRun.id);
                await loadData();
            }, [serverId, activeRun, loadData]),
        );

        if (!serverId) {
            return (
                <SharedStateView
                    kind="empty"
                    icon={
                        <Ionicons
                            name="scan-outline"
                            size={64}
                            color={theme.colors.textSecondary}
                        />
                    }
                    title={t("supervisor.title")}
                    description={t("supervisor.notSynced")}
                />
            );
        }

        return (
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
                }
            >
                {/* Health Summary Card */}
                {summary && (
                    <ItemGroup>
                        <SupervisorSummaryCard
                            summary={summary}
                            scoreDelta={null}
                            activeLoop={activeLoop}
                            onPressLoop={
                                activeLoop
                                    ? () =>
                                          router.push({
                                              pathname: "/project/[id]/supervisor-loop/[loopId]",
                                              params: { id: project.id, loopId: activeLoop.id },
                                          })
                                    : undefined
                            }
                        />
                    </ItemGroup>
                )}

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
                                <Ionicons name="alert-circle-outline" size={16} color="#FF9500" />
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
                                    <ActivityIndicator size="small" color={theme.colors.textSecondary} />
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
                                                router.push(`/session/${activeRun.sessionId}` as any)
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
                                        style={[styles.actionButton, styles.cancelButton]}
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
                                                <ActivityIndicator size="small" color="#FFFFFF" />
                                                <Text style={styles.scanButtonText}>
                                                    {t("supervisor.scanStarting")}
                                                </Text>
                                            </>
                                        ) : (
                                            <>
                                                <Ionicons name="scan-outline" size={18} color="#FFFFFF" />
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
                                        <Text style={[styles.loopButtonText, { color: theme.colors.header.tint }]}>
                                            {t("supervisor.loopMode")}
                                        </Text>
                                    </Pressable>
                                </View>
                            )}
                        </View>
                    </View>
                </ItemGroup>

                {/* Settings link */}
                <ItemGroup>
                    <Pressable
                        style={styles.settingsLink}
                        onPress={() =>
                            router.push(`/project/${project.id}/supervisor-settings` as any)
                        }
                    >
                        <Ionicons
                            name="settings-outline"
                            size={20}
                            color={theme.colors.textSecondary}
                        />
                        <Text style={styles.settingsLinkText}>{t("supervisor.settings")}</Text>
                        <Ionicons
                            name="chevron-forward"
                            size={18}
                            color={theme.colors.textSecondary}
                        />
                    </Pressable>
                </ItemGroup>
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
        backgroundColor: resolveActiveTint(theme),
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
}));
