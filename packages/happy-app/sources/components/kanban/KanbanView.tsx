import * as React from "react";
import { View, FlatList, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import {
    kanbanStore,
    useKanbanTasks,
    useKanbanLoading,
    useKanbanLoaded,
    useKanbanActiveColumn,
} from "@/sync/kanbanStore";
import {
    type KanbanTask,
    type KanbanColumnId,
    tasksForColumn,
    taskCountByColumn,
} from "@/sync/kanbanTypes";
import { KanbanColumnSelector } from "./KanbanColumnSelector";
import { KanbanTaskCard } from "./KanbanTaskCard";
import { KanbanEmptyState } from "./KanbanEmptyState";

/**
 * Main Kanban board view.
 * Shows column selector at top, task cards list below.
 */
export const KanbanViewWrapper = React.memo(() => {
    const { theme } = useUnistyles();
    const router = useRouter();
    const allTasks = useKanbanTasks();
    const isLoading = useKanbanLoading();
    const isLoaded = useKanbanLoaded();
    const activeColumn = useKanbanActiveColumn();

    // Load tasks on mount
    React.useEffect(() => {
        if (!isLoaded && !isLoading) {
            kanbanStore.getState().loadTasks();
        }
    }, [isLoaded, isLoading]);

    const counts = React.useMemo(
        () => taskCountByColumn(allTasks),
        [allTasks],
    );

    const columnTasks = React.useMemo(
        () => tasksForColumn(allTasks, activeColumn),
        [allTasks, activeColumn],
    );

    const handleColumnSelect = React.useCallback((col: KanbanColumnId) => {
        kanbanStore.getState().setActiveColumn(col);
    }, []);

    const handleTaskPress = React.useCallback(
        (taskId: string) => {
            router.push(`/kanban/task/${taskId}`);
        },
        [router],
    );

    const renderItem = React.useCallback(
        ({ item }: { item: KanbanTask }) => (
            <KanbanTaskCard
                task={item}
                onPress={handleTaskPress}
            />
        ),
        [handleTaskPress],
    );

    const keyExtractor = React.useCallback(
        (item: KanbanTask) => item.id,
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

    // Empty board (no tasks at all)
    const totalCount = allTasks.length;
    if (totalCount === 0) {
        return <KanbanEmptyState />;
    }

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: theme.colors.groupped.background },
            ]}
        >
            <KanbanColumnSelector
                activeColumn={activeColumn}
                counts={counts}
                onSelect={handleColumnSelect}
            />
            <FlatList
                data={columnTasks as KanbanTask[]}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
            />
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
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
