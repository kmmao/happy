import * as React from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { layout } from "@/components/layout";
import {
  KANBAN_COLUMNS,
  type KanbanTask,
  tasksForColumn,
} from "@/sync/kanbanTypes";
import { KanbanStatsBar } from "./KanbanStatsBar";
import { KanbanBoardColumn } from "./KanbanBoardColumn";

interface KanbanBoardViewProps {
  readonly allTasks: ReadonlyArray<KanbanTask>;
  readonly totalCount: number;
  readonly activeSessionCount: number;
  readonly onTaskPress: (taskId: string) => void;
  readonly onTaskLongPress: (taskId: string) => void;
}

export const KanbanBoardView = React.memo(
  ({
    allTasks,
    totalCount,
    activeSessionCount,
    onTaskPress,
    onTaskLongPress,
  }: KanbanBoardViewProps) => {
    const { theme } = useUnistyles();

    const columnTasksMap = React.useMemo(() => {
      const map: Record<string, ReadonlyArray<KanbanTask>> = {};
      for (const col of KANBAN_COLUMNS) {
        map[col] = tasksForColumn(allTasks, col);
      }
      return map;
    }, [allTasks]);

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
    flex: 1,
    maxWidth: layout.maxWidth === Infinity ? 1400 : layout.maxWidth,
    width: "100%",
    alignSelf: "center",
  },
  columnsRow: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
}));
