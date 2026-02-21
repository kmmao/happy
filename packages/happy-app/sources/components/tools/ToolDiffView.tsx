import * as React from "react";
import { ScrollView, View } from "react-native";
import { DiffView } from "@/components/diff/DiffView";
import { useSetting } from "@/sync/storage";

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
  }) => {
    const wrapLines = useSetting("wrapLinesInDiffs");
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
      // When wrapping lines, no horizontal scroll needed
      return <View style={{ flex: 1 }}>{diffView}</View>;
    }

    // When not wrapping, use horizontal scroll
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={true}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        {diffView}
      </ScrollView>
    );
  },
);
