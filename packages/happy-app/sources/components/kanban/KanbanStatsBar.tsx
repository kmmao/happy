import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import { StatusDot } from "@/components/StatusDot";
import {
  ACTIVE_SESSION_COLOR,
  KANBAN_COLUMN_COLORS,
} from "@/components/project/designTokens";
import {
  KANBAN_COLUMNS,
  KANBAN_COLUMN_LABELS,
  type KanbanColumnId,
} from "@/sync/kanbanTypes";

interface KanbanStatsBarProps {
  readonly totalTasks: number;
  readonly activeSessionCount: number;
  readonly columnCounts: Readonly<Record<KanbanColumnId, number>>;
  readonly onAddTask?: () => void;
}

export const KanbanStatsBar = React.memo(
  ({
    totalTasks,
    activeSessionCount,
    columnCounts,
    onAddTask,
  }: KanbanStatsBarProps) => {
    const { theme } = useUnistyles();

    return (
      <View style={styles.container}>
        <Text style={[styles.stat, { color: theme.colors.textSecondary }]}>
          {t("kanban.stats.totalTasks", { count: totalTasks })}
        </Text>

        {totalTasks > 0 && (
          <View style={styles.distribution}>
            {KANBAN_COLUMNS.map((col) => {
              const count = columnCounts[col];
              if (count === 0) return null;
              return (
                <View key={col} style={styles.distributionItem}>
                  <View
                    style={[
                      styles.distributionDot,
                      { backgroundColor: KANBAN_COLUMN_COLORS[col] },
                    ]}
                  />
                  <Text
                    style={[
                      styles.distributionText,
                      { color: theme.colors.textSecondary },
                    ]}
                  >
                    {t(KANBAN_COLUMN_LABELS[col])} {count}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.spacer} />

        {activeSessionCount > 0 && (
          <View style={styles.activeContainer}>
            <StatusDot color={ACTIVE_SESSION_COLOR} isPulsing size={6} />
            <Text style={[styles.stat, { color: theme.colors.textSecondary }]}>
              {t("kanban.stats.activeSessions", {
                count: activeSessionCount,
              })}
            </Text>
          </View>
        )}

        {onAddTask != null && (
          <Pressable
            onPress={onAddTask}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("kanban.newTask")}
            style={({ pressed }) => [
              styles.addButton,
              {
                backgroundColor: theme.colors.button.primary.background,
              },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons
              name="add"
              size={18}
              color={theme.colors.button.primary.tint}
            />
          </Pressable>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create(() => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 12,
  },
  stat: {
    fontSize: 12,
    ...Typography.default(),
  },
  distribution: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  distributionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  distributionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  distributionText: {
    fontSize: 11,
    ...Typography.default(),
  },
  spacer: {
    flex: 1,
  },
  activeContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  addButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
}));
