import * as React from "react";
import {
  View,
  ScrollView,
  TextInput,
  Pressable,
  Text,
  ActivityIndicator,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Header } from "@/components/navigation/Header";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { kanbanStore, useKanbanTask } from "@/sync/kanbanStore";
import {
  KANBAN_COLUMNS,
  KANBAN_COLUMN_LABELS,
  KANBAN_PRIORITIES,
  KANBAN_PRIORITY_LABELS,
  type KanbanColumnId,
  type KanbanPriority,
  type KanbanTask,
} from "@/sync/kanbanTypes";
import { useHappyAction } from "@/hooks/useHappyAction";
import { useAllMachines, useSession } from "@/sync/storage";
import { isMachineOnline } from "@/utils/machineUtils";
import { machineSpawnNewSession } from "@/sync/ops";
import { sync } from "@/sync/sync";
import { Modal } from "@/modal";
import { Ionicons } from "@expo/vector-icons";

const KanbanTaskDetail = React.memo(() => {
  const { theme } = useUnistyles();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const task = useKanbanTask(id);
  const machines = useAllMachines();

  // Form state — init from task
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [columnId, setColumnId] = React.useState<KanbanColumnId>("todo");
  const [priority, setPriority] = React.useState<KanbanPriority>("medium");
  const [machineId, setMachineId] = React.useState<string | null>(null);
  const [directory, setDirectory] = React.useState("");
  const [sessionPrompt, setSessionPrompt] = React.useState("");

  // Hydrate form from task
  React.useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
      setColumnId(task.columnId);
      setPriority(task.priority);
      setMachineId(task.machineId);
      setDirectory(task.directory ?? "");
      setSessionPrompt(task.sessionPrompt ?? "");
    }
  }, [task?.id]); // Only on initial load or id change

  // Check if form has changes
  const hasChanges = React.useMemo(() => {
    if (!task) return false;
    return (
      title !== task.title ||
      description !== task.description ||
      columnId !== task.columnId ||
      priority !== task.priority ||
      machineId !== task.machineId ||
      (directory || null) !== (task.directory || null) ||
      (sessionPrompt || null) !== (task.sessionPrompt || null)
    );
  }, [
    task,
    title,
    description,
    columnId,
    priority,
    machineId,
    directory,
    sessionPrompt,
  ]);

  const [saving, performSave] = useHappyAction(async () => {
    if (!task || !title.trim()) return;

    const updated: KanbanTask = {
      ...task,
      title: title.trim(),
      description: description.trim(),
      columnId,
      priority,
      machineId,
      directory: directory.trim() || null,
      sessionPrompt: sessionPrompt.trim() || null,
    };

    await kanbanStore.getState().saveTask(updated);
    router.back();
  });

  const [deleting, performDelete] = useHappyAction(async () => {
    if (!task) return;

    Modal.alert(
      t("kanban.deleteConfirmTitle"),
      t("kanban.deleteConfirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            await kanbanStore.getState().deleteTask(task.id);
            router.back();
          },
        },
      ],
    );
  });

  const [spawning, performSpawnSession] = useHappyAction(async () => {
    if (!task) return;

    const targetMachineId = machineId ?? task.machineId;
    if (!targetMachineId) {
      throw { message: t("kanban.noMachineSelected") };
    }

    const machine = machines.find((m) => m.id === targetMachineId);
    if (!machine || !isMachineOnline(machine)) {
      throw { message: t("kanban.machineNotOnline") };
    }

    const targetDir = (directory || task.directory || "").trim();
    if (!targetDir) {
      throw { message: t("kanban.noDirectory") };
    }

    const result = await machineSpawnNewSession({
      machineId: targetMachineId,
      directory: targetDir,
    });

    if (result.type === "error") {
      throw { message: result.errorMessage ?? t("kanban.spawnFailed") };
    }

    // Link session and move to in_progress
    if (result.type === "success" && result.sessionId) {
      await kanbanStore.getState().linkSession(task.id, result.sessionId);
      await kanbanStore.getState().moveTask(task.id, "in_progress");

      // Auto-send session prompt if available
      const prompt = (sessionPrompt || task.sessionPrompt || "").trim();
      if (prompt) {
        await sync.sendMessage(result.sessionId, prompt);
      }

      router.replace(`/session/${result.sessionId}`);
    }
  });

  if (!task) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: theme.colors.groupped.background },
        ]}
      >
        <Header title={t("kanban.taskNotFound")} />
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.groupped.background },
      ]}
    >
      <Header
        title={t("kanban.taskDetail")}
        headerRight={() => (
          <Pressable
            onPress={performSave}
            disabled={saving || !hasChanges || !title.trim()}
            hitSlop={15}
          >
            <Text
              style={[
                styles.saveButton,
                {
                  color:
                    hasChanges && title.trim()
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
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
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

        {/* Column */}
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

        {/* Priority */}
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

        {/* Linked Sessions */}
        {task.sessionIds.length > 0 && (
          <ItemGroup title={t("kanban.linkedSessions")}>
            {task.sessionIds.map((sid) => (
              <LinkedSessionItem
                key={sid}
                sessionId={sid}
                onPress={() => router.push(`/session/${sid}`)}
              />
            ))}
          </ItemGroup>
        )}

        {/* Start Session */}
        <ItemGroup title={t("kanban.actionsLabel")}>
          <Item
            title={t("kanban.startSession")}
            icon={
              <Ionicons
                name="play-circle-outline"
                size={22}
                color={theme.colors.header.tint}
              />
            }
            onPress={performSpawnSession}
            loading={spawning}
            showDivider
          />
          <Item
            title={t("common.delete")}
            onPress={performDelete}
            loading={deleting}
            destructive
          />
        </ItemGroup>

        {/* Machine */}
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
        <ItemGroup title={t("kanban.directory")}>
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
        <ItemGroup title={t("kanban.sessionPromptLabel")}>
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

// Linked session item — shows session name and active status
const LinkedSessionItem = React.memo(
  ({ sessionId, onPress }: { sessionId: string; onPress: () => void }) => {
    const session = useSession(sessionId);
    const { theme } = useUnistyles();

    if (!session) {
      return (
        <Item
          title={sessionId.substring(0, 12)}
          subtitle={t("kanban.sessionNotFound")}
          onPress={onPress}
          showChevron
          showDivider
        />
      );
    }

    const name =
      session.metadata?.name ??
      session.metadata?.path?.split("/").pop() ??
      sessionId.substring(0, 12);

    return (
      <Item
        title={name}
        subtitle={
          session.active
            ? t("kanban.sessionActive")
            : t("kanban.sessionInactive")
        }
        onPress={onPress}
        showChevron
        showDivider
        icon={
          <View
            style={[
              styles.sessionDot,
              {
                backgroundColor: session.active
                  ? theme.colors.status.connected
                  : theme.colors.textSecondary,
              },
            ]}
          />
        }
      />
    );
  },
);

export default KanbanTaskDetail;

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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
  sessionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
}));
