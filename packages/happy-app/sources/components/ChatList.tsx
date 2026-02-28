import * as React from "react";
import { useSession, useSessionMessages } from "@/sync/storage";
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  View,
} from "react-native";
import { useCallback } from "react";
import { useHeaderHeight } from "@/utils/responsive";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MessageView } from "./MessageView";
import { Metadata, Session } from "@/sync/storageTypes";
import { ChatFooter } from "./ChatFooter";
import { Message, ToolCallMessage } from "@/sync/typesMessage";
import { ToolGroupView } from "./ToolGroupView";
import { knownTools } from "./tools/knownTools";

// Tools that should NOT be grouped (they have special UI or require interaction)
const UNGROUPABLE_TOOLS = new Set(["Task", "AskUserQuestion", "TodoWrite"]);

function isToolGroupable(toolName: string): boolean {
  if (UNGROUPABLE_TOOLS.has(toolName)) return false;
  const knownTool = knownTools[toolName as keyof typeof knownTools] as any;
  if (knownTool?.hidden) return false;
  return true;
}
const MIN_GROUP_SIZE = 3;

type ToolGroup = {
  kind: "tool-group";
  id: string;
  messages: ToolCallMessage[];
  model?: string;
  turnTokens?: number;
};

type DisplayItem = Message | ToolGroup;

export interface ChatListHandle {
  scrollToBottom: () => void;
  scrollToUserMessage: (direction: "prev" | "next") => number;
  getUserMessageCount: () => number;
}

export const ChatList = React.memo(
  React.forwardRef<
    ChatListHandle,
    {
      session: Session;
      onScrollAwayFromBottom?: (isAway: boolean) => void;
      onScrollActivity?: () => void;
    }
  >((props, ref) => {
    const { messages } = useSessionMessages(props.session.id);
    return (
      <ChatListInternal
        ref={ref}
        metadata={props.session.metadata}
        sessionId={props.session.id}
        messages={messages}
        onScrollAwayFromBottom={props.onScrollAwayFromBottom}
        onScrollActivity={props.onScrollActivity}
      />
    );
  }),
);

const ListHeader = React.memo(() => {
  const headerHeight = useHeaderHeight();
  const safeArea = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: headerHeight + safeArea.top + 32,
      }}
    />
  );
});

const ListFooter = React.memo((props: { sessionId: string }) => {
  const session = useSession(props.sessionId)!;
  return (
    <ChatFooter
      controlledByUser={session.agentState?.controlledByUser || false}
    />
  );
});

const SCROLL_AWAY_THRESHOLD = 200;

