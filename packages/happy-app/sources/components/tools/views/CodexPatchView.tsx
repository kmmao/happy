import * as React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { ToolCall } from "@/sync/typesMessage";
import { ToolSectionView } from "../ToolSectionView";
import { Metadata } from "@/sync/storageTypes";
import { resolvePath } from "@/utils/pathUtils";
import { ToolDiffView } from "@/components/tools/ToolDiffView";
import { EditTabBar, type EditTabItem } from "@/components/diff/EditTabBar";
import { getLanguageFromPath } from "@/components/diff/syntaxTokenizer";
import { getCodexPatchEntries, getCodexPatchTotals } from "../codexPatchUtils";
import { t } from "@/text";

interface CodexPatchViewProps {
  tool: ToolCall;
  metadata: Metadata | null;
  scrollViewRef?: React.RefObject<ScrollView | null>;
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
    const totals = React.useMemo(() => getCodexPatchTotals(entries), [entries]);

    const [activeIndex, setActiveIndex] = React.useState(0);
    const isFullView = !!scrollViewRef;
    const [expanded, setExpanded] = React.useState(isFullView);

    React.useEffect(() => {
      if (activeIndex >= entries.length) {
        setActiveIndex(0);
      }
    }, [activeIndex, entries.length]);

    React.useEffect(() => {
      setExpanded(isFullView);
    }, [isFullView, tool.id]);

    if (entries.length === 0) {
      return null;
    }

    const activeEntry = entries[activeIndex] ?? entries[0];
    const tabItems: EditTabItem[] = entries.map((entry) => ({
      index: entry.index,
      label: entry.resolvedPath.split("/").pop() || entry.resolvedPath,
      additions: entry.additions,
      deletions: entry.deletions,
    }));

    return (
      <ToolSectionView fullWidth>
        <EditTabBar
          items={tabItems}
          activeIndex={activeIndex}
          onTabPress={setActiveIndex}
        />
        {!isFullView && (
          <Pressable style={styles.toggleRow} onPress={() => setExpanded((v) => !v)}>
            <Ionicons
              name={expanded ? "chevron-down" : "chevron-forward"}
              size={14}
              color={theme.colors.textSecondary}
            />
            <Text style={styles.toggleText}>
              {expanded ? t("common.collapse") : t("common.expand")}
            </Text>
            {totals && (
              <>
                <Text style={[styles.statsText, { color: theme.colors.diff.success }]}>
                  +{totals.additions}
                </Text>
                <Text style={[styles.statsText, { color: theme.colors.diff.error }]}>
                  -{totals.deletions}
                </Text>
              </>
            )}
          </Pressable>
        )}
        <View style={styles.pathHeader}>
          <View style={styles.pathPill}>
            <View style={styles.pathDot} />
            <Text style={styles.pathLabel} numberOfLines={1}>
              {activeEntry.resolvedPath}
            </Text>
          </View>
        </View>
        {(expanded || isFullView) && (
          <ToolDiffView
            oldText={activeEntry.oldText}
            newText={activeEntry.newText}
            showLineNumbers
            showPlusMinusSymbols
            collapsible
            language={activeEntry.language}
          />
        )}
      </ToolSectionView>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  pathHeader: {
    marginBottom: 10,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  toggleText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    flex: 1,
  },
  statsText: {
    fontSize: 11,
  },
  pathPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceHigh,
    borderWidth: 1,
    borderColor: theme.colors.divider,
  },
  pathDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.success,
  },
  pathLabel: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.text,
  },
}));
