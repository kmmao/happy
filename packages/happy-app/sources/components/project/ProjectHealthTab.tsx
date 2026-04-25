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
import { onProjectEvent } from "@/utils/projectEvents";
import {
    type RelatedProject,
    fetchRelatedProjects,
} from "@/sync/apiProjects";
import { SupervisorCostSection } from "./SupervisorCostSection";
import { SupervisorRelatedProjects } from "./SupervisorRelatedProjects";
import {
    SupervisorRun,
    fetchSupervisorRuns,
    type SupervisorCostSummary,
    fetchSupervisorCost,
    type SupervisorTrendData,
    fetchSupervisorTrend,
    deleteSupervisorRun,
    deleteSupervisorLoop,
    clearAllRuns,
    clearAllLoops,
    type SupervisorLoop,
    fetchLoopHistory,
} from "@/sync/apiSupervisor";
import { ItemGroup } from "@/components/ItemGroup";
import { useRouter } from "expo-router";
import { sync } from "@/sync/sync";
import { SupervisorTrendChart } from "./SupervisorTrendChart";
import { SupervisorRunHistoryItem } from "./SupervisorRunHistoryItem";
import { Modal } from "@/modal";
import { useHappyAction } from "@/hooks/useHappyAction";
import { DayRangeSelector } from "./DayRangeSelector";
import { SupervisorLoopHistoryItem } from "./SupervisorLoopHistoryItem";
import { SharedStateView } from "@/components/SharedStateView";


interface ProjectHealthTabProps {
    project: Project;
}

