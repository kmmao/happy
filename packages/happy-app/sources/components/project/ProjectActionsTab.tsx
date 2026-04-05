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
import { TokenStorage } from "@/auth/tokenStorage";
import { emitProjectEvent, onProjectEvent } from "@/utils/projectEvents";
import {
    fetchSupervisorActions,
    fetchActionStats,
    type SupervisorAction,
    type SupervisorActionStats,
} from "@/sync/apiSupervisor";
import { SupervisorActionCard } from "@/components/project/SupervisorActionCard";
import { Modal } from "@/modal";
import { sync } from "@/sync/sync";
import { layout } from "@/components/layout";
import { Project } from "@/sync/projectManager";
import {
    type SortField,
    type UrgencyLevel,
    SORT_KEY_MAP,
    SEVERITY_ORDER,
    URGENCY_ORDER,
    URGENCY_COLORS,
    CATEGORY_KEY_MAP,
    getUrgencyLevel,
} from "./supervisorConstants";

// --- Types ---

type ActionTab = "pending" | "approved" | "fixing" | "analyzing" | "analyzed" | "done" | "failed" | "dismissed";
type UrgencyFilter = "all" | UrgencyLevel;

const TABS: ActionTab[] = ["pending", "approved", "fixing", "analyzing", "analyzed", "done", "failed", "dismissed"];
const SORT_FIELDS: SortField[] = ["severity", "category", "confidence", "urgency"];
const URGENCY_FILTERS: UrgencyFilter[] = ["all", "urgent", "must-fix", "optional"];
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
        case "analyzing":
            return t("supervisor.tabAnalyzing");
        case "analyzed":
            return t("supervisor.tabAnalyzed");
        case "done":
            return t("supervisor.tabDone");
        case "failed":
            return t("supervisor.tabFailed");
        case "dismissed":
            return t("supervisor.tabDismissed");
    }
}

