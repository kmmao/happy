import * as React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { ToolCall } from "@/sync/typesMessage";
import { ToolSectionView } from "../ToolSectionView";
import { Metadata } from "@/sync/storageTypes";
import { resolvePath } from "@/utils/pathUtils";
import { ToolDiffView } from "@/components/tools/ToolDiffView";
import { DiffStatsBar } from "@/components/diff/DiffStatsBar";
import { getLanguageFromPath } from "@/components/diff/syntaxTokenizer";
import { getCodexPatchEntries } from "../codexPatchUtils";

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
    const entries = React.useMemo(
      () =>
        getCodexPatchEntries(tool.input?.changes).map((entry, index) => {
          const resolvedPath = resolvePath(entry.path, metadata);
          return {
            ...entry,
            index,
            resolvedPath,
            language: getLanguageFromPath(resolvedPath),
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
      <ToolSectionView fullWidth>
        <View style={styles.list}>
          {entries.map((entry) => {
            const fileName =
              entry.resolvedPath.split("/").pop() || entry.resolvedPath;
            const expanded = expandedIndexes.has(entry.index);

            return (
              <View
                key={`${entry.index}-${entry.resolvedPath}`}
                style={styles.item}
              >
                <Pressable
                  style={styles.cardHeader}
                  onPress={() => toggleEntry(entry.index)}
                >
                  <View style={styles.cardHeaderLeft}>
                    <View style={styles.fileIconWrap}>
                      <Ionicons
                        name="document-text-outline"
                        size={18}
                        color={theme.colors.text}
                      />
                    </View>
                    <View style={styles.fileMeta}>
                      <Text style={styles.fileName} numberOfLines={1}>
                        {fileName}
                      </Text>
                      {entry.resolvedPath !== fileName && (
                        <Text style={styles.filePath} numberOfLines={1}>
                          {entry.resolvedPath}
                        </Text>
                      )}
                    </View>
                  </View>
                  <View style={styles.cardHeaderRight}>
                    <DiffStatsBar
                      additions={entry.additions}
                      deletions={entry.deletions}
                    />
                    {!isFullView && entries.length === 1 && durationText && (
                      <Text style={styles.durationText}>{durationText}</Text>
                    )}
                    <Ionicons
                      name={expanded ? "chevron-down" : "chevron-forward"}
                      size={16}
                      color={theme.colors.textSecondary}
                    />
                  </View>
                </Pressable>
                {expanded && (
                  <View
                    style={[
                      styles.diffWrap,
                      { borderTopColor: theme.colors.divider },
                    ]}
                  >
                    <ToolDiffView
                      oldText={entry.oldText}
                      newText={entry.newText}
                      showLineNumbers
                      showPlusMinusSymbols
                      collapsible
                      language={entry.language}
                      visibleLineCount={isFullView ? undefined : 5}
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
    gap: 12,
  },
  item: {
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
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
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  fileMeta: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.colors.text,
  },
  filePath: {
    marginTop: 2,
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  durationText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontVariant: ["tabular-nums"],
  },
  diffWrap: {
    borderTopWidth: 1,
    marginTop: 4,
    paddingTop: 8,
  },
}));
