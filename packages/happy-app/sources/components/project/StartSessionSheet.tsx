import * as React from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useAllMachines } from "@/sync/storage";
import { isMachineOnline } from "@/utils/machineUtils";
import { machineSpawnNewSession } from "@/sync/ops";
import { kanbanStore } from "@/sync/kanbanStore";
import { type KanbanTask } from "@/sync/kanbanTypes";
import { sync } from "@/sync/sync";
import { Modal } from "@/modal";

interface StartSessionSheetProps {
  /** Display title for the sheet header */
  title: string;
  /** Auto-generated prompt from idea/feature title+description */
  defaultPrompt: string;
  /** Pre-existing kanban task (if already converted) */
  existingTask: KanbanTask | null;
  /** Auto-convert function; returns taskId */
  onAutoConvert: () => Promise<string>;
  /** Close the modal */
  onClose: () => void;
}

export const StartSessionSheet = React.memo(
  ({
    title,
    defaultPrompt,
    existingTask,
    onAutoConvert,
    onClose,
  }: StartSessionSheetProps) => {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const machines = useAllMachines();

    const onlineMachines = React.useMemo(
      () => machines.filter(isMachineOnline),
      [machines],
    );

    // Form state — pre-fill from existing task or defaults
    const [machineId, setMachineId] = React.useState<string | null>(() => {
      if (existingTask?.machineId) return existingTask.machineId;
      if (onlineMachines.length === 1) return onlineMachines[0].id;
      return null;
    });
    const [directory, setDirectory] = React.useState(
      () => existingTask?.directory ?? "",
    );
    const [prompt, setPrompt] = React.useState(
      () => existingTask?.sessionPrompt ?? defaultPrompt,
    );
    const [isStarting, setIsStarting] = React.useState(false);
    // Persist resolved taskId across directory-approval retries
    const resolvedTaskIdRef = React.useRef<string | null>(null);

    const canStart = !!machineId && directory.trim().length > 0 && !isStarting;

    const performStart = React.useCallback(
      async (approvedDirCreation = false) => {
        if (!machineId || !directory.trim()) return;

        const machine = machines.find((m) => m.id === machineId);
        if (!machine || !isMachineOnline(machine)) {
          Modal.alert(t("kanban.machineNotOnline"));
          return;
        }

        setIsStarting(true);

        try {
          // 1. Ensure we have a task (reuse across retries)
          let taskId = resolvedTaskIdRef.current;
          if (!taskId) {
            taskId = existingTask ? existingTask.id : await onAutoConvert();
            resolvedTaskIdRef.current = taskId;
          }

          // 2. Spawn session
          const result = await machineSpawnNewSession({
            machineId,
            directory: directory.trim(),
            approvedNewDirectoryCreation: approvedDirCreation,
          });

          if (result.type === "requestToApproveDirectoryCreation") {
            setIsStarting(false);
            const confirmed = await Modal.confirm(
              t("kanban.directory"),
              result.directory,
            );
            if (confirmed) {
              await performStart(true);
            }
            return;
          }

          if (result.type === "error") {
            throw new Error(result.errorMessage ?? t("kanban.spawnFailed"));
          }

          if (result.type === "success" && result.sessionId) {
            // 3. Link session + move to in_progress
            await kanbanStore.getState().linkSession(taskId, result.sessionId);
            await kanbanStore.getState().moveTask(taskId, "in_progress");

            // 4. Save machine/directory/prompt to task for next time
            const task = kanbanStore.getState().tasks[taskId];
            if (task) {
              await kanbanStore.getState().saveTask({
                ...task,
                machineId,
                directory: directory.trim(),
                sessionPrompt: prompt.trim() || null,
              });
            }

            // 5. Send prompt
            const trimmedPrompt = prompt.trim();
            if (trimmedPrompt) {
              await sync.sendMessage(result.sessionId, trimmedPrompt);
            }

            // 6. Close and navigate
            setIsStarting(false);
            onClose();
            router.replace(`/session/${result.sessionId}`);
          }
        } catch (error) {
          setIsStarting(false);
          const message =
            error instanceof Error ? error.message : t("kanban.spawnFailed");
          Modal.alert(t("common.error"), message);
        }
      },
      [
        machineId,
        directory,
        prompt,
        existingTask,
        onAutoConvert,
        machines,
        onClose,
        router,
      ],
    );

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
            {title}
          </Text>

          {/* Machine selection */}
          <Text
            style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}
          >
            {t("kanban.machine")}
          </Text>

          {onlineMachines.length === 0 ? (
            <Text
              style={[styles.noMachines, { color: theme.colors.textSecondary }]}
            >
              {t("kanban.noMachineSelected")}
            </Text>
          ) : (
            onlineMachines.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => setMachineId(m.id)}
                style={({ pressed }) => [
                  styles.machineItem,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Ionicons
                  name={
                    m.id === machineId ? "radio-button-on" : "radio-button-off"
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
            style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}
          >
            {t("kanban.directory")}
          </Text>
          <View
            style={[
              styles.inputWrapper,
              {
                backgroundColor: theme.colors.groupped.background,
              },
            ]}
          >
            <TextInput
              style={[styles.input, { color: theme.colors.text }]}
              placeholder="/path/to/project"
              placeholderTextColor={theme.colors.textSecondary}
              value={directory}
              onChangeText={setDirectory}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Prompt */}
          <Text
            style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}
          >
            {t("kanban.sessionPromptLabel")}
          </Text>
          <View
            style={[
              styles.inputWrapper,
              {
                backgroundColor: theme.colors.groupped.background,
              },
            ]}
          >
            <TextInput
              style={[styles.promptInput, { color: theme.colors.text }]}
              placeholder={t("kanban.sessionPromptPlaceholder")}
              placeholderTextColor={theme.colors.textSecondary}
              value={prompt}
              onChangeText={setPrompt}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Start button */}
          <Pressable
            onPress={() => performStart()}
            disabled={!canStart}
            style={({ pressed }) => [
              styles.startButton,
              {
                backgroundColor: canStart
                  ? theme.colors.header.tint
                  : theme.colors.divider,
              },
              pressed && canStart && { opacity: 0.8 },
            ]}
          >
            {isStarting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.startButtonText}>
                {t("kanban.startSession")}
              </Text>
            )}
          </Pressable>

          {/* Cancel */}
          <Pressable
            onPress={onClose}
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
    paddingBottom: 8,
    ...Typography.default("semiBold"),
  },
  sectionLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
    ...Typography.default("semiBold"),
  },
  machineItem: {
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
  noMachines: {
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 8,
    ...Typography.default(),
  },
  inputWrapper: {
    marginHorizontal: 16,
    borderRadius: 8,
    overflow: "hidden",
  },
  input: {
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Typography.default(),
  },
  promptInput: {
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 60,
    ...Typography.default(),
  },
  startButton: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  startButtonText: {
    color: "#fff",
    fontSize: 16,
    ...Typography.default("semiBold"),
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
