import * as React from "react";
import { FlatList, View, type ListRenderItem } from "react-native";
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

const codexKeyExtractor = (item: FileChange) => item.filePath;

export const CodexCodeTab = React.memo<CodexCodeTabProps>(
  function CodexCodeTab({ sessionId }) {
    const { theme } = useUnistyles();
    const { messages } = useSessionMessages(sessionId);
    // Match LegacyCodeChangesView: defer the heavy messages → fileChanges
    // derivation so streaming chunks don't re-run collectToolCalls + the
    // codex tab data extractor on every render.
    const deferredMessages = React.useDeferredValue(messages);
    const session = useSession(sessionId);
    const metadata = session?.metadata ?? null;

    const data = React.useMemo(() => {
      const toolCalls = collectToolCalls(deferredMessages);
      const codexData = extractCodexCodeTabData(toolCalls, metadata);
      if (codexData.fileChanges.length > 0) {
        return codexData;
      }

      return {
        ...codexData,
        fileChanges: extractFileChanges(toolCalls, metadata),
      };
    }, [deferredMessages, metadata]);

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

    // Expansion hoisted out of CodexFileChangeCard. Seeds the first file as
    // expanded once on the first non-empty render — preserving the legacy
    // `initiallyExpanded={index === 0}` UX without re-expanding it every
    // time the sorted file list shuffles during streaming.
    const [expandedKeys, setExpandedKeys] = React.useState<ReadonlySet<string>>(
      () => new Set<string>(),
    );
    const seededRef = React.useRef(false);
    if (!seededRef.current && fileChanges.length > 0) {
      seededRef.current = true;
      setExpandedKeys(new Set([fileChanges[0].filePath]));
    }
    const handleToggle = React.useCallback((filePath: string) => {
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(filePath)) next.delete(filePath);
        else next.add(filePath);
        return next;
      });
    }, []);

    const renderItem = React.useCallback<ListRenderItem<FileChange>>(
      ({ item }) => (
        <CodexFileChangeCard
          change={item}
          expanded={expandedKeys.has(item.filePath)}
          onToggle={handleToggle}
        />
      ),
      [expandedKeys, handleToggle],
    );

    const flatListContentStyle = React.useMemo(
      () => ({
        padding: theme.codex.spacing.panelPadding,
        gap: theme.codex.spacing.cardGap,
      }),
      [theme.codex.spacing.panelPadding, theme.codex.spacing.cardGap],
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
          <FlatList
            style={styles.scrollView}
            contentContainerStyle={flatListContentStyle}
            data={fileChanges}
            renderItem={renderItem}
            keyExtractor={codexKeyExtractor}
            // Same virtualization tuning as LegacyCodeChangesView; codex
            // cards each carry a CodexUnifiedDiffView which is expensive
            // to keep mounted off-screen.
            removeClippedSubviews
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={5}
          />
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create((_, rt) => ({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
  },
}));
