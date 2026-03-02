import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import {
  type KanbanColumnId,
  KANBAN_COLUMN_ICONS,
  KANBAN_COLUMN_EMPTY_TITLES,
  KANBAN_COLUMN_EMPTY_SUBTITLES,
} from "@/sync/kanbanTypes";

interface KanbanColumnEmptyStateProps {
  readonly columnId: KanbanColumnId;
}

export const KanbanColumnEmptyState = React.memo(
  ({ columnId }: KanbanColumnEmptyStateProps) => {
    const { theme } = useUnistyles();
    const iconName = KANBAN_COLUMN_ICONS[columnId];

    return (
      <View style={styles.container}>
        <Ionicons
          name={iconName as keyof typeof Ionicons.glyphMap}
          size={24}
          color={theme.colors.textSecondary}
          style={styles.icon}
        />
        <Text style={[styles.title, { color: theme.colors.textSecondary }]}>
          {t(KANBAN_COLUMN_EMPTY_TITLES[columnId])}
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
          {t(KANBAN_COLUMN_EMPTY_SUBTITLES[columnId])}
        </Text>
      </View>
    );
  },
);

const styles = StyleSheet.create(() => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  icon: {
    marginBottom: 6,
    opacity: 0.5,
  },
  title: {
    fontSize: 12,
    textAlign: "center",
    ...Typography.default("semiBold"),
  },
  subtitle: {
    fontSize: 11,
    textAlign: "center",
    marginTop: 2,
    opacity: 0.6,
    ...Typography.default(),
  },
}));
