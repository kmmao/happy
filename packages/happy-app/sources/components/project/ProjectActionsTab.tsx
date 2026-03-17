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
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { TokenStorage } from "@/auth/tokenStorage";
import {
    fetchSupervisorActions,
    fetchActionStats,
    type SupervisorAction,
    type SupervisorActionStats,
} from "@/sync/apiSupervisor";
import { SupervisorActionCard } from "@/components/project/SupervisorActionCard";
import { sync } from "@/sync/sync";
import { layout } from "@/components/layout";
import { Project } from "@/sync/projectManager";

// --- Types ---

type ActionTab = "pending" | "approved" | "fixing" | "done" | "dismissed";

const TABS: ActionTab[] = ["pending", "approved", "fixing", "done", "dismissed"];
const PAGE_SIZE = 20;

// --- Tab label mapping ---

function getTabLabel(tab: ActionTab): string {
    switch (tab) {
        case "pending":
            return t("supervisor.tabPending");
        case "approved":
            return t("supervisor.tabApproved");
        case "fixing":
            return t("supervisor.tabFixing");
        case "done":
            return t("supervisor.tabDone");
        case "dismissed":
            return t("supervisor.tabDismissed");
    }
}

function getTabCount(
    tab: ActionTab,
    stats: SupervisorActionStats | null,
): number | null {
    if (!stats) return null;
    switch (tab) {
        case "pending":
            return stats.pending ?? null;
        case "approved":
            return stats.approvedNoFix ?? null;
        case "fixing":
            return (stats.fixPending ?? 0) + (stats.fixRunning ?? 0) || null;
        case "done":
            return (stats.fixCompleted ?? 0) + (stats.fixFailed ?? 0) || null;
        case "dismissed":
            return (stats.skipped ?? 0) + (stats.ignored ?? 0) || null;
    }
}

function getTabFetchParams(tab: ActionTab): { approval?: string; view?: string } {
    if (tab === "pending") return { approval: "pending" };
    return { view: tab };
}

// --- Props ---

interface ProjectActionsTabProps {
    readonly project: Project;
}

// --- Component ---

