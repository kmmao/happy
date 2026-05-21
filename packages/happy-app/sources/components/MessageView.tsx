import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { MarkdownView } from "./markdown/MarkdownView";
import { storeTempText } from "@/sync/persistence";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import {
  Message,
  UserTextMessage,
  AgentTextMessage,
  ToolCallMessage,
} from "@/sync/typesMessage";
import { Metadata } from "@/sync/storageTypes";
import { useLayout } from "./layout";
import { ToolView } from "./tools/ToolView";
import { AgentEvent } from "@/sync/typesRaw";
import { sync } from "@/sync/sync";
import { Option } from "./markdown/MarkdownView";
import { useSetting, useProjectForSession, useSession } from "@/sync/storage";
import { isSessionRunning } from "@/utils/sessionUtils";
import { getAutoOptionFeedbackStats } from "@/sync/autoOptionFeedback";
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
import type { MessageMeta } from "@/sync/typesMessageMeta";
import { StreamingTextView } from "./StreamingTextView";
import { parseLocalCommandMessage, isUserSlashCommandEcho } from "./parseLocalCommandMessage";

function buildUserMetaBadgeText(meta: MessageMeta | undefined): string | null {
  if (!meta) return null;
  const parts: string[] = [];

  if (meta.permissionMode && meta.permissionMode !== "default") {
    const known: Record<string, string> = {
      acceptEdits: t("agentInput.permissionMode.acceptEdits"),
      plan: t("agentInput.permissionMode.plan"),
      dontAsk: t("agentInput.permissionMode.dontAsk"),
      auto: t("agentInput.permissionMode.auto"),
      bypassPermissions: t("agentInput.permissionMode.bypassPermissions"),
      yolo: t("agentInput.permissionMode.bypassPermissions"),
      readOnly: t("agentInput.codexPermissionMode.readOnly"),
      safeYolo: t("agentInput.codexPermissionMode.safeYolo"),
    };
    const label = known[meta.permissionMode];
    if (label) parts.push(label);
  }

  if (meta.model) {
    parts.push(formatModelName(meta.model));
  }

  if (meta.effort) {
    const effortLabels: Record<string, string> = {
      low: t("agentInput.effort.low"),
      medium: t("agentInput.effort.medium"),
      high: t("agentInput.effort.high"),
      max: t("agentInput.effort.max"),
      xhigh: t("agentInput.effort.xhigh"),
    };
    const label = effortLabels[meta.effort];
    if (label) parts.push(label);
  }

  const thinkingType = meta.thinking?.type;
  if (thinkingType && thinkingType !== "adaptive") {
    const thinkingLabels: Record<string, string> = {
      enabled: t("agentInput.thinking.enabled"),
      disabled: t("agentInput.thinking.disabled"),
    };
    const label = thinkingLabels[thinkingType];
    if (label) parts.push(label);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

export const MessageView = React.memo((props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  showAvatar?: boolean;
  isLatestAgent?: boolean;
  hasTurnsWithThinking?: boolean;
  thinkingMode?: "adaptive" | "enabled" | null;
  permissionModeKey?: string | null;
  contentMaxWidth?: number;
}) => {
  const layout = useLayout();
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
          thinkingMode={props.thinkingMode}
          permissionModeKey={props.permissionModeKey}
        />
      </View>
    </View>
  );
});

// RenderBlock function that dispatches to the correct component based on message kind
function RenderBlock(props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  showAvatar?: boolean;
  isLatestAgent?: boolean;
  hasTurnsWithThinking?: boolean;
  thinkingMode?: "adaptive" | "enabled" | null;
  permissionModeKey?: string | null;
}): React.ReactElement {
  switch (props.message.kind) {
    case "user-text":
      return (
        <UserTextBlock message={props.message} metadata={props.metadata} sessionId={props.sessionId} />
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
          thinkingMode={props.thinkingMode}
        />
      );

    default:
      // Exhaustive check - TypeScript will error if we miss a case
      const _exhaustive: never = props.message;
      throw new Error(`Unknown message kind: ${_exhaustive}`);
  }
}

