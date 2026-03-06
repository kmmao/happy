import * as React from "react";
import { useSession, useSessionMessages } from "@/sync/storage";
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  View,
  ViewToken,
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
const UNGROUPABLE_TOOLS = new Set([
  "Task",
  "Agent",
  "AskUserQuestion",
  "TodoWrite",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
]);

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
  cacheRead?: number;
  totalInput?: number;
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
      onVisibleUserMessageChange?: (msgIndex: number) => void;
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
        onVisibleUserMessageChange={props.onVisibleUserMessageChange}
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
      onVisibleUserMessageChange?: (msgIndex: number) => void;
    }
  >((props, ref) => {
    const flatListRef = React.useRef<FlatList>(null);
    const isAwayRef = React.useRef(false);
    const currentUserMsgIndexRef = React.useRef(-1);

    // Pre-compute which agent-text messages should show an avatar.
    // In an inverted list, index+1 is the visually "previous" (above) message.
    // Show avatar on the first agent-text in a consecutive run.
    // Also find the latest (newest) agent-text message ID (index 0 = newest).
    const { showAvatarMap, latestAgentId } = React.useMemo(() => {
      const map = new Map<string, boolean>();
      let latestId: string | null = null;
      for (let i = 0; i < props.messages.length; i++) {
        const msg = props.messages[i];
        if (msg.kind === "agent-text") {
          if (!latestId) latestId = msg.id;
          const prev = props.messages[i + 1];
          map.set(msg.id, !prev || prev.kind !== "agent-text");
        }
      }
      return { showAvatarMap: map, latestAgentId: latestId };
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
          let cacheRead: number | undefined;
          let totalInput: number | undefined;

          // Search backward in the original messages (toward newer / index 0)
          // for the same-turn ready event (includes model + per-turn tokens).
          for (let i = groupStartIdx - 1; i >= 0; i--) {
            const m = props.messages[i];
            if (m.kind === "user-text") break;
            if (m.kind === "agent-event" && m.event.type === "ready") {
              model = m.event.model;
              if (m.event.usage) {
                const cr = m.event.usage.cache_read_input_tokens ?? 0;
                const cc = m.event.usage.cache_creation_input_tokens ?? 0;
                turnTokens =
                  m.event.usage.input_tokens +
                  m.event.usage.output_tokens +
                  cc +
                  cr;
                cacheRead = cr;
                totalInput = m.event.usage.input_tokens + cc + cr;
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
            cacheRead,
            totalInput,
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

    // Map displayItems index → original messages index.
    // ToolGroups collapse N tool-call messages into 1 displayItem,
    // so the indices diverge. useLatestOptions needs messages indices.
    const displayToMsgIndex = React.useMemo(() => {
      const map = new Map<number, number>();
      let msgIdx = 0;
      for (let di = 0; di < displayItems.length; di++) {
        const item = displayItems[di];
        if (item.kind === "tool-group") {
          map.set(di, msgIdx);
          msgIdx += item.messages.length;
        } else {
          map.set(di, msgIdx);
          msgIdx++;
        }
      }
      return map;
    }, [displayItems]);

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
        // Return the original messages array index (not displayItems index)
        return displayToMsgIndex.get(targetIndex) ?? -1;
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

    // Track visible user messages for scroll-based options detection.
    // Use refs so the callback is stable (FlatList requirement).
    const onVisibleUserMsgRef = React.useRef(props.onVisibleUserMessageChange);
    onVisibleUserMsgRef.current = props.onVisibleUserMessageChange;
    const displayToMsgIndexRef = React.useRef(displayToMsgIndex);
    displayToMsgIndexRef.current = displayToMsgIndex;
    const displayItemsRef = React.useRef(displayItems);
    displayItemsRef.current = displayItems;

    const viewabilityPairs = React.useRef([
      {
        viewabilityConfig: { itemVisiblePercentThreshold: 30 },
        onViewableItemsChanged: ({
          viewableItems,
        }: {
          viewableItems: ViewToken[];
        }) => {
          const cb = onVisibleUserMsgRef.current;
          if (!cb) return;
          const items = displayItemsRef.current;
          const map = displayToMsgIndexRef.current;
          // Find the lowest-index (most recent) user-text in viewable area
          for (const vt of viewableItems) {
            if (vt.index == null) continue;
            const item = items[vt.index];
            if (item?.kind === "user-text") {
              const msgIdx = map.get(vt.index);
              if (msgIdx !== undefined) {
                cb(msgIdx);
                return;
              }
            }
          }
          cb(-1);
        },
      },
    ]);

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
              cacheRead={item.cacheRead}
              totalInput={item.totalInput}
            />
          );
        }
        return (
          <MessageView
            message={item}
            metadata={props.metadata}
            sessionId={props.sessionId}
            showAvatar={showAvatarMap.get(item.id) ?? false}
            isLatestAgent={item.id === latestAgentId}
          />
        );
      },
      [props.metadata, props.sessionId, showAvatarMap, latestAgentId],
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
        viewabilityConfigCallbackPairs={viewabilityPairs.current}
        ListHeaderComponent={<ListFooter sessionId={props.sessionId} />}
        ListFooterComponent={<ListHeader />}
      />
    );
  }),
);
