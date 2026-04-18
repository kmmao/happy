import * as React from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { buildCodexDiffPalette } from "@/components/session/codex/codexDiffPalette";
import { ToolDiffView } from "@/components/tools/ToolDiffView";

interface CodexUnifiedDiffViewProps {
  oldText: string;
  newText: string;
  language: string | null;
  visibleLineCount?: number;
}

export const CodexUnifiedDiffView = React.memo<CodexUnifiedDiffViewProps>(
  function CodexUnifiedDiffView({
    oldText,
    newText,
    language,
    visibleLineCount = 8,
  }) {
    const { theme } = useUnistyles();
    const palette = React.useMemo(
      () => buildCodexDiffPalette(theme.colors.codex),
      [theme.colors.codex],
    );

    return (
      <View
        style={[
          styles.container,
          {
            borderColor: theme.colors.codex.codeBorder,
            backgroundColor: theme.colors.codex.codeBg,
            borderRadius: theme.codex.radius.diff,
          },
        ]}
      >
        <ToolDiffView
          oldText={oldText}
          newText={newText}
          language={language}
          collapsible={false}
          showLineNumbers
          showPlusMinusSymbols
          visibleLineCount={visibleLineCount}
          palette={palette}
        />
      </View>
    );
  },
);

const styles = StyleSheet.create(() => ({
  container: {
    borderWidth: 1,
    overflow: "hidden",
  },
}));
