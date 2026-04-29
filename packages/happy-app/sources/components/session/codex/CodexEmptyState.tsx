import * as React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/StyledText";
import { t } from "@/text";

export const CodexEmptyState = React.memo(function CodexEmptyState() {
  const { theme } = useUnistyles();

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.codex.sectionBgElevated,
            borderColor: theme.colors.codex.borderSoft,
            borderRadius: theme.codex.radius.section,
            paddingHorizontal: theme.codex.spacing.panelPadding * 2,
            paddingVertical: theme.codex.spacing.panelPadding * 2,
            gap: theme.codex.spacing.cardGap,
          },
        ]}
      >
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor: theme.colors.codex.chipBg,
              borderColor: theme.colors.codex.chipBorder,
              borderRadius: theme.codex.radius.card + 4,
            },
          ]}
        >
          <Ionicons
            name="git-compare-outline"
            size={22}
            color={theme.colors.codex.accent}
          />
        </View>
        <Text style={[styles.title, { color: theme.colors.codex.textPrimary }]}>
          {t("changes.noChanges")}
        </Text>
        <Text style={[styles.subtitle, { color: theme.colors.codex.textSecondary }]}>
          {t("tools.names.viewDiff")}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create((_, rt) => ({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    alignItems: "center",
  },
  iconWrap: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 12,
    textAlign: "center",
  },
}));
