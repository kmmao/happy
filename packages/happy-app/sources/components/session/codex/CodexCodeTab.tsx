import * as React from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { CodexEmptyState } from "@/components/session/codex/CodexEmptyState";
import { type FileChange } from "@/components/session/codeChangeTypes";
import { CodexFileChangeCard } from "@/components/session/codex/CodexFileChangeCard";
import {
  extractCodexCodeTabData,
} from "@/components/session/codex/codexCodeTabData";
import { CodexTurnDiffSummary } from "@/components/session/codex/CodexTurnDiffSummary";
import {
  collectToolCalls,
  extractFileChanges,
} from "@/components/session/sidePanelCodeData";
import { useSession, useSessionMessages } from "@/sync/storage";

interface CodexCodeTabProps {
  sessionId: string;
}

function sortFileChanges(changes: readonly FileChange[]): FileChange[] {
  return [...changes].sort((left, right) => {
    const rightMagnitude = right.totalAdditions + right.totalDeletions;
    const leftMagnitude = left.totalAdditions + left.totalDeletions;
    if (rightMagnitude !== leftMagnitude) {
      return rightMagnitude - leftMagnitude;
    }
    return left.displayPath.localeCompare(right.displayPath);
  });
}

export const CodexCodeTab = React.memo<CodexCodeTabProps>(
  function CodexCodeTab({ sessionId }) {
    const { theme } = useUnistyles();
    const { messages } = useSessionMessages(sessionId);
    const session = useSession(sessionId);
    const metadata = session?.metadata ?? null;

    const data = React.useMemo(() => {
      const toolCalls = collectToolCalls(messages);
      const codexData = extractCodexCodeTabData(toolCalls, metadata);
      if (codexData.fileChanges.length > 0) {
        return codexData;
      }

      return {
        ...codexData,
        fileChanges: extractFileChanges(toolCalls, metadata),
      };
    }, [messages, metadata]);

    const fileChanges = React.useMemo(
      () => sortFileChanges(data.fileChanges),
      [data.fileChanges],
    );
    const totalFiles = fileChanges.length;
    const totalAdditions = fileChanges.reduce(
      (sum, change) => sum + change.totalAdditions,
      0,
    );
    const totalDeletions = fileChanges.reduce(
      (sum, change) => sum + change.totalDeletions,
      0,
    );

    return (
      <View
        style={[
          styles.container,
          { backgroundColor: theme.colors.codex.panelBg },
        ]}
      >
        <CodexTurnDiffSummary
          totalFiles={totalFiles}
          totalAdditions={totalAdditions}
          totalDeletions={totalDeletions}
          source={data.source}
        />

        {totalFiles === 0 ? (
          <CodexEmptyState />
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={[
              styles.contentContainer,
              {
                padding: theme.codex.spacing.panelPadding,
                gap: theme.codex.spacing.cardGap,
              },
            ]}
          >
            {fileChanges.map((change, index) => (
              <CodexFileChangeCard
                key={change.filePath}
                change={change}
                initiallyExpanded={index === 0}
              />
            ))}
          </ScrollView>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create(() => ({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
  },
}));
