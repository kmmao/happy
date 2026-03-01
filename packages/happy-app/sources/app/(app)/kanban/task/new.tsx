import * as React from "react";
import { View, ScrollView, TextInput, Pressable, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Header } from "@/components/navigation/Header";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { kanbanStore } from "@/sync/kanbanStore";
import {
  KANBAN_COLUMNS,
  KANBAN_COLUMN_LABELS,
  KANBAN_PRIORITIES,
  KANBAN_PRIORITY_LABELS,
  type KanbanColumnId,
  type KanbanPriority,
} from "@/sync/kanbanTypes";
import { useHappyAction } from "@/hooks/useHappyAction";
import { useAllMachines } from "@/sync/storage";
import { isMachineOnline } from "@/utils/machineUtils";

const NewKanbanTask = React.memo(() => {
  const { theme } = useUnistyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const machines = useAllMachines();

  // Form state
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [columnId, setColumnId] = React.useState<KanbanColumnId>("todo");
  const [priority, setPriority] = React.useState<KanbanPriority>("medium");
  const [machineId, setMachineId] = React.useState<string | null>(null);
  const [directory, setDirectory] = React.useState("");
  const [sessionPrompt, setSessionPrompt] = React.useState("");

  // Pick first online machine by default
  React.useEffect(() => {
    if (!machineId) {
      const online = machines.find((m) => isMachineOnline(m));
      if (online) {
        setMachineId(online.id);
      }
    }
  }, [machines, machineId]);

  const [saving, performSave] = useHappyAction(async () => {
    if (!title.trim()) {
      throw { message: t("kanban.titleRequired") };
    }

    await kanbanStore.getState().createTask({
      title: title.trim(),
      description: description.trim(),
      columnId,
      priority,
      machineId,
      directory: directory.trim() || null,
      sessionPrompt: sessionPrompt.trim() || null,
    });

    router.back();
  });

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.groupped.background },
      ]}
    >
      <Header
        title={t("kanban.newTask")}
        headerRight={() => (
          <Pressable
            onPress={performSave}
            disabled={saving || !title.trim()}
            hitSlop={15}
          >
            <Text
              style={[
                styles.saveButton,
                {
                  color: title.trim()
                    ? theme.colors.header.tint
                    : theme.colors.textSecondary,
                },
              ]}
            >
              {t("common.save")}
            </Text>
          </Pressable>
        )}
      />
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + 24,
        }}
        keyboardDismissMode="on-drag"
      >
        {/* Title & Description */}
        <ItemGroup title={t("kanban.details")}>
          <View
            style={[
              styles.inputWrapper,
              { backgroundColor: theme.colors.surface },
            ]}
          >
            <TextInput
              style={[styles.titleInput, { color: theme.colors.text }]}
              placeholder={t("kanban.titlePlaceholder")}
              placeholderTextColor={theme.colors.textSecondary}
              value={title}
              onChangeText={setTitle}
              autoFocus
            />
            <View
              style={[
                styles.divider,
                {
                  backgroundColor: theme.colors.divider,
                },
              ]}
            />
            <TextInput
              style={[styles.descriptionInput, { color: theme.colors.text }]}
              placeholder={t("kanban.descriptionPlaceholder")}
              placeholderTextColor={theme.colors.textSecondary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>
        </ItemGroup>

        {/* Column selection */}
        <ItemGroup title={t("kanban.column")}>
          {KANBAN_COLUMNS.map((col) => (
            <Item
              key={col}
              title={t(KANBAN_COLUMN_LABELS[col])}
              onPress={() => setColumnId(col)}
              selected={col === columnId}
              showDivider={col !== "done"}
            />
          ))}
        </ItemGroup>

        {/* Priority selection */}
        <ItemGroup title={t("kanban.priorityLabel")}>
          {KANBAN_PRIORITIES.map((p) => (
            <Item
              key={p}
              title={t(KANBAN_PRIORITY_LABELS[p])}
              onPress={() => setPriority(p)}
              selected={p === priority}
              showDivider={p !== "urgent"}
            />
          ))}
        </ItemGroup>

        {/* Machine selection */}
        {machines.length > 0 && (
          <ItemGroup title={t("kanban.machine")}>
            {machines.map((m) => (
              <Item
                key={m.id}
                title={m.metadata?.displayName ?? m.id.substring(0, 8)}
                subtitle={
                  isMachineOnline(m)
                    ? t("kanban.machineOnline")
                    : t("kanban.machineOffline")
                }
                onPress={() => setMachineId(m.id)}
                selected={m.id === machineId}
                showDivider
              />
            ))}
          </ItemGroup>
        )}

        {/* Directory */}
        <ItemGroup
          title={t("kanban.directory")}
          footer={t("kanban.directoryHint")}
        >
          <View
            style={[
              styles.inputWrapper,
              { backgroundColor: theme.colors.surface },
            ]}
          >
            <TextInput
              style={[styles.singleInput, { color: theme.colors.text }]}
              placeholder="/path/to/project"
              placeholderTextColor={theme.colors.textSecondary}
              value={directory}
              onChangeText={setDirectory}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        </ItemGroup>

        {/* Session Prompt */}
        <ItemGroup
          title={t("kanban.sessionPromptLabel")}
          footer={t("kanban.sessionPromptHint")}
        >
          <View
            style={[
              styles.inputWrapper,
              { backgroundColor: theme.colors.surface },
            ]}
          >
            <TextInput
              style={[styles.descriptionInput, { color: theme.colors.text }]}
              placeholder={t("kanban.sessionPromptPlaceholder")}
              placeholderTextColor={theme.colors.textSecondary}
              value={sessionPrompt}
              onChangeText={setSessionPrompt}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>
        </ItemGroup>
      </ScrollView>
    </View>
  );
});

export default NewKanbanTask;

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  saveButton: {
    fontSize: 17,
    ...Typography.default("semiBold"),
  },
  inputWrapper: {
    borderRadius: 10,
    overflow: "hidden",
  },
  titleInput: {
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 12,
    ...Typography.default(),
  },
  divider: {
    height: 1,
    marginLeft: 16,
  },
  descriptionInput: {
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 80,
    ...Typography.default(),
  },
  singleInput: {
    fontSize: 15,
    paddingHorizontal: 16,
    paddingVertical: 12,
    ...Typography.default(),
  },
}));
