import * as React from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { getLanguageFromPath } from "@/components/diff/syntaxTokenizer";
import { Text } from "@/components/StyledText";
import { type FileChange } from "@/components/session/codeChangeTypes";
import { CodexDiffStats } from "@/components/session/codex/CodexDiffStats";
import {
  inferCodexFileChangeKind,
} from "@/components/session/codex/codexFileChangePresentation";
import { CodexUnifiedDiffView } from "@/components/session/codex/CodexUnifiedDiffView";
import { t } from "@/text";

interface CodexFileChangeCardProps {
  change: FileChange;
  initiallyExpanded?: boolean;
}

function getKindVisuals(kind: ReturnType<typeof inferCodexFileChangeKind>) {
  if (kind === "add") {
    return {
      icon: "add-outline" as const,
      tone: "success",
    };
  }
  if (kind === "delete") {
    return {
      icon: "remove-outline" as const,
      tone: "danger",
    };
  }
  return {
    icon: "code-slash-outline" as const,
    tone: "neutral",
  };
}

export const CodexFileChangeCard = React.memo<CodexFileChangeCardProps>(
  function CodexFileChangeCard({ change, initiallyExpanded = false }) {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(initiallyExpanded);
    const language = getLanguageFromPath(change.filePath);
    const kind = inferCodexFileChangeKind(change);
    const visuals = getKindVisuals(kind);
    const badgeColors = React.useMemo(() => {
      if (visuals.tone === "success") {
        return {
          borderColor: theme.colors.codex.changeKind.add,
          color: theme.colors.codex.changeKind.add,
          backgroundColor: theme.colors.codex.sectionBgElevated,
        };
      }
      if (visuals.tone === "danger") {
        return {
          borderColor: theme.colors.codex.changeKind.delete,
          color: theme.colors.codex.changeKind.delete,
          backgroundColor: theme.colors.codex.sectionBgElevated,
        };
      }
      return {
        borderColor: theme.colors.codex.changeKind.update,
        color: theme.colors.codex.changeKind.update,
        backgroundColor: theme.colors.codex.sectionBgElevated,
      };
    }, [theme.colors.codex, visuals.tone]);

    return (
      <View
        style={[
          styles.card,
          {
            borderColor: theme.colors.codex.codeBorder,
            backgroundColor: theme.colors.codex.cardBg,
            borderRadius: theme.codex.radius.card,
          },
        ]}
      >
        <Pressable
          onPress={() => setExpanded((value) => !value)}
          style={({ pressed }) => [
            styles.header,
            {
              paddingHorizontal: theme.codex.spacing.cardPadding,
              paddingVertical: theme.codex.spacing.cardPadding,
              gap: theme.codex.spacing.cardGap,
            },
            pressed && { backgroundColor: theme.colors.codex.cardBgHover },
          ]}
        >
          <View style={styles.left}>
            <View
              style={[
                styles.kindIconWrap,
                {
                  backgroundColor: badgeColors.backgroundColor,
                  borderColor: badgeColors.borderColor,
                  borderRadius: theme.codex.radius.diff,
                },
              ]}
            >
              <Ionicons
                name={visuals.icon}
                size={14}
                color={badgeColors.color}
              />
            </View>

            <View style={styles.meta}>
              <Text
                style={[styles.path, { color: theme.colors.codex.textPrimary }]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {change.displayPath}
              </Text>

              {change.edits.length > 1 ? (
                <View
                  style={[
                    styles.subRow,
                    { marginTop: theme.codex.spacing.cardGap - 4 },
                  ]}
                >
                  <Text
                    style={[
                      styles.editCount,
                      { color: theme.colors.codex.textMuted },
                    ]}
                  >
                    {t("changes.editCount", { count: change.edits.length })}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.right}>
            <CodexDiffStats
              additions={change.totalAdditions}
              deletions={change.totalDeletions}
            />
            <Ionicons
              name={expanded ? "chevron-down" : "chevron-forward"}
              size={16}
              color={theme.colors.codex.textSecondary}
            />
          </View>
        </Pressable>

        {expanded ? (
          <View
            style={[
              styles.body,
              {
                borderTopColor: theme.colors.codex.borderSoft,
                paddingHorizontal: theme.codex.spacing.cardPadding,
                paddingVertical: theme.codex.spacing.diffPadding,
              },
            ]}
          >
            {change.edits.map((edit, index) => (
              <View
                key={`${change.filePath}:${edit.toolName}:${edit.editIndex}`}
                style={
                  index > 0
                    ? { marginTop: theme.codex.spacing.cardGap - 2 }
                    : undefined
                }
              >
                <CodexUnifiedDiffView
                  oldText={edit.oldText}
                  newText={edit.newText}
                  language={language}
                />
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create((_, rt) => ({
  card: {
    borderWidth: 1,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  left: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  kindIconWrap: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  path: {
    fontSize: 13,
    fontWeight: "700",
  },
  subRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  editCount: {
    fontSize: 11,
  },
  body: {
    borderTopWidth: 1,
  },
}));