function getTabCount(
    tab: ActionTab,
    stats: SupervisorActionStats | null,
): number | null {
    if (!stats) return null;
    let count: number;
    switch (tab) {
        case "pending":
            count = stats.pending ?? 0;
            break;
        case "approved":
            count = stats.approvedNoFix ?? 0;
            break;
        case "fixing":
            count = stats.fixing ?? 0;
            break;
        case "analyzing":
            count = stats.analyzing ?? 0;
            break;
        case "analyzed":
            count = stats.fixAnalyzed ?? 0;
            break;
        case "done":
            count = stats.fixCompleted ?? 0;
            break;
        case "failed":
            count = stats.fixFailed ?? 0;
            break;
        case "dismissed":
            count = (stats.skipped ?? 0) + (stats.ignored ?? 0);
            break;
    }
    return count > 0 ? count : null;
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
    const [loading, setLoading] = React.useState(!!projectId);
    const [loadingMore, setLoadingMore] = React.useState(false);
    const [refreshing, setRefreshing] = React.useState(false);
    const [total, setTotal] = React.useState(0);
    const [sortField, setSortField] = React.useState<SortField | null>(null);
    const [sortAsc, setSortAsc] = React.useState(false);
    const [urgencyFilter, setUrgencyFilter] = React.useState<UrgencyFilter>("all");
    const [categoryFilter, setCategoryFilter] = React.useState<string | null>(null);

    // Fetch actions and stats when activeTab changes (stats also refreshed here)
    React.useEffect(() => {
        if (!projectId) return;
        let cancelled = false;

        async function loadActions() {
            try {
                setLoading(true);
                setActions([]);
                const credentials = await TokenStorage.getCredentials();
                if (!credentials || cancelled) return;
                const [data, statsData] = await Promise.all([
                    fetchSupervisorActions(credentials, projectId, {
                        ...getTabFetchParams(activeTab),
                        category: categoryFilter ?? undefined,
                        limit: PAGE_SIZE,
                        offset: 0,
                    }),
                    fetchActionStats(credentials, projectId).catch(
                        () => null,
                    ),
                ]);
                if (!cancelled) {
                    setActions(data.actions);
                    setTotal(data.total);
                    if (statsData) {
                        setStats(statsData);
                    }
                }
            } catch {
                Modal.toast(t("supervisor.loadError"));
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
    }, [projectId, activeTab, categoryFilter]);

    const handleLoadMore = React.useCallback(async () => {
        if (loadingMore || actions.length >= total) return;
        try {
            setLoadingMore(true);
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const data = await fetchSupervisorActions(credentials, projectId, {
                ...getTabFetchParams(activeTab),
                category: categoryFilter ?? undefined,
                limit: PAGE_SIZE,
                offset: actions.length,
            });
            setActions((prev) => [...prev, ...data.actions]);
            setTotal(data.total);
        } catch {
            Modal.toast(t("supervisor.loadError"));
        } finally {
            setLoadingMore(false);
        }
    }, [projectId, activeTab, categoryFilter, actions.length, total, loadingMore]);

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
            Modal.toast(t("supervisor.loadError"));
        } finally {
            setRefreshing(false);
        }
    }, [projectId, activeTab]);

    // Listen for health tab changes to refresh actions
    React.useEffect(() => {
        return onProjectEvent("health-changed", () => {
            handleRefresh();
        });
    }, [handleRefresh]);

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
            emitProjectEvent("actions-changed");
        } catch {
            Modal.toast(t("supervisor.loadError"));
        }
    }, [projectId, activeTab, actions.length]);

    // Subscribe to real-time fix status updates
    React.useEffect(() => {
        const unsubscribe = sync.onSupervisorStatus((event) => {
            if (event.projectId !== projectId) return;
            if (
                event.status === "fix-running" ||
                event.status === "fix-completed" ||
                event.status === "fix-failed" ||
                event.status === "fix-analyzed"
            ) {
                handleUpdated();
            }
        });
        return unsubscribe;
    }, [projectId, handleUpdated]);

    const handleSortPress = React.useCallback((field: SortField) => {
        setSortField((prev) => {
            if (prev === field) {
                // Toggle direction, or clear if already ascending
                setSortAsc((asc) => {
                    if (asc) {
                        // Clear sort
                        setSortField(null);
                        return false;
                    }
                    return true;
                });
                return field;
            }
            setSortAsc(false);
            return field;
        });
    }, []);

    const handleUrgencyPress = React.useCallback((filter: UrgencyFilter) => {
        setUrgencyFilter((prev) => (prev === filter ? "all" : filter));
    }, []);

    const displayedActions = React.useMemo(() => {
        let result = actions;

        // Filter by urgency
        if (urgencyFilter !== "all") {
            result = result.filter(
                (a) => getUrgencyLevel(a.severity, a.confidence) === urgencyFilter,
            );
        }

        // Sort
        if (sortField) {
            const dir = sortAsc ? 1 : -1;
            result = [...result].sort((a, b) => {
                switch (sortField) {
                    case "severity": {
                        const oa = SEVERITY_ORDER[a.severity] ?? 99;
                        const ob = SEVERITY_ORDER[b.severity] ?? 99;
                        return (oa - ob) * dir;
                    }
                    case "category":
                        return a.category.localeCompare(b.category) * dir;
                    case "confidence": {
                        const ca = a.confidence ?? 0;
                        const cb = b.confidence ?? 0;
                        return (cb - ca) * dir; // Default: high confidence first
                    }
                    case "urgency": {
                        const ua = URGENCY_ORDER[getUrgencyLevel(a.severity, a.confidence)];
                        const ub = URGENCY_ORDER[getUrgencyLevel(b.severity, b.confidence)];
                        return (ua - ub) * dir;
                    }
                    default:
                        return 0;
                }
            });
        }

        return result;
    }, [actions, sortField, sortAsc, urgencyFilter]);

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

            {/* Sort & Filter Bar */}
            {!loading && actions.length > 0 && (
                <View style={styles.filterBar}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.filterBarContent}
                    >
                        {/* Sort chips */}
                        <View style={styles.filterGroup}>
                            <Ionicons
                                name="swap-vertical-outline"
                                size={14}
                                color={theme.colors.textSecondary}
                            />
                            {SORT_FIELDS.map((field) => {
                                const isActive = sortField === field;
                                return (
                                    <Pressable
                                        key={field}
                                        style={[
                                            styles.chip,
                                            isActive && styles.chipActive,
                                        ]}
                                        onPress={() => handleSortPress(field)}
                                    >
                                        <Text
                                            style={[
                                                styles.chipText,
                                                isActive && styles.chipTextActive,
                                            ]}
                                        >
                                            {t(SORT_KEY_MAP[field])}
                                        </Text>
                                        {isActive && (
                                            <Ionicons
                                                name={sortAsc ? "arrow-up" : "arrow-down"}
                                                size={10}
                                                color="#FFFFFF"
                                            />
                                        )}
                                    </Pressable>
                                );
                            })}
                        </View>

                        {/* Divider */}
                        <View style={styles.filterDivider} />

                        {/* Urgency filter chips */}
                        <View style={styles.filterGroup}>
                            <Ionicons
                                name="flag-outline"
                                size={14}
                                color={theme.colors.textSecondary}
                            />
                            {URGENCY_FILTERS.map((filter) => {
                                const isActive = urgencyFilter === filter;
                                const chipColor =
                                    filter !== "all"
                                        ? URGENCY_COLORS[filter]
                                        : undefined;
                                return (
                                    <Pressable
                                        key={filter}
                                        style={[
                                            styles.chip,
                                            isActive && (chipColor
                                                ? { backgroundColor: chipColor }
                                                : styles.chipActive),
                                        ]}
                                        onPress={() => handleUrgencyPress(filter)}
                                    >
                                        <Text
                                            style={[
                                                styles.chipText,
                                                isActive && styles.chipTextActive,
                                            ]}
                                        >
                                            {filter === "all"
                                                ? t("supervisor.urgencyAll")
                                                : filter === "urgent"
                                                  ? t("supervisor.urgencyUrgent")
                                                  : filter === "must-fix"
                                                    ? t("supervisor.urgencyMustFix")
                                                    : t("supervisor.urgencyOptional")}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    </ScrollView>
                </View>
            )}

            {/* Category filter */}
            <View style={styles.filterBar}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterBarContent}
                >
                    <Pressable
                        style={[
                            styles.chip,
                            !categoryFilter && styles.chipActive,
                        ]}
                        onPress={() => setCategoryFilter(null)}
                    >
                        <Text
                            style={[
                                styles.chipText,
                                !categoryFilter && styles.chipTextActive,
                            ]}
                        >
                            {t("supervisor.categoryAll")}
                        </Text>
                    </Pressable>
                    {Object.keys(CATEGORY_KEY_MAP).filter((k) => k !== "ui-ux").map((cat) => {
                        const isActive = categoryFilter === cat;
                        return (
                            <Pressable
                                key={cat}
                                style={[
                                    styles.chip,
                                    isActive && styles.chipActive,
                                ]}
                                onPress={() =>
                                    setCategoryFilter(isActive ? null : cat)
                                }
                            >
                                <Text
                                    style={[
                                        styles.chipText,
                                        isActive && styles.chipTextActive,
                                    ]}
                                >
                                    {CATEGORY_KEY_MAP[cat]
                                        ? t(CATEGORY_KEY_MAP[cat])
                                        : cat}
                                </Text>
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
                    {displayedActions.length === 0 ? (
                        <View style={styles.filteredEmptyContainer}>
                            <Text style={styles.emptyText}>
                                {t("supervisor.noActions")}
                            </Text>
                        </View>
                    ) : (
                        <View style={styles.actionsContainer}>
                            {displayedActions.map((action, index) => (
                                <SupervisorActionCard
                                    key={action.id}
                                    action={action}
                                    projectId={projectId}
                                    onUpdated={handleUpdated}
                                    onDeleted={handleUpdated}
                                    isLast={index === displayedActions.length - 1}
                                />
                            ))}
                        </View>
                    )}

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
        backgroundColor: theme.dark ? theme.colors.accentPurple : theme.colors.header.tint,
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
    filterBar: {
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.divider,
    },
    filterBarContent: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 6,
    },
    filterGroup: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    filterDivider: {
        width: 1,
        height: 16,
        backgroundColor: theme.colors.divider,
        marginHorizontal: 4,
    },
    chip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        backgroundColor: theme.colors.surface,
    },
    chipActive: {
        backgroundColor: theme.dark ? theme.colors.accentPurple : theme.colors.header.tint,
    },
    chipText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    chipTextActive: {
        ...Typography.default("semiBold"),
        color: "#FFFFFF",
    },
    filteredEmptyContainer: {
        paddingVertical: 48,
        alignItems: "center",
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
