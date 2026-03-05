import * as React from "react";
import { View, ScrollView, TextInput, Pressable, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Header } from "@/components/navigation/Header";
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
import {
  KANBAN_COLUMN_COLORS,
  PRIORITY_COLORS,
} from "@/components/project/designTokens";
import { useHappyAction } from "@/hooks/useHappyAction";
import { useAllMachines, useSetting, useAllSessions } from "@/sync/storage";
import { isMachineOnline } from "@/utils/machineUtils";
import { Ionicons } from "@expo/vector-icons";
import { Modal } from "@/modal";
import { PromptTemplatePicker } from "@/components/kanban/PromptTemplatePicker";
import type { PromptTemplate } from "@/sync/promptTemplateTypes";
import { expandTemplate } from "@/sync/promptTemplateExpand";

// ---------------------------------------------------------------------------
// Pill selector
// ---------------------------------------------------------------------------

interface PillOption<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly color: string;
}

interface PillSelectorProps<T extends string> {
  readonly options: ReadonlyArray<PillOption<T>>;
  readonly selected: T;
  readonly onSelect: (id: T) => void;
}

const PillSelector = React.memo(function PillSelectorInner({
  options,
  selected,
  onSelect,
}: PillSelectorProps<string>) {
  const { theme } = useUnistyles();
  const styles = stylesheet;

  return (
    <View
      style={[
        styles.pillTrack,
        { backgroundColor: theme.colors.groupped.background },
      ]}
    >
      {options.map((opt) => {
        const isActive = opt.id === selected;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onSelect(opt.id)}
            style={[styles.pill, isActive && { backgroundColor: opt.color }]}
          >
            <Text
              style={[
                styles.pillText,
                {
                  color: isActive ? "#FFFFFF" : theme.colors.text,
                },
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}) as <T extends string>(props: PillSelectorProps<T>) => React.ReactElement;

// ---------------------------------------------------------------------------
// Main page component (used on native mobile / Mac Catalyst)
// ---------------------------------------------------------------------------

const NewKanbanTask = React.memo(() => {
  const { theme } = useUnistyles();
  const styles = stylesheet;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const machines = useAllMachines();
  const recentMachinePaths = useSetting("recentMachinePaths");
  const allSessions = useAllSessions();

  // Form state
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [columnId, setColumnId] = React.useState<KanbanColumnId>("todo");
  const [priority, setPriority] = React.useState<KanbanPriority>("medium");
  const [machineId, setMachineId] = React.useState<string | null>(() => {
    const online = machines.find((m) => isMachineOnline(m));
    return online?.id ?? null;
  });
  const [directory, setDirectory] = React.useState("");
  const [sessionPrompt, setSessionPrompt] = React.useState("");

  // Pill options
  const columnOptions = React.useMemo<
    ReadonlyArray<PillOption<KanbanColumnId>>
  >(
    () =>
      KANBAN_COLUMNS.map((col) => ({
        id: col,
        label: t(KANBAN_COLUMN_LABELS[col]),
        color: KANBAN_COLUMN_COLORS[col],
      })),
    [],
  );

  const priorityOptions = React.useMemo<
    ReadonlyArray<PillOption<KanbanPriority>>
  >(
    () =>
      KANBAN_PRIORITIES.map((p) => ({
        id: p,
        label: t(KANBAN_PRIORITY_LABELS[p]),
        color: PRIORITY_COLORS[p],
      })),
    [],
  );

  const onlineMachines = React.useMemo(
    () => machines.filter(isMachineOnline),
    [machines],
  );

  const pathSuggestions = React.useMemo(() => {
    if (!machineId) return [];

    const paths = new Set<string>();

    for (const entry of recentMachinePaths ?? []) {
      if (entry.machineId === machineId && entry.path) {
        paths.add(entry.path);
      }
    }

    for (const s of allSessions) {
      if (s.metadata?.machineId === machineId && s.metadata?.path) {
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
        tags: [],
      });
      setSessionPrompt(expanded);
    };
    Modal.show({
      component: PromptTemplatePicker,
      props: { onSelect },
    });
  }, [title, description, directory]);

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
        headerLeft={() => (
          <Pressable onPress={() => router.back()} hitSlop={15}>
            <Text
              style={[styles.headerAction, { color: theme.colors.header.tint }]}
            >
              {t("common.cancel")}
            </Text>
          </Pressable>
        )}
        headerRight={() => (
          <Pressable
            onPress={performSave}
            disabled={saving || !title.trim()}
            hitSlop={15}
          >
            <Text
              style={[
                styles.headerActionBold,
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
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardDismissMode="on-drag"
      >
        {/* Title & Description */}
        <ItemGroup title={t("kanban.details")}>
          <View
            style={[
              styles.inputCard,
              { backgroundColor: theme.colors.surface },
            ]}
          >
            <TextInput
              style={[
                styles.titleInput,
                { color: theme.colors.text, outlineStyle: "none" as any },
              ]}
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
              style={[
                styles.descInput,
                { color: theme.colors.text, outlineStyle: "none" as any },
              ]}
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
          <PillSelector
            options={columnOptions}
            selected={columnId}
            onSelect={setColumnId}
          />
        </ItemGroup>

        {/* Priority */}
        <ItemGroup title={t("kanban.priorityLabel")}>
          <PillSelector
            options={priorityOptions}
            selected={priority}
            onSelect={setPriority}
          />
        </ItemGroup>

        {/* Machine */}
        {onlineMachines.length > 0 && (
          <ItemGroup title={t("kanban.machine")}>
            {onlineMachines.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => setMachineId(m.id)}
                style={({ pressed }) => [
                  styles.machineRow,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Ionicons
                  name={
                    m.id === machineId ? "radio-button-on" : "radio-button-off"
                  }
                  size={20}
                  color={
                    m.id === machineId
                      ? theme.colors.header.tint
                      : theme.colors.textSecondary
                  }
                />
                <Text
                  style={[styles.machineText, { color: theme.colors.text }]}
                  numberOfLines={1}
                >
                  {m.metadata?.displayName ?? m.id.substring(0, 8)}
                </Text>
              </Pressable>
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
              styles.inputCard,
              { backgroundColor: theme.colors.surface },
            ]}
          >
            <TextInput
              style={[
                styles.singleInput,
                { color: theme.colors.text, outlineStyle: "none" as any },
              ]}
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
                    styles.pathItem,
                    {
                      backgroundColor: theme.colors.surface,
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Ionicons
                    name="folder-outline"
                    size={16}
                    color={theme.colors.textSecondary}
                  />
                  <Text
                    style={[styles.pathText, { color: theme.colors.text }]}
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
        <ItemGroup
          title={t("kanban.sessionPromptLabel")}
          footer={t("kanban.sessionPromptHint")}
        >
          <Pressable
            onPress={handlePickTemplate}
            style={({ pressed }) => [
              styles.templateBtn,
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
                styles.templateBtnText,
                { color: theme.colors.header.tint },
              ]}
            >
              {t("kanban.templates.useTemplate")}
            </Text>
          </Pressable>
          <View
            style={[
              styles.inputCard,
              { backgroundColor: theme.colors.surface },
            ]}
          >
            <TextInput
              style={[
                styles.descInput,
                { color: theme.colors.text, outlineStyle: "none" as any },
              ]}
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

const stylesheet = StyleSheet.create((_theme) => ({
  container: {
    flex: 1,
  },
  headerAction: {
    fontSize: 17,
    ...Typography.default(),
  },
  headerActionBold: {
    fontSize: 17,
    ...Typography.default("semiBold"),
  },

  // Pill selector
  pillTrack: {
    flexDirection: "row",
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  pill: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 8,
  },
  pillText: {
    fontSize: 13,
    ...Typography.default("semiBold"),
  },

  // Form inputs
  inputCard: {
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
  descInput: {
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

  // Machine
  machineRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  machineText: {
    fontSize: 15,
    flex: 1,
    ...Typography.default(),
  },

  // Path suggestions
  pathSuggestions: {
    marginTop: 4,
    gap: 2,
  },
  pathItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 8,
  },
  pathText: {
    flex: 1,
    fontSize: 13,
    ...Typography.mono(),
  },

  // Template
  templateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 8,
    gap: 6,
  },
  templateBtnText: {
    fontSize: 14,
    ...Typography.default("semiBold"),
  },
}));
