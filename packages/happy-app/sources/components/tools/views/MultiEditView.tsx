import * as React from "react";
import { View, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ToolSectionView } from "../../tools/ToolSectionView";
import { ToolViewProps } from "./_all";
import { DiffView } from "@/components/diff/DiffView";
import { knownTools } from "../../tools/knownTools";
import { trimIdent } from "@/utils/trimIdent";
import { getDiffStatsLight } from "@/components/diff/calculateDiff";
import { EditTabBar, EditTabItem } from "@/components/diff/EditTabBar";
import { useSetting } from "@/sync/storage";
import { t } from "@/text";
import { getLanguageForPath } from "@/components/diff/fileLanguage";

export const MultiEditView = React.memo<ToolViewProps>(({ tool }) => {
  const showLineNumbersInToolViews = useSetting("showLineNumbersInToolViews");
  const wrapLinesInDiffs = useSetting("wrapLinesInDiffs");
  const [activeEditIndex, setActiveEditIndex] = React.useState(0);

  let edits: Array<{
    old_string: string;
    new_string: string;
    replace_all?: boolean;
  }> = [];

  const parsed = knownTools.MultiEdit.input.safeParse(tool.input);
  if (parsed.success && parsed.data.edits) {
    edits = parsed.data.edits;
  }

  const filePath =
    typeof tool.input?.file_path === "string" ? tool.input.file_path : null;
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

  if (edits.length === 0) {
    return null;
  }

  const content = (
    <View style={{ flex: 1 }}>
      {edits.map((edit, index) => {
        const oldString = trimIdent(edit.old_string || "");
        const newString = trimIdent(edit.new_string || "");

        return (
          <View key={index}>
            <DiffView
              oldText={oldString}
              newText={newString}
              wrapLines={wrapLinesInDiffs}
              showLineNumbers={showLineNumbersInToolViews}
              showPlusMinusSymbols={showLineNumbersInToolViews}
              collapsible
              language={language}
            />
            {index < edits.length - 1 && <View style={styles.separator} />}
          </View>
        );
      })}
    </View>
  );

  if (wrapLinesInDiffs) {
    return (
      <ToolSectionView fullWidth>
        <EditTabBar
          items={editItems}
          activeIndex={activeEditIndex}
          onTabPress={setActiveEditIndex}
        />
        {content}
      </ToolSectionView>
    );
  }

  return (
    <ToolSectionView fullWidth>
      <EditTabBar
        items={editItems}
        activeIndex={activeEditIndex}
        onTabPress={setActiveEditIndex}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={true}
        showsVerticalScrollIndicator={true}
        nestedScrollEnabled={true}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {content}
      </ScrollView>
    </ToolSectionView>
  );
});

const styles = StyleSheet.create({
  separator: {
    height: 8,
  },
});
