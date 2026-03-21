import React from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Switch } from "@/components/Switch";
import type { Theme } from "@/theme";
import type { Provider } from "./types";
import { FieldLabel } from "./FieldLabel";

interface Props {
  readonly theme: Theme;
  readonly formHost: string;
  readonly formProvider: Provider;
  readonly formToken: string;
  readonly onHostChange: (v: string) => void;
  readonly onProviderChange: (v: Provider) => void;
  readonly onTokenChange: (v: string) => void;
}

export const GitHostBasicForm = React.memo(function GitHostBasicForm({
  theme,
  formHost,
  formProvider,
  formToken,
  onHostChange,
  onProviderChange,
  onTokenChange,
}: Props) {
  return (
    <View>
      {/* Host input */}
      <FieldLabel theme={theme}>{t("gitHosts.hostLabel")}</FieldLabel>
      <TextInput
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: 8,
          padding: 12,
          fontSize: 15,
          color: theme.colors.text,
          marginBottom: 12,
          ...Typography.mono(),
        }}
        value={formHost}
        onChangeText={onHostChange}
        placeholder="github.mycompany.com or http://10.0.0.1:3000"
        placeholderTextColor={theme.colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      {/* Provider selector */}
      <FieldLabel theme={theme}>{t("gitHosts.providerLabel")}</FieldLabel>
      <View
        style={{
          flexDirection: "row",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <ProviderButton
          label="GitHub"
          icon="logo-github"
          selected={formProvider === "github"}
          onPress={() => onProviderChange("github")}
          theme={theme}
        />
        <ProviderButton
          label="Gitea"
          icon="server-outline"
          selected={formProvider === "gitea"}
          onPress={() => onProviderChange("gitea")}
          theme={theme}
        />
      </View>

      {/* API Token input */}
      <FieldLabel theme={theme}>{t("gitHosts.tokenLabel")}</FieldLabel>
      <TextInput
        style={{
          backgroundColor: theme.colors.surface,
          borderRadius: 8,
          padding: 12,
          fontSize: 15,
          color: theme.colors.text,
          marginBottom: 4,
          ...Typography.mono(),
        }}
        value={formToken}
        onChangeText={onTokenChange}
        placeholder={t("gitHosts.tokenPlaceholder")}
        placeholderTextColor={theme.colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      <Text
        style={{
          fontSize: 12,
          color: theme.colors.textSecondary,
          marginBottom: 8,
          lineHeight: 16,
          ...Typography.default(),
        }}
      >
        {formProvider === "github"
          ? t("gitHosts.tokenHintGitHub")
          : t("gitHosts.tokenHint")}
      </Text>
    </View>
  );
});

// ── Sub-components ──────────────────────────────────

const ProviderButton = React.memo<{
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  selected: boolean;
  onPress: () => void;
  theme: Theme;
}>(function ProviderButton({ label, icon, selected, onPress, theme }) {
  return (
    <Pressable
      style={{
        flex: 1,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: selected
          ? theme.colors.button.primary.background
          : theme.colors.surface,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
      onPress={onPress}
    >
      <Ionicons
        name={icon}
        size={18}
        color={selected ? theme.colors.button.primary.tint : theme.colors.text}
      />
      <Text
        style={{
          fontSize: 14,
          fontWeight: selected ? "600" : "400",
          color: selected
            ? theme.colors.button.primary.tint
            : theme.colors.text,
          ...Typography.default(selected ? "semiBold" : undefined),
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
});
