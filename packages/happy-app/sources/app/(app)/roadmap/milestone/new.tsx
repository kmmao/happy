import * as React from "react";
import { View, ScrollView, TextInput, Pressable, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Header } from "@/components/navigation/Header";
import { ItemGroup } from "@/components/ItemGroup";
import { roadmapStore } from "@/sync/roadmapStore";
import { useHappyAction } from "@/hooks/useHappyAction";

const NewMilestone = React.memo(() => {
  const { theme } = useUnistyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");

  const [saving, performSave] = useHappyAction(async () => {
    if (!title.trim()) {
      throw { message: t("roadmap.titleRequired") };
    }

    await roadmapStore.getState().createMilestone({
      title: title.trim(),
      description: description.trim(),
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
        title={t("roadmap.newMilestone")}
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
      </ScrollView>
    </View>
  );
});

export default NewMilestone;

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
