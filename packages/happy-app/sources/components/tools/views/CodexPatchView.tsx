import * as React from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ToolCall } from "@/sync/typesMessage";
import { ToolSectionView } from "../ToolSectionView";
import { Metadata } from "@/sync/storageTypes";
import { resolvePath } from "@/utils/pathUtils";
import { ToolDiffView } from "@/components/tools/ToolDiffView";
import { EditTabBar, type EditTabItem } from "@/components/diff/EditTabBar";
import { getLanguageFromPath } from "@/components/diff/syntaxTokenizer";
import { getCodexPatchEntries } from "../codexPatchUtils";

interface CodexPatchViewProps {
  tool: ToolCall;
  metadata: Metadata | null;
}

export const CodexPatchView = React.memo<CodexPatchViewProps>(
  ({ tool, metadata }) => {
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

    const [activeIndex, setActiveIndex] = React.useState(0);

    React.useEffect(() => {
      if (activeIndex >= entries.length) {
        setActiveIndex(0);
      }
    }, [activeIndex, entries.length]);

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
        <View style={styles.pathHeader}>
          <View style={styles.pathPill}>
            <View style={styles.pathDot} />
            <Text style={styles.pathLabel} numberOfLines={1}>
              {activeEntry.resolvedPath}
            </Text>
          </View>
        </View>
        <ToolDiffView
          oldText={activeEntry.oldText}
          newText={activeEntry.newText}
          showLineNumbers
          showPlusMinusSymbols
          collapsible
          language={activeEntry.language}
        />
      </ToolSectionView>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  pathHeader: {
    marginBottom: 10,
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