const ChatListInternal = React.memo(
  React.forwardRef<
    ChatListHandle,
    {
      metadata: Metadata | null;
      sessionId: string;
      messages: Message[];
      onScrollAwayFromBottom?: (isAway: boolean) => void;
      onScrollActivity?: () => void;
    }
  >((props, ref) => {
    const flatListRef = React.useRef<FlatList>(null);
    const isAwayRef = React.useRef(false);
    const currentUserMsgIndexRef = React.useRef(-1);

    // Pre-compute which agent-text messages should show an avatar.
    // In an inverted list, index+1 is the visually "previous" (above) message.
    // Show avatar on the first agent-text in a consecutive run.
    const showAvatarMap = React.useMemo(() => {
      const map = new Map<string, boolean>();
      for (let i = 0; i < props.messages.length; i++) {
        const msg = props.messages[i];
        if (msg.kind === "agent-text") {
          const prev = props.messages[i + 1];
          map.set(msg.id, !prev || prev.kind !== "agent-text");
        }
      }
      return map;
    }, [props.messages]);

    // Group consecutive tool-call messages (3+) into collapsible groups.
    // The list is inverted (index 0 = newest), so we iterate normally
    // and group consecutive groupable tool-calls.
    const displayItems: DisplayItem[] = React.useMemo(() => {
      const result: DisplayItem[] = [];
      let currentGroup: ToolCallMessage[] = [];
      let groupStartIdx = -1;

      const flushGroup = () => {
        if (currentGroup.length >= MIN_GROUP_SIZE) {
          let model: string | undefined;
          let turnTokens: number | undefined;

          // Search backward in the original messages (toward newer / index 0)
          // for the same-turn ready event (includes model + per-turn tokens).
          for (let i = groupStartIdx - 1; i >= 0; i--) {
            const m = props.messages[i];
            if (m.kind === "user-text") break;
            if (m.kind === "agent-event" && m.event.type === "ready") {
              model = m.event.model;
              if (m.event.usage) {
                turnTokens =
                  m.event.usage.input_tokens +
                  m.event.usage.output_tokens +
                  (m.event.usage.cache_creation_input_tokens ?? 0) +
                  (m.event.usage.cache_read_input_tokens ?? 0);
              }
              break;
            }
          }

          // Fallback: if no ready event found (running turn), search forward
          // (toward older messages) for a previous turn's ready event.
          // Only take the model name — tokens belong to a different turn.
          if (!model) {
            const afterGroup = groupStartIdx + currentGroup.length;
            for (let i = afterGroup; i < props.messages.length; i++) {
              const m = props.messages[i];
              if (m.kind === "agent-event" && m.event.type === "ready") {
                model = m.event.model;
                break;
              }
            }
          }

          result.push({
            kind: "tool-group",
            id: `group-${currentGroup[0].id}`,
            messages: [...currentGroup],
            model,
            turnTokens,
          });
        } else {
          for (const msg of currentGroup) {
            result.push(msg);
          }
        }
        currentGroup = [];
        groupStartIdx = -1;
      };

      for (let idx = 0; idx < props.messages.length; idx++) {
        const msg = props.messages[idx];
        const isGroupable =
          msg.kind === "tool-call" && isToolGroupable(msg.tool.name);

        if (isGroupable) {
          if (currentGroup.length === 0) groupStartIdx = idx;
          currentGroup.push(msg as ToolCallMessage);
        } else {
          flushGroup();
          result.push(msg);
        }
      }
      flushGroup();

      return result;
    }, [props.messages]);

    // Collect user-text message indices in displayItems (not props.messages)
    // since the FlatList now uses displayItems as data.
    const userMessageIndices = React.useMemo(
      () =>
        displayItems
          .map((item, i) => (item.kind === "user-text" ? i : -1))
          .filter((i) => i !== -1),
      [displayItems],
    );

    React.useImperativeHandle(ref, () => ({
      scrollToBottom: () => {
        flatListRef.current?.scrollToOffset({
          offset: 0,
          animated: true,
        });
      },
      scrollToUserMessage: (direction: "prev" | "next") => {
        if (userMessageIndices.length === 0) return -1;

        if (direction === "next") {
          // "Next" = older user message = higher index in inverted list
          const nextPos = userMessageIndices.findIndex(
            (i) => i > currentUserMsgIndexRef.current,
          );
          if (nextPos === -1) return currentUserMsgIndexRef.current;
          currentUserMsgIndexRef.current = userMessageIndices[nextPos];
        } else {
          // "Prev" = newer user message = lower index in inverted list
          const candidates = userMessageIndices.filter(
            (i) => i < currentUserMsgIndexRef.current,
          );
          if (candidates.length === 0) {
            // Already at newest, go to the first one
            currentUserMsgIndexRef.current = userMessageIndices[0];
          } else {
            currentUserMsgIndexRef.current = candidates[candidates.length - 1];
          }
        }

        const targetIndex = currentUserMsgIndexRef.current;
        if (targetIndex >= 0 && targetIndex < displayItems.length) {
          flatListRef.current?.scrollToIndex({
            index: targetIndex,
            animated: true,
            viewPosition: 0.5,
          });
        }
        return targetIndex;
      },
      getUserMessageCount: () => userMessageIndices.length,
    }));

    const handleScrollToIndexFailed = useCallback(
      (info: { index: number; averageItemLength: number }) => {
        // Scroll to approximate offset, then retry after layout settles
        flatListRef.current?.scrollToOffset({
          offset: info.averageItemLength * info.index,
          animated: true,
        });
        setTimeout(() => {
          if (info.index >= 0 && info.index < displayItems.length) {
            flatListRef.current?.scrollToIndex({
              index: info.index,
              animated: true,
              viewPosition: 0.5,
            });
          }
        }, 200);
      },
      [displayItems.length],
    );

    const handleScroll = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offsetY = event.nativeEvent.contentOffset.y;
        const isAway = offsetY > SCROLL_AWAY_THRESHOLD;
        if (isAway !== isAwayRef.current) {
          isAwayRef.current = isAway;
          props.onScrollAwayFromBottom?.(isAway);
        }
        props.onScrollActivity?.();
      },
      [props.onScrollAwayFromBottom, props.onScrollActivity],
    );

    const keyExtractor = useCallback((item: DisplayItem) => item.id, []);
    const renderItem = useCallback(
      ({ item }: { item: DisplayItem }) => {
        if (item.kind === "tool-group") {
          return (
            <ToolGroupView
              messages={item.messages}
              metadata={props.metadata}
              sessionId={props.sessionId}
              model={item.model}
              turnTokens={item.turnTokens}
            />
          );
        }
        return (
          <MessageView
            message={item}
            metadata={props.metadata}
            sessionId={props.sessionId}
            showAvatar={showAvatarMap.get(item.id) ?? false}
          />
        );
      },
      [props.metadata, props.sessionId, showAvatarMap],
    );
    return (
      <FlatList
        ref={flatListRef}
        data={displayItems}
        inverted={true}
        keyExtractor={keyExtractor}
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
          autoscrollToTopThreshold: 10,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
        renderItem={renderItem}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        onScroll={handleScroll}
        scrollEventThrottle={400}
        ListHeaderComponent={<ListFooter sessionId={props.sessionId} />}
        ListFooterComponent={<ListHeader />}
      />
    );
  }),
);
