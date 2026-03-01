import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import type { KanbanTask } from "@/sync/kanbanTypes";
import { KANBAN_PRIORITY_LABELS } from "@/sync/kanbanTypes";
import { SessionStatusDots } from "./SessionStatusDots";
import { PRIORITY_COLORS } from "@/components/project/designTokens";

interface KanbanTaskCardProps {
  task: KanbanTask;
  onPress: (taskId: string) => void;
  onLongPress?: (taskId: string) => void;
  dragHandle?: React.ReactNode;
}

export const KanbanTaskCard = React.memo(
  ({ task, onPress, onLongPress, dragHandle }: KanbanTaskCardProps) => {
    const { theme } = useUnistyles();
    const priorityColor = PRIORITY_COLORS[task.priority];
    const hasLinkedSessions = task.sessionIds.length > 0;

    return (
      <Pressable
        onPress={() => onPress(task.id)}
        onLongPress={() => onLongPress?.(task.id)}
        accessibilityRole="button"
        accessibilityLabel={task.title}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: theme.colors.surface },
          pressed && { opacity: 0.7 },
        ]}
      >
        <View style={styles.header}>
          <View
            style={[styles.priorityDot, { backgroundColor: priorityColor }]}
          />
          <Text
            style={[styles.title, { color: theme.colors.text }]}
            numberOfLines={2}
          >
            {task.title}
          </Text>
          {dragHandle}
        </View>

        {task.description.length > 0 && (
          <Text
            style={[styles.description, { color: theme.colors.textSecondary }]}
            numberOfLines={2}
          >
            {task.description}
          </Text>
        )}

        <View style={styles.footer}>
          <Text style={[styles.priorityLabel, { color: priorityColor }]}>
            {t(KANBAN_PRIORITY_LABELS[task.priority])}
          </Text>

          {task.tags.length > 0 && (
            <View style={styles.tagsRow}>
              {task.tags.slice(0, 2).map((tag) => (
                <View
                  key={tag}
                  style={[
                    styles.tag,
                    {
                      backgroundColor: theme.colors.groupped.background,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.tagText,
                      {
                        color: theme.colors.textSecondary,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.spacer} />

          {hasLinkedSessions && (
            <View style={styles.sessionIndicator}>
              <Ionicons
                name="terminal-outline"
                size={14}
                color={theme.colors.textSecondary}
              />
              <SessionStatusDots sessionIds={task.sessionIds} />
              <Text
                style={[
                  styles.sessionCount,
                  { color: theme.colors.textSecondary },
                ]}
              >
                {task.sessionIds.length}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  card: {
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
    flexShrink: 0,
  },
  title: {
    fontSize: 15,
    flex: 1,
    ...Typography.default("semiBold"),
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    paddingLeft: 16,
    ...Typography.default(),
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    gap: 8,
  },
  priorityLabel: {
    fontSize: 11,
    ...Typography.default("semiBold"),
  },
  tagsRow: {
    flexDirection: "row",
    gap: 4,
  },
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tagText: {
    fontSize: 11,
    ...Typography.default(),
  },
  spacer: {
    flex: 1,
  },
  sessionIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  sessionCount: {
    fontSize: 12,
    ...Typography.default(),
  },
}));
