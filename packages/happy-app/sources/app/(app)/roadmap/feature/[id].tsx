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
  roadmapStore,
  useRoadmapFeature,
  useRoadmapMilestones,
} from "@/sync/roadmapStore";
import {
  ROADMAP_FEATURE_STATUSES,
  ROADMAP_FEATURE_STATUS_LABELS,
  ROADMAP_MOSCOW,
  ROADMAP_MOSCOW_LABELS,
  ROADMAP_COMPLEXITIES,
  ROADMAP_COMPLEXITY_LABELS,
  type RoadmapFeature,
  type RoadmapFeatureStatus,
  type RoadmapMoscow,
  type RoadmapComplexity,
} from "@/sync/roadmapTypes";
import { useKanbanTask } from "@/sync/kanbanStore";
import { StartSessionSheet } from "@/components/project/StartSessionSheet";
import { useHappyAction } from "@/hooks/useHappyAction";
import { Modal } from "@/modal";
import { Ionicons } from "@expo/vector-icons";

const FeatureDetail = React.memo(() => {
  const { theme } = useUnistyles();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const feature = useRoadmapFeature(id);
  const milestones = useRoadmapMilestones();
  const existingTask = useKanbanTask(feature?.convertedTaskId ?? "");

  // Form state
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [milestoneId, setMilestoneId] = React.useState("");
  const [status, setStatus] = React.useState<RoadmapFeatureStatus>("planned");
  const [moscow, setMoscow] = React.useState<RoadmapMoscow>("should_have");
  const [complexity, setComplexity] =
    React.useState<RoadmapComplexity>("moderate");

  // Hydrate form
  React.useEffect(() => {
    if (feature) {
      setTitle(feature.title);
      setDescription(feature.description);
      setMilestoneId(feature.milestoneId);
      setStatus(feature.status);
      setMoscow(feature.moscow);
      setComplexity(feature.complexity);
    }
  }, [feature?.id]);

  const hasChanges = React.useMemo(() => {
    if (!feature) return false;
    return (
      title !== feature.title ||
      description !== feature.description ||
      milestoneId !== feature.milestoneId ||
      status !== feature.status ||
      moscow !== feature.moscow ||
      complexity !== feature.complexity
    );
  }, [feature, title, description, milestoneId, status, moscow, complexity]);

  const [saving, performSave] = useHappyAction(async () => {
    if (!feature || !title.trim()) return;

    const updated: RoadmapFeature = {
      ...feature,
      title: title.trim(),
      description: description.trim(),
      milestoneId,
      status,
      moscow,
      complexity,
    };

    await roadmapStore.getState().saveFeature(updated);
    router.back();
  });

  const [deleting, performDelete] = useHappyAction(async () => {
    if (!feature) return;

    Modal.alert(
      t("roadmap.deleteFeatureConfirmTitle"),
      t("roadmap.deleteFeatureConfirmMessage"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            await roadmapStore.getState().deleteFeature(feature.id);
            router.back();
          },
        },
      ],
    );
  });

  const [converting, performConvert] = useHappyAction(async () => {
    if (!feature) return;

    const confirmed = await Modal.confirm(
      t("roadmap.convertConfirmTitle"),
      t("roadmap.convertConfirmMessage"),
    );

    if (confirmed) {
      const taskId = await roadmapStore
        .getState()
        .convertFeatureToTask(feature.id);
      router.replace(`/kanban/task/${taskId}`);
    }
  });

  const handleStartSession = React.useCallback(() => {
    if (!feature) return;
    Modal.show({
      component: StartSessionSheet,
      props: {
        title: feature.title,
        defaultPrompt: `[Feature] ${feature.title}\n\n${feature.description}`,
        existingTask,
        onAutoConvert: () =>
          roadmapStore.getState().convertFeatureToTask(feature.id),
      },
    });
  }, [feature, existingTask]);

  if (!feature) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: theme.colors.groupped.background,
          },
        ]}
      >
        <Header title={t("roadmap.featureNotFound")} />
        <View style={styles.centered}>
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        </View>
      </View>
    );
  }

  const hasConvertedTask = !!feature.convertedTaskId;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.colors.groupped.background },
      ]}
    >
      <Header
        title={t("roadmap.featureDetail")}
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
        <ItemGroup title={t("roadmap.details")}>
          <View
            style={[
              styles.inputWrapper,
              { backgroundColor: theme.colors.surface },
            ]}
          >
            <TextInput
              style={[styles.titleInput, { color: theme.colors.text }]}
              placeholder={t("roadmap.titlePlaceholder")}
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
              placeholder={t("roadmap.descriptionPlaceholder")}
              placeholderTextColor={theme.colors.textSecondary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>
        </ItemGroup>

        {/* Milestone */}
        {milestones.length > 1 && (
          <ItemGroup title={t("roadmap.milestoneLabel")}>
            {milestones.map((ms, idx) => (
              <Item
                key={ms.id}
                title={ms.title}
                onPress={() => setMilestoneId(ms.id)}
                selected={ms.id === milestoneId}
                showDivider={idx !== milestones.length - 1}
              />
            ))}
          </ItemGroup>
        )}

        {/* Status */}
        <ItemGroup title={t("roadmap.statusLabel")}>
          {ROADMAP_FEATURE_STATUSES.map((s, idx) => (
            <Item
              key={s}
              title={t(ROADMAP_FEATURE_STATUS_LABELS[s])}
              onPress={() => setStatus(s)}
              selected={s === status}
              showDivider={idx !== ROADMAP_FEATURE_STATUSES.length - 1}
            />
          ))}
        </ItemGroup>

        {/* MoSCoW */}
        <ItemGroup title={t("roadmap.moscowLabel")}>
          {ROADMAP_MOSCOW.map((m, idx) => (
            <Item
              key={m}
              title={t(ROADMAP_MOSCOW_LABELS[m])}
              onPress={() => setMoscow(m)}
              selected={m === moscow}
              showDivider={idx !== ROADMAP_MOSCOW.length - 1}
            />
          ))}
        </ItemGroup>

        {/* Complexity */}
        <ItemGroup title={t("roadmap.complexityLabel")}>
          {ROADMAP_COMPLEXITIES.map((c, idx) => (
            <Item
              key={c}
              title={t(ROADMAP_COMPLEXITY_LABELS[c])}
              onPress={() => setComplexity(c)}
              selected={c === complexity}
              showDivider={idx !== ROADMAP_COMPLEXITIES.length - 1}
            />
          ))}
        </ItemGroup>

        {/* Actions */}
        <ItemGroup title={t("kanban.actionsLabel")}>
          {feature.status !== "cancelled" && (
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
          {!hasConvertedTask && (
            <Item
              title={t("roadmap.convertToTask")}
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
          {hasConvertedTask && (
            <Item
              title={t("roadmap.viewTask")}
              icon={
                <Ionicons
                  name="open-outline"
                  size={22}
                  color={theme.colors.header.tint}
                />
              }
              onPress={() =>
                router.push(`/kanban/task/${feature.convertedTaskId}`)
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

export default FeatureDetail;

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
