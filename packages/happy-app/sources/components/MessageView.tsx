import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { MarkdownView } from "./markdown/MarkdownView";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import {
  Message,
  UserTextMessage,
  AgentTextMessage,
  ToolCallMessage,
} from "@/sync/typesMessage";
import { Metadata } from "@/sync/storageTypes";
import { layout } from "./layout";
import { ToolView } from "./tools/ToolView";
import { AgentEvent } from "@/sync/typesRaw";
import { sync } from "@/sync/sync";
import { Option } from "./markdown/MarkdownView";
import { useSetting, storage } from "@/sync/storage";
import { sessionCancelQueuedMessage, sessionRewindFiles } from "@/sync/ops";
import { Modal } from "@/modal";
import { AgentDot } from "./AgentDot";
import { MessageImage } from "./MessageImage";
import { parseImageRefs } from "@/utils/parseImageRefs";
import { useBookmarks } from "@/hooks/useBookmarks";
import { useAppendToInput } from "@/hooks/useInputContext";
import { parseTaskStatusMessage, getThinkingLabelTitle } from "./messageProgress";
import { parseLegacyCodexDiffPreview } from "./tools/codexDiffCompat";
import { parseLegacyCodexPlanPreview } from "./tools/codexPlanCompat";
import { parseCodexServicePreview } from "./tools/codexServiceCompat";
import { CodexDiffView } from "./tools/views/CodexDiffView";

export const MessageView = (props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  showAvatar?: boolean;
  isLatestAgent?: boolean;
  hasTurnsWithThinking?: boolean;
  permissionModeKey?: string | null;
  contentMaxWidth?: number;
}) => {
  return (
    <View style={styles.messageContainer} renderToHardwareTextureAndroid={true}>
      <View style={[styles.messageContent, { maxWidth: props.contentMaxWidth ?? layout.maxWidth }]}>
        <RenderBlock
          message={props.message}
          metadata={props.metadata}
          sessionId={props.sessionId}
          getMessageById={props.getMessageById}
          showAvatar={props.showAvatar}
          isLatestAgent={props.isLatestAgent}
          hasTurnsWithThinking={props.hasTurnsWithThinking}
          permissionModeKey={props.permissionModeKey}
        />
      </View>
    </View>
  );
};

// RenderBlock function that dispatches to the correct component based on message kind
function RenderBlock(props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  showAvatar?: boolean;
  isLatestAgent?: boolean;
  hasTurnsWithThinking?: boolean;
  permissionModeKey?: string | null;
}): React.ReactElement {
  switch (props.message.kind) {
    case "user-text":
      return (
        <UserTextBlock message={props.message} sessionId={props.sessionId} />
      );

    case "agent-text":
      return (
        <AgentTextBlock
          message={props.message}
          sessionId={props.sessionId}
          showAvatar={props.showAvatar}
          flavor={props.metadata?.flavor}
          isLatestAgent={props.isLatestAgent}
        />
      );

    case "tool-call":
      return (
        <ToolCallBlock
          message={props.message}
          metadata={props.metadata}
          sessionId={props.sessionId}
          getMessageById={props.getMessageById}
          permissionModeKey={props.permissionModeKey}
        />
      );

    case "agent-event":
      return (
        <AgentEventBlock
          event={props.message.event}
          metadata={props.metadata}
          sessionUsage={props.message.sessionUsage}
          hasTurnsWithThinking={props.hasTurnsWithThinking}
        />
      );

    default:
      // Exhaustive check - TypeScript will error if we miss a case
      const _exhaustive: never = props.message;
      throw new Error(`Unknown message kind: ${_exhaustive}`);
  }
}

