import * as React from "react";
import { View, FlatList, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
    ideationStore,
    useIdeationIdeas,
    useIdeationLoading,
    useIdeationLoaded,
    useIdeationActiveFilter,
} from "@/sync/ideationStore";
import {
    type IdeationIdea,
    type IdeationStatus,
    ideaCountByStatus,
} from "@/sync/ideationTypes";
import { IdeationFilterBar } from "./IdeationFilterBar";
import { IdeationIdeaCard } from "./IdeationIdeaCard";
import { IdeationEmptyState } from "./IdeationEmptyState";
import { IdeationActionSheet } from "./IdeationActionSheet";
import { Modal } from "@/modal";
import { useRouter } from "expo-router";

/**
 * Main Ideation list view.
 * Shows filter bar at top, idea cards list below.
 */
export const IdeationView = React.memo(() => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const allIdeas = useIdeationIdeas();
    const isLoading = useIdeationLoading();
    const isLoaded = useIdeationLoaded();
    const activeFilter = useIdeationActiveFilter();

    // Load ideas on mount
    React.useEffect(() => {
        if (!isLoaded && !isLoading) {
            ideationStore.getState().loadIdeas();
        }
    }, [isLoaded, isLoading]);

    const counts = React.useMemo(
        () => ideaCountByStatus(allIdeas),
        [allIdeas],
    );

    const filteredIdeas = React.useMemo(() => {
        const ideas =
            activeFilter === "all"
                ? [...allIdeas]
                : allIdeas.filter((i) => i.status === activeFilter);
        return ideas.sort((a, b) => b.updatedAt - a.updatedAt);
    }, [allIdeas, activeFilter]);

    const handleFilterSelect = React.useCallback(
        (filter: IdeationStatus | "all") => {
            ideationStore.getState().setActiveFilter(filter);
        },
        [],
    );

    const handleIdeaPress = React.useCallback(
        (ideaId: string) => {
            router.push(`/ideation/idea/${ideaId}`);
        },
        [router],
    );

    const handleIdeaLongPress = React.useCallback((ideaId: string) => {
        const idea = ideationStore.getState().ideas[ideaId];
        if (!idea) return;

        Modal.show({
            component: IdeationActionSheet,
            props: { idea },
        });
    }, []);

    const renderItem = React.useCallback(
        ({ item }: { item: IdeationIdea }) => (
            <IdeationIdeaCard
                idea={item}
                onPress={handleIdeaPress}
                onLongPress={handleIdeaLongPress}
            />
        ),
        [handleIdeaPress, handleIdeaLongPress],
    );

    const keyExtractor = React.useCallback(
        (item: IdeationIdea) => item.id,
        [],
    );

    // Loading state
    if (!isLoaded) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator
                    size="small"
                    color={theme.colors.textSecondary}
                />
            </View>
        );
    }

    // Empty state (no ideas at all)
    if (allIdeas.length === 0) {
        return <IdeationEmptyState />;
    }

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: theme.colors.groupped.background },
            ]}
        >
            <IdeationFilterBar
                activeFilter={activeFilter}
                counts={counts}
                totalCount={allIdeas.length}
                onSelect={handleFilterSelect}
            />
            <FlatList
                data={filteredIdeas}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
            />
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    container: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
    },
    listContent: {
        paddingVertical: 4,
        paddingBottom: 24,
    },
}));
