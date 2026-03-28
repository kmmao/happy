import * as React from "react";
import { View, Text, FlatList, Pressable, RefreshControl } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useRouter } from "expo-router";
import { useProjectKnowledge } from "@/hooks/useProjectKnowledge";
import { useHappyAction } from "@/hooks/useHappyAction";
import { KnowledgeEntryCard } from "./KnowledgeEntryCard";
import { ProjectProfileCard } from "./ProjectProfileCard";
import { layout } from "@/components/layout";

interface ProjectKnowledgeTabProps {
    projectServerId: string | undefined;
    isActive: boolean;
}

const FILTER_KEYS = ["all", "discovery", "decision", "fix", "convention", "warning", "archived"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

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
        case "archived":
            return t("projects.knowledgeFilterArchived");
    }
}

const STALE_THRESHOLD_MS = 30_000;

export const ProjectKnowledgeTab = React.memo<ProjectKnowledgeTabProps>(
    ({ projectServerId, isActive }) => {
        const { theme } = useUnistyles();
        const [activeFilter, setActiveFilter] = React.useState<FilterKey>("all");

        const {
            entries,
            archivedEntries,
            profile,
            loading,
            lastRefreshAt,
            refresh,
            refreshIfStale,
            updateEntry,
            deleteEntry,
            regenerateProfile,
        } = useProjectKnowledge(projectServerId);

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

        const isArchivedFilter = activeFilter === "archived";

        const filteredEntries = React.useMemo(() => {
            if (isArchivedFilter) {
                return archivedEntries;
            }
            if (activeFilter === "all") {
                return entries;
            }
            return entries.filter((e) => e.entryType === activeFilter);
        }, [entries, archivedEntries, activeFilter, isArchivedFilter]);

        const renderItem = React.useCallback(
            ({ item }: { item: (typeof entries)[number] }) => (
                <KnowledgeEntryCard
                    entry={item}
                    onUpdate={updateEntry}
                    onDelete={isArchivedFilter ? deleteEntry : undefined}
                    isArchived={isArchivedFilter}
                    onViewEvolution={handleViewEvolution}
                />
            ),
            [updateEntry, deleteEntry, isArchivedFilter, handleViewEvolution],
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
                    <ProjectProfileCard
                        profile={profile}
                        onRegenerate={doRegenerate}
                        regenerating={regenerating}
                    />
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
            [profile, activeFilter, theme, refreshStatusText, refreshing, loading],
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

        return (
            <FlatList
                data={filteredEntries}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                ListHeaderComponent={ListHeader}
                ListEmptyComponent={!loading ? EmptyComponent : null}
                contentContainerStyle={styles.listContent}
                style={styles.list}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={doRefresh} />
                }
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
}));
