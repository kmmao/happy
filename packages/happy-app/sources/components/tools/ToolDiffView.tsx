import * as React from "react";
import { ScrollView, View } from "react-native";
import { DiffView } from "@/components/diff/DiffView";
import { useSetting } from "@/sync/storage";
import { getDiffPreviewMaxHeight } from "./toolDiffPreview";

interface ToolDiffViewProps {
  oldText: string;
  newText: string;
  style?: any;
  showLineNumbers?: boolean;
  showPlusMinusSymbols?: boolean;
  collapsible?: boolean;
  language?: string | null;
  viewMode?: "unified" | "split";
  expandedContext?: boolean;
  visibleLineCount?: number;
}

export const ToolDiffView = React.memo<ToolDiffViewProps>(
  ({
    oldText,
    newText,
    style,
    showLineNumbers = false,
    showPlusMinusSymbols = false,
    collapsible = false,
    language = null,
    viewMode = "unified",
    expandedContext = false,
    visibleLineCount,
  }) => {
    const wrapLines = useSetting("wrapLinesInDiffs");
    const maxHeight = getDiffPreviewMaxHeight(visibleLineCount);
    // Split mode forces wrap since each column has limited width
    const effectiveWrapLines = viewMode === "split" ? true : wrapLines;

    const diffView = (
      <DiffView
        oldText={oldText}
        newText={newText}
        wrapLines={effectiveWrapLines}
        showLineNumbers={showLineNumbers}
        showPlusMinusSymbols={showPlusMinusSymbols}
        collapsible={collapsible}
        language={language}
        viewMode={viewMode}
        expandedContext={expandedContext}
        style={{ flex: 1, ...style }}
      />
    );

    if (effectiveWrapLines) {
      return (
        <ScrollView
          style={maxHeight ? { maxHeight } : undefined}
          nestedScrollEnabled
          showsVerticalScrollIndicator={maxHeight != null}
        >
          {diffView}
        </ScrollView>
      );
    }

    return (
      <ScrollView
        style={maxHeight ? { maxHeight } : undefined}
        nestedScrollEnabled
        showsVerticalScrollIndicator={maxHeight != null}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={true}
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <View>{diffView}</View>
        </ScrollView>
      </ScrollView>
    );
  },
);
