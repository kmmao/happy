import * as React from "react";
import { View, Text, TextInput, FlatList, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useKnowledgeSearch, type KnowledgeSearchResult } from "@/hooks/useKnowledgeSearch";
import { KnowledgeSearchResultCard } from "@/components/knowledge/KnowledgeSearchResultCard";
import { layout } from "@/components/layout";
import { projectManager } from "@/sync/projectManager";
import { SharedEmptyState } from "@/components/SharedEmptyState";

function KnowledgeSearchScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { results, loading, hasMore, query, search, loadMore } = useKnowledgeSearch();

    const renderItem = React.useCallback(
        ({ item }: { item: KnowledgeSearchResult }) => (
            <KnowledgeSearchResultCard
                result={item}
                onPress={() => {
                    const localProjectId = projectManager.getProjectByServerId(item.projectId)?.id;
                    if (!localProjectId) return;
                    router.push(`/project/${localProjectId}?tab=knowledge` as any);
                }}
            />
        ),
        [router],
    );

    const keyExtractor = React.useCallback(
        (item: KnowledgeSearchResult) => item.id,
        [],
    );

    const ListFooter = React.useMemo(() => {
        if (loading && results.length > 0) {
            return (
                <View style={styles.footerLoader}>
                    <ActivityIndicator size="small" color={theme.colors.header.tint} />
                </View>
            );
        }
        return null;
    }, [loading, results.length, theme]);

    const ListEmpty = React.useMemo(() => {
        if (loading) return null;
        if (!query.trim()) {
            return (
                <SharedEmptyState
                    inline
                    icon={
                        <Ionicons
                            name="search-outline"
                            size={48}
                            color={theme.colors.textSecondary}
                        />
                    }
                    title={t("projects.knowledgeSearchTitle")}
                    description={t("projects.knowledgeSearchHint")}
                />
            );
        }
        return (
            <SharedEmptyState
                inline
                icon={
                    <Ionicons
                        name="document-text-outline"
                        size={48}
                        color={theme.colors.textSecondary}
                    />
                }
                title={t("projects.knowledgeSearchEmpty")}
            />
        );
    }, [loading, query, theme]);

    return (
        <View style={styles.container}>
            {/* Search bar */}
            <View style={[styles.searchBar, { backgroundColor: theme.colors.surface }]}>
                <Ionicons name="search" size={18} color={theme.colors.textSecondary} />
                <TextInput
                    style={[styles.searchInput, { color: theme.colors.text }]}
                    placeholder={t("projects.knowledgeSearchPlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={query}
                    onChangeText={search}
                    autoFocus
                    returnKeyType="search"
                />
                {loading && results.length === 0 && (
                    <ActivityIndicator size="small" color={theme.colors.header.tint} />
                )}
            </View>

            <FlatList
                data={results}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                ListEmptyComponent={ListEmpty}
                ListFooterComponent={ListFooter}
                onEndReached={hasMore ? loadMore : undefined}
                onEndReachedThreshold={0.3}
                contentContainerStyle={styles.listContent}
                keyboardDismissMode="on-drag"
            />
        </View>
    );
}

export default React.memo(KnowledgeSearchScreen);

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    searchBar: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginHorizontal: 16,
        marginVertical: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
    },
    searchInput: {
        ...Typography.default("regular"),
        fontSize: 15,
        flex: 1,
        padding: 0,
    },
    listContent: {
        paddingBottom: 40,
        maxWidth: layout.maxWidth,
        alignSelf: "center",
        width: "100%",
    },
    footerLoader: {
        paddingVertical: 20,
        alignItems: "center",
    },
}));
