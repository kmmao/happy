import * as React from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import {
  usePromptTemplates,
  promptTemplateStore,
} from "@/sync/promptTemplateStore";
import type { PromptTemplate } from "@/sync/promptTemplateTypes";

interface PromptTemplatePickerProps {
  onSelect: (template: PromptTemplate) => void;
  onClose: () => void;
}

export const PromptTemplatePicker = React.memo(
  ({ onSelect, onClose }: PromptTemplatePickerProps) => {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const templates = usePromptTemplates();
    const isLoaded = promptTemplateStore((s) => s.isLoaded);

    React.useEffect(() => {
      if (!isLoaded) {
        promptTemplateStore.getState().loadTemplates();
      }
    }, [isLoaded]);

    const handleSelect = React.useCallback(
      (template: PromptTemplate) => {
        onSelect(template);
        onClose();
      },
      [onSelect, onClose],
    );

    const handleManage = React.useCallback(() => {
      onClose();
      router.push("/kanban/templates");
    }, [onClose, router]);

    const renderItem = React.useCallback(
      ({ item }: { item: PromptTemplate }) => (
        <Pressable
          onPress={() => handleSelect(item)}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.templateItem,
            pressed && { opacity: 0.6 },
          ]}
        >
          <View style={styles.templateIcon}>
            <Ionicons
              name={item.isBuiltIn ? "document-text-outline" : "create-outline"}
              size={20}
              color={theme.colors.header.tint}
            />
          </View>
          <View style={styles.templateContent}>
            <Text
              style={[styles.templateName, { color: theme.colors.text }]}
              numberOfLines={1}
            >
              {item.isBuiltIn
                ? t(item.name as Parameters<typeof t>[0])
                : item.name}
            </Text>
            <Text
              style={[
                styles.templatePreview,
                { color: theme.colors.textSecondary },
              ]}
              numberOfLines={2}
            >
              {item.content.slice(0, 120)}
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={theme.colors.textSecondary}
          />
        </Pressable>
      ),
      [handleSelect, theme],
    );

    const keyExtractor = React.useCallback(
      (item: PromptTemplate) => item.id,
      [],
    );

    const ItemSeparator = React.useCallback(
      () => (
        <View
          style={[styles.separator, { backgroundColor: theme.colors.divider }]}
        />
      ),
      [theme],
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
          {/* Header */}
          <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>
            {t("kanban.templates.pickTitle")}
          </Text>

          {/* Template list */}
          <FlatList
            data={templates}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            ItemSeparatorComponent={ItemSeparator}
            style={styles.list}
            scrollEnabled={templates.length > 5}
          />

          {/* Manage templates */}
          <View
            style={[styles.divider, { backgroundColor: theme.colors.divider }]}
          />
          <Pressable
            onPress={handleManage}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.manageItem,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Ionicons
              name="settings-outline"
              size={18}
              color={theme.colors.header.tint}
            />
            <Text
              style={[styles.manageText, { color: theme.colors.header.tint }]}
            >
              {t("kanban.templates.manage")}
            </Text>
          </Pressable>

          {/* Cancel */}
          <View
            style={[styles.divider, { backgroundColor: theme.colors.divider }]}
          />
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
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
    paddingBottom: 12,
    ...Typography.default("semiBold"),
  },
  list: {
    maxHeight: 300,
  },
  templateItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  templateIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  templateContent: {
    flex: 1,
    gap: 2,
  },
  templateName: {
    fontSize: 15,
    ...Typography.default("semiBold"),
  },
  templatePreview: {
    fontSize: 12,
    lineHeight: 16,
    ...Typography.default(),
  },
  separator: {
    height: 0.5,
    marginLeft: 58,
  },
  divider: {
    height: 0.5,
    marginHorizontal: 16,
    marginVertical: 4,
  },
  manageItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 6,
  },
  manageText: {
    fontSize: 14,
    ...Typography.default(),
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
