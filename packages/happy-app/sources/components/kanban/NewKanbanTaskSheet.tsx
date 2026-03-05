import * as React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal } from "@/modal";
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
import { useAllMachines, useSetting, useAllSessions } from "@/sync/storage";
import { isMachineOnline } from "@/utils/machineUtils";
import { PromptTemplatePicker } from "@/components/kanban/PromptTemplatePicker";
import type { PromptTemplate } from "@/sync/promptTemplateTypes";
import { expandTemplate } from "@/sync/promptTemplateExpand";

// ---------------------------------------------------------------------------
// Pill selector (inline, compact version for modal)
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
                { color: isActive ? "#FFFFFF" : theme.colors.text },
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
// Main sheet component
// ---------------------------------------------------------------------------

interface NewKanbanTaskSheetProps {
  readonly onClose: () => void;
}

export const NewKanbanTaskSheet = React.memo(
  ({ onClose }: NewKanbanTaskSheetProps) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
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
    const [isSaving, setIsSaving] = React.useState(false);

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
        .slice(0, 3);
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

    const canSave = title.trim().length > 0 && !isSaving;

    const handleSave = React.useCallback(async () => {
      if (!title.trim()) return;

      setIsSaving(true);
      try {
        await kanbanStore.getState().createTask({
          title: title.trim(),
          description: description.trim(),
          columnId,
          priority,
          machineId,
          directory: directory.trim() || null,
          sessionPrompt: sessionPrompt.trim() || null,
        });
        setIsSaving(false);
        onClose();
      } catch (error) {
        setIsSaving(false);
        const message =
          error instanceof Error ? error.message : t("kanban.titleRequired");
        Modal.alert(t("common.error"), message);
      }
    }, [
      title,
      description,
      columnId,
      priority,
      machineId,
      directory,
      sessionPrompt,
      onClose,
    ]);

    const onlineMachines = React.useMemo(
      () => machines.filter(isMachineOnline),
      [machines],
    );

    const maxSheetHeight = windowHeight * 0.8;

    return (
      <View style={styles.overlay}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              paddingBottom: Math.max(insets.bottom, 16),
              maxHeight: maxSheetHeight,
            },
          ]}
        >
          {/* Title */}
          <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>
            {t("kanban.newTask")}
          </Text>

          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator
            keyboardDismissMode="on-drag"
            style={styles.scrollContent}
          >
            {/* Task title */}
            <Text
              style={[
                styles.sectionLabel,
                { color: theme.colors.textSecondary },
              ]}
            >
              {t("kanban.details")}
            </Text>
            <View
              style={[
                styles.inputWrapper,
                { backgroundColor: theme.colors.groupped.background },
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
            </View>

            {/* Description */}
            <View
              style={[
                styles.inputWrapper,
                styles.inputWrapperSpaced,
                { backgroundColor: theme.colors.groupped.background },
              ]}
            >
              <TextInput
                style={[
                  styles.descriptionInput,
                  { color: theme.colors.text, outlineStyle: "none" as any },
                ]}
                placeholder={t("kanban.descriptionPlaceholder")}
                placeholderTextColor={theme.colors.textSecondary}
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {/* Column */}
            <Text
              style={[
                styles.sectionLabel,
                { color: theme.colors.textSecondary },
              ]}
            >
              {t("kanban.column")}
            </Text>
            <View style={styles.pillWrapper}>
              <PillSelector
                options={columnOptions}
                selected={columnId}
                onSelect={setColumnId}
              />
            </View>

            {/* Priority */}
            <Text
              style={[
                styles.sectionLabel,
                { color: theme.colors.textSecondary },
              ]}
            >
              {t("kanban.priorityLabel")}
            </Text>
            <View style={styles.pillWrapper}>
              <PillSelector
                options={priorityOptions}
                selected={priority}
                onSelect={setPriority}
              />
            </View>

            {/* Machine */}
            <Text
              style={[
                styles.sectionLabel,
                { color: theme.colors.textSecondary },
              ]}
            >
              {t("kanban.machine")}
            </Text>
            {onlineMachines.length === 0 ? (
              <Text
                style={[
                  styles.noMachines,
                  { color: theme.colors.textSecondary },
                ]}
              >
                {t("kanban.noMachineSelected")}
              </Text>
            ) : (
              onlineMachines.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setMachineId(m.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: m.id === machineId }}
                  style={({ pressed }) => [
                    styles.machineItem,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Ionicons
                    name={
                      m.id === machineId
                        ? "radio-button-on"
                        : "radio-button-off"
                    }
                    size={18}
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
              ))
            )}

            {/* Directory */}
            <Text
              style={[
                styles.sectionLabel,
                { color: theme.colors.textSecondary },
              ]}
            >
              {t("kanban.directory")}
            </Text>
            <View
              style={[
                styles.inputWrapper,
                { backgroundColor: theme.colors.groupped.background },
              ]}
            >
              <TextInput
                style={[
                  styles.input,
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
                      styles.pathChip,
                      {
                        backgroundColor: theme.colors.groupped.background,
                      },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Ionicons
                      name="folder-outline"
                      size={12}
                      color={theme.colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.pathChipText,
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

            {/* Session Prompt */}
            <Text
              style={[
                styles.sectionLabel,
                { color: theme.colors.textSecondary },
              ]}
            >
              {t("kanban.sessionPromptLabel")}
            </Text>
            <Pressable
              onPress={handlePickTemplate}
              style={({ pressed }) => [
                styles.templateChip,
                { backgroundColor: theme.colors.groupped.background },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons
                name="document-text-outline"
                size={14}
                color={theme.colors.header.tint}
              />
              <Text
                style={[
                  styles.templateChipText,
                  { color: theme.colors.header.tint },
                ]}
              >
                {t("kanban.templates.useTemplate")}
              </Text>
            </Pressable>
            <View
              style={[
                styles.inputWrapper,
                styles.inputWrapperSpaced,
                { backgroundColor: theme.colors.groupped.background },
              ]}
            >
              <TextInput
                style={[
                  styles.descriptionInput,
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
          </ScrollView>

          {/* Save button */}
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel={t("common.save")}
            accessibilityState={{ disabled: !canSave }}
            style={({ pressed }) => [
              styles.saveButton,
              {
                backgroundColor: canSave
                  ? theme.colors.header.tint
                  : theme.colors.divider,
              },
              pressed && canSave && { opacity: 0.8 },
            ]}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color={theme.colors.surface} />
            ) : (
              <Text
                style={[styles.saveButtonText, { color: theme.colors.surface }]}
              >
                {t("common.save")}
              </Text>
            )}
          </Pressable>

          {/* Cancel */}
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

const stylesheet = StyleSheet.create((_theme) => ({
  overlay: {
    width: "100%",
    maxWidth: 480,
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
    paddingBottom: 4,
    ...Typography.default("semiBold"),
  },
  scrollContent: {
    flexShrink: 1,
  },
  sectionLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    ...Typography.default("semiBold"),
  },

  // Inputs
  inputWrapper: {
    marginHorizontal: 16,
    borderRadius: 8,
    overflow: "hidden",
  },
  inputWrapperSpaced: {
    marginTop: 6,
  },
  titleInput: {
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Typography.default(),
  },
  descriptionInput: {
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 56,
    ...Typography.default(),
  },
  input: {
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Typography.default(),
  },

  // Pill selector
  pillWrapper: {
    marginHorizontal: 16,
  },
  pillTrack: {
    flexDirection: "row",
    borderRadius: 8,
    padding: 3,
    gap: 2,
  },
  pill: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
    borderRadius: 6,
  },
  pillText: {
    fontSize: 12,
    ...Typography.default("semiBold"),
  },

  // Machine
  noMachines: {
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 8,
    ...Typography.default(),
  },
  machineItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  machineText: {
    fontSize: 14,
    flex: 1,
    ...Typography.default(),
  },

  // Path suggestions
  pathSuggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: 16,
    marginTop: 6,
    gap: 4,
  },
  pathChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  pathChipText: {
    fontSize: 11,
    maxWidth: 180,
    ...Typography.mono(),
  },

  // Template
  templateChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginHorizontal: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    gap: 4,
  },
  templateChipText: {
    fontSize: 12,
    ...Typography.default("semiBold"),
  },

  // Buttons
  saveButton: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonText: {
    fontSize: 16,
    ...Typography.default("semiBold"),
  },
  cancelItem: {
    alignItems: "center",
    paddingVertical: 12,
  },
  cancelText: {
    fontSize: 16,
    ...Typography.default("semiBold"),
  },
}));
