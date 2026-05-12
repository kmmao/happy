import * as React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { AgentDot } from "./AgentDot";
import { MarkdownView, type Option } from "./markdown/MarkdownView";
import {
  collapseTurnTimelineSteps,
  type TurnTimelineDisplayItem,
  type TurnTimelineStep,
} from "./chatTimelineDisplay";
import { ToolView } from "./tools/ToolView";
import { sync } from "@/sync/sync";
import { getThinkingLabelTitle } from "./messageProgress";
import { type Metadata } from "@/sync/storageTypes";
import { t } from "@/text";
import { useSetting, useSession } from "@/sync/storage";
import { isSessionRunning } from "@/utils/sessionUtils";
import { useAppendToInput } from "@/hooks/useInputContext";
import {
  summarizeHiddenTimelineSteps,
  type HiddenTimelineSummaryKind,
} from "./turnTimelineSummary";

function formatModelName(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

function formatDuration(ms: number): string {
  if (ms >= 60000) {
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(costUsd: number): string {
  if (costUsd < 0.01) {
    return `$${costUsd.toFixed(4)}`;
  }
  return `$${costUsd.toFixed(2)}`;
}

function getTurnSummary(item: TurnTimelineDisplayItem): {
  model: string | null;
  duration: string | null;
  turns: number | null;
  totalTokens: string | null;
  cacheHitRate: number | null;
  cost: string | null;
} {
  const event = item.readyMessage.event;
  if (event.type !== "ready") {
    return {
      model: null,
      duration: null,
      turns: null,
      totalTokens: null,
      cacheHitRate: null,
      cost: null,
    };
  }

  let totalTokens: number | null = null;
  let cacheHitRate: number | null = null;

  if (event.modelUsage) {
    const usageItems = Object.values(event.modelUsage);
    totalTokens = usageItems.reduce(
      (sum, usage) =>
        sum +
        usage.inputTokens +
        usage.outputTokens +
        usage.cacheReadInputTokens +
        usage.cacheCreationInputTokens,
      0,
    );
    const totalCacheRead = usageItems.reduce(
      (sum, usage) => sum + usage.cacheReadInputTokens,
      0,
    );
    const totalInput = usageItems.reduce(
      (sum, usage) =>
        sum +
        usage.inputTokens +
        usage.cacheReadInputTokens +
        usage.cacheCreationInputTokens,
      0,
    );
    if (totalCacheRead > 0 && totalInput > 0) {
      cacheHitRate = Math.round((totalCacheRead / totalInput) * 100);
    }
  } else if (item.readyMessage.sessionUsage) {
    totalTokens =
      item.readyMessage.sessionUsage.totalInputTokens +
      item.readyMessage.sessionUsage.totalOutputTokens;
  } else if (event.usage) {
    totalTokens =
      event.usage.input_tokens +
      event.usage.output_tokens +
      (event.usage.cache_creation_input_tokens ?? 0) +
      (event.usage.cache_read_input_tokens ?? 0);
  }

  const costUsd =
    event.totalCostUsd ?? item.readyMessage.sessionUsage?.totalCostUsd ?? null;

  return {
    model: event.model ? formatModelName(event.model) : null,
    duration:
      typeof event.durationMs === "number" ? formatDuration(event.durationMs) : null,
    turns: typeof event.numTurns === "number" && event.numTurns > 0 ? event.numTurns : null,
    totalTokens: totalTokens !== null ? formatTokenCount(totalTokens) : null,
    cacheHitRate,
    cost: typeof costUsd === "number" && costUsd > 0 ? formatCost(costUsd) : null,
  };
}

function StepMeta(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  backgroundColor: string;
  borderColor: string;
}) {
  return (
    <View
      style={[
        styles.metaBadge,
        {
          backgroundColor: props.backgroundColor,
          borderColor: props.borderColor,
        },
      ]}
    >
      <Ionicons name={props.icon} size={11} color={props.color} />
      <Text style={[styles.metaBadgeText, { color: props.color }]}>
        {props.label}
      </Text>
    </View>
  );
}

function getHiddenSummaryLabel(
  kind: HiddenTimelineSummaryKind,
): string {
  switch (kind) {
    case "thinking":
      return t("sessionInfo.thinking");
    case "read":
      return t("tools.names.readFile");
    case "write":
      return t("tools.names.writeFile");
    case "search":
      return t("tools.names.search");
    case "list_files":
      return t("tools.names.listFiles");
    case "verify":
      return t("tools.names.verify");
    case "test":
      return t("tools.names.test");
    case "git":
      return t("tools.names.git");
    case "package":
      return t("tools.names.package");
    case "run":
      return t("tools.names.run");
    case "patch":
      return t("tools.names.applyChanges");
    case "diff":
      return t("tools.names.viewDiff");
    case "progress":
      return t("session.progressTodosSection");
    case "tool":
    default:
      return t("timeline.typeToolCall");
  }
}

function getHiddenSummaryIcon(
  kind: HiddenTimelineSummaryKind,
): keyof typeof Ionicons.glyphMap {
  switch (kind) {
    case "thinking":
      return "sparkles-outline";
    case "read":
      return "document-text-outline";
    case "write":
      return "create-outline";
    case "search":
      return "search-outline";
    case "list_files":
      return "folder-open-outline";
    case "verify":
      return "checkmark-done-outline";
    case "test":
      return "flask-outline";
    case "git":
      return "git-branch-outline";
    case "package":
      return "cube-outline";
    case "run":
      return "play-outline";
    case "patch":
      return "construct-outline";
    case "diff":
      return "git-compare-outline";
    case "progress":
      return "list-outline";
    case "tool":
    default:
      return "extension-puzzle-outline";
  }
}

function ThinkingTimelineStep(props: {
  step: Extract<TurnTimelineStep, { kind: "thinking" }>;
  sessionId: string;
}) {
  const { theme } = useUnistyles();
  const expandThinkingByDefault = useSetting("expandThinkingByDefault");
  const appendToInput = useAppendToInput();
  const session = useSession(props.sessionId);
  const [expanded, setExpanded] = React.useState(expandThinkingByDefault);
  React.useEffect(() => {
    setExpanded(expandThinkingByDefault);
  }, [expandThinkingByDefault]);
  const title = getThinkingLabelTitle(props.step.message.text);
  const label = title
    ? `${t("sessionInfo.thinking")} · ${title}`
    : t("sessionInfo.thinking");
  const handleOptionPress = React.useCallback(
    (option: Option) => {
      if (session && isSessionRunning(session)) {
        appendToInput(option.title);
      } else {
        sync.sendMessage(props.sessionId, option.title);
      }
    },
    [props.sessionId, session, appendToInput],
  );

  return (
    <Pressable
      onPress={() => setExpanded((value) => !value)}
      style={[
        styles.thinkingCard,
        {
          backgroundColor: theme.colors.surfaceHigh,
          borderColor: theme.colors.divider,
        },
      ]}
    >
      <View style={styles.thinkingHeader}>
        <View style={styles.stepTitleRow}>
          <Ionicons
            name={expanded ? "chevron-down" : "chevron-forward"}
            size={13}
            color={theme.colors.textSecondary}
          />
          <Text style={[styles.stepTitle, { color: theme.colors.text }]}>
            {label}
          </Text>
        </View>
      </View>
      {expanded ? (
        <View
          style={[
            styles.thinkingBody,
            { borderTopColor: theme.colors.divider },
          ]}
        >
          <MarkdownView
            markdown={props.step.message.text}
            onOptionPress={handleOptionPress}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

export const TurnTimelineMessageView = React.memo(function TurnTimelineMessageView(props: {
  item: TurnTimelineDisplayItem;
  metadata: Metadata | null;
  sessionId: string;
  showAvatar?: boolean;
  isLatestAgent?: boolean;
  permissionModeKey?: string | null;
}) {
  const { theme } = useUnistyles();
  const summary = React.useMemo(() => getTurnSummary(props.item), [props.item]);
  const [stepsExpanded, setStepsExpanded] = React.useState(false);
  React.useEffect(() => {
    setStepsExpanded(false);
  }, [props.item.steps]);
  const collapsedSteps = React.useMemo(
    () => collapseTurnTimelineSteps(props.item.steps, 4),
    [props.item.steps],
  );
  const visibleSteps = stepsExpanded
    ? props.item.steps
    : collapsedSteps.visibleSteps;
  const hiddenStepSummary = React.useMemo(
    () =>
      summarizeHiddenTimelineSteps(
        props.item.steps.slice(collapsedSteps.visibleSteps.length),
        props.metadata,
      ),
    [props.item.steps, props.metadata, collapsedSteps.visibleSteps.length],
  );
  return (
    <View style={styles.messageRow}>
      <View style={styles.avatarSlot}>
        {props.showAvatar ? (
          <AgentDot
            flavor={props.metadata?.flavor}
            size={12}
            animated={props.isLatestAgent}
          />
        ) : null}
      </View>
      <View style={styles.contentColumn}>
        <View
          style={[
            styles.container,
            {
              backgroundColor: theme.colors.surfaceHigh,
              borderColor: theme.colors.divider,
            },
          ]}
        >
          <View style={styles.summaryRow}>
            {summary.model ? (
              <StepMeta
                icon="sparkles-outline"
                label={summary.model}
                color={theme.colors.accentPurple}
                backgroundColor={theme.colors.accentPurple + "12"}
                borderColor={theme.colors.accentPurple + "24"}
              />
            ) : null}
            {summary.duration ? (
              <StepMeta
                icon="flash-outline"
                label={summary.duration}
                color={theme.colors.accentOrange}
                backgroundColor={theme.colors.accentOrange + "12"}
                borderColor={theme.colors.accentOrange + "24"}
              />
            ) : null}
            {summary.turns ? (
              <StepMeta
                icon="albums-outline"
                label={t("message.turnCount", { count: summary.turns })}
                color={theme.colors.textSecondary}
                backgroundColor={theme.colors.textSecondary + "10"}
                borderColor={theme.colors.textSecondary + "18"}
              />
            ) : null}
            {summary.totalTokens ? (
              <StepMeta
                icon="layers-outline"
                label={
                  summary.cacheHitRate !== null
                    ? `${summary.totalTokens} ↓${summary.cacheHitRate}%`
                    : summary.totalTokens
                }
                color={theme.colors.accentTeal}
                backgroundColor={theme.colors.accentTeal + "12"}
                borderColor={theme.colors.accentTeal + "24"}
              />
            ) : null}
            {summary.cost ? (
              <StepMeta
                icon="cash-outline"
                label={summary.cost}
                color={theme.colors.success}
                backgroundColor={theme.colors.success + "12"}
                borderColor={theme.colors.success + "22"}
              />
            ) : null}
          </View>

          <View style={styles.stepsColumn}>
            {visibleSteps.map((step, index) => {
              const showRail = index < visibleSteps.length - 1;
              return (
                <View key={step.message.id} style={styles.stepRow}>
                  <View style={styles.railColumn}>
                    <View
                      style={[
                        styles.railDot,
                        {
                          backgroundColor:
                            step.kind === "thinking"
                              ? theme.colors.textSecondary
                              : theme.colors.accentBlue,
                        },
                      ]}
                    />
                    {showRail ? (
                      <View
                        style={[
                          styles.railLine,
                          { backgroundColor: theme.colors.divider },
                        ]}
                      />
                    ) : null}
                  </View>
                  <View style={styles.stepContent}>
                    {step.kind === "thinking" ? (
                      <ThinkingTimelineStep
                        step={step}
                        sessionId={props.sessionId}
                      />
                    ) : (
                      <ToolView
                        tool={step.message.tool}
                        metadata={props.metadata}
                        messages={step.message.children}
                        sessionId={props.sessionId}
                        messageId={step.message.id}
                        permissionModeKey={props.permissionModeKey}
                      />
                    )}
                  </View>
                </View>
              );
            })}
          </View>
          {collapsedSteps.didCollapse ? (
            <Pressable
              onPress={() => setStepsExpanded((value) => !value)}
              hitSlop={8}
              style={styles.stepsToggle}
            >
              <View style={styles.stepsToggleMain}>
                <Text
                  style={[
                    styles.stepsToggleText,
                    { color: theme.colors.accentBlue },
                  ]}
                >
                  {stepsExpanded
                    ? t("sidePanel.collapse")
                    : t("session.progressShowAll", {
                        n: collapsedSteps.hiddenCount,
                      })}
                </Text>
                <Ionicons
                  name={stepsExpanded ? "chevron-up" : "chevron-down"}
                  size={12}
                  color={theme.colors.accentBlue}
                />
              </View>
              {!stepsExpanded && hiddenStepSummary.items.length > 0 ? (
                <View style={styles.stepsToggleSummary}>
                  {hiddenStepSummary.items.map((item) => (
                    <View
                      key={`hidden-${item.kind}`}
                      style={[
                        styles.hiddenTypeChip,
                        {
                          backgroundColor: theme.colors.accentBlue + "10",
                          borderColor: theme.colors.accentBlue + "18",
                        },
                      ]}
                    >
                      <Ionicons
                        name={getHiddenSummaryIcon(item.kind)}
                        size={10}
                        color={theme.colors.accentBlue}
                      />
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.hiddenTypeChipText,
                          { color: theme.colors.accentBlue },
                        ]}
                      >
                        {getHiddenSummaryLabel(item.kind)} {item.count}
                      </Text>
                    </View>
                  ))}
                  {hiddenStepSummary.otherCount > 0 ? (
                    <View
                      style={[
                        styles.hiddenTypeChip,
                        {
                          backgroundColor: theme.colors.textSecondary + "10",
                          borderColor: theme.colors.textSecondary + "18",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.hiddenTypeChipText,
                          { color: theme.colors.textSecondary },
                        ]}
                      >
                        {t("session.progressToolMixOther")} {hiddenStepSummary.otherCount}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create((_theme) => ({
  messageRow: {
    flexDirection: "row",
  },
  avatarSlot: {
    width: 24,
    paddingTop: 8,
    alignItems: "center",
  },
  contentColumn: {
    flex: 1,
    minWidth: 0,
  },
  container: {
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  metaBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  metaBadgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  stepsColumn: {
    gap: 2,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 10,
  },
  railColumn: {
    width: 14,
    alignItems: "center",
  },
  railDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    marginTop: 10,
  },
  railLine: {
    width: 2,
    flex: 1,
    marginTop: 6,
    borderRadius: 999,
  },
  stepContent: {
    flex: 1,
    minWidth: 0,
  },
  thinkingCard: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  thinkingHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  thinkingBody: {
    borderTopWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  stepTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  stepTitle: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  stepsToggle: {
    alignSelf: "flex-start",
    gap: 6,
    marginLeft: 24,
    marginTop: 2,
  },
  stepsToggleMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  stepsToggleText: {
    fontSize: 12,
    fontWeight: "600",
  },
  stepsToggleSummary: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  hiddenTypeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    maxWidth: 180,
  },
  hiddenTypeChipText: {
    fontSize: 11,
    fontWeight: "600",
  },
}));
