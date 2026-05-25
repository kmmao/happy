import * as React from "react";
import { View, useWindowDimensions } from "react-native";
import * as Clipboard from "expo-clipboard";
import { ToolCall } from "@/sync/typesMessage";
import { Metadata } from "@/sync/storageTypes";
import { knownTools } from "@/components/tools/knownTools";
import { toolFullViewStyles } from "../ToolFullView";
import { ToolDiffView } from "@/components/tools/ToolDiffView";
import { trimIdent } from "@/utils/trimIdent";
import { getLanguageForPath } from "@/components/diff/fileLanguage";
import {
  calculateUnifiedDiff,
  formatUnifiedDiffText,
} from "@/components/diff/calculateDiff";
import { DiffToolbar } from "@/components/diff/DiffToolbar";

interface EditViewFullProps {
  tool: ToolCall;
  metadata: Metadata | null;
}

export const EditViewFull = React.memo<EditViewFullProps>(
  ({ tool, metadata }) => {
    const { input } = tool;
    const screenWidth = useWindowDimensions().width;

    const [viewMode, setViewMode] = React.useState<"unified" | "split">(
      "unified",
    );
    const [expandedContext, setExpandedContext] = React.useState(false);

    // Parse the input
    let oldString = "";
    let newString = "";
    const parsed = knownTools.Edit.input.safeParse(input);
    if (parsed.success) {
      oldString = trimIdent(parsed.data.old_string || "");
      newString = trimIdent(parsed.data.new_string || "");
    }

    const filePath =
      typeof input?.file_path === "string" ? input.file_path : null;
    const language = filePath ? getLanguageForPath(filePath) : null;

    const handleCopyDiff = React.useCallback(() => {
      const contextLines = expandedContext ? 999999 : 3;
      const { hunks } = calculateUnifiedDiff(
        oldString,
        newString,
        contextLines,
      );
      const text = formatUnifiedDiffText(hunks, filePath);
      Clipboard.setStringAsync(text);
    }, [oldString, newString, filePath, expandedContext]);

    return (
      <View style={toolFullViewStyles.sectionFullWidth}>
        <DiffToolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          expandedContext={expandedContext}
          onExpandedContextChange={setExpandedContext}
          onCopyDiff={handleCopyDiff}
          showSplitOption={screenWidth >= 600}
        />
        <ToolDiffView
          oldText={oldString}
          newText={newString}
          style={{ width: "100%" }}
          showLineNumbers={true}
          showPlusMinusSymbols={true}
          collapsible
          language={language}
          viewMode={viewMode}
          expandedContext={expandedContext}
        />
      </View>
    );
  },
);
