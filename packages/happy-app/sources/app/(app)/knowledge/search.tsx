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

function KnowledgeSearchScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { results, loading, hasMore, query, search, loadMore } = useKnowledgeSearch();

    const renderItem = React.useCallback(
        ({ item }: { item: KnowledgeSearchResult }) => (
            <KnowledgeSearchResultCard
                result={item}
                onPress={() => {
                    router.push(`/project/${item.projectId}?tab=knowledge` as any);
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
                <View style={styles.emptyContainer}>
                    <Ionicons name="search-outline" size={48} color={theme.colors.textSecondary} />
                    <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
                        {t("projects.knowledgeSearchTitle")}
                    </Text>
                    <Text style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}>
                        {t("projects.knowledgeSearchHint")}
                    </Text>
                </View>
            );
        }
        return (
            <View style={styles.emptyContainer}>
                <Ionicons name="document-text-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>
                    {t("projects.knowledgeSearchEmpty")}
                </Text>
            </View>
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
    emptyContainer: {
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 80,
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
