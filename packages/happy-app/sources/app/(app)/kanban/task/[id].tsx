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
import {
  kanbanStore,
  useKanbanTask,
  useKanbanLoaded,
} from "@/sync/kanbanStore";
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
import {
  useAllMachines,
  useSession,
  useSetting,
  useAllSessions,
} from "@/sync/storage";
import { isMachineOnline } from "@/utils/machineUtils";
import { StatusDot } from "@/components/StatusDot";
import { machineSpawnNewSession } from "@/sync/ops";
import { sync } from "@/sync/sync";
import { Modal } from "@/modal";
import { Ionicons } from "@expo/vector-icons";
import { PromptTemplatePicker } from "@/components/kanban/PromptTemplatePicker";
import type { PromptTemplate } from "@/sync/promptTemplateTypes";
import { expandTemplate } from "@/sync/promptTemplateExpand";

const KanbanTaskDetail = React.memo(() => {
  const { theme } = useUnistyles();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const task = useKanbanTask(id);
  const isStoreLoaded = useKanbanLoaded();
  const machines = useAllMachines();
  const recentMachinePaths = useSetting("recentMachinePaths");
  const allSessions = useAllSessions();

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

  const pathSuggestions = React.useMemo(() => {
    if (!machineId) return [];

    // Filter out worktree/branch paths (e.g. .dev/worktree/*, .claude/worktrees/*)
    const isWorktreePath = (p: string) =>
      p.includes("/.dev/worktree/") || p.includes("/.claude/worktrees/");

    const paths = new Set<string>();

    for (const entry of recentMachinePaths ?? []) {
      if (
        entry.machineId === machineId &&
        entry.path &&
        !isWorktreePath(entry.path)
      ) {
        paths.add(entry.path);
      }
    }

    for (const s of allSessions) {
      if (
        s.metadata?.machineId === machineId &&
        s.metadata?.path &&
        !isWorktreePath(s.metadata.path)
      ) {
        paths.add(s.metadata.path);
      }
    }

    const current = directory.trim();
    return Array.from(paths)
      .filter((p) => p !== current)
      .slice(0, 5);
  }, [machineId, recentMachinePaths, allSessions, directory]);

  const handlePickTemplate = React.useCallback(() => {
    const onSelect = (template: PromptTemplate) => {
      const expanded = expandTemplate(template.content, {
        title,
        description,
        directory: directory || null,
        tags: task?.tags ?? [],
      });
      setSessionPrompt(expanded);
    };
    Modal.show({
      component: PromptTemplatePicker,
      props: { onSelect },
    });
  }, [title, description, directory, task?.tags]);

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

  const spawnWithApproval = React.useCallback(
    async (approvedDirCreation = false) => {
      if (!task) return;

      const targetMachineId = machineId ?? task.machineId;
      if (!targetMachineId) {
        throw new Error(t("kanban.noMachineSelected"));
      }

      const machine = machines.find((m) => m.id === targetMachineId);
      if (!machine || !isMachineOnline(machine)) {
        throw new Error(t("kanban.machineNotOnline"));
      }

      const targetDir = (directory || task.directory || "").trim();
      if (!targetDir) {
        throw new Error(t("kanban.noDirectory"));
      }

      const result = await machineSpawnNewSession({
        machineId: targetMachineId,
        directory: targetDir,
        approvedNewDirectoryCreation: approvedDirCreation,
      });

      if (result.type === "requestToApproveDirectoryCreation") {
        const confirmed = await Modal.confirm(
          t("kanban.directory"),
          result.directory,
        );
        if (confirmed) {
          await spawnWithApproval(true);
        }
        return;
      }

      if (result.type === "error") {
        throw new Error(result.errorMessage ?? t("kanban.spawnFailed"));
      }

      if (result.type === "success" && result.sessionId) {
        await kanbanStore.getState().linkSession(task.id, result.sessionId);
        await kanbanStore.getState().moveTask(task.id, "in_progress");

        const prompt = (sessionPrompt || task.sessionPrompt || "").trim();
        if (prompt) {
          await sync.sendMessage(result.sessionId, prompt);
        }

        router.replace(`/session/${result.sessionId}`);
      }
    },
    [task, machineId, directory, sessionPrompt, machines, router],
  );

  const [spawning, performSpawnSession] = useHappyAction(spawnWithApproval);

  if (!task) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: theme.colors.groupped.background },
        ]}
      >
        <Header
          title={isStoreLoaded ? t("kanban.taskNotFound") : t("common.loading")}
        />
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
            {machines.map((m) => {
              const online = isMachineOnline(m);
              return (
                <Item
                  key={m.id}
                  title={m.metadata?.displayName ?? m.id.substring(0, 8)}
                  subtitle={
                    online
                      ? t("kanban.machineOnline")
                      : t("kanban.machineOffline")
                  }
                  leftElement={
                    <View style={styles.machineIcon}>
                      <Ionicons
                        name="desktop-outline"
                        size={20}
                        color={theme.colors.textSecondary}
                      />
                      <StatusDot
                        color={
                          online
                            ? theme.colors.status.connected
                            : theme.colors.textSecondary
                        }
                        isPulsing={online}
                        size={8}
                        style={styles.machineStatusDot}
                      />
                    </View>
                  }
                  onPress={() => setMachineId(m.id)}
                  selected={m.id === machineId}
                  showDivider
                />
              );
            })}
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
          {pathSuggestions.length > 0 && (
            <View style={styles.pathSuggestions}>
              {pathSuggestions.map((path) => (
                <Pressable
                  key={path}
                  onPress={() => setDirectory(path)}
                  style={({ pressed }) => [
                    styles.pathSuggestionItem,
                    { backgroundColor: theme.colors.surface },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Ionicons
                    name="folder-outline"
                    size={16}
                    color={theme.colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.pathSuggestionText,
                      { color: theme.colors.text },
                    ]}
                    numberOfLines={1}
                  >
                    {path}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </ItemGroup>

        {/* Session Prompt */}
        <ItemGroup title={t("kanban.sessionPromptLabel")}>
          <Pressable
            onPress={handlePickTemplate}
            style={({ pressed }) => [
              styles.templateButton,
              { backgroundColor: theme.colors.surface },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons
              name="document-text-outline"
              size={18}
              color={theme.colors.header.tint}
            />
            <Text
              style={[
                styles.templateButtonText,
                { color: theme.colors.header.tint },
              ]}
            >
              {t("kanban.templates.useTemplate")}
            </Text>
          </Pressable>
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
  machineIcon: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  machineStatusDot: {
    position: "absolute",
    bottom: -1,
    right: -1,
  },
  pathSuggestions: {
    marginTop: 4,
    gap: 2,
  },
  pathSuggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 8,
  },
  pathSuggestionText: {
    flex: 1,
    fontSize: 13,
    ...Typography.mono(),
  },
  templateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 8,
    gap: 6,
  },
  templateButtonText: {
    fontSize: 14,
    ...Typography.default("semiBold"),
  },
}));
