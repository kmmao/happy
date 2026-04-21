import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
  TEMPLATE_TYPES,
  TYPE_COLORS,
  TYPE_ICONS,
  TYPE_LABELS,
} from "./roleFormPresentation";

interface RoleTemplateSelectorProps {
  selectedTemplateType?: string;
  onSelectTemplate: (templateType: string) => void;
}

export const RoleTemplateSelector = React.memo(function RoleTemplateSelector({
  selectedTemplateType,
  onSelectTemplate,
}: RoleTemplateSelectorProps) {
  const { theme } = useUnistyles();

  return (
    <View style={styles.templateGrid}>
      {TEMPLATE_TYPES.map((templateType) => {
        const isSelected = selectedTemplateType === templateType;
        return (
          <Pressable
            key={templateType}
            style={[
              styles.templateButton,
              isSelected && styles.templateButtonSelected,
            ]}
            onPress={() => onSelectTemplate(templateType)}
          >
            <View
              style={[
                styles.templateIcon,
                { backgroundColor: TYPE_COLORS[templateType] ?? "#6B7280" },
              ]}
            >
              <Ionicons
                name={(TYPE_ICONS[templateType] ?? "person") as any}
                size={18}
                color="#fff"
              />
            </View>
            <Text
              style={[
                styles.templateLabel,
                { color: theme.colors.text },
                isSelected && styles.templateLabelSelected,
              ]}
            >
              {TYPE_LABELS[templateType]?.() ?? templateType}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  templateGrid: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 10,
  },
  templateButton: {
    alignItems: "center" as const,
    width: 80,
    gap: 6,
    paddingVertical: 6,
    borderRadius: 10,
  },
  templateButtonSelected: {
    backgroundColor: theme.colors.groupped.background,
  },
  templateIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  templateLabel: {
    fontSize: 12,
    textAlign: "center" as const,
  },
  templateLabelSelected: {
    fontWeight: "600",
  },
}));
