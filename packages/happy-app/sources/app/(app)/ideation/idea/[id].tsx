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
import { ideationStore, useIdeationIdea } from "@/sync/ideationStore";
import { useKanbanTask } from "@/sync/kanbanStore";
import { StartSessionSheet } from "@/components/project/StartSessionSheet";
import {
  IDEATION_CATEGORIES,
  IDEATION_CATEGORY_LABELS,
  IDEATION_STATUSES,
  IDEATION_STATUS_LABELS,
  IDEATION_PRIORITIES,
  IDEATION_PRIORITY_LABELS,
  type IdeationCategory,
  type IdeationStatus,
  type IdeationPriority,
  type IdeationIdea,
} from "@/sync/ideationTypes";
import { useHappyAction } from "@/hooks/useHappyAction";
import { Modal } from "@/modal";
import { Ionicons } from "@expo/vector-icons";

const IdeaDetail = React.memo(() => {
  const { theme } = useUnistyles();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const idea = useIdeationIdea(id);
  const existingTask = useKanbanTask(idea?.convertedTaskId ?? "");

  // Form state
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [category, setCategory] = React.useState<IdeationCategory>("feature");
  const [status, setStatus] = React.useState<IdeationStatus>("draft");
  const [priority, setPriority] = React.useState<IdeationPriority>("medium");

  // Hydrate form from idea
  React.useEffect(() => {
    if (idea) {
      setTitle(idea.title);
      setDescription(idea.description);
      setCategory(idea.category);
      setStatus(idea.status);
      setPriority(idea.priority);
    }
  }, [idea?.id]);

  // Check if form has changes
  const hasChanges = React.useMemo(() => {
    if (!idea) return false;
    return (
      title !== idea.title ||
      description !== idea.description ||
      category !== idea.category ||
      status !== idea.status ||
      priority !== idea.priority
    );
  }, [idea, title, description, category, status, priority]);

  const [saving, performSave] = useHappyAction(async () => {
    if (!idea || !title.trim()) return;

    const updated: IdeationIdea = {
      ...idea,
      title: title.trim(),
      description: description.trim(),
      category,
      status,
      priority,
    };

    await ideationStore.getState().saveIdea(updated);
    router.back();
  });

  const [deleting, performDelete] = useHappyAction(async () => {
    if (!idea) return;

    Modal.alert(
      t("ideation.deleteConfirmTitle"),
      t("ideation.deleteConfirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            await ideationStore.getState().deleteIdea(idea.id);
            router.back();
          },
        },
      ],
    );
  });

  const [converting, performConvert] = useHappyAction(async () => {
    if (!idea) return;

    const confirmed = await Modal.confirm(
      t("ideation.convertConfirmTitle"),
      t("ideation.convertConfirmMessage"),
    );

    if (confirmed) {
      const taskId = await ideationStore.getState().convertToTask(idea.id);
      router.replace(`/kanban/task/${taskId}`);
    }
  });

  const handleStartSession = React.useCallback(() => {
    if (!idea) return;
    Modal.show({
      component: StartSessionSheet,
      props: {
        title: idea.title,
        defaultPrompt: `[Idea] ${idea.title}\n\n${idea.description}`,
        existingTask,
        onAutoConvert: () => ideationStore.getState().convertToTask(idea.id),
      },
    });
  }, [idea, existingTask]);

  if (!idea) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: theme.colors.groupped.background },
        ]}
      >
        <Header title={t("ideation.ideaNotFound")} />
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        </View>
      </View>
    );
  }

  const isConverted = idea.status === "converted";

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.groupped.background },
      ]}
    >
      <Header
        title={t("ideation.ideaDetail")}
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
        contentContainerStyle={{
          paddingBottom: insets.bottom + 24,
        }}
        keyboardDismissMode="on-drag"
      >
        {/* Title & Description */}
        <ItemGroup title={t("ideation.details")}>
          <View
            style={[
              styles.inputWrapper,
              { backgroundColor: theme.colors.surface },
            ]}
          >
            <TextInput
              style={[styles.titleInput, { color: theme.colors.text }]}
              placeholder={t("ideation.titlePlaceholder")}
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
              placeholder={t("ideation.descriptionPlaceholder")}
              placeholderTextColor={theme.colors.textSecondary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>
        </ItemGroup>

        {/* Category */}
        <ItemGroup title={t("ideation.categoryLabel")}>
          {IDEATION_CATEGORIES.map((cat, idx) => (
            <Item
              key={cat}
              title={t(IDEATION_CATEGORY_LABELS[cat])}
              onPress={() => setCategory(cat)}
              selected={cat === category}
              showDivider={idx !== IDEATION_CATEGORIES.length - 1}
            />
          ))}
        </ItemGroup>

        {/* Status */}
        <ItemGroup title={t("ideation.statusLabel")}>
          {IDEATION_STATUSES.filter((s) => s !== "converted").map(
            (s, idx, arr) => (
              <Item
                key={s}
                title={t(IDEATION_STATUS_LABELS[s])}
                onPress={() => setStatus(s)}
                selected={s === status}
                showDivider={idx !== arr.length - 1}
              />
            ),
          )}
        </ItemGroup>

        {/* Priority */}
        <ItemGroup title={t("ideation.priorityLabel")}>
          {IDEATION_PRIORITIES.map((p, idx) => (
            <Item
              key={p}
              title={t(IDEATION_PRIORITY_LABELS[p])}
              onPress={() => setPriority(p)}
              selected={p === priority}
              showDivider={idx !== IDEATION_PRIORITIES.length - 1}
            />
          ))}
        </ItemGroup>

        {/* Actions */}
        <ItemGroup title={t("kanban.actionsLabel")}>
          {idea.status !== "dismissed" && (
            <Item
              title={t("kanban.startSession")}
              icon={
                <Ionicons
                  name="play-circle-outline"
                  size={22}
                  color={theme.colors.header.tint}
                />
              }
              onPress={handleStartSession}
              showDivider
            />
          )}
          {!isConverted && (
            <Item
              title={t("ideation.convertToTask")}
              icon={
                <Ionicons
                  name="arrow-forward-circle-outline"
                  size={22}
                  color={theme.colors.header.tint}
                />
              }
              onPress={performConvert}
              loading={converting}
              showDivider
            />
          )}
          {isConverted && idea.convertedTaskId && (
            <Item
              title={t("ideation.viewTask")}
              icon={
                <Ionicons
                  name="open-outline"
                  size={22}
                  color={theme.colors.header.tint}
                />
              }
              onPress={() =>
                router.push(`/kanban/task/${idea.convertedTaskId}`)
              }
              showDivider
            />
          )}
          <Item
            title={t("common.delete")}
            onPress={performDelete}
            loading={deleting}
            destructive
          />
        </ItemGroup>
      </ScrollView>
    </View>
  );
});

export default IdeaDetail;

const styles = StyleSheet.create(() => ({
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
}));