function UserTextBlock(props: { message: UserTextMessage; sessionId: string }) {
  const { toggleBookmark, isBookmarked } = useBookmarks();
  const appendToInput = useAppendToInput();
  const { theme } = useUnistyles();

  const queuedIds = storage((s) => s.queuedMessageLocalIds[props.sessionId]);
  const isQueued =
    props.message.localId != null &&
    (queuedIds ?? []).includes(props.message.localId);

  const handleCancelQueued = React.useCallback(async () => {
    const localId = props.message.localId;
    if (!localId) return;
    const cancelled = await sessionCancelQueuedMessage(props.sessionId, localId);
    if (cancelled) {
      storage.getState().removeQueuedMessageId(props.sessionId, localId);
    }
  }, [props.sessionId, props.message.localId]);

  const handleOptionPress = React.useCallback(
    (option: Option) => {
      sync.sendMessage(props.sessionId, option.title);
    },
    [props.sessionId],
  );

  const [rewinding, setRewinding] = React.useState(false);
  const handleRewind = React.useCallback(async () => {
    if (rewinding) return;
    const rewindId = props.message.realId;
    if (!rewindId) {
      Modal.alert(t("session.rewindFailed"), t("session.rewindUnavailable"));
      return;
    }
    setRewinding(true);
    try {
      const preview = await sessionRewindFiles(props.sessionId, rewindId, true);
      if (!preview.canRewind) {
        Modal.alert(t("session.rewindFailed"), preview.error ?? t("session.rewindUnavailable"));
        return;
      }
      const fileCount = preview.filesChanged?.length ?? 0;
      const stats = [
        `${fileCount} ${t("session.rewindFiles")}`,
        preview.insertions != null ? `+${preview.insertions}` : null,
        preview.deletions != null ? `-${preview.deletions}` : null,
      ].filter(Boolean).join("  ");

      const confirmed = await Modal.confirm(
        t("session.rewindTitle"),
        `${t("session.rewindConfirm")}\n\n${stats}${preview.filesChanged ? "\n" + preview.filesChanged.join("\n") : ""}`,
        { confirmText: t("session.rewindAction"), destructive: true },
      );
      if (!confirmed) return;

      const result = await sessionRewindFiles(props.sessionId, rewindId, false);
      if (result.canRewind) {
        Modal.toast(t("session.rewindSuccess"));
      } else {
        Modal.alert(t("session.rewindFailed"), result.error ?? t("session.rewindUnknownError"));
      }
    } finally {
      setRewinding(false);
    }
  }, [props.sessionId, props.message.realId, rewinding]);

  const parsed = React.useMemo(
    () => parseImageRefs(props.message.text),
    [props.message.text],
  );

  const displayText =
    parsed.imagePaths.length > 0
      ? parsed.text
      : props.message.displayText || props.message.text;

  const bookmarked = isBookmarked(displayText);

  return (
    <View style={styles.userMessageContainer}>
      {parsed.imagePaths.length > 0 && (
        <View style={styles.userImageContainer}>
          {parsed.imagePaths.map((path) => (
            <MessageImage
              key={path}
              sessionId={props.sessionId}
              imagePath={path}
              displayName={parsed.displayNames.get(path)}
            />
          ))}
        </View>
      )}
      {displayText.length > 0 && (
        <View style={styles.userBubbleRow}>
          <View style={styles.userMessageBubble}>
            <MarkdownView
              markdown={displayText}
              onOptionPress={handleOptionPress}
            />
          </View>
          <View style={styles.userActionsRow}>
            <Pressable
              style={({ pressed }) => [
                styles.userBookmarkButton,
                pressed && { opacity: 0.5 },
              ]}
              onPress={() => appendToInput(displayText)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t("session.appendToInput")}
              // @ts-expect-error RN Web supports title for tooltip
              title={t("session.appendToInput")}
            >
              <Ionicons
                name="copy-outline"
                size={13}
                color={theme.colors.textSecondary}
              />
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.userBookmarkButton,
                pressed && { opacity: 0.5 },
              ]}
              onPress={() => toggleBookmark(displayText, "user")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={t("session.bookmarkOption")}
              // @ts-expect-error RN Web supports title for tooltip
              title={t("session.bookmarkOption")}
            >
              <Ionicons
                name={bookmarked ? "bookmark" : "bookmark-outline"}
                size={13}
                color={
                  bookmarked
                    ? theme.colors.radio.active
                    : theme.colors.textSecondary
                }
              />
            </Pressable>
            {!isQueued && (
              <Pressable
                style={({ pressed }) => [
                  styles.userBookmarkButton,
                  (pressed || rewinding) && { opacity: 0.5 },
                ]}
                onPress={handleRewind}
                disabled={rewinding}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={t("session.rewindTitle")}
                // @ts-expect-error RN Web supports title for tooltip
                title={t("session.rewindTitle")}
              >
                <Ionicons
                  name="play-back-outline"
                  size={13}
                  color={theme.colors.textSecondary}
                />
              </Pressable>
            )}
          </View>
        </View>
      )}
      {isQueued && (
        <View style={styles.queuedIndicator}>
          <Ionicons
            name="time-outline"
            size={11}
            color={theme.colors.textSecondary}
          />
          <Text
            style={[styles.queuedText, { color: theme.colors.textSecondary }]}
          >
            {t("session.messageQueued")}
          </Text>
          <Pressable
            onPress={handleCancelQueued}
            hitSlop={8}
            style={({ pressed }) => [
              styles.cancelQueuedButton,
              { backgroundColor: theme.colors.surfaceHighest },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text
              style={[
                styles.cancelQueuedText,
                { color: theme.colors.textSecondary },
              ]}
            >
              {t("session.cancelQueued")}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function AgentTextBlock(props: {
  message: AgentTextMessage;
  sessionId: string;
  showAvatar?: boolean;
  flavor?: string | null;
  isLatestAgent?: boolean;
}) {
  const experiments = useSetting("experiments");
  const expandThinkingByDefault = useSetting("expandThinkingByDefault");
  const { theme } = useUnistyles();
  const [thinkingExpanded, setThinkingExpanded] = React.useState(
    expandThinkingByDefault,
  );
  React.useEffect(() => {
    setThinkingExpanded(expandThinkingByDefault);
  }, [expandThinkingByDefault]);
  const handleOptionPress = React.useCallback(
    (option: Option) => {
      sync.sendMessage(props.sessionId, option.title);
    },
    [props.sessionId],
  );

  // Hide thinking messages unless experiments is enabled
  if (props.message.isThinking && !experiments) {
    return null;
  }

  // Collapsed thinking block
  if (props.message.isThinking) {
    const thinkingTitle = getThinkingLabelTitle(props.message.text);
    const thinkingLabel = thinkingTitle
      ? `${t("sessionInfo.thinking")} ${thinkingTitle}`
      : t("sessionInfo.thinking");

    return (
      <View style={styles.agentMessageRow}>
        <View style={[styles.avatarSlot, { paddingTop: 7 }]}>
          {props.showAvatar && (
            <AgentDot
              flavor={props.flavor}
              size={12}
              animated={props.isLatestAgent}
            />
          )}
        </View>
        <View style={styles.agentMessageContainer}>
          <Pressable
            style={({ pressed }) => [
              styles.thinkingHeader,
              pressed && { opacity: 0.6 },
            ]}
            onPress={() => setThinkingExpanded((v) => !v)}
          >
            <Ionicons
              name={thinkingExpanded ? "chevron-down" : "chevron-forward"}
              size={14}
              color={theme.colors.textSecondary}
            />
            <Text style={styles.thinkingLabel} numberOfLines={1} ellipsizeMode="tail">
              {thinkingLabel}
            </Text>
          </Pressable>
          {thinkingExpanded && (
            <View style={styles.thinkingContent}>
              <MarkdownView
                markdown={props.message.text}
                onOptionPress={handleOptionPress}
              />
            </View>
          )}
        </View>
      </View>
    );
  }

  const taskStatus = props.message.taskStatus ?? parseTaskStatusMessage(props.message.text);
  const legacyDiffPreview = React.useMemo(
    () => parseLegacyCodexDiffPreview(props.message.text),
    [props.message.text],
  );
  const legacyPlanPreview = React.useMemo(
    () => parseLegacyCodexPlanPreview(props.message.text),
    [props.message.text],
  );
  const codexServicePreview = React.useMemo(
    () => parseCodexServicePreview(props.message.text),
    [props.message.text],
  );
  const taskStatusIcon =
    taskStatus?.status === "completed"
      ? "checkmark-circle-outline"
      : taskStatus?.status === "failed"
        ? "close-circle-outline"
        : taskStatus?.status === "stopped"
          ? "stop-circle-outline"
          : "hourglass-outline";
  const taskStatusTone =
    taskStatus?.status === "completed"
      ? {
          backgroundColor: theme.colors.success + "14",
          borderColor: theme.colors.success + "2e",
          textColor: theme.colors.success,
        }
      : taskStatus?.status === "failed"
        ? {
            backgroundColor: theme.colors.textDestructive + "14",
            borderColor: theme.colors.textDestructive + "30",
            textColor: theme.colors.textDestructive,
          }
        : taskStatus?.status === "stopped"
          ? {
              backgroundColor: theme.colors.textSecondary + "10",
              borderColor: theme.colors.textSecondary + "24",
              textColor: theme.colors.textSecondary,
            }
          : {
              backgroundColor: theme.colors.accentOrange + "14",
              borderColor: theme.colors.accentOrange + "2b",
              textColor: theme.colors.accentOrange,
            };
  const taskStatusLabel =
    taskStatus?.status === "start"
      ? t("message.taskStarted")
      : taskStatus?.status === "progress"
        ? t("message.taskProgress")
        : taskStatus?.status === "completed"
          ? t("message.taskCompleted")
          : taskStatus?.status === "failed"
            ? t("message.taskFailed")
            : taskStatus?.status === "stopped"
              ? t("message.taskStopped")
              : null;

  if (!taskStatus && legacyDiffPreview) {
    return (
      <View style={styles.legacyPreviewContainer}>
        {legacyDiffPreview.prefixMarkdown ? (
          <View style={styles.legacyPreviewMarkdown}>
            <MarkdownView
              markdown={legacyDiffPreview.prefixMarkdown}
              onOptionPress={handleOptionPress}
            />
          </View>
        ) : null}
        <View style={styles.toolContainer}>
          <CodexDiffView
            tool={{
              name: "CodexDiff",
              state: "completed",
              input: {
                unified_diff: legacyDiffPreview.unifiedDiff,
              },
              createdAt: props.message.createdAt,
              startedAt: null,
              completedAt: null,
              description: null,
              result: { status: "completed" },
            }}
            metadata={null}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.agentMessageRow}>
      <View style={styles.avatarSlot}>
        {props.showAvatar && (
          <AgentDot
            flavor={props.flavor}
            size={12}
            animated={props.isLatestAgent}
          />
        )}
      </View>
      <View style={styles.agentMessageContainer}>
        {taskStatus && taskStatusLabel ? (
          <View
            style={[
              styles.taskProgressCard,
              {
                backgroundColor: taskStatusTone.backgroundColor,
                borderColor: taskStatusTone.borderColor,
              },
            ]}
          >
            <View style={styles.taskProgressHeader}>
              <View style={styles.taskProgressMainRow}>
                <Ionicons
                  name={taskStatusIcon}
                  size={10}
                  color={taskStatusTone.textColor}
                />
                <View style={styles.taskProgressTextRow}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.taskProgressLabel,
                      { color: taskStatusTone.textColor },
                    ]}
                  >
                    {taskStatusLabel}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.taskProgressSummary,
                      { color: theme.colors.text },
                    ]}
                  >
                    {taskStatus.summary}
                  </Text>
                </View>
              </View>
              {taskStatus.metrics ? (
                <Text
                  numberOfLines={1}
                  style={[
                    styles.taskProgressMetrics,
                    { color: taskStatusTone.textColor },
                  ]}
                >
                  {taskStatus.metrics}
                </Text>
              ) : null}
            </View>
          </View>
        ) : legacyPlanPreview ? (
          <View style={styles.codexPlanCard}>
            {legacyPlanPreview.explanation ? (
              <Text style={styles.codexPlanTitle}>
                {legacyPlanPreview.explanation}
              </Text>
            ) : null}
            <View style={styles.codexPlanList}>
              {legacyPlanPreview.items.map((item, index) => {
                const tone =
                  item.status === "completed"
                    ? {
                        dot: theme.colors.success,
                        label: theme.colors.success,
                      }
                    : item.status === "in_progress"
                      ? {
                          dot: theme.colors.accentBlue,
                          label: theme.colors.accentBlue,
                        }
                      : item.status === "pending"
                        ? {
                            dot: theme.colors.accentOrange,
                            label: theme.colors.accentOrange,
                          }
                        : {
                            dot: theme.colors.textSecondary,
                            label: theme.colors.textSecondary,
                          };

                const statusLabel =
                  item.status === "completed"
                    ? t("supervisor.status_completed")
                    : item.status === "in_progress"
                      ? t("message.taskProgress")
                      : item.status === "pending"
                        ? t("supervisor.status_pending")
                        : t("timeline.typeToolCall");

                return (
                  <View key={`${item.status}-${index}-${item.text}`} style={styles.codexPlanRow}>
                    <View
                      style={[
                        styles.codexPlanDot,
                        { backgroundColor: tone.dot },
                      ]}
                    />
                    <View style={styles.codexPlanTextWrap}>
                      <Text style={[styles.codexPlanStatus, { color: tone.label }]}>
                        {statusLabel}
                      </Text>
                      <Text style={styles.codexPlanText}>{item.text}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : codexServicePreview ? (
          codexServicePreview.kind === "steering" ? (
            <View style={styles.codexServiceInline}>
              <Ionicons
                name="sync-outline"
                size={12}
                color={theme.colors.textSecondary}
              />
              <Text style={styles.codexServiceInlineText}>
                {codexServicePreview.title}
              </Text>
            </View>
          ) : (
            <View
              style={[
                styles.codexServiceCard,
                codexServicePreview.kind === "warning"
                  ? {
                      backgroundColor: theme.colors.box.warning.background,
                      borderColor: theme.colors.box.warning.border,
                    }
                  : codexServicePreview.kind === "review"
                    ? {
                        backgroundColor: theme.colors.surfaceHigh,
                        borderColor: theme.colors.divider,
                      }
                    : {
                        backgroundColor: theme.colors.accentBlue + "10",
                        borderColor: theme.colors.accentBlue + "24",
                      },
              ]}
            >
              <View style={styles.codexServiceHeader}>
                <Ionicons
                  name={
                    codexServicePreview.kind === "warning"
                      ? "alert-circle-outline"
                      : codexServicePreview.kind === "review"
                        ? "eye-outline"
                        : "swap-horizontal-outline"
                  }
                  size={14}
                  color={
                    codexServicePreview.kind === "warning"
                      ? theme.colors.box.warning.text
                      : codexServicePreview.kind === "review"
                        ? theme.colors.textSecondary
                        : theme.colors.accentBlue
                  }
                />
                <Text
                  style={[
                    styles.codexServiceTitle,
                    {
                      color:
                        codexServicePreview.kind === "warning"
                          ? theme.colors.box.warning.text
                          : codexServicePreview.kind === "review"
                            ? theme.colors.textSecondary
                            : theme.colors.accentBlue,
                    },
                  ]}
                >
                  {codexServicePreview.title}
                </Text>
              </View>
              {codexServicePreview.detail ? (
                <Text style={styles.codexServiceDetail}>
                  {codexServicePreview.detail}
                </Text>
              ) : null}
            </View>
          )
        ) : (
          <MarkdownView
            markdown={props.message.text}
            onOptionPress={handleOptionPress}
          />
        )}
      </View>
    </View>
  );
}

function formatModelName(model: string): string {
  // Strip date suffix from model IDs like "claude-sonnet-4-6-20250514" → "claude-sonnet-4-6"
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
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(costUsd: number): string {
  if (costUsd < 0.01) {
    return `$${costUsd.toFixed(4)}`;
  }
  return `$${costUsd.toFixed(2)}`;
}

function AgentEventBlock(props: {
  event: AgentEvent;
  metadata: Metadata | null;
  sessionUsage?: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd?: number;
  };
  hasTurnsWithThinking?: boolean;
}) {
  const { theme } = useUnistyles();
  if (props.event.type === "switch") {
    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>
          {t("message.switchedToMode", { mode: props.event.mode })}
        </Text>
      </View>
    );
  }
  if (props.event.type === "message") {
    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>{props.event.message}</Text>
      </View>
    );
  }
  if (props.event.type === "limit-reached") {
    const formatTime = (timestamp: number): string => {
      try {
        const date = new Date(timestamp * 1000); // Convert from Unix timestamp
        return date.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      } catch {
        return t("message.unknownTime");
      }
    };

    const displayText = props.event.endsAt
      ? t("message.usageLimitUntil", { time: formatTime(props.event.endsAt) })
      : props.event.message || t("message.usageLimitReached");

    return (
      <View style={styles.limitReachedContainer}>
        <Text style={styles.limitReachedText}>{displayText}</Text>
      </View>
    );
  }
  // Per-call usage-stats are hidden — session summary is shown at turn-end only
  if (props.event.type === "usage-stats") {
    return null;
  }
  if (props.event.type === "ready") {
    const model = props.event.model;
    const durationMs = props.event.durationMs;
    const modelStr = model ? formatModelName(model) : null;
    const durationStr =
      durationMs !== undefined ? formatDuration(durationMs) : null;

    // Session total tokens: prefer SDK modelUsage, fallback to reducer cumulative
    let sessionTotalTokens: number | null = null;
    let sessionCacheHitRate: number | null = null;
    if (props.event.modelUsage) {
      const modelValues = Object.values(props.event.modelUsage);
      sessionTotalTokens = modelValues.reduce(
        (sum, m) =>
          sum +
          m.inputTokens +
          m.outputTokens +
          m.cacheReadInputTokens +
          m.cacheCreationInputTokens,
        0,
      );
      const totalCacheRead = modelValues.reduce(
        (sum, m) => sum + m.cacheReadInputTokens,
        0,
      );
      const totalAllInput = modelValues.reduce(
        (sum, m) =>
          sum +
          m.inputTokens +
          m.cacheReadInputTokens +
          m.cacheCreationInputTokens,
        0,
      );
      if (totalCacheRead > 0 && totalAllInput > 0) {
        sessionCacheHitRate = Math.round(
          (totalCacheRead / totalAllInput) * 100,
        );
      }
    } else if (props.sessionUsage) {
      sessionTotalTokens =
        props.sessionUsage.totalInputTokens +
        props.sessionUsage.totalOutputTokens;
    }

    // Session cost
    const sessionCost =
      props.event.totalCostUsd ?? props.sessionUsage?.totalCostUsd;

    const hasParts =
      props.hasTurnsWithThinking ||
      modelStr ||
      durationStr ||
      (props.event.numTurns !== undefined && props.event.numTurns > 0) ||
      sessionTotalTokens !== null ||
      (sessionCost !== undefined && sessionCost > 0);

    if (!hasParts) {
      return null;
    }

    return (
      <View style={styles.turnStatsContainer}>
        {props.hasTurnsWithThinking && (
          <View
            style={[
              styles.turnStatBadge,
              {
                backgroundColor: theme.colors.agentEventText + "12",
                borderColor: theme.colors.agentEventText + "20",
              },
            ]}
          >
            <Text style={styles.turnStatBadgeText}>
              {t("message.thinkingMarker")}
            </Text>
          </View>
        )}
        {modelStr && (
          <View
            style={[
              styles.turnStatBadge,
              {
                backgroundColor: theme.colors.accentPurple + "12",
                borderColor: theme.colors.accentPurple + "24",
              },
            ]}
          >
            <Text
              style={[
                styles.turnStatBadgeText,
                { color: theme.colors.accentPurple },
              ]}
            >
              {modelStr}
            </Text>
          </View>
        )}
        {durationStr && (
          <View
            style={[
              styles.turnStatBadge,
              {
                backgroundColor: theme.colors.accentOrange + "12",
                borderColor: theme.colors.accentOrange + "24",
              },
            ]}
          >
            <Text
              style={[
                styles.turnStatBadgeText,
                { color: theme.colors.accentOrange },
              ]}
            >
              {durationStr}
            </Text>
          </View>
        )}
        {props.event.numTurns !== undefined && props.event.numTurns > 0 && (
          <View
            style={[
              styles.turnStatBadge,
              {
                backgroundColor: theme.colors.agentEventText + "12",
                borderColor: theme.colors.agentEventText + "20",
              },
            ]}
          >
            <Text style={styles.turnStatBadgeText}>
              {t("message.turnCount", { count: props.event.numTurns })}
            </Text>
          </View>
        )}
        {sessionTotalTokens !== null && (
          <View
            style={[
              styles.turnStatBadge,
              {
                backgroundColor: theme.colors.accentTeal + "12",
                borderColor: theme.colors.accentTeal + "24",
              },
            ]}
          >
            <Text
              style={[
                styles.turnStatBadgeText,
                { color: theme.colors.accentTeal },
              ]}
            >
              {t("message.sessionSummary", {
                tokens: formatTokenCount(sessionTotalTokens),
              })}
            </Text>
            {sessionCacheHitRate !== null && (
              <Text
                style={[
                  styles.turnStatBadgeText,
                  { color: theme.colors.success, marginLeft: 3 },
                ]}
              >
                ↓{sessionCacheHitRate}%
              </Text>
            )}
          </View>
        )}
        {sessionCost !== undefined && sessionCost > 0 && (
          <View
            style={[
              styles.turnStatBadge,
              {
                backgroundColor: theme.colors.success + "12",
                borderColor: theme.colors.success + "22",
              },
            ]}
          >
            <Text
              style={[styles.turnStatBadgeText, { color: theme.colors.success }]}
            >
              {formatCost(sessionCost)}
            </Text>
          </View>
        )}
      </View>
    );
  }
  return null;
}

function ToolCallBlock(props: {
  message: ToolCallMessage;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  permissionModeKey?: string | null;
}) {
  const handleOptionPress = React.useCallback(
    (option: Option) => {
      sync.sendMessage(props.sessionId, option.title);
    },
    [props.sessionId],
  );

  if (!props.message.tool) {
    return null;
  }
  return (
    <View style={styles.toolContainer}>
      <ToolView
        tool={props.message.tool}
        metadata={props.metadata}
        messages={props.message.children}
        sessionId={props.sessionId}
        messageId={props.message.id}
        permissionModeKey={props.permissionModeKey}
        onOptionPress={handleOptionPress}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  messageContainer: {
    flexDirection: "row",
    justifyContent: "center",
  },
  messageContent: {
    flexDirection: "column",
    flexGrow: 1,
    flexBasis: 0,
  },
  userMessageContainer: {
    maxWidth: "100%",
    flexDirection: "column",
    alignItems: "flex-end",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
  },
  userBubbleRow: {
    flexDirection: "column",
    alignItems: "flex-end",
    maxWidth: "100%",
  },
  userActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginTop: 2,
    marginBottom: 8,
  },
  userBookmarkButton: {
    padding: 4,
    flexShrink: 0,
  },
  userImageContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 4,
    marginBottom: 4,
    borderRadius: 12,
    overflow: "hidden",
  },
  userMessageBubble: {
    backgroundColor: theme.colors.userMessageBackground,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 2,
    flexShrink: 1,
  },
  queuedIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginBottom: 12,
    marginRight: 4,
    opacity: 0.6,
  },
  queuedText: {
    fontSize: 11,
    ...Typography.default(),
  },
  cancelQueuedButton: {
    marginLeft: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  cancelQueuedText: {
    fontSize: 11,
    ...Typography.default(),
  },
  agentMessageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingLeft: 8,
  },
  avatarSlot: {
    width: 32,
    paddingTop: 11,
    alignItems: "center",
    flexShrink: 0,
  },
  agentMessageContainer: {
    marginRight: 16,
    marginBottom: 8,
    borderRadius: 16,
    flex: 1,
  },
  taskProgressCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 1,
  },
  taskProgressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 5,
  },
  taskProgressMainRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 0,
    flexShrink: 1,
  },
  taskProgressTextRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
  },
  taskProgressLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.1,
    ...Typography.default(),
  },
  taskProgressSummary: {
    fontSize: 11.5,
    lineHeight: 15,
    flexShrink: 1,
    ...Typography.default(),
  },
  taskProgressMetrics: {
    fontSize: 11,
    lineHeight: 14,
    flexShrink: 0,
    ...Typography.default(),
  },
  thinkingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    opacity: 0.5,
  },
  thinkingLabel: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  thinkingContent: {
    opacity: 0.4,
    paddingLeft: 4,
  },
  agentEventContainer: {
    marginHorizontal: 8,
    alignItems: "center",
    paddingVertical: 8,
  },
  agentEventText: {
    color: theme.colors.agentEventText,
    fontSize: 14,
  },
  limitReachedContainer: {
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.colors.box.warning.background,
    borderRadius: 12,
    alignItems: "center",
  },
  limitReachedText: {
    color: theme.colors.box.warning.text,
    fontSize: 14,
    textAlign: "center",
  },
  turnStatsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 3,
    marginHorizontal: 8,
    marginTop: 2,
    marginBottom: 6,
    paddingLeft: 40,
  },
  turnStatBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.agentEventText + "12",
    borderColor: theme.colors.agentEventText + "20",
    gap: 2,
  },
  turnStatBadgeText: {
    fontSize: 10,
    fontFamily: "monospace",
    color: theme.colors.agentEventText,
  },
  turnStatsText: {
    color: theme.colors.agentEventText,
    fontSize: 11,
    opacity: 0.6,
  },
  toolContainer: {
    marginHorizontal: 8,
  },
  legacyPreviewContainer: {
    marginBottom: 8,
  },
  legacyPreviewMarkdown: {
    marginHorizontal: 8,
    marginBottom: 8,
  },
  codexPlanCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.divider,
    backgroundColor: theme.colors.surfaceHigh,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  codexPlanTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.textSecondary,
    ...Typography.default("semiBold"),
  },
  codexPlanList: {
    gap: 8,
  },
  codexPlanRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  codexPlanDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
  },
  codexPlanTextWrap: {
    flex: 1,
    gap: 1,
  },
  codexPlanStatus: {
    fontSize: 11,
    fontWeight: "600",
    ...Typography.default("semiBold"),
  },
  codexPlanText: {
    fontSize: 12.5,
    lineHeight: 17,
    color: theme.colors.text,
    ...Typography.default(),
  },
  codexServiceCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  codexServiceHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  codexServiceTitle: {
    fontSize: 12,
    fontWeight: "600",
    ...Typography.default("semiBold"),
  },
  codexServiceDetail: {
    fontSize: 12.5,
    lineHeight: 17,
    color: theme.colors.text,
    ...Typography.default(),
  },
  codexServiceInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  codexServiceInlineText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  debugText: {
    color: theme.colors.agentEventText,
    fontSize: 12,
  },
}));
