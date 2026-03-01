import * as React from "react";
import { ScrollView, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import {
  KANBAN_COLUMNS,
  KANBAN_COLUMN_LABELS,
  type KanbanColumnId,
} from "@/sync/kanbanTypes";

interface KanbanColumnSelectorProps {
  activeColumn: KanbanColumnId;
  counts: Record<KanbanColumnId, number>;
  onSelect: (column: KanbanColumnId) => void;
}

export const KanbanColumnSelector = React.memo(
  ({ activeColumn, counts, onSelect }: KanbanColumnSelectorProps) => {
    const { theme } = useUnistyles();

    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.container}
      >
        {KANBAN_COLUMNS.map((col) => {
          const isActive = col === activeColumn;
          const count = counts[col];

          return (
            <Pressable
              key={col}
              onPress={() => onSelect(col)}
              style={[
                styles.tab,
                isActive && {
                  backgroundColor: theme.colors.text,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  {
                    color: isActive
                      ? theme.colors.surface
                      : theme.colors.textSecondary,
                  },
                ]}
              >
                {t(KANBAN_COLUMN_LABELS[col])}
              </Text>
              {count > 0 && (
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: isActive
                        ? theme.colors.surface
                        : theme.colors.textSecondary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      {
                        color: isActive
                          ? theme.colors.text
                          : theme.colors.surface,
                      },
                    ]}
                  >
                    {count}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    gap: 6,
  },
  tabText: {
    fontSize: 13,
    ...Typography.default("semiBold"),
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeText: {
    fontSize: 11,
    ...Typography.default("semiBold"),
  },
}));
