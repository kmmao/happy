import * as React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { ToolCall } from "@/sync/typesMessage";
import { ToolSectionView } from "../ToolSectionView";
import { Metadata } from "@/sync/storageTypes";
import { resolvePath } from "@/utils/pathUtils";
import { ToolDiffView } from "@/components/tools/ToolDiffView";
import { useSetting } from "@/sync/storage";
import { getLanguageForPath } from "@/components/diff/fileLanguage";
import { CodexDiffStats } from "@/components/session/codex/CodexDiffStats";
import { buildCodexDiffPalette } from "@/components/session/codex/codexDiffPalette";
import { getCodexPatchEntries } from "../codexPatchUtils";
import { buildCodexToolViewTheme } from "./codexToolViewTheme";

interface CodexPatchViewProps {
  tool: ToolCall;
  metadata: Metadata | null;
  scrollViewRef?: React.RefObject<ScrollView | null>;
}

function formatToolDuration(tool: ToolCall): string | null {
  if (tool.createdAt == null || tool.completedAt == null) {
    return null;
  }
  const seconds = (tool.completedAt - tool.createdAt) / 1000;
  if (seconds < 1) {
    return `${Math.round(seconds * 1000)}ms`;
  }
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export const CodexPatchView = React.memo<CodexPatchViewProps>(
  ({ tool, metadata, scrollViewRef }) => {
    const { theme } = useUnistyles();
    const expandDiffsByDefault = useSetting("expandDiffsByDefault");
    const chrome = React.useMemo(
      () => buildCodexToolViewTheme(theme.colors.codex),
      [theme.colors.codex],
    );
    const diffPalette = React.useMemo(
      () => buildCodexDiffPalette(theme.colors.codex),
      [theme.colors.codex],
    );
    const entries = React.useMemo(
      () =>
        getCodexPatchEntries(tool.input?.changes).map((entry, index) => {
          const resolvedPath = resolvePath(entry.path, metadata);
          return {
            ...entry,
            index,
            resolvedPath,
            language: getLanguageForPath(resolvedPath),
          };
        }),
      [tool.input?.changes, metadata],
    );
    const isFullView = !!scrollViewRef;
    const durationText = React.useMemo(() => formatToolDuration(tool), [tool]);
    const [expandedIndexes, setExpandedIndexes] = React.useState<Set<number>>(
      () => new Set(isFullView && entries.length === 1 ? [0] : []),
    );

    React.useEffect(() => {
      setExpandedIndexes(new Set(isFullView && entries.length === 1 ? [0] : []));
    }, [entries.length, isFullView, tool.createdAt]);

    if (entries.length === 0) {
      return null;
    }

    const toggleEntry = (index: number) => {
      setExpandedIndexes((prev) => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        return next;
      });
    };

    return (
      <ToolSectionView fullWidth provider="codex">
        <View style={[styles.list, { gap: theme.codex.spacing.sectionGap }]}>
          {entries.map((entry) => {
            const fileName =
              entry.resolvedPath.split("/").pop() || entry.resolvedPath;
            const expanded = expandedIndexes.has(entry.index);

            return (
              <View
                key={`${entry.index}-${entry.resolvedPath}`}
                style={[
                  styles.item,
                  {
                    borderColor: chrome.cardBorder,
                    backgroundColor: chrome.cardBg,
                    borderRadius: theme.codex.radius.card,
                  },
                  !expanded && styles.itemCollapsed,
                ]}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.cardHeader,
                    {
                      paddingHorizontal: theme.codex.spacing.cardPadding + 4,
                      paddingVertical: theme.codex.spacing.cardPadding - 2,
                      gap: theme.codex.spacing.sectionGap,
                    },
                    pressed && { backgroundColor: chrome.cardBgHover },
                  ]}
                  onPress={() => toggleEntry(entry.index)}
                >
                  <View style={styles.cardHeaderLeft}>
                    <View
                      style={[
                        styles.fileIconWrap,
                        {
                          backgroundColor: chrome.iconBg,
                          borderColor: chrome.iconBorder,
                          borderRadius: theme.codex.radius.diff - 2,
                        },
                      ]}
                    >
                      <Ionicons
                        name="document-text-outline"
                        size={18}
                        color={chrome.iconColor}
                      />
                    </View>
                    <View style={styles.fileMeta}>
                      <Text
                        style={[styles.fileName, { color: chrome.title }]}
                        numberOfLines={1}
                      >
                        {fileName}
                      </Text>
                      {entry.resolvedPath !== fileName && (
                        <Text
                          style={[styles.filePath, { color: chrome.subtitle }]}
                          numberOfLines={1}
                        >
                          {entry.resolvedPath}
                        </Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.cardHeaderRight}>
                    <CodexDiffStats
                      additions={entry.additions}
                      deletions={entry.deletions}
                    />
                    {!isFullView && entries.length === 1 && durationText && (
                      <Text
                        style={[styles.durationText, { color: chrome.meta }]}
                      >
                        {durationText}
                      </Text>
                    )}
                    <Ionicons
                      name={expanded ? "chevron-down" : "chevron-forward"}
                      size={16}
                      color={chrome.subtitle}
                    />
                  </View>
                </Pressable>
                {expanded && (
                  <View
                    style={[
                      styles.diffWrap,
                      {
                        borderTopColor: chrome.divider,
                        paddingTop: theme.codex.spacing.diffPadding - 2,
                      },
                    ]}
                  >
                    <ToolDiffView
                      oldText={entry.oldText}
                      newText={entry.newText}
                      showLineNumbers
                      showPlusMinusSymbols
                      collapsible
                      language={entry.language}
                      visibleLineCount={isFullView || expandDiffsByDefault ? undefined : 5}
                      palette={diffPalette}
                    />
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ToolSectionView>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  list: {
  },
  item: {
    overflow: "hidden",
    borderWidth: 1,
  },
  itemCollapsed: {
    borderBottomWidth: 0,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardHeaderLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fileIconWrap: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: theme.codex.borderWidth.soft,
  },
  fileMeta: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 15,
    fontWeight: "700",
  },
  filePath: {
    marginTop: 2,
    fontSize: 12,
  },
  durationText: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  diffWrap: {
    borderTopWidth: 1,
    marginTop: 4,
  },
}));
