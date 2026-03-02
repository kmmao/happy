import * as React from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  KANBAN_COLUMNS,
  type KanbanTask,
  tasksForColumn,
  taskCountByColumn,
} from "@/sync/kanbanTypes";
import { KanbanStatsBar } from "./KanbanStatsBar";
import { KanbanBoardColumn } from "./KanbanBoardColumn";

interface KanbanBoardViewProps {
  readonly allTasks: ReadonlyArray<KanbanTask>;
  readonly totalCount: number;
  readonly activeSessionCount: number;
  readonly onTaskPress: (taskId: string) => void;
  readonly onTaskLongPress: (taskId: string) => void;
  readonly onAddTask: () => void;
}

export const KanbanBoardView = React.memo(
  ({
    allTasks,
    totalCount,
    activeSessionCount,
    onTaskPress,
    onTaskLongPress,
    onAddTask,
  }: KanbanBoardViewProps) => {
    const { theme } = useUnistyles();

    const columnTasksMap = React.useMemo(() => {
      const map: Record<string, ReadonlyArray<KanbanTask>> = {};
      for (const col of KANBAN_COLUMNS) {
        map[col] = tasksForColumn(allTasks, col);
      }
      return map;
    }, [allTasks]);

    const columnCounts = React.useMemo(
      () => taskCountByColumn(allTasks),
      [allTasks],
    );

    return (
      <View
        style={[
          styles.container,
          { backgroundColor: theme.colors.groupped.background },
        ]}
      >
        <KanbanStatsBar
          totalTasks={totalCount}
          activeSessionCount={activeSessionCount}
          columnCounts={columnCounts}
          onAddTask={onAddTask}
        />
        <View style={styles.columnsRow}>
          {KANBAN_COLUMNS.map((col) => (
            <KanbanBoardColumn
              key={col}
              columnId={col}
              tasks={columnTasksMap[col]}
              onTaskPress={onTaskPress}
              onTaskLongPress={onTaskLongPress}
            />
          ))}
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create(() => ({
  container: {
    width: "100%",
    alignSelf: "stretch",
  },
  columnsRow: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
  },
}));
