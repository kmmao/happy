import * as React from "react";
import {
  FlatList,
  Pressable,
  View,
  type ListRenderItem,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { DiffStatsBar } from "@/components/diff/DiffStatsBar";
import { getLanguageForPath } from "@/components/diff/fileLanguage";
import { CodexCodeTab } from "@/components/session/codex/CodexCodeTab";
import { Text } from "@/components/StyledText";
import { ToolDiffView } from "@/components/tools/ToolDiffView";
import { getFileChangeEditKey } from "@/components/tools/fileChangeEditKey";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { useSession, useSessionMessages } from "@/sync/storage";
import {
  collectToolCalls,
  extractFileChanges,
  type FileChange,
} from "./sidePanelCodeData";

interface LegacyFileChangeItemProps {
  change: FileChange;
  // Optional controlled-mode pair. When `expanded` is provided the row stops
  // managing its own state — used by LegacyCodeChangesView so that FlatList
  // virtualization can unmount/remount a row without losing the expansion.
  // Independent callers (SessionProgressPanel/CodexPlanSection equivalent)
  // pass nothing and the row falls back to its original useState behavior.
  expanded?: boolean;
  onToggle?: (filePath: string) => void;
}

const LegacyFileChangeItem = React.memo(function LegacyFileChangeItem({
  change,
  expanded: expandedProp,
  onToggle,
}: LegacyFileChangeItemProps) {
  const { theme } = useUnistyles();
  const isControlled = expandedProp !== undefined;
  const [internalExpanded, setInternalExpanded] = React.useState(false);
  const expanded = isControlled ? expandedProp : internalExpanded;
  const handlePress = React.useCallback(() => {
    if (isControlled) {
      onToggle?.(change.filePath);
    } else {
      setInternalExpanded((value) => !value);
    }
  }, [isControlled, onToggle, change.filePath]);
  const language = getLanguageForPath(change.filePath);

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: theme.colors.divider }}>
      <Pressable
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 6,
          opacity: pressed ? 0.6 : 1,
        })}
        onPress={handlePress}
      >
        <Ionicons
          name={expanded ? "chevron-down" : "chevron-forward"}
          size={12}
          color={theme.colors.textSecondary}
        />
        <Text
          style={{
            flex: 1,
            fontSize: 12,
            color: theme.colors.text,
            ...Typography.mono(),
          }}
          numberOfLines={1}
          ellipsizeMode="middle"
        >
          {change.displayPath}
        </Text>
        {change.edits.length > 1 ? (
          <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>
            {t("changes.editCount", { count: change.edits.length })}
          </Text>
        ) : null}
        <DiffStatsBar
          additions={change.totalAdditions}
          deletions={change.totalDeletions}
        />
      </Pressable>
      {expanded ? (
        <View style={{ paddingHorizontal: 6, paddingBottom: 6 }}>
          {change.edits.map((edit) => (
            <View key={getFileChangeEditKey(edit)} style={{ marginBottom: 6 }}>
              <ToolDiffView
                oldText={edit.oldText}
                newText={edit.newText}
                collapsible={false}
                language={language}
                visibleLineCount={5}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
});

export const FileChangeItem = LegacyFileChangeItem;

const legacyKeyExtractor = (item: FileChange) => item.filePath;

const LegacyCodeChangesView = React.memo(function LegacyCodeChangesView({
  sessionId,
}: {
  sessionId: string;
}) {
  const { theme } = useUnistyles();
  const { messages } = useSessionMessages(sessionId);
  const session = useSession(sessionId);
  const metadata = session?.metadata ?? null;

  // During streaming, the messages array reference is replaced on every
  // chunk. collectToolCalls + extractFileChanges is O(messages × tool calls),
  // and the resulting file list scrolls the whole side panel. Defer the
  // expensive derivation so React only catches up to the latest messages
  // when the main thread is idle — mid-stream frames are dropped, and the
  // final state always lands. This keeps streaming responsive without
  // sacrificing eventual accuracy.
  const deferredMessages = React.useDeferredValue(messages);
  const fileChanges = React.useMemo(() => {
    const toolCalls = collectToolCalls(deferredMessages);
    return extractFileChanges(toolCalls, metadata);
  }, [deferredMessages, metadata]);

  const totalFiles = fileChanges.length;
  const totalAdditions = fileChanges.reduce(
    (sum, fileChange) => sum + fileChange.totalAdditions,
    0,
  );
  const totalDeletions = fileChanges.reduce(
    (sum, fileChange) => sum + fileChange.totalDeletions,
    0,
  );

  // Expansion is hoisted out of the row so FlatList virtualization can
  // unmount/remount a row (when it leaves the window and returns) without
  // losing the user's expanded view of its diff.
  const [expandedKeys, setExpandedKeys] = React.useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
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
      <LegacyFileChangeItem
        change={item}
        expanded={expandedKeys.has(item.filePath)}
        onToggle={handleToggle}
      />
    ),
    [expandedKeys, handleToggle],
  );

  const SummaryHeader = React.useMemo(
    () => (
      <View
        style={[
          styles.legacySummaryBar,
          { borderBottomColor: theme.colors.divider },
        ]}
      >
        <Text
          style={[
            styles.legacySummaryText,
            { color: theme.colors.text, ...Typography.default("semiBold") },
          ]}
        >
          {t("changes.summary", { files: totalFiles })}
        </Text>
        {totalFiles > 0 ? (
          <DiffStatsBar additions={totalAdditions} deletions={totalDeletions} />
        ) : null}
      </View>
    ),
    [
      theme.colors.divider,
      theme.colors.text,
      totalFiles,
      totalAdditions,
      totalDeletions,
    ],
  );

  const EmptyView = React.useMemo(
    () => (
      <View style={styles.emptyContainer}>
        <Ionicons
          name="document-text-outline"
          size={40}
          color={theme.colors.textSecondary}
        />
        <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>
          {t("changes.noChanges")}
        </Text>
      </View>
    ),
    [theme.colors.textSecondary],
  );

  return (
    <FlatList
      style={[styles.legacyContainer, { backgroundColor: theme.colors.surface }]}
      contentContainerStyle={styles.legacyContentContainer}
      data={fileChanges}
      renderItem={renderItem}
      keyExtractor={legacyKeyExtractor}
      ListHeaderComponent={SummaryHeader}
      ListEmptyComponent={EmptyView}
      // Virtualize so off-screen rows release their ToolDiffView trees;
      // critical for long sessions with 100+ changed files.
      removeClippedSubviews
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      windowSize={5}
    />
  );
});

interface SessionCodeChangesViewProps {
  sessionId: string;
}

export const SessionCodeChangesView = React.memo<SessionCodeChangesViewProps>(
  function SessionCodeChangesView({ sessionId }) {
    const session = useSession(sessionId);
    const flavor = session?.metadata?.flavor?.toLowerCase();

    if (flavor === "codex") {
      return <CodexCodeTab sessionId={sessionId} />;
    }

    return <LegacyCodeChangesView sessionId={sessionId} />;
  },
);

const styles = StyleSheet.create((_, rt) => ({
  legacyContainer: {
    flex: 1,
  },
  // contentContainerStyle for the FlatList. flexGrow lets ListEmptyComponent
  // fill the visible area so the "no changes" view stays vertically centered.
  legacyContentContainer: {
    flexGrow: 1,
  },
  legacySummaryBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  legacySummaryText: {
    fontSize: 13,
    fontWeight: "600",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
}));
