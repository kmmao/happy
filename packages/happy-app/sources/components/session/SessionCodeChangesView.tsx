import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
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

const LegacyFileChangeItem = React.memo(function LegacyFileChangeItem({
  change,
}: {
  change: FileChange;
}) {
  const { theme } = useUnistyles();
  const [expanded, setExpanded] = React.useState(false);
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
        onPress={() => setExpanded((value) => !value)}
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

const LegacyCodeChangesView = React.memo(function LegacyCodeChangesView({
  sessionId,
}: {
  sessionId: string;
}) {
  const { theme } = useUnistyles();
  const { messages } = useSessionMessages(sessionId);
  const session = useSession(sessionId);
  const metadata = session?.metadata ?? null;

  const fileChanges = React.useMemo(() => {
    const toolCalls = collectToolCalls(messages);
    return extractFileChanges(toolCalls, metadata);
  }, [messages, metadata]);

  const totalFiles = fileChanges.length;
  const totalAdditions = fileChanges.reduce(
    (sum, fileChange) => sum + fileChange.totalAdditions,
    0,
  );
  const totalDeletions = fileChanges.reduce(
    (sum, fileChange) => sum + fileChange.totalDeletions,
    0,
  );

  return (
    <View style={[styles.legacyContainer, { backgroundColor: theme.colors.surface }]}>
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
      {totalFiles === 0 ? (
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
      ) : (
        <ScrollView style={styles.scrollView}>
          {fileChanges.map((change) => (
            <LegacyFileChangeItem key={change.filePath} change={change} />
          ))}
        </ScrollView>
      )}
    </View>
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
  scrollView: {
    flex: 1,
  },
}));