export const ProjectHealthTab = React.memo(
    ({ project }: ProjectHealthTabProps) => {
        const { theme } = useUnistyles();
        const router = useRouter();
        const [runs, setRuns] = React.useState<SupervisorRun[]>([]);
        const [runsTotal, setRunsTotal] = React.useState(0);
        const [loadingMore, setLoadingMore] = React.useState(false);
        const [costSummary, setCostSummary] =
            React.useState<SupervisorCostSummary | null>(null);
        const [trendData, setTrendData] =
            React.useState<SupervisorTrendData | null>(null);
        const [relatedProjects, setRelatedProjects] = React.useState<
            RelatedProject[]
        >([]);
        const [loaded, setLoaded] = React.useState(false);
        const [refreshing, setRefreshing] = React.useState(false);
        const [loopHistory, setLoopHistory] = React.useState<SupervisorLoop[]>([]);
        const [loopHistoryTotal, setLoopHistoryTotal] = React.useState(0);
        const PAGE_SIZE = 20;
        const [visibleRunCount, setVisibleRunCount] = React.useState(3);
        const [analyticsDays, setAnalyticsDays] = React.useState(3);
        const analyticsDaysRef = React.useRef(3);
        const [analyticsLoading, setAnalyticsLoading] = React.useState(false);

        const serverId = project.serverId;

        const loadData = React.useCallback(async () => {
            if (!serverId) return;
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const [runsResult, costResult, trendResult, relatedResult, loopHistoryResult] =
                    await Promise.all([
                        fetchSupervisorRuns(credentials, serverId, { limit: PAGE_SIZE, offset: 0 }),
                        fetchSupervisorCost(credentials, serverId, analyticsDaysRef.current).catch(
                            () => null,
                        ),
                        fetchSupervisorTrend(credentials, serverId, analyticsDaysRef.current).catch(
                            () => null,
                        ),
                        fetchRelatedProjects(credentials, serverId).catch(() => []),
                        fetchLoopHistory(credentials, serverId, { limit: 5 }).catch(
                            () => ({ loops: [], total: 0 }),
                        ),
                    ]);
                setRuns(runsResult.runs);
                setRunsTotal(runsResult.total);
                setVisibleRunCount(3);
                setCostSummary(costResult);
                setTrendData(trendResult);
                setRelatedProjects(relatedResult);
                setLoopHistory(loopHistoryResult.loops);
                setLoopHistoryTotal(loopHistoryResult.total);
            } catch {
                // Silently fail — user can pull to refresh
            } finally {
                setLoaded(true);
            }
        }, [serverId]);

        const loadMoreRuns = React.useCallback(async () => {
            if (!serverId || loadingMore) return;
            const nextVisible = visibleRunCount + 10;
            // If we already have enough locally loaded, just expand the visible count
            if (nextVisible <= runs.length) {
                setVisibleRunCount(nextVisible);
                return;
            }
            // Need to fetch from server
            setLoadingMore(true);
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const result = await fetchSupervisorRuns(credentials, serverId, {
                    limit: PAGE_SIZE,
                    offset: runs.length,
                });
                setRuns((prev) => {
                    const existingIds = new Set(prev.map((r) => r.id));
                    const newRuns = result.runs.filter((r) => !existingIds.has(r.id));
                    return [...prev, ...newRuns];
                });
                setRunsTotal(result.total);
                setVisibleRunCount(nextVisible);
            } catch {
                // Silently fail
            } finally {
                setLoadingMore(false);
            }
        }, [serverId, loadingMore, visibleRunCount, runs.length]);

        React.useEffect(() => {
            loadData();
        }, [loadData]);

        React.useEffect(() => {
            return onProjectEvent("actions-changed", () => {
                loadData();
            });
        }, [loadData]);

        React.useEffect(() => {
            if (!serverId) return;
            const unsubscribe = sync.onSupervisorStatus((event) => {
                if (event.projectId !== serverId) return;
                if (
                    event.status === "completed" ||
                    event.status === "failed" ||
                    event.status === "cancelled"
                ) {
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

        const healthRuns = React.useMemo(
            () => runs.filter((r) => r.trigger !== "research"),
            [runs],
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

        const [clearRunsLoading, doClearAllRuns] = useHappyAction(
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
                const result = await clearAllRuns(credentials, serverId);
                Modal.toast(t("supervisor.clearAllSuccess", { count: result.deletedCount }));
                setRuns([]);
                setRunsTotal(0);
                setVisibleRunCount(3);
            }, [serverId]),
        );

        const [clearLoopsLoading, doClearAllLoops] = useHappyAction(
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
                const result = await clearAllLoops(credentials, serverId);
                Modal.toast(t("supervisor.clearAllSuccess", { count: result.deletedCount }));
                setLoopHistory([]);
                setLoopHistoryTotal(0);
            }, [serverId]),
        );

        if (!serverId) {
            return (
                <SharedStateView
                    kind="empty"
                    icon={
                        <Ionicons
                            name="pulse-outline"
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
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                    />
                }
            >
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
                {trendData && trendData.points.length >= 2 && (
                    <ItemGroup title={t("supervisor.trendSection")}>
                        <SupervisorTrendChart points={trendData.points} />
                    </ItemGroup>
                )}

                {/* Loop History */}
                {loaded && loopHistory.length > 0 && (
                    <ItemGroup
                        title={
                            <View style={styles.sectionHeader}>
                                <Text style={styles.sectionTitle}>{t("supervisor.loopHistory")}</Text>
                                <Pressable onPress={doClearAllLoops} disabled={clearLoopsLoading} hitSlop={8}>
                                    {clearLoopsLoading
                                        ? <ActivityIndicator size="small" color="#FF3B30" />
                                        : <Text style={styles.clearAllText}>{t("supervisor.clearAll")}</Text>
                                    }
                                </Pressable>
                            </View>
                        }
                    >
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
                <ItemGroup
                    title={
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>{t("supervisor.runHistory")}</Text>
                            {loaded && healthRuns.length > 0 && (
                                <Pressable onPress={doClearAllRuns} disabled={clearRunsLoading} hitSlop={8}>
                                    {clearRunsLoading
                                        ? <ActivityIndicator size="small" color="#FF3B30" />
                                        : <Text style={styles.clearAllText}>{t("supervisor.clearAll")}</Text>
                                    }
                                </Pressable>
                            )}
                        </View>
                    }
                >
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
                            {healthRuns.slice(0, visibleRunCount).map((run, index) => (
                                <SupervisorRunHistoryItem
                                    key={run.id}
                                    run={run}
                                    isLast={index === Math.min(healthRuns.length, visibleRunCount) - 1}
                                    onPress={
                                        run.status !== "pending" && run.status !== "running" && serverId
                                            ? () =>
                                                  router.push({
                                                      pathname: "/project/[id]/supervisor-run/[runId]",
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
                            {(healthRuns.length > visibleRunCount || runsTotal > runs.length) && (
                                <Pressable
                                    style={styles.showMoreRow}
                                    onPress={loadMoreRuns}
                                    disabled={loadingMore}
                                >
                                    {loadingMore ? (
                                        <ActivityIndicator size="small" color={theme.colors.header.tint} />
                                    ) : (
                                        <>
                                            <Text style={styles.showMoreText}>
                                                {t("supervisor.showMoreRuns", {
                                                    count: Math.max(
                                                        healthRuns.length - visibleRunCount,
                                                        runsTotal - visibleRunCount,
                                                    ),
                                                })}
                                            </Text>
                                            <Ionicons
                                                name="chevron-forward"
                                                size={16}
                                                color={theme.colors.header.tint}
                                            />
                                        </>
                                    )}
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
    sectionHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        flex: 1,
    },
    sectionTitle: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: theme.colors.textSecondary,
        textTransform: "uppercase",
        letterSpacing: 0.5,
    },
    clearAllText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: "#FF3B30",
    },
}));
