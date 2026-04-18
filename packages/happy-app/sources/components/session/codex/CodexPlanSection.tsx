import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { CodexDiffStats } from "@/components/session/codex/CodexDiffStats";
import { CodexFileChangeCard } from "@/components/session/codex/CodexFileChangeCard";
import {
  type CodexPlanData,
  getCodexPlanSourceLabelKey,
} from "@/components/session/codex/codexProgressPresentation";
import { type FileChange } from "@/components/session/codeChangeTypes";
import {
  type ChecklistTab,
  countTodoProgress,
  type ProgressTodo,
} from "@/components/session/sessionProgressData";
import { Text } from "@/components/StyledText";
import { t } from "@/text";

interface CodexPlanSectionProps {
  plan: CodexPlanData;
  onRefresh: () => void;
  onTodoTap: (todo: ProgressTodo) => void;
  nowMs: number;
  listFileChanges: readonly FileChange[];
  listFileTotalAdditions: number;
  listFileTotalDeletions: number;
  tabs: readonly ChecklistTab[];
  selectedListId: string | null;
  onSelectList: (id: string) => void;
}

function formatRelativeTime(updatedAt: number | null, nowMs: number): string {
  if (updatedAt === null) {
    return "";
  }
  const deltaSec = Math.max(0, Math.floor((nowMs - updatedAt) / 1000));
  if (deltaSec < 60) return t("session.progressTimeJustNow");
  if (deltaSec < 3600) return t("session.progressTimeMinutes", { n: Math.floor(deltaSec / 60) });
  if (deltaSec < 86400) return t("session.progressTimeHours", { n: Math.floor(deltaSec / 3600) });
  return t("session.progressTimeDays", { n: Math.floor(deltaSec / 86400) });
}

function getTodoMeta(
  theme: ReturnType<typeof useUnistyles>["theme"],
  status: ProgressTodo["status"],
): { icon: keyof typeof Ionicons.glyphMap; color: string } {
  if (status === "completed") {
    return {
      icon: "checkmark-circle",
      color: theme.colors.codex.status.completed,
    };
  }
  if (status === "in_progress") {
    return {
      icon: "ellipse",
      color: theme.colors.codex.status.inProgress,
    };
  }
  return {
    icon: "square-outline",
    color: theme.colors.codex.status.pending,
  };
}

