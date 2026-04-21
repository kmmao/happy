import * as React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { ToolSectionView } from "../../tools/ToolSectionView";
import { t } from "@/text";
import { type ToolViewProps } from "./_all";
import {
  collapseProgressTodos,
  countHappyProgressTokens,
  shouldCollapseProgressExplanation,
  summarizeHappyProgressInput,
  type HappyProgressTodo,
} from "./happyProgressViewData";

function formatDurationMs(startMs: number, endMs: number | null): string | null {
  if (!endMs || endMs < startMs) {
    return null;
  }
  const diffMs = endMs - startMs;
  if (diffMs < 1000) {
    return `${Math.round(diffMs)}ms`;
  }
  const seconds = diffMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function formatClockTime(timestamp: number | null): string | null {
  if (!timestamp) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

function formatTokenCount(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}k`;
  }
  return String(count);
}

function getTodoTone(
  theme: ReturnType<typeof useUnistyles>["theme"],
  status: HappyProgressTodo["status"],
): {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  railColor: string;
  surfaceColor: string;
  borderColor: string;
  textColor: string;
  subtitleColor: string;
  contentStyle?: object;
} {
  if (status === "completed") {
    return {
      icon: "checkmark-circle",
      iconColor: theme.colors.success,
      railColor: theme.colors.success + "30",
      surfaceColor: theme.colors.success + "0d",
      borderColor: theme.colors.success + "18",
      textColor: theme.colors.text,
      subtitleColor: theme.colors.success,
      contentStyle: { textDecorationLine: "line-through" as const, opacity: 0.78 },
    };
  }

  if (status === "in_progress") {
    return {
      icon: "ellipse",
      iconColor: theme.colors.accentBlue,
      railColor: theme.colors.accentBlue + "30",
      surfaceColor: theme.colors.accentBlue + "0d",
      borderColor: theme.colors.accentBlue + "18",
      textColor: theme.colors.text,
      subtitleColor: theme.colors.accentBlue,
    };
  }

  return {
    icon: "square-outline",
    iconColor: theme.colors.textSecondary,
    railColor: theme.colors.textSecondary + "28",
    surfaceColor: theme.colors.surfaceHigh,
    borderColor: theme.colors.divider,
    textColor: theme.colors.text,
    subtitleColor: theme.colors.textSecondary,
  };
}

function MetricBadge(props: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  tone: {
    backgroundColor: string;
    borderColor: string;
    color: string;
  };
}) {
  return (
    <View
      style={[
        styles.metricBadge,
        {
          backgroundColor: props.tone.backgroundColor,
          borderColor: props.tone.borderColor,
        },
      ]}
    >
      <Ionicons name={props.icon} size={11} color={props.tone.color} />
      <Text style={[styles.metricBadgeText, { color: props.tone.color }]}>
        {props.text}
      </Text>
    </View>
  );
}

export const HappyUpdateProgressView = React.memo<ToolViewProps>(
  function HappyUpdateProgressView({ tool, messages }) {
    const { theme } = useUnistyles();
    const summary = React.useMemo(
      () => summarizeHappyProgressInput(tool.input),
      [tool.input],
    );
    const tokenCount = React.useMemo(
      () => countHappyProgressTokens(messages),
      [messages],
    );
    const [todosExpanded, setTodosExpanded] = React.useState(false);
    const completedAt = tool.completedAt ?? tool.startedAt ?? tool.createdAt;
    const updatedTime = formatClockTime(completedAt);
    const durationLabel = formatDurationMs(tool.createdAt, tool.completedAt);
    const focusLabel =
      summary.currentStage ??
      summary.label ??
      (summary.counts.total > 0
        ? t("tools.fullView.simple.updateTodos", { count: summary.counts.total })
        : null);
    const explanation =
      summary.explanation &&
      summary.explanation !== summary.currentStage &&
      summary.explanation !== summary.label
        ? summary.explanation
        : null;
    const focusDetail =
      summary.currentStage &&
      summary.label &&
      summary.label !== summary.currentStage
        ? summary.label
        : null;
    const explanationCanCollapse = shouldCollapseProgressExplanation(explanation);
    const [explanationExpanded, setExplanationExpanded] = React.useState(false);
    React.useEffect(() => {
      setExplanationExpanded(false);
    }, [explanation]);
    React.useEffect(() => {
      setTodosExpanded(false);
    }, [summary.todos]);
    const heroTitle =
      focusLabel ??
      (summary.counts.total > 0
        ? t("tools.fullView.simple.updateTodos", { count: summary.counts.total })
        : null);
    const collapsedTodos = React.useMemo(
      () => collapseProgressTodos(summary.todos, 4),
      [summary.todos],
    );
    const visibleTodos = todosExpanded
      ? summary.todos
      : collapsedTodos.visibleTodos;

    if (
      summary.counts.total === 0 &&
      summary.blockers.length === 0 &&
      !heroTitle &&
      !explanation &&
      tokenCount <= 0
    ) {
      return null;
    }

    return (
      <ToolSectionView>
        <View
          style={[
            styles.container,
            {
              borderColor: theme.colors.divider,
              backgroundColor: theme.colors.surfaceHigh,
            },
          ]}
        >
          {heroTitle || explanation ? (
            <View
              style={[
                styles.heroCard,
                {
                  borderColor: explanation
                    ? theme.colors.accentBlue + "20"
                    : theme.colors.divider,
                  backgroundColor: explanation
                    ? theme.colors.accentBlue + "08"
                    : theme.colors.surface,
                },
              ]}
            >
              <View style={styles.heroHeaderRow}>
                <Ionicons
                  name="sparkles-outline"
                  size={13}
                  color={theme.colors.accentBlue}
                />
                <Text
                  style={[styles.heroEyebrow, { color: theme.colors.accentBlue }]}
                >
                  {summary.currentStage
                    ? t("session.progressSummaryCurrentFocus")
                    : t("session.progressTodosSection")}
                </Text>
              </View>
              {heroTitle ? (
                <Text
                  style={[styles.heroTitle, { color: theme.colors.text }]}
                  numberOfLines={focusDetail || explanation ? 3 : 2}
                >
                  {summary.currentStage ? summary.currentStage : heroTitle}
                </Text>
              ) : null}
              {focusDetail ? (
                <Text
                  style={[
                    styles.heroDetail,
                    { color: theme.colors.textSecondary },
                  ]}
                  numberOfLines={2}
                >
                  {focusDetail}
                </Text>
              ) : null}
              {explanation ? (
                <View style={styles.heroExplanationWrap}>
                  <Text
                    style={[
                      styles.heroExplanation,
                      { color: theme.colors.textSecondary },
                    ]}
                    numberOfLines={
                      explanationCanCollapse && !explanationExpanded ? 3 : undefined
                    }
                  >
                    {explanation}
                  </Text>
                  {explanationCanCollapse ? (
                    <Pressable
                      onPress={() => setExplanationExpanded((value) => !value)}
                      hitSlop={8}
                      style={styles.explanationToggle}
                    >
                      <Text
                        style={[
                          styles.explanationToggleText,
                          { color: theme.colors.accentBlue },
                        ]}
                      >
                        {explanationExpanded ? t("sidePanel.collapse") : t("sidePanel.expand")}
                      </Text>
                      <Ionicons
                        name={explanationExpanded ? "chevron-up" : "chevron-down"}
                        size={12}
                        color={theme.colors.accentBlue}
                      />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.metricsRow}>
            {summary.counts.completed > 0 ? (
              <MetricBadge
                icon="checkmark-circle"
                text={t("session.progressLegendCompleted", {
                  n: summary.counts.completed,
                })}
                tone={{
                  backgroundColor: theme.colors.success + "12",
                  borderColor: theme.colors.success + "20",
                  color: theme.colors.success,
                }}
              />
            ) : null}
            {summary.counts.inProgress > 0 ? (
              <MetricBadge
                icon="ellipse"
                text={t("session.progressLegendInProgress", {
                  n: summary.counts.inProgress,
                })}
                tone={{
                  backgroundColor: theme.colors.accentBlue + "12",
                  borderColor: theme.colors.accentBlue + "20",
                  color: theme.colors.accentBlue,
                }}
              />
            ) : null}
            {summary.counts.pending > 0 ? (
              <MetricBadge
                icon="square-outline"
                text={t("session.progressLegendPending", {
                  n: summary.counts.pending,
                })}
                tone={{
                  backgroundColor: theme.colors.textSecondary + "10",
                  borderColor: theme.colors.textSecondary + "18",
                  color: theme.colors.textSecondary,
                }}
              />
            ) : null}
            {updatedTime ? (
              <MetricBadge
                icon="time-outline"
                text={updatedTime}
                tone={{
                  backgroundColor: theme.colors.accentPurple + "10",
                  borderColor: theme.colors.accentPurple + "18",
                  color: theme.colors.accentPurple,
                }}
              />
            ) : null}
            {durationLabel ? (
              <MetricBadge
                icon="flash-outline"
                text={durationLabel}
                tone={{
                  backgroundColor: theme.colors.accentOrange + "10",
                  borderColor: theme.colors.accentOrange + "18",
                  color: theme.colors.accentOrange,
                }}
              />
            ) : null}
            {tokenCount > 0 ? (
              <MetricBadge
                icon="layers-outline"
                text={formatTokenCount(tokenCount)}
                tone={{
                  backgroundColor: theme.colors.accentTeal + "10",
                  borderColor: theme.colors.accentTeal + "18",
                  color: theme.colors.accentTeal,
                }}
              />
            ) : null}
          </View>

          {summary.todos.length > 0 ? (
            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionTitleWrap}>
                  <Ionicons
                    name="list-outline"
                    size={13}
                    color={theme.colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.sectionTitle,
                      { color: theme.colors.textSecondary },
                    ]}
                  >
                    {t("session.progressTodosSection")}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.sectionMeta,
                    { color: theme.colors.textSecondary },
                  ]}
                >
                  {summary.counts.total}
                </Text>
              </View>
              <View style={styles.timelineList}>
              {visibleTodos.map((todo, index) => {
                const tone = getTodoTone(theme, todo.status);
                const subtitle =
                  todo.status === "in_progress"
                    ? todo.activeForm ?? todo.stage ?? null
                    : todo.stage ?? null;
                return (
                  <View key={`${todo.content}-${index}`} style={styles.timelineRow}>
                    <View style={styles.railColumn}>
                      <Ionicons
                        name={tone.icon}
                        size={15}
                        color={tone.iconColor}
                        style={styles.railIcon}
                      />
                      {index < visibleTodos.length - 1 ? (
                        <View
                          style={[
                            styles.railLine,
                            { backgroundColor: tone.railColor },
                          ]}
                        />
                      ) : null}
                    </View>
                    <View
                      style={[
                        styles.todoCard,
                        {
                          backgroundColor: tone.surfaceColor,
                          borderColor: tone.borderColor,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.todoContent,
                          { color: tone.textColor },
                          tone.contentStyle,
                        ]}
                      >
                        {todo.content}
                      </Text>
                      {subtitle ? (
                        <Text
                          style={[
                            styles.todoSubtitle,
                            { color: tone.subtitleColor },
                          ]}
                          numberOfLines={2}
                        >
                          {subtitle}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
              </View>
              {collapsedTodos.didCollapse ? (
                <Pressable
                  onPress={() => setTodosExpanded((value) => !value)}
                  hitSlop={8}
                  style={styles.todosToggle}
                >
                  <Text
                    style={[
                      styles.todosToggleText,
                      { color: theme.colors.accentBlue },
                    ]}
                  >
                    {todosExpanded
                      ? t("sidePanel.collapse")
                      : t("session.progressShowAll", {
                          n: collapsedTodos.hiddenCount,
                        })}
                  </Text>
                  <Ionicons
                    name={todosExpanded ? "chevron-up" : "chevron-down"}
                    size={12}
                    color={theme.colors.accentBlue}
                  />
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {summary.blockers.length > 0 ? (
            <View
              style={[
                styles.blockersCard,
                {
                  borderColor: theme.colors.textDestructive + "20",
                  backgroundColor: theme.colors.textDestructive + "0d",
                },
              ]}
            >
              <View style={styles.blockersHeader}>
                <Ionicons
                  name="alert-circle-outline"
                  size={13}
                  color={theme.colors.textDestructive}
                />
                <Text
                  style={[
                    styles.blockersTitle,
                    { color: theme.colors.textDestructive },
                  ]}
                >
                  {t("session.progressBlockersTitle", {
                    n: summary.blockers.length,
                  })}
                </Text>
              </View>
              <View style={styles.blockersList}>
                {summary.blockers.map((blocker, index) => (
                  <View key={`${blocker}-${index}`} style={styles.blockerRow}>
                    <View
                      style={[
                        styles.blockerDot,
                        { backgroundColor: theme.colors.textDestructive },
                      ]}
                    />
                    <Text style={[styles.blockerText, { color: theme.colors.text }]}>
                      {blocker}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </ToolSectionView>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  container: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    gap: 12,
  },
  heroCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 6,
  },
  heroHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  heroTitle: {
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 18,
  },
  heroDetail: {
    fontSize: 12,
    lineHeight: 17,
  },
  heroExplanation: {
    fontSize: 13,
    lineHeight: 19,
  },
  heroExplanationWrap: {
    gap: 6,
  },
  explanationToggle: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  explanationToggleText: {
    fontSize: 12,
    fontWeight: "600",
  },
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  sectionBlock: {
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  sectionMeta: {
    fontSize: 12,
    fontWeight: "600",
  },
  todosToggle: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
    marginLeft: 28,
  },
  todosToggleText: {
    fontSize: 12,
    fontWeight: "600",
  },
  metricBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  metricBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  timelineList: {
    gap: 0,
  },
  timelineRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  railColumn: {
    width: 18,
    alignItems: "center",
  },
  railIcon: {
    marginTop: 6,
  },
  railLine: {
    width: 2,
    flex: 1,
    marginTop: 4,
    marginBottom: -4,
    borderRadius: 999,
  },
  todoCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 4,
  },
  todoContent: {
    fontSize: 14,
    lineHeight: 20,
  },
  todoSubtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  blockersCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 8,
  },
  blockersHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  blockersTitle: {
    fontSize: 12,
    fontWeight: "700",
  },
  blockersList: {
    gap: 6,
  },
  blockerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  blockerDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    marginTop: 6,
  },
  blockerText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
}));