function ProjectActionsTabInner({ project }: ProjectActionsTabProps) {
    const { theme } = useUnistyles();
    const projectId = project.serverId ?? "";

    const [activeTab, setActiveTab] = React.useState<ActionTab>("pending");
    const [actions, setActions] = React.useState<SupervisorAction[]>([]);
    const [stats, setStats] = React.useState<SupervisorActionStats | null>(
        null,
    );
    const [loading, setLoading] = React.useState(!projectId);
    const [loadingMore, setLoadingMore] = React.useState(false);
    const [refreshing, setRefreshing] = React.useState(false);
    const [total, setTotal] = React.useState(0);

    // Fetch stats for badge counts on mount
    React.useEffect(() => {
        if (!projectId) return;
        let cancelled = false;

        async function loadStats() {
            try {
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || cancelled) return;
                const data = await fetchActionStats(credentials, projectId).catch(
                    () => null,
                );
                if (!cancelled && data) {
                    setStats(data);
                }
            } catch {
                // Stats are optional — silently ignore
            }
        }

        loadStats();
        return () => {
            cancelled = true;
        };
    }, [projectId]);

    // Fetch actions when activeTab changes
    React.useEffect(() => {
        if (!projectId) return;
        let cancelled = false;

        async function loadActions() {
            try {
                setLoading(true);
                setActions([]);
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || cancelled) return;
                const data = await fetchSupervisorActions(credentials, projectId, {
                    ...getTabFetchParams(activeTab),
                    limit: PAGE_SIZE,
                    offset: 0,
                });
                if (!cancelled) {
                    setActions(data.actions);
                    setTotal(data.total);
                }
            } catch {
                // Silently fail — list stays empty
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        loadActions();
        return () => {
            cancelled = true;
        };
    }, [projectId, activeTab]);

    const handleLoadMore = React.useCallback(async () => {
        if (loadingMore || actions.length >= total) return;
        try {
            setLoadingMore(true);
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const data = await fetchSupervisorActions(credentials, projectId, {
                ...getTabFetchParams(activeTab),
                limit: PAGE_SIZE,
                offset: actions.length,
            });
            setActions((prev) => [...prev, ...data.actions]);
            setTotal(data.total);
        } catch {
            // Silently fail
        } finally {
            setLoadingMore(false);
        }
    }, [projectId, activeTab, actions.length, total, loadingMore]);

    const handleRefresh = React.useCallback(async () => {
        try {
            setRefreshing(true);
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            const [actionsData, statsData] = await Promise.all([
                fetchSupervisorActions(credentials, projectId, {
                    ...getTabFetchParams(activeTab),
                    limit: PAGE_SIZE,
                    offset: 0,
                }),
                fetchActionStats(credentials, projectId).catch(() => null),
            ]);

            setActions(actionsData.actions);
            setTotal(actionsData.total);
            if (statsData) {
                setStats(statsData);
            }
        } catch {
            // Silently fail
        } finally {
            setRefreshing(false);
        }
    }, [projectId, activeTab]);

    const handleUpdated = React.useCallback(async () => {
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;

            const [actionsData, statsData] = await Promise.all([
                fetchSupervisorActions(credentials, projectId, {
                    ...getTabFetchParams(activeTab),
                    limit: Math.max(actions.length, PAGE_SIZE),
                    offset: 0,
                }),
                fetchActionStats(credentials, projectId).catch(() => null),
            ]);

            setActions(actionsData.actions);
            setTotal(actionsData.total);
            if (statsData) {
                setStats(statsData);
            }
        } catch {
            // Silently fail
        }
    }, [projectId, activeTab, actions.length]);

    // Subscribe to real-time fix status updates
    React.useEffect(() => {
        const unsubscribe = sync.onSupervisorStatus((event) => {
            if (event.projectId !== projectId) return;
            if (
                event.status === "fix-running" ||
                event.status === "fix-completed" ||
                event.status === "fix-failed"
            ) {
                handleUpdated();
            }
        });
        return unsubscribe;
    }, [projectId, handleUpdated]);

    const hasMore = actions.length < total;

    return (
        <View style={styles.container}>
            {/* Segmented Control */}
            <View style={styles.tabBar}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.tabBarContent}
                >
                    {TABS.map((tab) => {
                        const isActive = tab === activeTab;
                        const count = getTabCount(tab, stats);
                        return (
                            <Pressable
                                key={tab}
                                style={[
                                    styles.tab,
                                    isActive && styles.tabActive,
                                ]}
                                onPress={() => setActiveTab(tab)}
                            >
                                <Text
                                    style={[
                                        styles.tabLabel,
                                        isActive && styles.tabLabelActive,
                                    ]}
                                >
                                    {getTabLabel(tab)}
                                </Text>
                                {count !== null && (
                                    <View
                                        style={[
                                            styles.tabBadge,
                                            isActive &&
                                                styles.tabBadgeActive,
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.tabBadgeText,
                                                isActive &&
                                                    styles.tabBadgeTextActive,
                                            ]}
                                        >
                                            {count}
                                        </Text>
                                    </View>
                                )}
                            </Pressable>
                        );
                    })}
                </ScrollView>
            </View>

            {/* Action List */}
            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator
                        size="large"
                        color={theme.colors.header.tint}
                    />
                </View>
            ) : actions.length === 0 ? (
                <View style={styles.centered}>
                    <Text style={styles.emptyText}>
                        {t("supervisor.noActions")}
                    </Text>
                </View>
            ) : (
                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={handleRefresh}
                            tintColor={theme.colors.header.tint}
                        />
                    }
                >
                    <View style={styles.actionsContainer}>
                        {actions.map((action, index) => (
                            <SupervisorActionCard
                                key={action.id}
                                action={action}
                                projectId={projectId}
                                onUpdated={handleUpdated}
                                isLast={index === actions.length - 1}
                            />
                        ))}
                    </View>

                    {/* Load More */}
                    {hasMore && (
                        <Pressable
                            style={styles.loadMoreButton}
                            onPress={handleLoadMore}
                            disabled={loadingMore}
                        >
                            {loadingMore ? (
                                <ActivityIndicator
                                    size="small"
                                    color={theme.colors.header.tint}
                                />
                            ) : (
                                <Text style={styles.loadMoreText}>
                                    {t("supervisor.loadMore")}
                                </Text>
                            )}
                        </Pressable>
                    )}
                </ScrollView>
            )}
        </View>
    );
}

export const ProjectActionsTab = React.memo(ProjectActionsTabInner);

// --- Styles ---

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
    },
    tabBar: {
        paddingTop: 8,
    },
    tabBarContent: {
        flexDirection: "row",
        paddingHorizontal: 16,
        paddingVertical: 4,
        gap: 8,
    },
    tab: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 20,
        backgroundColor: theme.colors.groupped.background,
    },
    tabActive: {
        backgroundColor: theme.colors.header.tint,
    },
    tabLabel: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.textSecondary,
    },
    tabLabelActive: {
        ...Typography.default("semiBold"),
        color: "#FFFFFF",
    },
    tabBadge: {
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: theme.colors.divider,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 4,
    },
    tabBadgeActive: {
        backgroundColor: "rgba(255,255,255,0.3)",
    },
    tabBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        color: theme.colors.textSecondary,
    },
    tabBadgeTextActive: {
        color: "#FFFFFF",
    },
    centered: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    emptyText: {
        ...Typography.default(),
        fontSize: 15,
        color: theme.colors.textSecondary,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingTop: 16,
        paddingBottom: 32,
    },
    actionsContainer: {
        marginHorizontal: 16,
        backgroundColor: theme.colors.surface,
        borderRadius: 10,
        overflow: "hidden",
    },
    loadMoreButton: {
        marginHorizontal: 16,
        marginTop: 12,
        paddingVertical: 12,
        borderRadius: 10,
        backgroundColor: theme.colors.surface,
        alignItems: "center",
        justifyContent: "center",
    },
    loadMoreText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.header.tint,
    },
}));
