import * as React from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Text } from "@/components/StyledText";
import { t } from "@/text";
import {
  buildSessionSummaryRefreshDebugText,
  type SessionSummaryRefreshDebugState,
} from "../sessionSummaryRefreshPresentation";
import {
  buildCodexSummaryEntries,
  type CodexSessionSummary,
} from "./codexSummaryPresentation";

interface CodexSummarySectionProps {
  summary: CodexSessionSummary | undefined;
  summaryRefreshDebug: SessionSummaryRefreshDebugState | null;
  nowMs: number;
  onRefresh: () => void;
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

const SummaryBulletList = React.memo(function SummaryBulletList({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  const { theme } = useUnistyles();

  return (
    <View style={styles.detailBlock}>
      <Text
        style={[styles.detailTitle, { color: theme.colors.codex.textSecondary }]}
      >
        {title}
      </Text>
      {items.map((item, index) => (
        <Text
          key={`${index}-${item}`}
          style={[styles.detailItem, { color: theme.colors.codex.textPrimary }]}
        >
          {`• ${item}`}
        </Text>
      ))}
    </View>
  );
});

export const CodexSummarySection = React.memo<CodexSummarySectionProps>(
  function CodexSummarySection({
    summary,
    summaryRefreshDebug,
    nowMs,
    onRefresh,
  }) {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const refreshDebugText = React.useMemo(
      () =>
        summaryRefreshDebug
          ? buildSessionSummaryRefreshDebugText(summaryRefreshDebug, {
              relativeTimeLabel: formatRelativeTime(
                summaryRefreshDebug.timestamp,
                nowMs,
              ),
              pending: (params) =>
                t("session.progressSummaryRefreshPendingDebug", params),
              applied: (params) =>
                t("session.progressSummaryRefreshAppliedDebug", params),
              superseded: (params) =>
                t("session.progressSummaryRefreshSupersededDebug", params),
            })
          : null,
      [summaryRefreshDebug, nowMs],
    );
    const summaryEntries = React.useMemo(
      () => (summary ? buildCodexSummaryEntries(summary) : []),
      [summary],
    );
    const hasDetails = !!summary && (
      (summary.keyDecisions?.length ?? 0) > 0 ||
      (summary.openQuestions?.length ?? 0) > 0 ||
      (summary.impactScope?.length ?? 0) > 0
    );

    return (
      <View
        style={[
          styles.container,
          {
            borderColor: theme.colors.codex.summaryBorder,
            backgroundColor: theme.colors.codex.summaryBg,
            borderRadius: theme.codex.radius.section,
          },
        ]}
      >
        <View
          style={[
            styles.header,
            {
              paddingHorizontal: theme.codex.spacing.cardPadding + 2,
              paddingVertical: theme.codex.spacing.cardPadding,
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
                name="book-outline"
                size={16}
                color={theme.colors.codex.accent}
              />
            </View>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: theme.colors.codex.textPrimary }]}>
                {t("session.progressSummarySection")}
              </Text>
              {summary ? (
                <Text
                  style={[
                    styles.timeHint,
                    { color: theme.colors.codex.textSecondary },
                  ]}
                >
                  {formatRelativeTime(summary.updatedAt, nowMs)}
                </Text>
              ) : null}
              {refreshDebugText ? (
                <Text
                  style={[
                    styles.timeHint,
                    { color: theme.colors.codex.textSecondary },
                  ]}
                >
                  {refreshDebugText}
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
            accessibilityLabel={t("session.progressSummaryRefreshLabel")}
          >
            <Ionicons
              name="refresh-outline"
              size={12}
              color={theme.colors.codex.accent}
            />
            <Text
              style={[styles.refreshText, { color: theme.colors.codex.accent }]}
            >
              {t("session.progressSummaryRefreshLabel")}
            </Text>
          </Pressable>
        </View>

        {summary ? (
          <View
            style={[
              styles.body,
              {
                paddingHorizontal: theme.codex.spacing.cardPadding + 2,
                paddingBottom: theme.codex.spacing.cardPadding + 2,
                gap: theme.codex.spacing.cardGap,
              },
            ]}
          >
            <View
              style={[
                styles.summaryCard,
                {
                  borderColor: theme.colors.codex.borderSoft,
                  backgroundColor: theme.colors.codex.sectionBgElevated,
                  borderRadius: theme.codex.radius.card + 2,
                  padding: theme.codex.spacing.cardPadding,
                },
              ]}
            >
              {summaryEntries.map((entry, index) => (
                <View
                  key={entry.id}
                  style={[
                    styles.summaryEntry,
                    index > 0
                      ? {
                          borderTopColor: theme.colors.codex.borderSoft,
                          borderTopWidth: 1,
                          paddingTop: theme.codex.spacing.cardPadding - 2,
                        }
                      : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.summaryEntryLabel,
                      { color: theme.colors.codex.textSecondary },
                    ]}
                  >
                    {entry.id === "goal"
                      ? t("session.progressSummaryGoal")
                      : t("session.progressSummaryCurrentFocus")}
                  </Text>
                  <Text
                    style={[
                      styles.summaryEntryValue,
                      { color: theme.colors.codex.textPrimary },
                    ]}
                  >
                    {entry.value}
                  </Text>
                </View>
              ))}
            </View>

            {hasDetails ? (
              <Pressable
                onPress={() => setExpanded((prev) => !prev)}
                hitSlop={6}
                style={styles.expandRow}
              >
                <Text
                  style={[styles.expandText, { color: theme.colors.codex.accent }]}
                >
                  {expanded
                    ? t("session.progressSummaryCollapse")
                    : t("session.progressSummaryExpand", {
                        decisions: summary.keyDecisions?.length ?? 0,
                        questions: summary.openQuestions?.length ?? 0,
                        scopes: summary.impactScope?.length ?? 0,
                      })}
                </Text>
                <Ionicons
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={theme.colors.codex.accent}
                />
              </Pressable>
            ) : null}

            {expanded && summary.keyDecisions?.length ? (
              <SummaryBulletList
                title={t("session.progressSummaryDecisions")}
                items={summary.keyDecisions}
              />
            ) : null}
            {expanded && summary.openQuestions?.length ? (
              <SummaryBulletList
                title={t("session.progressSummaryOpenQuestions")}
                items={summary.openQuestions}
              />
            ) : null}
            {expanded && summary.impactScope?.length ? (
              <SummaryBulletList
                title={t("session.progressSummaryImpactScope")}
                items={summary.impactScope}
              />
            ) : null}
          </View>
        ) : (
          <Text
            style={[styles.emptyText, { color: theme.colors.codex.textSecondary }]}
          >
            {t("session.progressSummaryEmpty")}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
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
  body: {
  },
  summaryCard: {
    borderWidth: 1,
    gap: 10,
  },
  summaryEntry: {
    gap: 4,
  },
  summaryEntryLabel: {
    fontSize: 11,
    fontWeight: "600",
  },
  summaryEntryValue: {
    fontSize: 13,
    lineHeight: 19,
  },
  expandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  expandText: {
    fontSize: 12,
    fontWeight: "600",
  },
  detailBlock: {
    gap: 6,
  },
  detailTitle: {
    fontSize: 11,
    fontWeight: "700",
  },
  detailItem: {
    fontSize: 13,
    lineHeight: 18,
  },
  emptyText: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    fontSize: 13,
    lineHeight: 18,
  },
}));
