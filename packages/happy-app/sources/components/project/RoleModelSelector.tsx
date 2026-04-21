import * as React from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import { projectFormSheetStyles as pfs } from "./projectFormSheetStyles";
import {
  MODEL_PRESET_LABELS,
  MODEL_PRESET_VALUES,
  type RoleModelPresetValue,
} from "./roleFormPresentation";

interface RoleModelSelectorProps {
  modelPreset: RoleModelPresetValue;
  modelCustomValue: string;
  onModelPresetChange: (value: RoleModelPresetValue) => void;
  onModelCustomValueChange: (value: string) => void;
}

export const RoleModelSelector = React.memo(function RoleModelSelector({
  modelPreset,
  modelCustomValue,
  onModelPresetChange,
  onModelCustomValueChange,
}: RoleModelSelectorProps) {
  const { theme } = useUnistyles();
  const [isDropdownOpen, setIsDropdownOpen] = React.useState(false);

  return (
    <>
      <Pressable
        style={styles.modelSelector}
        onPress={() => setIsDropdownOpen((value) => !value)}
      >
        <Text
          style={[
            styles.modelSelectorText,
            !modelPreset && { color: theme.colors.textSecondary },
          ]}
        >
          {modelPreset === ""
            ? t("roles.modelDefault")
            : modelPreset === "custom"
              ? t("roles.modelCustom")
              : (MODEL_PRESET_LABELS[modelPreset] ?? modelPreset)}
        </Text>
        <Ionicons
          name={isDropdownOpen ? "chevron-up" : "chevron-down"}
          size={16}
          color={theme.colors.textSecondary}
        />
      </Pressable>

      {isDropdownOpen ? (
        <View style={styles.modelDropdownList}>
          {MODEL_PRESET_VALUES.map((modelValue) => {
            const isSelected = modelPreset === modelValue;
            const label = modelValue === ""
              ? t("roles.modelDefault")
              : (MODEL_PRESET_LABELS[modelValue] ?? modelValue);

            return (
              <Pressable
                key={modelValue || "__default__"}
                style={[
                  styles.modelDropdownItem,
                  isSelected && styles.modelDropdownItemSelected,
                ]}
                onPress={() => {
                  onModelPresetChange(modelValue);
                  setIsDropdownOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.modelDropdownItemText,
                    isSelected && { color: theme.colors.accentPurple },
                  ]}
                >
                  {label}
                </Text>
                {isSelected ? (
                  <Ionicons name="checkmark" size={16} color={theme.colors.accentPurple} />
                ) : null}
              </Pressable>
            );
          })}

          <Pressable
            style={[
              styles.modelDropdownItem,
              modelPreset === "custom" && styles.modelDropdownItemSelected,
            ]}
            onPress={() => {
              onModelPresetChange("custom");
              setIsDropdownOpen(false);
            }}
          >
            <Text
              style={[
                styles.modelDropdownItemText,
                modelPreset === "custom" && { color: theme.colors.accentPurple },
              ]}
            >
              {t("roles.modelCustom")}
            </Text>
            {modelPreset === "custom" ? (
              <Ionicons name="checkmark" size={16} color={theme.colors.accentPurple} />
            ) : null}
          </Pressable>
        </View>
      ) : null}

      {modelPreset === "custom" ? (
        <TextInput
          style={[pfs.textInput, { marginTop: 8 }]}
          value={modelCustomValue}
          onChangeText={onModelCustomValueChange}
          placeholder={t("roles.modelOverridePlaceholder")}
          placeholderTextColor={theme.colors.textSecondary}
          maxLength={100}
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : null}
    </>
  );
});

const styles = StyleSheet.create((theme) => ({
  modelSelector: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    backgroundColor: theme.colors.groupped.background,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  modelSelectorText: {
    fontSize: 15,
    color: theme.colors.text,
    flex: 1,
  },
  modelDropdownList: {
    marginTop: 4,
    backgroundColor: theme.colors.groupped.background,
    borderRadius: 8,
    overflow: "hidden" as const,
  },
  modelDropdownItem: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surface,
  },
  modelDropdownItemSelected: {
    backgroundColor: theme.dark
      ? "rgba(139,92,246,0.12)"
      : "rgba(109,40,217,0.06)",
  },
  modelDropdownItemText: {
    fontSize: 14,
    color: theme.colors.text,
  },
}));
