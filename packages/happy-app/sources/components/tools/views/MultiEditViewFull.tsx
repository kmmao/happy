import * as React from "react";
import {
  View,
  Text,
  ScrollView,
  LayoutChangeEvent,
  useWindowDimensions,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { ToolCall } from "@/sync/typesMessage";
import { Metadata } from "@/sync/storageTypes";
import { knownTools } from "@/components/tools/knownTools";
import { toolFullViewStyles } from "../ToolFullView";
import { DiffView } from "@/components/diff/DiffView";
import { trimIdent } from "@/utils/trimIdent";
import {
  getDiffStatsLight,
  calculateUnifiedDiff,
  formatUnifiedDiffText,
} from "@/components/diff/calculateDiff";
import { EditTabBar, EditTabItem } from "@/components/diff/EditTabBar";
import { DiffToolbar } from "@/components/diff/DiffToolbar";
import { t } from "@/text";
import { useSetting } from "@/sync/storage";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { getLanguageForPath } from "@/components/diff/fileLanguage";

interface MultiEditViewFullProps {
  tool: ToolCall;
  metadata: Metadata | null;
  scrollViewRef?: React.RefObject<ScrollView | null>;
}

export const MultiEditViewFull = React.memo<MultiEditViewFullProps>(
  ({ tool, metadata, scrollViewRef }) => {
    const { input } = tool;
    const wrapLinesInDiffs = useSetting("wrapLinesInDiffs");
    const { theme } = useUnistyles();
    const screenWidth = useWindowDimensions().width;
    const [activeEditIndex, setActiveEditIndex] = React.useState(0);
    const [viewMode, setViewMode] = React.useState<"unified" | "split">(
      "unified",
    );
    const [expandedContext, setExpandedContext] = React.useState(false);
    const effectiveWrapLines = viewMode === "split" ? true : wrapLinesInDiffs;
    const [editOffsets, setEditOffsets] = React.useState<
      Record<number, number>
    >({});

    // Parse the input
    let edits: Array<{
      old_string: string;
      new_string: string;
      replace_all?: boolean;
    }> = [];

    const parsed = knownTools.MultiEdit.input.safeParse(input);
    if (parsed.success && parsed.data.edits) {
      edits = parsed.data.edits;
    }

    const filePath =
      typeof input?.file_path === "string" ? input.file_path : null;
    const language = filePath ? getLanguageForPath(filePath) : null;

    // Pre-compute tab items with stats
    const editItems: EditTabItem[] = React.useMemo(
      () =>
        edits.map((edit, index) => {
          const stats = getDiffStatsLight(
            trimIdent(edit.old_string || ""),
            trimIdent(edit.new_string || ""),
          );
          return {
            index,
            label: t("tools.multiEdit.editNumber", {
              index: index + 1,
              total: edits.length,
            }),
            additions: stats.additions,
            deletions: stats.deletions,
          };
        }),
      [edits],
    );

    const handleTabPress = React.useCallback(
      (index: number) => {
        setActiveEditIndex(index);
        const y = editOffsets[index];
        if (y !== undefined && scrollViewRef?.current) {
          scrollViewRef.current.scrollTo({ y, animated: true });
        }
      },
      [editOffsets, scrollViewRef],
    );

    const handleEditLayout = React.useCallback(
      (index: number, event: LayoutChangeEvent) => {
        const y = event.nativeEvent.layout.y;
        setEditOffsets((prev) => ({ ...prev, [index]: y }));
      },
      [],
    );

    const handleCopyDiff = React.useCallback(() => {
      const contextLines = expandedContext ? 999999 : 3;
      const parts: string[] = [];
      for (const edit of edits) {
        const oldStr = trimIdent(edit.old_string || "");
        const newStr = trimIdent(edit.new_string || "");
        const { hunks } = calculateUnifiedDiff(oldStr, newStr, contextLines);
        parts.push(formatUnifiedDiffText(hunks, filePath));
      }
      Clipboard.setStringAsync(parts.join("\n"));
    }, [edits, filePath, expandedContext]);

    if (edits.length === 0) {
      return null;
    }

    const content = (
      <View style={{ flex: 1 }}>
        {edits.map((edit, index) => {
          const oldString = trimIdent(edit.old_string || "");
          const newString = trimIdent(edit.new_string || "");

          return (
            <View key={index} onLayout={(e) => handleEditLayout(index, e)}>
              <View style={styles.editHeader}>
                <Text
                  style={[styles.editNumber, { color: theme.colors.textLink }]}
                >
                  {t("tools.multiEdit.editNumber", {
                    index: index + 1,
                    total: edits.length,
                  })}
                </Text>
                {edit.replace_all && (
                  <View
                    style={[
                      styles.replaceAllBadge,
                      { backgroundColor: theme.colors.textLink },
                    ]}
                  >
                    <Text style={styles.replaceAllText}>
                      {t("tools.multiEdit.replaceAll")}
                    </Text>
                  </View>
                )}
              </View>
              <DiffView
                oldText={oldString}
                newText={newString}
                wrapLines={effectiveWrapLines}
                showLineNumbers={true}
                showPlusMinusSymbols={true}
                collapsible
                language={language}
                viewMode={viewMode}
                expandedContext={expandedContext}
              />
              {index < edits.length - 1 && (
                <View
                  style={[
                    styles.separator,
                    { backgroundColor: theme.colors.diff.outline },
                  ]}
                />
              )}
            </View>
          );
        })}
      </View>
    );

    const toolbar = (
      <DiffToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        expandedContext={expandedContext}
        onExpandedContextChange={setExpandedContext}
        onCopyDiff={handleCopyDiff}
        showSplitOption={screenWidth >= 600}
      />
    );

    if (effectiveWrapLines) {
      return (
        <View style={toolFullViewStyles.sectionFullWidth}>
          <EditTabBar
            items={editItems}
            activeIndex={activeEditIndex}
            onTabPress={handleTabPress}
          />
          {toolbar}
          {content}
        </View>
      );
    }

    return (
      <View style={toolFullViewStyles.sectionFullWidth}>
        <EditTabBar
          items={editItems}
          activeIndex={activeEditIndex}
          onTabPress={handleTabPress}
        />
        {toolbar}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={true}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={true}
          contentContainerStyle={{ flexGrow: 1 }}
        >
          {content}
        </ScrollView>
      </View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  editHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  editNumber: {
    fontSize: 14,
    fontWeight: "600",
  },
  replaceAllBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  replaceAllText: {
    fontSize: 12,
    color: "#fff",
    fontWeight: "600",
  },
  separator: {
    height: 1,
    marginVertical: 16,
  },
}));
