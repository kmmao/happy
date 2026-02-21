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
import { useSetting } from "@/sync/storage";
import { FlavorIcon } from "./FlavorIcon";
import { MessageImage } from "./MessageImage";
import { parseImageRefs } from "@/utils/parseImageRefs";
import { useBookmarks } from "@/hooks/useBookmarks";

export const MessageView = (props: {
  message: Message;
  metadata: Metadata | null;
  sessionId: string;
  getMessageById?: (id: string) => Message | null;
  showAvatar?: boolean;
}) => {
  return (
    <View style={styles.messageContainer} renderToHardwareTextureAndroid={true}>
      <View style={styles.messageContent}>
        <RenderBlock
          message={props.message}
          metadata={props.metadata}
          sessionId={props.sessionId}
          getMessageById={props.getMessageById}
          showAvatar={props.showAvatar}
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
        />
      );

    case "tool-call":
      return (
        <ToolCallBlock
          message={props.message}
          metadata={props.metadata}
          sessionId={props.sessionId}
          getMessageById={props.getMessageById}
        />
      );

    case "agent-event":
      return (
        <AgentEventBlock
          event={props.message.event}
          metadata={props.metadata}
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
  const { theme } = useUnistyles();

  const handleOptionPress = React.useCallback(
    (option: Option) => {
      sync.sendMessage(props.sessionId, option.title);
    },
    [props.sessionId],
  );

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
            />
          ))}
        </View>
      )}
      {displayText.length > 0 && (
        <View style={styles.userBubbleRow}>
          <Pressable
            style={({ pressed }) => [
              styles.userBookmarkButton,
              pressed && { opacity: 0.5 },
            ]}
            onPress={() => toggleBookmark(displayText, "user")}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={bookmarked ? "bookmark" : "bookmark-outline"}
              size={14}
              color={
                bookmarked
                  ? theme.colors.radio.active
                  : theme.colors.textSecondary
              }
            />
          </Pressable>
          <View style={styles.userMessageBubble}>
            <MarkdownView
              markdown={displayText}
              onOptionPress={handleOptionPress}
            />
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
}) {
  const experiments = useSetting("experiments");
  const { theme } = useUnistyles();
  const [thinkingExpanded, setThinkingExpanded] = React.useState(false);
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
    return (
      <View style={styles.agentMessageRow}>
        <View style={styles.avatarSlot}>
          {props.showAvatar && <FlavorIcon flavor={props.flavor} size={24} />}
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
            <Text style={styles.thinkingLabel}>
              {t("sessionInfo.thinking")}
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

  return (
    <View style={styles.agentMessageRow}>
      <View style={styles.avatarSlot}>
        {props.showAvatar && <FlavorIcon flavor={props.flavor} size={24} />}
      </View>
      <View style={styles.agentMessageContainer}>
        <MarkdownView
          markdown={props.message.text}
          onOptionPress={handleOptionPress}
        />
      </View>
    </View>
  );
}

function formatModelName(model: string): string {
  // Strip date suffix from model IDs like "claude-sonnet-4-6-20250514" → "claude-sonnet-4-6"
  return model.replace(/-\d{8}$/, "");
}

function formatTokenCount(count: number): string {
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

function AgentEventBlock(props: {
  event: AgentEvent;
  metadata: Metadata | null;
}) {
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
  if (props.event.type === "ready") {
    const { model, usage, durationMs } = props.event;
    if (!model && !usage && durationMs === undefined) {
      return null;
    }
    const totalTokens = usage
      ? usage.input_tokens +
        usage.output_tokens +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0)
      : null;
    const tokensStr =
      totalTokens !== null ? formatTokenCount(totalTokens) : null;
    const durationStr =
      durationMs !== undefined ? formatDuration(durationMs) : null;
    const modelStr = model ? formatModelName(model) : null;

    let label: string;
    if (modelStr && tokensStr && durationStr) {
      label = t("message.turnStats", {
        model: modelStr,
        tokens: tokensStr,
        duration: durationStr,
      });
    } else if (tokensStr && durationStr) {
      label = t("message.turnStatsNoModel", {
        tokens: tokensStr,
        duration: durationStr,
      });
    } else {
      const parts = [
        modelStr,
        tokensStr && `${tokensStr} tokens`,
        durationStr,
      ].filter(Boolean);
      label = parts.join(" · ");
    }

    return (
      <View style={styles.turnStatsContainer}>
        <Text style={styles.turnStatsText}>{label}</Text>
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
    maxWidth: layout.maxWidth,
  },
  userMessageContainer: {
    maxWidth: "100%",
    flexDirection: "column",
    alignItems: "flex-end",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
  },
  userBubbleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
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
    marginBottom: 12,
    maxWidth: "100%",
  },
  agentMessageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingLeft: 8,
  },
  avatarSlot: {
    width: 32,
    paddingTop: 8,
    alignItems: "center",
    flexShrink: 0,
  },
  agentMessageContainer: {
    marginRight: 16,
    marginBottom: 12,
    borderRadius: 16,
    flex: 1,
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
    marginHorizontal: 8,
    marginTop: 2,
    marginBottom: 8,
    alignItems: "flex-start",
    paddingLeft: 40,
  },
  turnStatsText: {
    color: theme.colors.agentEventText,
    fontSize: 11,
    opacity: 0.6,
  },
  toolContainer: {
    marginHorizontal: 8,
  },
  debugText: {
    color: theme.colors.agentEventText,
    fontSize: 12,
  },
}));
