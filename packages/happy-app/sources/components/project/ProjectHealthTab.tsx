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
    type SupervisorAction,
    fetchSupervisorActions,
    type SupervisorCostSummary,
    fetchSupervisorCost,
    type SupervisorTrendData,
    fetchSupervisorTrend,
    type SupervisorSummary,
    fetchSupervisorSummary,
    batchUpdateActionApproval,
} from "@/sync/apiSupervisor";
import { ItemGroup } from "@/components/ItemGroup";
import { useRouter } from "expo-router";
import { sync } from "@/sync/sync";
import { SupervisorActionCard } from "./SupervisorActionCard";
import { SupervisorSummaryCard } from "./SupervisorSummaryCard";
import { SupervisorTrendChart } from "./SupervisorTrendChart";
import { SupervisorRunHistoryItem } from "./SupervisorRunHistoryItem";
import type { TranslationKey } from "@/text";
import { Modal } from "@/modal";

const statusKeyMap: Record<string, TranslationKey> = {
    pending: "supervisor.status_pending",
    running: "supervisor.status_running",
    completed: "supervisor.status_completed",
    failed: "supervisor.status_failed",
    cancelled: "supervisor.status_cancelled",
};

function statusLabel(status: string): string {
    const key = statusKeyMap[status];
    return key ? t(key) : status;
}

interface ProjectHealthTabProps {
    project: Project;
}

