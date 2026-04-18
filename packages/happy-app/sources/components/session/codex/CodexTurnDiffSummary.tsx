import * as React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/StyledText";
import { CodexDiffStats } from "@/components/session/codex/CodexDiffStats";
import {
  type CodexCodeTabData,
} from "@/components/session/codex/codexCodeTabData";
import { getCodexSourceLabelKey } from "@/components/session/codex/codexFileChangePresentation";
import { t } from "@/text";

interface CodexTurnDiffSummaryProps {
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  source: CodexCodeTabData["source"];
}

export const CodexTurnDiffSummary = React.memo<CodexTurnDiffSummaryProps>(
  function CodexTurnDiffSummary({
    totalFiles,
    totalAdditions,
    totalDeletions,
    source,
  }) {
    const { theme } = useUnistyles();
    const sourceLabel = t(getCodexSourceLabelKey(source));

    return (
      <View
        style={[
          styles.container,
          {
            borderBottomColor: theme.colors.codex.summaryBorder,
            backgroundColor: theme.colors.codex.summaryBg,
            paddingHorizontal: theme.codex.spacing.panelPadding,
            paddingVertical: theme.codex.spacing.cardPadding,
            gap: theme.codex.spacing.sectionGap,
          },
        ]}
      >
        <View style={styles.left}>
          <View
            style={[
              styles.iconWrap,
              {
                backgroundColor: theme.colors.codex.chipBg,
                borderColor: theme.colors.codex.chipBorder,
                borderRadius: theme.codex.radius.card,
              },
            ]}
          >
            <Ionicons
              name="git-compare-outline"
              size={18}
              color={theme.colors.codex.accent}
            />
          </View>
          <View style={styles.textWrap}>
            <Text style={[styles.title, { color: theme.colors.codex.textPrimary }]}>
              {t("changes.summary", { files: totalFiles })}
            </Text>
            <Text style={[styles.subtitle, { color: theme.colors.codex.textSecondary }]}>
              {t("tools.names.viewDiff")}
            </Text>
          </View>
        </View>

        <View style={styles.right}>
          <View
            style={[
              styles.sourceChip,
              {
                backgroundColor: theme.colors.codex.chipBg,
                borderColor: theme.colors.codex.chipBorder,
                borderRadius: theme.codex.radius.chip,
                paddingHorizontal: theme.codex.spacing.chipX,
                paddingVertical: theme.codex.spacing.chipY,
              },
            ]}
          >
            <Text
              style={[
                styles.sourceChipText,
                { color: theme.colors.codex.chipText },
              ]}
            >
              {sourceLabel}
            </Text>
          </View>
          <CodexDiffStats additions={totalAdditions} deletions={totalDeletions} />
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create(() => ({
  container: {
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  right: {
    alignItems: "flex-end",
    gap: 8,
  },
  iconWrap: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
  },
  subtitle: {
    marginTop: 2,
    fontSize: 11,
  },
  sourceChip: {
    borderWidth: 1,
  },
  sourceChipText: {
    fontSize: 11,
    fontWeight: "600",
  },
}));
