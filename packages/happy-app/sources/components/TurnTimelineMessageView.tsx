import * as React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { AgentDot } from "./AgentDot";
import { MarkdownView, type Option } from "./markdown/MarkdownView";
import {
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

interface ModelUsageInfo {
  model: string;
  tokens: string;
  cacheHitRate: number | null;
}

function getTurnSummary(item: TurnTimelineDisplayItem): {
  model: string | null;
  models: ModelUsageInfo[];
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
      models: [],
      duration: null,
      turns: null,
      totalTokens: null,
      cacheHitRate: null,
      cost: null,
    };
  }

  let totalTokens: number | null = null;
  let cacheHitRate: number | null = null;
  const models: ModelUsageInfo[] = [];

  if (event.modelUsage) {
    const entries = Object.entries(event.modelUsage);
    const usageItems = entries.map(([, v]) => v);
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

    // Build per-model breakdown when multiple models are used
    if (entries.length > 1) {
      // Sort: primary model first, then by token count descending
      const primaryModel = event.model ? formatModelName(event.model) : null;
      const sorted = entries
        .map(([model, usage]) => {
          const t =
            usage.inputTokens +
            usage.outputTokens +
            usage.cacheReadInputTokens +
            usage.cacheCreationInputTokens;
          const cr = usage.cacheReadInputTokens;
          const inp =
            usage.inputTokens +
            usage.cacheReadInputTokens +
            usage.cacheCreationInputTokens;
          const hit = cr > 0 && inp > 0 ? Math.round((cr / inp) * 100) : null;
          return { model: formatModelName(model), tokens: t, cacheHitRate: hit };
        })
        .sort((a, b) => {
          if (a.model === primaryModel) return -1;
          if (b.model === primaryModel) return 1;
          return b.tokens - a.tokens;
        });
      for (const s of sorted) {
        models.push({
          model: s.model,
          tokens: formatTokenCount(s.tokens),
          cacheHitRate: s.cacheHitRate,
        });
      }
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
    models,
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
          <View style={styles.stepsColumn}>
            {props.item.steps.map((step) => (
                <View key={step.message.id} style={styles.stepContent}>
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
            ))}
          </View>
          <View style={styles.summaryRow}>
            {summary.models.length > 1 ? (
              summary.models.map((m, i) => (
                <StepMeta
                  key={i}
                  icon={i === 0 ? "sparkles-outline" : "git-branch-outline"}
                  label={
                    m.cacheHitRate !== null
                      ? `${m.model} ${m.tokens} ↓${m.cacheHitRate}%`
                      : `${m.model} ${m.tokens}`
                  }
                  color={i === 0 ? theme.colors.accentPurple : theme.colors.accentTeal}
                  backgroundColor={(i === 0 ? theme.colors.accentPurple : theme.colors.accentTeal) + "12"}
                  borderColor={(i === 0 ? theme.colors.accentPurple : theme.colors.accentTeal) + "24"}
                />
              ))
            ) : (
              <>
                {summary.model ? (
                  <StepMeta
                    icon="sparkles-outline"
                    label={summary.model}
                    color={theme.colors.accentPurple}
                    backgroundColor={theme.colors.accentPurple + "12"}
                    borderColor={theme.colors.accentPurple + "24"}
                  />
                ) : null}
              </>
            )}
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
            {summary.models.length <= 1 && summary.totalTokens ? (
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
  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
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
  stepContent: {
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
}));
