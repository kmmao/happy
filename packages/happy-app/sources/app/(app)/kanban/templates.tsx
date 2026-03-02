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
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Header } from "@/components/navigation/Header";
import { ItemGroup } from "@/components/ItemGroup";
import { Modal } from "@/modal";
import { useHappyAction } from "@/hooks/useHappyAction";
import {
  promptTemplateStore,
  usePromptTemplates,
  usePromptTemplateLoaded,
} from "@/sync/promptTemplateStore";
import type { PromptTemplate } from "@/sync/promptTemplateTypes";

const PromptTemplatesPage = React.memo(() => {
  const { theme } = useUnistyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const templates = usePromptTemplates();
  const isLoaded = usePromptTemplateLoaded();

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editContent, setEditContent] = React.useState("");

  React.useEffect(() => {
    if (!isLoaded) {
      promptTemplateStore.getState().loadTemplates();
    }
  }, [isLoaded]);

  const handleEdit = React.useCallback((template: PromptTemplate) => {
    if (template.isBuiltIn) {
      return;
    }
    setEditingId(template.id);
    setEditName(template.name);
    setEditContent(template.content);
  }, []);

  const handleCancelEdit = React.useCallback(() => {
    setEditingId(null);
    setEditName("");
    setEditContent("");
  }, []);

  const [saving, performSave] = useHappyAction(async () => {
    if (!editingId || !editName.trim()) return;

    const template = promptTemplateStore.getState().templates[editingId];
    if (!template) return;

    await promptTemplateStore.getState().saveTemplate({
      ...template,
      name: editName.trim(),
      content: editContent.trim(),
    });

    handleCancelEdit();
  });

  const [creating, performCreate] = useHappyAction(async () => {
    await promptTemplateStore.getState().createTemplate({
      name: t("kanban.templates.newTemplate"),
      content: "",
    });
  });

  const deleteTargetRef = React.useRef<PromptTemplate | null>(null);

  const [_deleting, performDelete] = useHappyAction(async () => {
    const template = deleteTargetRef.current;
    if (!template) return;

    const confirmed = await Modal.confirm(
      t("kanban.templates.deleteTitle"),
      t("kanban.templates.deleteMessage"),
      { destructive: true },
    );

    if (confirmed) {
      await promptTemplateStore.getState().deleteTemplate(template.id);
      if (editingId === template.id) {
        handleCancelEdit();
      }
    }
    deleteTargetRef.current = null;
  });

  const handleDelete = React.useCallback(
    (template: PromptTemplate) => {
      if (template.isBuiltIn) return;
      deleteTargetRef.current = template;
      performDelete();
    },
    [performDelete],
  );

  if (!isLoaded) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: theme.colors.groupped.background },
        ]}
      >
        <Header title={t("kanban.templates.title")} />
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
        title={t("kanban.templates.title")}
        headerRight={() => (
          <Pressable onPress={performCreate} disabled={creating} hitSlop={15}>
            <Ionicons
              name="add-outline"
              size={28}
              color={theme.colors.header.tint}
            />
          </Pressable>
        )}
      />
      <ScrollView
        contentContainerStyle={{
          paddingBottom: insets.bottom + 24,
        }}
        keyboardDismissMode="on-drag"
      >
        {templates.map((tmpl) => {
          const isEditing = editingId === tmpl.id;
          const displayName = tmpl.isBuiltIn
            ? t(tmpl.name as Parameters<typeof t>[0])
            : tmpl.name;

          if (isEditing) {
            return (
              <ItemGroup key={tmpl.id} title={t("kanban.templates.editing")}>
                <View
                  style={[
                    styles.inputWrapper,
                    {
                      backgroundColor: theme.colors.surface,
                    },
                  ]}
                >
                  <TextInput
                    style={[styles.nameInput, { color: theme.colors.text }]}
                    placeholder={t("kanban.templates.namePlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={editName}
                    onChangeText={setEditName}
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
                    style={[styles.contentInput, { color: theme.colors.text }]}
                    placeholder={t("kanban.templates.contentPlaceholder")}
                    placeholderTextColor={theme.colors.textSecondary}
                    value={editContent}
                    onChangeText={setEditContent}
                    multiline
                    numberOfLines={8}
                    textAlignVertical="top"
                  />
                </View>
                <View style={styles.editActions}>
                  <Pressable
                    onPress={handleCancelEdit}
                    style={({ pressed }) => [
                      styles.editButton,
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.editButtonText,
                        {
                          color: theme.colors.textSecondary,
                        },
                      ]}
                    >
                      {t("common.cancel")}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={performSave}
                    disabled={saving || !editName.trim()}
                    style={({ pressed }) => [
                      styles.editButton,
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.editButtonText,
                        {
                          color: editName.trim()
                            ? theme.colors.header.tint
                            : theme.colors.textSecondary,
                        },
                      ]}
                    >
                      {t("common.save")}
                    </Text>
                  </Pressable>
                </View>
              </ItemGroup>
            );
          }

          return (
            <ItemGroup key={tmpl.id}>
              <Pressable
                onPress={() => handleEdit(tmpl)}
                disabled={tmpl.isBuiltIn}
                style={({ pressed }) => [
                  styles.templateRow,
                  {
                    backgroundColor: theme.colors.surface,
                  },
                  pressed && !tmpl.isBuiltIn && { opacity: 0.7 },
                ]}
              >
                <View style={styles.templateInfo}>
                  <View style={styles.templateHeader}>
                    <Text
                      style={[
                        styles.templateName,
                        {
                          color: theme.colors.text,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {displayName}
                    </Text>
                    {tmpl.isBuiltIn && (
                      <View
                        style={[
                          styles.badge,
                          {
                            backgroundColor: theme.colors.header.tint + "20",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            {
                              color: theme.colors.header.tint,
                            },
                          ]}
                        >
                          {t("kanban.templates.builtInBadge")}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.templatePreview,
                      {
                        color: theme.colors.textSecondary,
                      },
                    ]}
                    numberOfLines={2}
                  >
                    {tmpl.content.slice(0, 120)}
                  </Text>
                </View>
                {!tmpl.isBuiltIn && (
                  <View style={styles.templateActions}>
                    <Pressable onPress={() => handleEdit(tmpl)} hitSlop={10}>
                      <Ionicons
                        name="create-outline"
                        size={20}
                        color={theme.colors.header.tint}
                      />
                    </Pressable>
                    <Pressable onPress={() => handleDelete(tmpl)} hitSlop={10}>
                      <Ionicons
                        name="trash-outline"
                        size={20}
                        color={theme.colors.deleteAction}
                      />
                    </Pressable>
                  </View>
                )}
              </Pressable>
            </ItemGroup>
          );
        })}

        {templates.length === 0 && (
          <View style={styles.emptyState}>
            <Text
              style={[styles.emptyText, { color: theme.colors.textSecondary }]}
            >
              {t("kanban.templates.empty")}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
});

export default PromptTemplatesPage;

const styles = StyleSheet.create(() => ({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  inputWrapper: {
    borderRadius: 10,
    overflow: "hidden",
  },
  nameInput: {
    fontSize: 17,
    paddingHorizontal: 16,
    paddingVertical: 12,
    ...Typography.default("semiBold"),
  },
  divider: {
    height: 1,
    marginLeft: 16,
  },
  contentInput: {
    fontSize: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 160,
    ...Typography.mono(),
  },
  editActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 16,
    paddingTop: 8,
    paddingHorizontal: 4,
  },
  editButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  editButtonText: {
    fontSize: 15,
    ...Typography.default("semiBold"),
  },
  templateRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 12,
  },
  templateInfo: {
    flex: 1,
    gap: 4,
  },
  templateHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  templateName: {
    fontSize: 15,
    ...Typography.default("semiBold"),
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    ...Typography.default("semiBold"),
  },
  templatePreview: {
    fontSize: 12,
    lineHeight: 16,
    ...Typography.default(),
  },
  templateActions: {
    flexDirection: "row",
    gap: 16,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 15,
    ...Typography.default(),
  },
}));