export const ProjectHealthTab = React.memo(
    ({ project }: ProjectHealthTabProps) => {
        const { theme } = useUnistyles();
        const router = useRouter();
        const [runs, setRuns] = React.useState<SupervisorRun[]>([]);
        const [total, setTotal] = React.useState(0);
        const [pendingActions, setPendingActions] = React.useState<
            SupervisorAction[]
        >([]);
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

        const serverId = project.serverId;

        const loadData = React.useCallback(async () => {
            if (!serverId) return;
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const [runsResult, actionsResult, costResult, trendResult, relatedResult, summaryResult] =
                    await Promise.all([
                        fetchSupervisorRuns(credentials, serverId, {
                            limit: 20,
                        }),
                        fetchSupervisorActions(credentials, serverId, {
                            approval: "pending",
                            limit: 20,
                        }),
                        fetchSupervisorCost(credentials, serverId, 30).catch(
                            () => null,
                        ),
                        fetchSupervisorTrend(credentials, serverId, 30).catch(
                            () => null,
                        ),
                        fetchRelatedProjects(credentials, serverId).catch(
                            () => [],
                        ),
                        fetchSupervisorSummary(credentials, serverId).catch(
                            () => null,
                        ),
                    ]);
                setRuns(runsResult.runs);
                setTotal(runsResult.total);
                setPendingActions(actionsResult.actions);
                setCostSummary(costResult);
                setTrendData(trendResult);
                setRelatedProjects(relatedResult);
                setSummary(summaryResult);
            } catch (e) {
                // Silently fail — user can pull to refresh
            } finally {
                setLoaded(true);
            }
        }, [serverId]);

        React.useEffect(() => {
            loadData();
        }, [loadData]);

        // Subscribe to real-time supervisor status updates
        React.useEffect(() => {
            if (!serverId) return;
            const unsubscribe = sync.onSupervisorStatus((event) => {
                if (event.projectId !== serverId) return;
                // Terminal states: full refresh
                if (event.status === "completed" || event.status === "failed" || event.status === "cancelled") {
                    loadData();
                }
                // Running state: optimistic UI update
                if (event.status === "running") {
                    setRuns((prev) => {
                        const exists = prev.some((r) => r.id === event.runId);
                        if (exists) {
                            return prev.map((r) =>
                                r.id === event.runId ? { ...r, status: "running" } : r,
                            );
                        }
                        return prev;
                    });
                }
            });
            return unsubscribe;
        }, [serverId, loadData]);

        const onRefresh = React.useCallback(async () => {
            setRefreshing(true);
            await loadData();
            setRefreshing(false);
        }, [loadData]);

        const activeRun = React.useMemo(
            () =>
                runs.find(
                    (r) => r.status === "pending" || r.status === "running",
                ),
            [runs],
        );

        const [triggerLoading, doTrigger] = useHappyAction(
            React.useCallback(async () => {
                if (!serverId) return;
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                try {
                    const run = await triggerSupervisorRun(credentials, serverId);
                    // Optimistic: add the new run to the list immediately
                    setRuns((prev) => [run, ...prev]);
                } catch (e) {
                    if (e instanceof SupervisorAlreadyRunningError) {
                        throw new Error(t("supervisor.alreadyRunning"));
                    }
                    throw e;
                }
            }, [serverId]),
        );

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

        const [batchApproveLoading, doBatchApprove] = useHappyAction(
            React.useCallback(async () => {
                if (!serverId || pendingActions.length === 0) return;
                const confirmed = await Modal.confirm(
                    t("supervisor.approveAll"),
                    t("supervisor.approveAllConfirm", {
                        count: pendingActions.length,
                    }),
                    { confirmText: t("supervisor.approve"), destructive: false },
                );
                if (!confirmed) return;
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const pendingIds = pendingActions.map((a) => a.id);
                await batchUpdateActionApproval(
                    credentials,
                    serverId,
                    pendingIds,
                    "approved",
                );
                Modal.toast(
                    t("supervisor.approveAllSuccess", {
                        count: pendingIds.length,
                    }),
                );
                await loadData();
            }, [serverId, pendingActions, loadData]),
        );

        const [batchSkipLoading, doBatchSkip] = useHappyAction(
            React.useCallback(async () => {
                if (!serverId || pendingActions.length === 0) return;
                const confirmed = await Modal.confirm(
                    t("supervisor.skipAll"),
                    t("supervisor.skipAllConfirm", {
                        count: pendingActions.length,
                    }),
                    { confirmText: t("supervisor.skip"), destructive: true },
                );
                if (!confirmed) return;
                const credentials = await TokenStorage.getCredentials();
                if (!credentials) return;
                const pendingIds = pendingActions.map((a) => a.id);
                await batchUpdateActionApproval(
                    credentials,
                    serverId,
                    pendingIds,
                    "skipped",
                );
                Modal.toast(
                    t("supervisor.skipAllSuccess", {
                        count: pendingIds.length,
                    }),
                );
                await loadData();
            }, [serverId, pendingActions, loadData]),
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

                        {/* Action buttons */}
                        <View style={styles.actionRow}>
                            {activeRun ? (
                                <>
                                    <View style={styles.statusChip}>
                                        <ActivityIndicator
                                            size="small"
                                            color={theme.colors.header.tint}
                                        />
                                        <Text style={styles.statusChipText}>
                                            {statusLabel(activeRun.status)}
                                        </Text>
                                    </View>
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
                                </>
                            ) : (
                                <Pressable
                                    style={styles.scanButton}
                                    onPress={doTrigger}
                                    disabled={triggerLoading}
                                >
                                    {triggerLoading ? (
                                        <ActivityIndicator
                                            size="small"
                                            color="#FFFFFF"
                                        />
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
                            )}
                        </View>
                    </View>
                </ItemGroup>

                {/* Health Summary */}
                <SupervisorSummaryCard summary={summary} scoreDelta={scoreDelta} />

                {/* Pending Actions */}
                {pendingActions.length > 0 && serverId && (
                    <ItemGroup
                        title={t("supervisor.pendingActions", {
                            count: pendingActions.length,
                        })}
                    >
                        {pendingActions.map((action, index) => (
                            <SupervisorActionCard
                                key={action.id}
                                action={action}
                                projectId={serverId}
                                onUpdated={loadData}
                                isLast={
                                    index === pendingActions.length - 1
                                }
                            />
                        ))}
                        <View style={styles.batchButtonsRow}>
                            <Pressable
                                style={styles.batchApproveButton}
                                onPress={doBatchApprove}
                                disabled={batchApproveLoading}
                            >
                                {batchApproveLoading ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                ) : (
                                    <Text style={styles.batchApproveText}>
                                        {t("supervisor.approveAll")}
                                    </Text>
                                )}
                            </Pressable>
                            <Pressable
                                style={styles.batchSkipButton}
                                onPress={doBatchSkip}
                                disabled={batchSkipLoading}
                            >
                                {batchSkipLoading ? (
                                    <ActivityIndicator size="small" color={theme.colors.text} />
                                ) : (
                                    <Text style={styles.batchSkipText}>
                                        {t("supervisor.skipAll")}
                                    </Text>
                                )}
                            </Pressable>
                        </View>
                    </ItemGroup>
                )}

                {/* View All Actions link */}
                {serverId && (
                    <ItemGroup>
                        <Pressable
                            style={styles.viewAllLink}
                            onPress={() =>
                                router.push(
                                    `/project/${serverId}/supervisor-actions` as any,
                                )
                            }
                        >
                            <Text style={styles.viewAllLinkText}>
                                {t("supervisor.viewAllActions")}
                            </Text>
                            <Ionicons
                                name="chevron-forward"
                                size={16}
                                color={theme.colors.header.tint}
                            />
                        </Pressable>
                    </ItemGroup>
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

                {/* Run History */}
                <ItemGroup title={t("supervisor.runHistory")}>
                    {!loaded ? (
                        <View style={styles.loadingContainer}>
                            <ActivityIndicator size="small" />
                        </View>
                    ) : runs.length === 0 ? (
                        <View style={styles.emptyHistoryCard}>
                            <Text style={styles.emptyHistoryText}>
                                {t("supervisor.noRuns")}
                            </Text>
                        </View>
                    ) : (
                        <>
                            {runs.map((run, index) => (
                                <SupervisorRunHistoryItem
                                    key={run.id}
                                    run={run}
                                    isLast={index === runs.length - 1}
                                    onPress={
                                        run.status === "completed" && serverId
                                            ? () =>
                                                  router.push({
                                                      pathname:
                                                          "/project/[id]/supervisor-run/[runId]",
                                                      params: {
                                                          id: serverId,
                                                          runId: run.id,
                                                      },
                                                  })
                                            : undefined
                                    }
                                />
                            ))}
                            {total > runs.length && (
                                <View style={styles.moreRow}>
                                    <Text style={styles.moreText}>
                                        {t("supervisor.moreRuns", {
                                            count: total - runs.length,
                                        })}
                                    </Text>
                                </View>
                            )}
                        </>
                    )}
                </ItemGroup>

                {/* Related Projects (Cross-Machine) */}
                <SupervisorRelatedProjects relatedProjects={relatedProjects} />

                {/* Webhook Events link */}
                <ItemGroup>
                    <Pressable
                        style={styles.settingsLink}
                        onPress={() =>
                            router.push(
                                `/project/${project.serverId}/webhook-events` as any,
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

                {/* Settings link */}
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
    actionRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginTop: 4,
    },
    scanButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: theme.colors.header.tint,
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    scanButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: "#FFFFFF",
    },
    statusChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: theme.colors.surface,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
    },
    statusChipText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
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
    batchButtonsRow: {
        flexDirection: "row",
        gap: 8,
        marginTop: 8,
        marginBottom: 4,
        paddingHorizontal: 16,
    },
    batchApproveButton: {
        flex: 1,
        backgroundColor: theme.colors.header.tint,
        paddingVertical: 10,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    batchApproveText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: "#FFFFFF",
    },
    batchSkipButton: {
        flex: 1,
        backgroundColor: theme.colors.surface,
        paddingVertical: 10,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
    },
    batchSkipText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.text,
    },
    viewAllLink: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    viewAllLinkText: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        color: theme.colors.header.tint,
    },
}));
