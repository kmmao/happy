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
}

const FILTER_KEYS = ["all", "discovery", "decision", "fix", "convention", "warning"] as const;
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
    }
}

export const ProjectKnowledgeTab = React.memo<ProjectKnowledgeTabProps>(
    ({ projectServerId }) => {
        const { theme } = useUnistyles();
        const [activeFilter, setActiveFilter] = React.useState<FilterKey>("all");

        const {
            entries,
            profile,
            loading,
            refresh,
            updateEntry,
            regenerateProfile,
        } = useProjectKnowledge(projectServerId);

        const [refreshing, doRefresh] = useHappyAction(async () => {
            await refresh();
        });

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

        const filteredEntries = React.useMemo(() => {
            if (activeFilter === "all") {
                return entries;
            }
            return entries.filter((e) => e.entryType === activeFilter);
        }, [entries, activeFilter]);

        const renderItem = React.useCallback(
            ({ item }: { item: (typeof entries)[number] }) => (
                <KnowledgeEntryCard
                    entry={item}
                    onUpdate={updateEntry}
                    onViewEvolution={handleViewEvolution}
                />
            ),
            [updateEntry, handleViewEvolution],
        );

        const keyExtractor = React.useCallback(
            (item: (typeof entries)[number]) => item.id,
            [],
        );

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
                            const isActive = activeFilter === key;
                            return (
                                <Pressable
                                    key={key}
                                    style={[
                                        styles.filterChip,
                                        {
                                            backgroundColor: isActive
                                                ? theme.colors.header.tint
                                                : theme.colors.surface,
                                        },
                                    ]}
                                    onPress={() => setActiveFilter(key)}
                                >
                                    <Text
                                        style={[
                                            styles.filterChipText,
                                            {
                                                color: isActive
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
                </View>
            ),
            [profile, activeFilter, theme],
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
