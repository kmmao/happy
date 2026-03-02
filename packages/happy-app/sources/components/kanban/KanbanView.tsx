import * as React from "react";
import { View, Pressable, ActivityIndicator, Platform } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { layout } from "@/components/layout";
import { useRouter } from "expo-router";
import { useShallow } from "zustand/react/shallow";
import { Ionicons } from "@expo/vector-icons";
import ReorderableList, {
  type ReorderableListReorderEvent,
  useReorderableDrag,
} from "react-native-reorderable-list";
import {
  kanbanStore,
  useKanbanTasks,
  useKanbanLoading,
  useKanbanLoaded,
  useKanbanActiveColumn,
} from "@/sync/kanbanStore";
import { storage } from "@/sync/storage";
import {
  type KanbanTask,
  type KanbanColumnId,
  tasksForColumn,
  taskCountByColumn,
} from "@/sync/kanbanTypes";
import { KanbanColumnSelector } from "./KanbanColumnSelector";
import { KanbanTaskCard } from "./KanbanTaskCard";
import { KanbanStatsBar } from "./KanbanStatsBar";
import { KanbanBoardView } from "./KanbanBoardView";
import { KanbanTaskActionSheet } from "./KanbanTaskActionSheet";
import { NewKanbanTaskSheet } from "./NewKanbanTaskSheet";
import { useIsBoardLayout } from "@/hooks/useIsBoardLayout";
import { Modal } from "@/modal";

/**
 * Wrapper that renders KanbanTaskCard with a drag handle.
 * Must be rendered inside ReorderableList for useReorderableDrag to work.
 */
const DraggableTaskCard = React.memo(
  ({
    task,
    onPress,
    onLongPress,
  }: {
    task: KanbanTask;
    onPress: (taskId: string) => void;
    onLongPress: (taskId: string) => void;
  }) => {
    const drag = useReorderableDrag();
    const { theme } = useUnistyles();

    const handle = (
      <Pressable onLongPress={drag} delayLongPress={150} hitSlop={8}>
        <Ionicons
          name="reorder-three"
          size={20}
          color={theme.colors.textSecondary}
        />
      </Pressable>
    );

    return (
      <KanbanTaskCard
        task={task}
        onPress={onPress}
        onLongPress={onLongPress}
        dragHandle={handle}
      />
    );
  },
);

/**
 * Main Kanban board view.
 * Shows stats bar, column selector at top, reorderable task cards list below.
 */
export const KanbanViewWrapper = React.memo(() => {
  const { theme } = useUnistyles();
  const router = useRouter();
  const isBoardLayout = useIsBoardLayout();
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

  const counts = React.useMemo(() => taskCountByColumn(allTasks), [allTasks]);

  const columnTasks = React.useMemo(
    () => tasksForColumn(allTasks, activeColumn),
    [allTasks, activeColumn],
  );

  // Collect all unique session IDs across tasks for stats
  const allSessionIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const task of allTasks) {
      for (const sid of task.sessionIds) {
        ids.add(sid);
      }
    }
    return [...ids];
  }, [allTasks]);

  const activeSessionCount = storage(
    useShallow((state) => {
      let count = 0;
      for (const sid of allSessionIds) {
        if (state.sessions[sid]?.active) count++;
      }
      return count;
    }),
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

  const handleAddTask = React.useCallback(() => {
    if (Platform.OS === "web") {
      Modal.show({ component: NewKanbanTaskSheet });
    } else {
      router.push("/kanban/task/new");
    }
  }, [router]);

  const handleTaskLongPress = React.useCallback((taskId: string) => {
    const task = kanbanStore.getState().tasks[taskId];
    if (!task) return;

    Modal.show({
      component: KanbanTaskActionSheet,
      props: { task },
    });
  }, []);

  const handleReorder = React.useCallback(
    ({ from, to }: ReorderableListReorderEvent) => {
      kanbanStore.getState().reorderTasks(activeColumn, from, to);
    },
    [activeColumn],
  );

  const renderItem = React.useCallback(
    ({ item }: { item: KanbanTask }) => (
      <DraggableTaskCard
        task={item}
        onPress={handleTaskPress}
        onLongPress={handleTaskLongPress}
      />
    ),
    [handleTaskPress, handleTaskLongPress],
  );

  const keyExtractor = React.useCallback((item: KanbanTask) => item.id, []);

  // Loading state
  if (!isLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={theme.colors.textSecondary} />
      </View>
    );
  }

  const totalCount = allTasks.length;

  // Board layout for wide screens (web, tablet, Mac)
  if (isBoardLayout) {
    return (
      <View
        style={[
          styles.outerContainer,
          { backgroundColor: theme.colors.groupped.background },
        ]}
      >
        <KanbanBoardView
          allTasks={allTasks}
          totalCount={totalCount}
          activeSessionCount={activeSessionCount}
          onTaskPress={handleTaskPress}
          onTaskLongPress={handleTaskLongPress}
          onAddTask={handleAddTask}
        />
      </View>
    );
  }

  // Mobile tab layout
  return (
    <View
      style={[
        styles.outerContainer,
        { backgroundColor: theme.colors.groupped.background },
      ]}
    >
      <View style={styles.container}>
        <KanbanStatsBar
          totalTasks={totalCount}
          activeSessionCount={activeSessionCount}
          columnCounts={counts}
          onAddTask={handleAddTask}
        />
        <KanbanColumnSelector
          activeColumn={activeColumn}
          counts={counts}
          onSelect={handleColumnSelect}
        />
        <ReorderableList
          data={columnTasks as KanbanTask[]}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          onReorder={handleReorder}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  outerContainer: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
  },
  container: {
    flex: 1,
    maxWidth: layout.maxWidth,
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
