import * as React from "react";
import { View, ScrollView, TextInput, Pressable, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Header } from "@/components/navigation/Header";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { roadmapStore, useRoadmapMilestones } from "@/sync/roadmapStore";
import {
  ROADMAP_MOSCOW,
  ROADMAP_MOSCOW_LABELS,
  ROADMAP_COMPLEXITIES,
  ROADMAP_COMPLEXITY_LABELS,
  type RoadmapMoscow,
  type RoadmapComplexity,
} from "@/sync/roadmapTypes";
import { useHappyAction } from "@/hooks/useHappyAction";

const NewFeature = React.memo(() => {
  const { theme } = useUnistyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { milestoneId: paramMilestoneId } = useLocalSearchParams<{
    milestoneId?: string;
  }>();
  const milestones = useRoadmapMilestones();

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [milestoneId, setMilestoneId] = React.useState(paramMilestoneId ?? "");
  const [moscow, setMoscow] = React.useState<RoadmapMoscow>("should_have");
  const [complexity, setComplexity] =
    React.useState<RoadmapComplexity>("moderate");

  // Default to first milestone if none provided
  React.useEffect(() => {
    if (!milestoneId && milestones.length > 0) {
      setMilestoneId(milestones[0].id);
    }
  }, [milestoneId, milestones]);

  const [saving, performSave] = useHappyAction(async () => {
    if (!title.trim() || !milestoneId) {
      throw { message: t("roadmap.titleRequired") };
    }

    await roadmapStore.getState().createFeature({
      title: title.trim(),
      description: description.trim(),
      milestoneId,
      moscow,
      complexity,
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
        title={t("roadmap.newFeature")}
        headerRight={() => (
          <Pressable
            onPress={performSave}
            disabled={saving || !title.trim() || !milestoneId}
            hitSlop={15}
          >
            <Text
              style={[
                styles.saveButton,
                {
                  color:
                    title.trim() && milestoneId
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

        {/* Milestone selection */}
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

        {/* MoSCoW priority */}
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
      </ScrollView>
    </View>
  );
});

export default NewFeature;

const styles = StyleSheet.create(() => ({
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
}));
