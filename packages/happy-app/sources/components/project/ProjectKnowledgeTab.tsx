import * as React from "react";
import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useRouter } from "expo-router";
import { useProjectKnowledge, type LifecycleStats } from "@/hooks/useProjectKnowledge";
import { useProjectKnowledgeConfig } from "@/hooks/useProjectKnowledgeConfig";
import { useHappyAction } from "@/hooks/useHappyAction";
import { Modal } from "@/modal";
import { KnowledgeEntryCard } from "./KnowledgeEntryCard";
import { ProjectProfileCard } from "./ProjectProfileCard";
import { ProjectKnowledgeConfigCard } from "./ProjectKnowledgeConfigCard";
import { layout } from "@/components/layout";

interface ProjectKnowledgeTabProps {
    projectServerId: string | undefined;
    isActive: boolean;
}

const FILTER_KEYS = ["all", "discovery", "decision", "fix", "convention", "warning", "has-evolution", "superseded", "archived"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const CATEGORY_KEYS = ["all", "user", "feedback", "project", "reference"] as const;
type CategoryKey = (typeof CATEGORY_KEYS)[number];

function filterLabel(key: FilterKey): string {
    switch (key) {
        case "all":
            return t("projects.knowledgeFilterAll");
        case "discovery":
            return t("projects.knowledgeFilterDiscovery");
        case "decision":
            return t("projects.knowledgeFilterDecision");
        case "fix":
            return t("projects.knowledgeFilterFix");
        case "convention":
            return t("projects.knowledgeFilterConvention");
        case "warning":
            return t("projects.knowledgeFilterWarning");
        case "has-evolution":
            return t("projects.knowledgeFilterHasEvolution");
        case "superseded":
            return t("projects.knowledgeFilterSuperseded");
        case "archived":
            return t("projects.knowledgeFilterArchived");
    }
}

function categoryLabel(key: CategoryKey): string {
    switch (key) {
        case "all":
            return t("projects.knowledgeFilterAll");
        case "user":
            return t("projects.knowledgeCategoryUser");
        case "feedback":
            return t("projects.knowledgeCategoryFeedback");
        case "project":
            return t("projects.knowledgeCategoryProject");
        case "reference":
            return t("projects.knowledgeCategoryReference");
    }
}

const STALE_THRESHOLD_MS = 30_000;

export const ProjectKnowledgeTab = React.memo<ProjectKnowledgeTabProps>(
    ({ projectServerId, isActive }) => {
        const { theme } = useUnistyles();
        const [activeFilter, setActiveFilter] = React.useState<FilterKey>("all");
        const [activeCategory, setActiveCategory] = React.useState<CategoryKey>("all");

        const {
            entries,
            archivedEntries,
            supersededEntries,
            profile,
            loading,
            loadingMore,
            hasMore,
            lastRefreshAt,
            refresh,
            refreshIfStale,
            loadMore,
            updateEntry,
            deleteEntry,
            refineEntry,
            regenerateProfile,
            fetchLifecycle,
            runDecay,
            runMerge,
        } = useProjectKnowledge(projectServerId);

        const {
            config: knowledgeConfig,
            isCustomized: configIsCustomized,
            saving: configSaving,
            update: updateConfig,
            resetToDefaults: resetConfig,
        } = useProjectKnowledgeConfig(projectServerId);

        const decayEnabled = knowledgeConfig?.decayEnabled ?? false;
        const mergeEnabled = knowledgeConfig?.mergeEnabled ?? false;
        const showLifecycle = decayEnabled || mergeEnabled;

        const [lifecycleStats, setLifecycleStats] = React.useState<LifecycleStats | null>(null);
        React.useEffect(() => {
            if (showLifecycle && isActive) {
                void fetchLifecycle().then((s) => { if (s) setLifecycleStats(s); });
            }
        }, [showLifecycle, isActive, fetchLifecycle]);

        const [decaying, doDecay] = useHappyAction(async () => {
            const result = await runDecay();
            if (result) {
                const updated = await fetchLifecycle();
                if (updated) setLifecycleStats(updated);
                if (result.archived > 0) {
                    Modal.toast(t("projects.knowledgeDecayResult", { count: result.archived }));
                } else {
                    Modal.toast(t("projects.knowledgeDecayNone"));
                }
            }
        });

        const [merging, doMerge] = useHappyAction(async () => {
            const result = await runMerge();
            if (result) {
                const updated = await fetchLifecycle();
                if (updated) setLifecycleStats(updated);
                if (result.merged > 0) {
                    Modal.toast(t("projects.knowledgeMergeResult", { count: result.merged, clusters: result.clusters }));
                } else {
                    Modal.toast(t("projects.knowledgeMergeNone"));
                }
            }
        });

        const [refreshing, doRefresh] = useHappyAction(async () => {
            await refresh();
        });

        // Auto-refresh when tab becomes active (with staleness threshold)
        const wasActive = React.useRef(isActive);
        React.useEffect(() => {
            if (isActive && !wasActive.current) {
                void refreshIfStale(STALE_THRESHOLD_MS);
            }
            wasActive.current = isActive;
        }, [isActive, refreshIfStale]);

        // Elapsed seconds since last refresh (ticks every second, paused when tab hidden)
        const [elapsedSeconds, setElapsedSeconds] = React.useState<number | null>(null);
        React.useEffect(() => {
            if (!lastRefreshAt) {
                setElapsedSeconds(null);
                return;
            }
            setElapsedSeconds(Math.floor((Date.now() - lastRefreshAt) / 1000));
            if (!isActive) return;
            const timer = setInterval(() => {
                setElapsedSeconds(Math.floor((Date.now() - lastRefreshAt) / 1000));
            }, 1000);
            return () => clearInterval(timer);
        }, [lastRefreshAt, isActive]);

        const [regenerating, doRegenerate] = useHappyAction(async () => {
            await regenerateProfile();
        });

        const router = useRouter();
        const handleViewEvolution = React.useCallback(
            (entryId: string) => {
                if (!projectServerId) return;
                router.push(`/project/${projectServerId}/knowledge/${entryId}/evolution` as any);
            },
            [projectServerId, router],
        );

        const handleExtractSkill = React.useCallback(
            (entry: { id: string; title: string; content: string }) => {
                router.push({
                    pathname: "/skills/new" as any,
                    params: {
                        fromKnowledgeId: entry.id,
                        fromTitle: entry.title,
                        fromContent: entry.content,
                        fromProjectId: projectServerId ?? "",
                    },
                });
            },
            [router, projectServerId],
        );

        const isArchivedFilter = activeFilter === "archived";
        const isSupersededFilter = activeFilter === "superseded";
        const isEvolutionFilter = activeFilter === "has-evolution";

        const filteredEntries = React.useMemo(() => {
            if (isArchivedFilter) {
                return archivedEntries;
            }
            if (isSupersededFilter) {
                return supersededEntries;
            }
            let result = entries;
            if (isEvolutionFilter) {
                result = result.filter((e) => (e.evolutionSize ?? 0) > 1);
            } else if (activeFilter !== "all") {
                result = result.filter((e) => e.entryType === activeFilter);
            }
            if (activeCategory !== "all") {
                result = result.filter((e) => e.category === activeCategory);
            }
            return result;
        }, [entries, archivedEntries, supersededEntries, activeFilter, activeCategory, isArchivedFilter, isSupersededFilter, isEvolutionFilter]);

        const hasCategories = React.useMemo(
            () => entries.some((e) => e.category != null),
            [entries],
        );

        const renderItem = React.useCallback(
            ({ item }: { item: (typeof entries)[number] }) => (
                <KnowledgeEntryCard
                    entry={item}
                    onUpdate={updateEntry}
                    onDelete={isArchivedFilter ? deleteEntry : undefined}
                    onRefine={isArchivedFilter ? undefined : refineEntry}
                    onExtractSkill={isArchivedFilter ? undefined : handleExtractSkill}
                    isArchived={isArchivedFilter}
                    onViewEvolution={handleViewEvolution}
                />
            ),
            [updateEntry, deleteEntry, refineEntry, handleExtractSkill, isArchivedFilter, handleViewEvolution],
        );

        const keyExtractor = React.useCallback(
            (item: (typeof entries)[number]) => item.id,
            [],
        );

        const refreshStatusText = React.useMemo(() => {
            if (loading || refreshing) return t("projects.knowledgeRefreshing");
            if (elapsedSeconds === null) return "";
            if (elapsedSeconds < 5) return t("projects.knowledgeRefreshedJustNow");
            if (elapsedSeconds < 60) return t("projects.knowledgeRefreshedSecondsAgo", { seconds: elapsedSeconds });
            const minutes = Math.floor(elapsedSeconds / 60);
            return t("projects.knowledgeRefreshedMinutesAgo", { minutes });
        }, [loading, refreshing, elapsedSeconds]);

        const ListHeader = React.useMemo(
            () => (
                <View>
                    {/* Project-level knowledge config */}
                    {knowledgeConfig && (
                        <ProjectKnowledgeConfigCard
                            config={knowledgeConfig}
                            isCustomized={configIsCustomized}
                            saving={configSaving}
                            onUpdate={updateConfig}
                            onReset={resetConfig}
                        />
                    )}
                    <ProjectProfileCard
                        profile={profile}
                        onRegenerate={doRegenerate}
                        regenerating={regenerating}
                    />
                    {/* Lifecycle stats + actions */}
                    {showLifecycle && lifecycleStats && (
                        <View style={[styles.lifecycleCard, { backgroundColor: theme.colors.surface }]}>
                            <View style={styles.lifecycleHeader}>
                                <Ionicons name="pulse-outline" size={16} color={theme.colors.header.tint} />
                                <Text style={[styles.lifecycleTitle, { color: theme.colors.text }]}>
                                    {t("projects.knowledgeLifecycle")}
                                </Text>
                            </View>
                            <View style={styles.lifecycleStats}>
                                <Pressable style={styles.lifecycleStat} onPress={() => setActiveFilter("all")}>
                                    <Text style={[styles.lifecycleStatValue, { color: theme.colors.success }]}>
                                        {lifecycleStats.active}
                                    </Text>
                                    <Text style={[styles.lifecycleStatLabel, { color: theme.colors.textSecondary }]}>
                                        {t("projects.knowledgeLifecycleActive")}
                                    </Text>
                                </Pressable>
                                <Pressable style={styles.lifecycleStat} onPress={() => setActiveFilter("superseded")}>
                                    <Text style={[styles.lifecycleStatValue, { color: theme.colors.accentOrange }]}>
                                        {lifecycleStats.superseded}
                                    </Text>
                                    <Text style={[styles.lifecycleStatLabel, { color: theme.colors.textSecondary }]}>
                                        {t("projects.knowledgeLifecycleSuperseded")}
                                    </Text>
                                </Pressable>
                                <Pressable style={styles.lifecycleStat} onPress={() => setActiveFilter("archived")}>
                                    <Text style={[styles.lifecycleStatValue, { color: theme.colors.textSecondary }]}>
                                        {lifecycleStats.archived}
                                    </Text>
                                    <Text style={[styles.lifecycleStatLabel, { color: theme.colors.textSecondary }]}>
                                        {t("projects.knowledgeLifecycleArchived")}
                                    </Text>
                                </Pressable>
                                <Pressable style={styles.lifecycleStat} onPress={() => setActiveFilter("has-evolution")}>
                                    <Text style={[styles.lifecycleStatValue, { color: theme.colors.accentPurple }]}>
                                        {lifecycleStats.totalRelations}
                                    </Text>
                                    <Text style={[styles.lifecycleStatLabel, { color: theme.colors.textSecondary }]}>
                                        {t("projects.knowledgeLifecycleRelations")}
                                    </Text>
                                </Pressable>
                            </View>
                            <View style={styles.lifecycleActions}>
                                {decayEnabled && (
                                    <Pressable
                                        style={[styles.lifecycleButton, { backgroundColor: theme.colors.surfaceHighest }]}
                                        onPress={doDecay}
                                        disabled={decaying}
                                    >
                                        {decaying
                                            ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                            : <Ionicons name="timer-outline" size={14} color={theme.colors.textSecondary} />
                                        }
                                        <Text style={[styles.lifecycleButtonText, { color: theme.colors.textSecondary }]}>
                                            {t("projects.knowledgeRunDecay")}
                                        </Text>
                                    </Pressable>
                                )}
                                {mergeEnabled && (
                                    <Pressable
                                        style={[styles.lifecycleButton, { backgroundColor: theme.colors.surfaceHighest }]}
                                        onPress={doMerge}
                                        disabled={merging}
                                    >
                                        {merging
                                            ? <ActivityIndicator size="small" color={theme.colors.textSecondary} />
                                            : <Ionicons name="git-merge-outline" size={14} color={theme.colors.textSecondary} />
                                        }
                                        <Text style={[styles.lifecycleButtonText, { color: theme.colors.textSecondary }]}>
                                            {t("projects.knowledgeRunMerge")}
                                        </Text>
                                    </Pressable>
                                )}
                            </View>
                        </View>
                    )}
                    {/* Filter bar */}
                    <View style={styles.filterRow}>
                        {FILTER_KEYS.map((key) => {
                            const isFilterActive = activeFilter === key;
                            return (
                                <Pressable
                                    key={key}
                                    style={[
                                        styles.filterChip,
                                        {
                                            backgroundColor: isFilterActive
                                                ? (theme.dark ? theme.colors.accentPurple : theme.colors.header.tint)
                                                : theme.colors.surfaceHighest,
                                        },
                                    ]}
                                    onPress={() => setActiveFilter(key)}
                                >
                                    <Text
                                        style={[
                                            styles.filterChipText,
                                            {
                                                color: isFilterActive
                                                    ? "#FFFFFF"
                                                    : theme.colors.textSecondary,
                                            },
                                        ]}
                                    >
                                        {filterLabel(key)}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                    {/* Category filter bar — hidden when no entries have categories */}
                    {hasCategories && <View style={styles.filterRow}>
                        {CATEGORY_KEYS.map((key) => {
                            const isCatActive = activeCategory === key;
                            return (
                                <Pressable
                                    key={key}
                                    style={[
                                        styles.filterChip,
                                        {
                                            backgroundColor: isCatActive
                                                ? (theme.dark ? theme.colors.accentOrange : theme.colors.accentBlue)
                                                : theme.colors.surfaceHighest,
                                        },
                                    ]}
                                    onPress={() => setActiveCategory(key)}
                                >
                                    <Text
                                        style={[
                                            styles.filterChipText,
                                            {
                                                color: isCatActive
                                                    ? "#FFFFFF"
                                                    : theme.colors.textSecondary,
                                            },
                                        ]}
                                    >
                                        {categoryLabel(key)}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>}
                    {/* Refresh status bar */}
                    <View style={styles.refreshBar}>
                        <Text style={[styles.refreshText, { color: theme.colors.textSecondary }]}>
                            {refreshStatusText}
                        </Text>
                        <Pressable
                            onPress={doRefresh}
                            disabled={refreshing || loading}
                            hitSlop={8}
                            style={{ opacity: refreshing || loading ? 0.4 : 1 }}
                        >
                            <Ionicons
                                name="refresh"
                                size={16}
                                color={theme.colors.textSecondary}
                            />
                        </Pressable>
                    </View>
                </View>
            ),
            [profile, activeFilter, activeCategory, hasCategories, theme, refreshStatusText, refreshing, loading, showLifecycle, lifecycleStats, decayEnabled, mergeEnabled, decaying, merging, doDecay, doMerge, doRefresh, doRegenerate, regenerating, knowledgeConfig, configIsCustomized, configSaving, updateConfig, resetConfig],
        );

        const EmptyComponent = React.useMemo(
            () => (
                <View style={styles.emptyContainer}>
                    <Ionicons
                        name="bulb-outline"
                        size={48}
                        color={theme.colors.textSecondary}
                    />
                    <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
                        {t("projects.knowledgeEmpty")}
                    </Text>
                    <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
                        {t("projects.knowledgeEmptySubtitle")}
                    </Text>
                </View>
            ),
            [theme],
        );

        const isActiveList = activeFilter !== "archived" && activeFilter !== "superseded";

        const handleEndReached = React.useCallback(() => {
            if (isActiveList && hasMore && !loadingMore) {
                void loadMore();
            }
        }, [isActiveList, hasMore, loadingMore, loadMore]);

        const ListFooter = React.useMemo(() => {
            if (!isActiveList || !loadingMore) return null;
            return (
                <View style={styles.footerLoader}>
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                </View>
            );
        }, [isActiveList, loadingMore, theme]);

        return (
            <FlatList
                data={filteredEntries}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                ListHeaderComponent={ListHeader}
                ListEmptyComponent={!loading ? EmptyComponent : null}
                ListFooterComponent={ListFooter}
                contentContainerStyle={styles.listContent}
                style={styles.list}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={doRefresh} />
                }
                onEndReached={handleEndReached}
                onEndReachedThreshold={0.3}
            />
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    list: {
        flex: 1,
    },
    listContent: {
        paddingBottom: 32,
        maxWidth: layout.maxWidth,
        alignSelf: "center",
        width: "100%",
    },
    footerLoader: {
        paddingVertical: 16,
        alignItems: "center",
    },
    filterRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    filterChip: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 14,
    },
    filterChipText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
    },
    refreshBar: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 6,
    },
    refreshText: {
        ...Typography.default("regular"),
        fontSize: 11,
    },
    emptyContainer: {
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 60,
        gap: 8,
    },
    emptyTitle: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        marginTop: 8,
    },
    emptySubtitle: {
        ...Typography.default("regular"),
        fontSize: 13,
        textAlign: "center",
        paddingHorizontal: 40,
    },
    lifecycleCard: {
        marginHorizontal: 16,
        marginTop: 8,
        padding: 14,
        borderRadius: 12,
    },
    lifecycleHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginBottom: 10,
    },
    lifecycleTitle: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
    lifecycleStats: {
        flexDirection: "row",
        justifyContent: "space-around",
        marginBottom: 12,
    },
    lifecycleStat: {
        alignItems: "center",
        gap: 2,
    },
    lifecycleStatValue: {
        ...Typography.default("semiBold"),
        fontSize: 18,
    },
    lifecycleStatLabel: {
        ...Typography.default("regular"),
        fontSize: 10,
    },
    lifecycleActions: {
        flexDirection: "row",
        gap: 8,
    },
    lifecycleButton: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 8,
        borderRadius: 8,
    },
    lifecycleButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
    },
}));