function UserTextBlock(props: { message: UserTextMessage; metadata: Metadata | null; sessionId: string }) {
  const { toggleBookmark, isBookmarked } = useBookmarks();
  const appendToInput = useAppendToInput();
  const { theme } = useUnistyles();
  const router = useRouter();
  const session = useSession(props.sessionId);

  // The user's own slash-command input is shown optimistically (carries a
  // localId); the SDK then injects the canonical wrapper chip. Hide the raw
  // echo so we don't render the command twice. Gated to Claude flavor only:
  // Codex/Gemini don't reliably emit the <command-*> wrapper, so hiding the
  // echo there would drop the command with nothing to replace it.
  const isClaudeFlavor = !props.metadata?.flavor || props.metadata.flavor === 'claude';
  if (isClaudeFlavor && isUserSlashCommandEcho(props.message.text, props.message.localId != null)) {
    return null;
  }

  // Parse local command messages (slash commands wrapped by the SDK)
  const parsedCommand = parseLocalCommandMessage(props.message.displayText || props.message.text);
  if (parsedCommand.kind === 'caveat') {
    return null;
  }
  if (parsedCommand.kind === 'command-run') {
    return (
      <View style={styles.chipContainer}>
        <View style={[styles.commandChip, { backgroundColor: theme.colors.surfaceHigh }]}>
          <Ionicons name="terminal-outline" size={14} color={theme.colors.textSecondary} />
          <Text style={[styles.commandChipText, { color: theme.colors.textSecondary }]}>
            /{parsedCommand.commandName}
          </Text>
        </View>
      </View>
    );
  }

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

  const metaBadgeText = React.useMemo(
    () => buildUserMetaBadgeText(props.message.meta),
    [props.message.meta],
  );

  const parsed = React.useMemo(
    () => parseImageRefs(props.message.text),
    [props.message.text],
  );

  const displayText =
    parsed.imagePaths.length > 0
      ? parsed.text
      : props.message.displayText || props.message.text;

  const hasFullContent =
    parsed.imagePaths.length === 0 &&
    props.message.displayText != null &&
    props.message.displayText.length > 0 &&
    props.message.text !== props.message.displayText;

  // Hidden synthetic messages (e.g. auto-summary triggers from the CLI) send
  // an empty `displayText` so the Agent sees the underlying prompt but the
  // chat surface stays clean. Short-circuit the whole block so the row-spacing
  // container doesn't leave a phantom gap.
  if (displayText.length === 0 && parsed.imagePaths.length === 0) {
    return null;
  }

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
            {metaBadgeText != null && (
              <Text style={styles.messageMeta}>{metaBadgeText}</Text>
            )}
            {props.message.meta?.source === "auto-option-send" && (
              <View style={styles.autoSentBadge}>
                <Ionicons name="sparkles" size={9} color={theme.colors.radio.active} />
                <Text style={styles.autoSentBadgeText}>{t("session.autoSent")}</Text>
              </View>
            )}
            {hasFullContent && (
              <Pressable
                onPress={() => {
                  const textId = storeTempText(props.message.text);
                  router.push(`/text-selection?textId=${textId}`);
                }}
                style={styles.expandFullButton}
                hitSlop={8}
              >
                <Text style={styles.expandFullButtonText}>
                  {t("session.viewFullContent")}
                </Text>
              </Pressable>
            )}
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
          </View>
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
  const appendToInput = useAppendToInput();
  const session = useSession(props.sessionId);
  const [thinkingExpanded, setThinkingExpanded] = React.useState(
    expandThinkingByDefault,
  );
  React.useEffect(() => {
    setThinkingExpanded(expandThinkingByDefault);
  }, [expandThinkingByDefault]);
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
  const project = useProjectForSession(props.sessionId);
  const optionStatsProjectId = project?.id ?? `session:${props.sessionId}`;
  const optionStatsResolver = React.useCallback(
    (optionText: string) => getAutoOptionFeedbackStats(optionStatsProjectId, optionText),
    [optionStatsProjectId],
  );

  // True when this is the latest agent message AND the session is actively streaming.
  // We use a lightweight StreamingTextView during streaming to avoid re-parsing the
  // full Markdown on every delta. Once streaming stops, we switch back to MarkdownView.
  //
  // Once a message has been rendered as MarkdownView (streaming finished), it must
  // never switch back to StreamingTextView — otherwise sending a new message would
  // replay the typing animation on the previous reply and lose <options> styling.
  const sessionRunning = session != null && isSessionRunning(session);
  const wasRenderedAsMarkdown = React.useRef(false);
  if (!(props.isLatestAgent === true && sessionRunning)) {
    wasRenderedAsMarkdown.current = true;
  }
  const isStreaming = props.isLatestAgent === true && sessionRunning && !wasRenderedAsMarkdown.current;

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
                optionStatsResolver={optionStatsResolver}
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
        ) : isStreaming ? (
          // During active streaming: skip Markdown parsing (100% cache-miss, O(n²))
          // and render raw text. Switches back to MarkdownView once streaming ends.
          <StreamingTextView text={props.message.text} />
        ) : (
          <MarkdownView
            markdown={props.message.text}
            onOptionPress={handleOptionPress}
            optionStatsResolver={optionStatsResolver}
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
  thinkingMode?: "adaptive" | "enabled" | null;
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
      return (
        <View style={styles.turnStatsContainer}>
          <View
            style={[
              styles.turnStatBadge,
              {
                backgroundColor: theme.colors.agentEventText + "0E",
                borderColor: theme.colors.agentEventText + "20",
                opacity: 0.6,
              },
            ]}
          >
            <Text style={styles.turnStatBadgeText}>{t("message.turnEnd")}</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.turnStatsContainer}>
        {props.hasTurnsWithThinking && (() => {
          const thinkingLabel =
            props.thinkingMode === "adaptive"
              ? t("agentInput.thinking.adaptive")
              : props.thinkingMode === "enabled"
                ? t("agentInput.thinking.enabled")
                : t("message.thinkingMarker");
          return (
            <View
              style={[
                styles.turnStatBadge,
                {
                  backgroundColor: theme.colors.agentEventText + "12",
                  borderColor: theme.colors.agentEventText + "20",
                },
              ]}
            >
              <Text style={styles.turnStatBadgeText}>{thinkingLabel}</Text>
            </View>
          );
        })()}
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
  messageMeta: {
    ...Typography.default(),
    fontSize: 10,
    color: theme.colors.textSecondary,
    opacity: 0.65,
    alignSelf: "flex-end" as const,
    marginTop: 4,
    marginBottom: 2,
  },
  autoSentBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    alignSelf: "flex-end" as const,
    gap: 3,
    marginTop: 4,
    marginBottom: 2,
  },
  autoSentBadgeText: {
    fontSize: 10,
    color: theme.colors.radio.active,
    opacity: 0.8,
  },
  expandFullButton: {
    paddingHorizontal: 0,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: theme.colors.divider,
    marginTop: 4,
  },
  expandFullButtonText: {
    ...Typography.mono(),
    color: theme.colors.textLink,
    fontSize: 12,
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
    paddingVertical: 8,
  },
  agentEventText: {
    color: theme.colors.agentEventText,
    fontSize: 14,
    textAlign: "center",
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
  chipContainer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  commandChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  commandChipText: {
    fontSize: 13,
    ...Typography.mono(),
  },
}));