export const CodexPlanSection = React.memo<CodexPlanSectionProps>(
  function CodexPlanSection({
    plan,
    onRefresh,
    onTodoTap,
    nowMs,
    listFileChanges,
    listFileTotalAdditions,
    listFileTotalDeletions,
    tabs,
    selectedListId,
    onSelectList,
  }) {
    const { theme } = useUnistyles();
    const counts = React.useMemo(() => countTodoProgress(plan.todos), [plan.todos]);
    const focusLabel = React.useMemo(() => {
      if (!plan.currentStage) {
        return null;
      }
      return `${t("session.progressSummaryCurrentFocus")} · ${plan.currentStage}`;
    }, [plan.currentStage]);
    const selectedTab = React.useMemo(
      () =>
        tabs.find((tab) => tab.id === (selectedListId ?? plan.listId)) ??
        tabs.find((tab) => tab.active) ??
        null,
      [tabs, selectedListId, plan.listId],
    );
    const explanation = React.useMemo(() => {
      if (!plan.explanation) {
        return null;
      }
      const trimmed = plan.explanation.trim();
      if (!trimmed) {
        return null;
      }
      return trimmed === plan.currentStage?.trim() ? null : trimmed;
    }, [plan.explanation, plan.currentStage]);

    return (
      <View
        style={[
          styles.container,
          {
            borderColor: theme.colors.codex.planBorder,
            backgroundColor: theme.colors.codex.planBg,
            borderRadius: theme.codex.radius.section,
          },
        ]}
      >
        <View
          style={[
            styles.headerBlock,
            {
              paddingHorizontal: theme.codex.spacing.cardPadding + 2,
              paddingTop: theme.codex.spacing.cardPadding,
              paddingBottom: theme.codex.spacing.cardPadding - 2,
              gap: theme.codex.spacing.sectionGap - 2,
            },
          ]}
        >
          <View
            style={[
              styles.header,
              {
                gap: theme.codex.spacing.sectionGap,
              },
            ]}
          >
            <View style={styles.headerLeft}>
              <View
                style={[
                  styles.iconWrap,
                  {
                    borderColor: theme.colors.codex.chipBorder,
                    backgroundColor: theme.colors.codex.chipBg,
                    borderRadius: theme.codex.radius.card,
                  },
                ]}
              >
                <Ionicons
                  name="list-outline"
                  size={16}
                  color={theme.colors.codex.accent}
                />
              </View>
              <View style={styles.headerText}>
                <Text style={[styles.title, { color: theme.colors.codex.textPrimary }]}>
                  {t("session.progressTodosSection")}
                </Text>
                {plan.updatedAt !== null ? (
                  <Text
                    style={[
                      styles.timeHint,
                      { color: theme.colors.codex.textSecondary },
                    ]}
                  >
                    {formatRelativeTime(plan.updatedAt, nowMs)}
                  </Text>
                ) : null}
              </View>
            </View>

            <Pressable
              onPress={onRefresh}
              hitSlop={8}
              style={[
                styles.refreshButton,
                {
                  borderColor: theme.colors.codex.borderActive,
                  backgroundColor: theme.colors.codex.accentSoft,
                  borderRadius: theme.codex.radius.chip,
                  paddingHorizontal: theme.codex.spacing.chipX,
                  paddingVertical: theme.codex.spacing.chipY + 2,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t("session.progressRefreshActionLabel")}
            >
              <Ionicons
                name="refresh-outline"
                size={12}
                color={theme.colors.codex.accent}
              />
              <Text
                style={[styles.refreshText, { color: theme.colors.codex.accent }]}
              >
                {t("session.progressRefreshActionLabel")}
              </Text>
            </Pressable>
          </View>

          {tabs.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabsRow}
            >
              {tabs.map((tab) => {
                const isSelected = tab.id === selectedTab?.id;
                const isActive = tab.active;
                const color = isSelected
                  ? theme.colors.codex.accent
                  : isActive
                    ? theme.colors.codex.textPrimary
                    : theme.colors.codex.textSecondary;
                const backgroundColor = isSelected
                  ? theme.colors.codex.accentSoft
                  : isActive
                    ? theme.colors.codex.sectionBgElevated
                    : theme.colors.codex.chipBg;
                const borderColor = isSelected
                  ? theme.colors.codex.borderActive
                  : isActive
                    ? theme.colors.codex.borderSoft
                    : theme.colors.codex.chipBorder;

                return (
                  <Pressable
                    key={tab.id}
                    onPress={() => onSelectList(tab.id)}
                    style={[
                      styles.tabChip,
                      {
                        backgroundColor,
                        borderColor,
                        borderRadius: theme.codex.radius.chip,
                        paddingHorizontal: theme.codex.spacing.chipX,
                        paddingVertical: theme.codex.spacing.chipY + 1,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text
                      style={[styles.tabChipText, { color }]}
                      numberOfLines={1}
                    >
                      {tab.label}
                    </Text>
                    <Text style={[styles.tabChipCount, { color }]}>
                      {`${tab.completed}/${tab.total}`}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
        </View>

        {plan.todos.length > 0 ? (
          <View
            style={[
              styles.body,
              {
                paddingHorizontal: theme.codex.spacing.cardPadding + 2,
                paddingBottom: theme.codex.spacing.cardPadding + 2,
                gap: theme.codex.spacing.sectionGap,
              },
            ]}
          >
            <View style={styles.metaRow}>
              <View
                style={[
                  styles.sourceChip,
                  {
                    borderColor: theme.colors.codex.chipBorder,
                    backgroundColor: theme.colors.codex.chipBg,
                    borderRadius: theme.codex.radius.chip,
                    paddingHorizontal: theme.codex.spacing.chipX,
                    paddingVertical: theme.codex.spacing.chipY,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.sourceChipText,
                    { color: theme.colors.codex.chipText },
                  ]}
                >
                  {t(getCodexPlanSourceLabelKey(plan.source))}
                </Text>
              </View>
              <View
                style={[
                  styles.countChip,
                  {
                    borderColor: theme.colors.codex.borderSoft,
                    backgroundColor: theme.colors.codex.sectionBgElevated,
                    borderRadius: theme.codex.radius.chip,
                    paddingHorizontal: theme.codex.spacing.chipX,
                    paddingVertical: theme.codex.spacing.chipY,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.countChipText,
                    { color: theme.colors.codex.textSecondary },
                  ]}
                >
                  {t("session.progressTodosCount", {
                    done: counts.completed,
                    total: counts.total,
                  })}
                </Text>
              </View>
              {focusLabel ? (
                <View
                  style={[
                    styles.focusChip,
                    {
                      borderColor: theme.colors.codex.borderSoft,
                      backgroundColor: theme.colors.codex.sectionBgElevated,
                      borderRadius: theme.codex.radius.chip,
                      paddingHorizontal: theme.codex.spacing.chipX,
                      paddingVertical: theme.codex.spacing.chipY,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.focusChipText,
                      { color: theme.colors.codex.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {focusLabel}
                  </Text>
                </View>
              ) : null}
              {tabs.length > 1 && selectedTab ? (
                <View
                  style={[
                    styles.selectedListChip,
                    {
                      borderColor: theme.colors.codex.borderSoft,
                      backgroundColor: theme.colors.codex.sectionBgElevated,
                      borderRadius: theme.codex.radius.chip,
                      paddingHorizontal: theme.codex.spacing.chipX,
                      paddingVertical: theme.codex.spacing.chipY,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.selectedListChipText,
                      {
                        color: selectedTab.active
                          ? theme.colors.codex.textPrimary
                          : theme.colors.codex.textSecondary,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {selectedTab.label}
                  </Text>
                </View>
              ) : null}
            </View>

            {explanation ? (
              <View
                style={[
                  styles.explanationCard,
                  {
                    borderColor: theme.colors.codex.borderSoft,
                    backgroundColor: theme.colors.codex.sectionBgElevated,
                    borderRadius: theme.codex.radius.card + 2,
                    paddingHorizontal: theme.codex.spacing.cardPadding,
                    paddingVertical: theme.codex.spacing.cardPadding - 2,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.explanationText,
                    { color: theme.colors.codex.textSecondary },
                  ]}
                >
                  {explanation}
                </Text>
              </View>
            ) : null}

            <View
              style={[
                styles.progressTrack,
                { backgroundColor: theme.colors.codex.borderSoft },
              ]}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: theme.colors.codex.accent,
                    width: `${Math.round(counts.completionRatio * 100)}%`,
                  },
                ]}
              />
            </View>

            <View style={styles.todoList}>
              {plan.todos.map((todo, index) => {
                const meta = getTodoMeta(theme, todo.status);
                const displayContent =
                  todo.status === "in_progress" && todo.activeForm
                    ? todo.activeForm
                    : todo.content;
                return (
                  <Pressable
                    key={`${index}-${todo.content}`}
                    onPress={() => onTodoTap(todo)}
                    style={[
                      styles.todoRow,
                      {
                        borderColor: theme.colors.codex.borderSoft,
                        backgroundColor: theme.colors.codex.sectionBgElevated,
                        borderRadius: theme.codex.radius.card + 2,
                        paddingHorizontal: theme.codex.spacing.cardPadding,
                        paddingVertical: theme.codex.spacing.cardPadding - 2,
                        gap: theme.codex.spacing.cardGap,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={todo.content}
                  >
                    <Ionicons
                      name={meta.icon}
                      size={16}
                      color={meta.color}
                    />
                    <Text
                      style={[styles.todoText, { color: theme.colors.codex.textPrimary }]}
                    >
                      {displayContent}
                    </Text>
                    <Ionicons
                      name="ellipsis-horizontal"
                      size={14}
                      color={theme.colors.codex.textMuted}
                    />
                  </Pressable>
                );
              })}
            </View>

            {plan.blockers?.length ? (
              <View
                style={[
                  styles.blockersCard,
                  {
                    borderColor: theme.colors.codex.status.blocked,
                    backgroundColor: theme.colors.codex.sectionBgElevated,
                    borderRadius: theme.codex.radius.card + 2,
                    padding: theme.codex.spacing.cardPadding,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.blockersTitle,
                    { color: theme.colors.codex.status.blocked },
                  ]}
                >
                  {t("session.progressBlockersTitle", { n: plan.blockers.length })}
                </Text>
                {plan.blockers.map((blocker, index) => (
                  <Text
                    key={`${index}-${blocker}`}
                    style={[
                      styles.blockerItem,
                      { color: theme.colors.codex.textPrimary },
                    ]}
                  >
                    {`• ${blocker}`}
                  </Text>
                ))}
              </View>
            ) : null}

            {listFileChanges.length > 0 ? (
              <View
                style={[
                  styles.filesBlock,
                  { gap: theme.codex.spacing.cardGap },
                ]}
              >
                <View style={styles.filesHeader}>
                  <Text style={[styles.filesTitle, { color: theme.colors.codex.textPrimary }]}>
                    {t("session.progressListFilesTitle", {
                      n: listFileChanges.length,
                    })}
                  </Text>
                  <CodexDiffStats
                    additions={listFileTotalAdditions}
                    deletions={listFileTotalDeletions}
                  />
                </View>
                <View
                  style={[
                    styles.filesList,
                    { gap: theme.codex.spacing.cardGap - 2 },
                  ]}
                >
                  {listFileChanges.map((change) => (
                    <CodexFileChangeCard
                      key={change.filePath}
                      change={change}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : (
          <Text
            style={[styles.emptyText, { color: theme.colors.codex.textSecondary }]}
          >
            {t("session.progressTodosEmpty")}
          </Text>
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create(() => ({
  container: {
    borderWidth: 1,
    overflow: "hidden",
  },
  headerBlock: {
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
  },
  timeHint: {
    marginTop: 2,
    fontSize: 11,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
  },
  refreshText: {
    fontSize: 11,
    fontWeight: "600",
  },
  tabsRow: {
    gap: 8,
    paddingBottom: 2,
  },
  tabChip: {
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tabChipText: {
    fontSize: 11,
    fontWeight: "600",
    maxWidth: 120,
  },
  tabChipCount: {
    fontSize: 11,
    fontWeight: "700",
  },
  body: {
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  sourceChip: {
    borderWidth: 1,
  },
  sourceChipText: {
    fontSize: 11,
    fontWeight: "600",
  },
  countChip: {
    borderWidth: 1,
  },
  countChipText: {
    fontSize: 11,
    fontWeight: "600",
  },
  focusChip: {
    borderWidth: 1,
  },
  focusChipText: {
    fontSize: 11,
    fontWeight: "600",
  },
  selectedListChip: {
    borderWidth: 1,
  },
  selectedListChipText: {
    fontSize: 11,
    fontWeight: "600",
    maxWidth: 120,
  },
  explanationCard: {
    borderWidth: 1,
  },
  explanationText: {
    fontSize: 12,
    lineHeight: 18,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },
  todoList: {
    gap: 8,
  },
  todoRow: {
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  todoText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  blockersCard: {
    borderWidth: 1,
    gap: 6,
  },
  blockersTitle: {
    fontSize: 12,
    fontWeight: "700",
  },
  blockerItem: {
    fontSize: 12,
    lineHeight: 18,
  },
  filesBlock: {
  },
  filesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  filesTitle: {
    fontSize: 12,
    fontWeight: "700",
  },
  filesList: {
  },
  emptyText: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    fontSize: 13,
    lineHeight: 18,
  },
}));
