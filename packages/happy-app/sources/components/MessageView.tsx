import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownView } from "./markdown/MarkdownView";
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
        <View style={styles.userMessageBubble}>
          <MarkdownView
            markdown={displayText}
            onOptionPress={handleOptionPress}
          />
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

  return (
    <View style={styles.agentMessageRow}>
      <View style={styles.avatarSlot}>
        {props.showAvatar && <FlavorIcon flavor={props.flavor} size={24} />}
      </View>
      <View
        style={[
          styles.agentMessageContainer,
          props.message.isThinking && { opacity: 0.3 },
        ]}
      >
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

    return (
      <View style={styles.agentEventContainer}>
        <Text style={styles.agentEventText}>
          {t("message.usageLimitUntil", {
            time: formatTime(props.event.endsAt),
          })}
        </Text>
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
  agentEventContainer: {
    marginHorizontal: 8,
    alignItems: "center",
    paddingVertical: 8,
  },
  agentEventText: {
    color: theme.colors.agentEventText,
    fontSize: 14,
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
