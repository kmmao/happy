import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal } from "@/modal";
import { hapticsLight } from "@/components/haptics";
import { kanbanStore } from "@/sync/kanbanStore";
import {
  KANBAN_COLUMNS,
  KANBAN_COLUMN_LABELS,
  type KanbanTask,
  type KanbanColumnId,
} from "@/sync/kanbanTypes";

interface KanbanTaskActionSheetProps {
  task: KanbanTask;
  onClose: () => void;
}

const COLUMN_ICONS: Record<KanbanColumnId, string> = {
  backlog: "file-tray-outline",
  todo: "list-outline",
  in_progress: "play-circle-outline",
  review: "eye-outline",
  done: "checkmark-circle-outline",
};

export const KanbanTaskActionSheet = React.memo(
  ({ task, onClose }: KanbanTaskActionSheetProps) => {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const handleMoveTo = React.useCallback(
      async (columnId: KanbanColumnId) => {
        hapticsLight();
        onClose();
        await kanbanStore.getState().moveTask(task.id, columnId);
      },
      [task.id, onClose],
    );

    const handleStartSession = React.useCallback(() => {
      onClose();
      router.push(`/kanban/task/${task.id}`);
    }, [task.id, onClose, router]);

    const handleDelete = React.useCallback(async () => {
      onClose();
      const confirmed = await Modal.confirm(
        t("kanban.deleteConfirmTitle"),
        t("kanban.deleteConfirmMessage"),
        { destructive: true },
      );
      if (confirmed) {
        await kanbanStore.getState().deleteTask(task.id);
      }
    }, [task.id, onClose]);

    const otherColumns = KANBAN_COLUMNS.filter((col) => col !== task.columnId);

    return (
      <View style={styles.overlay}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          {/* Title */}
          <Text
            style={[styles.sheetTitle, { color: theme.colors.text }]}
            numberOfLines={1}
          >
            {task.title}
          </Text>

          {/* Move To section */}
          <Text
            style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}
          >
            {t("kanban.actions.moveTo")}
          </Text>

          {otherColumns.map((col) => (
            <Pressable
              key={col}
              onPress={() => handleMoveTo(col)}
              accessibilityRole="button"
              accessibilityLabel={t(KANBAN_COLUMN_LABELS[col])}
              style={({ pressed }) => [
                styles.actionItem,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Ionicons
                name={COLUMN_ICONS[col] as keyof typeof Ionicons.glyphMap}
                size={18}
                color={theme.colors.text}
              />
              <Text style={[styles.actionText, { color: theme.colors.text }]}>
                {t(KANBAN_COLUMN_LABELS[col])}
              </Text>
            </Pressable>
          ))}

          {/* Divider */}
          <View
            style={[styles.divider, { backgroundColor: theme.colors.divider }]}
          />

          {/* Start Session */}
          <Pressable
            onPress={handleStartSession}
            accessibilityRole="button"
            accessibilityLabel={t("kanban.startSession")}
            style={({ pressed }) => [
              styles.actionItem,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Ionicons
              name="terminal-outline"
              size={18}
              color={theme.colors.header.tint}
            />
            <Text
              style={[styles.actionText, { color: theme.colors.header.tint }]}
            >
              {t("kanban.startSession")}
            </Text>
          </Pressable>

          {/* Delete */}
          <Pressable
            onPress={handleDelete}
            accessibilityRole="button"
            accessibilityLabel={t("common.delete")}
            style={({ pressed }) => [
              styles.actionItem,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Ionicons
              name="trash-outline"
              size={18}
              color={theme.colors.deleteAction}
            />
            <Text
              style={[styles.actionText, { color: theme.colors.deleteAction }]}
            >
              {t("common.delete")}
            </Text>
          </Pressable>

          {/* Cancel */}
          <View
            style={[styles.divider, { backgroundColor: theme.colors.divider }]}
          />
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
            style={({ pressed }) => [
              styles.cancelItem,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text
              style={[styles.cancelText, { color: theme.colors.header.tint }]}
            >
              {t("common.cancel")}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create(() => ({
  overlay: {
    width: "100%",
    maxWidth: 400,
  },
  sheet: {
    borderRadius: 14,
    overflow: "hidden",
    paddingTop: 16,
  },
  sheetTitle: {
    fontSize: 15,
    textAlign: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    ...Typography.default("semiBold"),
  },
  sectionLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingVertical: 6,
    ...Typography.default("semiBold"),
  },
  actionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  actionText: {
    fontSize: 15,
    ...Typography.default(),
  },
  divider: {
    height: 0.5,
    marginHorizontal: 16,
    marginVertical: 4,
  },
  cancelItem: {
    alignItems: "center",
    paddingVertical: 14,
  },
  cancelText: {
    fontSize: 16,
    ...Typography.default("semiBold"),
  },
}));
