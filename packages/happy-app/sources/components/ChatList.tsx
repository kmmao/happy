import * as React from "react";
import { useSession, useSessionMessages, useSetting } from "@/sync/storage";
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
import { isSessionRunning } from "@/utils/sessionUtils";
import { Message } from "@/sync/typesMessage";
import { knownTools } from "./tools/knownTools";
import { parseLegacyCodexDiffPreview } from "./tools/codexDiffCompat";
import { TypingBubble } from "./TypingBubble";

type DisplayItem = Message;

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
      contentMaxWidth?: number;
    }
  >((props, ref) => {
    const { messages } = useSessionMessages(props.session.id);
    return (
      <ChatListInternal
        ref={ref}
        metadata={props.session.metadata}
        sessionId={props.session.id}
        messages={messages}
        permissionModeKey={props.session.permissionMode}
        onScrollAwayFromBottom={props.onScrollAwayFromBottom}
        onScrollActivity={props.onScrollActivity}
        onVisibleUserMessageChange={props.onVisibleUserMessageChange}
        contentMaxWidth={props.contentMaxWidth}
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

const ListFooter = React.memo((props: { sessionId: string; contentMaxWidth?: number }) => {
  const session = useSession(props.sessionId)!;
  const { messages } = useSessionMessages(props.sessionId);
  const isThinking = isSessionRunning(session);
  const lastMsg = messages.length > 0 ? messages[0] : undefined;
  const showTyping =
    isThinking &&
    lastMsg?.kind !== "agent-text" &&
    lastMsg?.kind !== "agent-event";
  return (
    <>
      {showTyping && (
        <TypingBubble contentMaxWidth={props.contentMaxWidth} />
      )}
      <ChatFooter
        controlledByUser={session.agentState?.controlledByUser || false}
      />
    </>
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
      permissionModeKey?: string | null;
      onScrollAwayFromBottom?: (isAway: boolean) => void;
      onScrollActivity?: () => void;
      onVisibleUserMessageChange?: (msgIndex: number) => void;
      contentMaxWidth?: number;
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

    // For each "ready" agent-event, check if the same turn had thinking messages.
    // In the inverted list (index 0 = newest), a turn's ready event precedes
    // (lower index) the agent-text/tool-call messages of that turn (higher index).
    // Scan forward (higher index = older) from each ready event until the next
    // user-text or another ready event, looking for isThinking agent-text messages.
    const thinkingTurnIds = React.useMemo(() => {
      const set = new Set<string>();
      for (let i = 0; i < props.messages.length; i++) {
        const msg = props.messages[i];
        if (msg.kind === "agent-event" && msg.event.type === "ready") {
          // Scan forward (older messages in the same turn)
          for (let j = i + 1; j < props.messages.length; j++) {
            const m = props.messages[j];
            if (m.kind === "user-text") break;
            if (m.kind === "agent-event" && m.event.type === "ready") break;
            if (m.kind === "agent-text" && m.isThinking) {
              set.add(msg.id);
              break;
            }
          }
        }
      }
      return set;
    }, [props.messages]);

    // Filter tool-call messages based on viewInline setting.
    // When viewInline is off, hide main agent tool calls (except special ones).
    const viewInline = useSetting("viewInline");
    const displayItems: DisplayItem[] = React.useMemo(() => {
      const visibleMessages = viewInline
        ? props.messages
        : (() => {
            // When viewInline is off, filter out tool-call messages.
            const ALWAYS_VISIBLE_TOOLS = new Set([
              "Task",
              "Agent",
              "AskUserQuestion",
              "TodoWrite",
              "Read",
              "Edit",
              "MultiEdit",
              "Write",
              "Grep",
              "Glob",
              "LS",
              "NotebookEdit",
              "CodexDynamicTool",
              "CodexPermissions",
              "unknown",
              "CodexPatch",
              "GeminiPatch",
              "CodexDiff",
              "GeminiDiff",
              "edit",
            ]);
            return props.messages.filter((msg) => {
              if (msg.kind !== "tool-call") return true;
              if (ALWAYS_VISIBLE_TOOLS.has(msg.tool.name)) return true;
              if (msg.tool.name.startsWith("mcp__")) return true;
              if (msg.tool.permission?.status === "pending") return true;
              const knownTool = knownTools[
                msg.tool.name as keyof typeof knownTools
              ] as any;
              if (knownTool?.hidden) return false;
              return false;
            });
          })();

      const dedupedMessages: DisplayItem[] = [];
      for (const msg of visibleMessages) {
        if (msg.kind === "agent-text") {
          const preview = parseLegacyCodexDiffPreview(msg.text);
          const lastMessage = dedupedMessages[dedupedMessages.length - 1];
          if (preview && lastMessage?.kind === "agent-text") {
            const lastPreview = parseLegacyCodexDiffPreview(lastMessage.text);
            if (
              lastPreview &&
              lastPreview.unifiedDiff === preview.unifiedDiff &&
              (lastPreview.prefixMarkdown ?? "") ===
                (preview.prefixMarkdown ?? "")
            ) {
              continue;
            }
          }
        }
        dedupedMessages.push(msg);
      }

      return dedupedMessages;
    }, [props.messages, viewInline]);

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
    // When viewInline is off, some messages are filtered out, so indices diverge.
    const displayToMsgIndex = React.useMemo(() => {
      if (viewInline) {
        // 1:1 mapping when all messages are shown
        const map = new Map<number, number>();
        for (let i = 0; i < displayItems.length; i++) {
          map.set(i, i);
        }
        return map;
      }
      const map = new Map<number, number>();
      let msgIdx = 0;
      let diIdx = 0;
      for (let mi = 0; mi < props.messages.length; mi++) {
        if (diIdx < displayItems.length && displayItems[diIdx] === props.messages[mi]) {
          map.set(diIdx, mi);
          diIdx++;
        }
      }
      return map;
    }, [displayItems, props.messages, viewInline]);

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
        const hasThinking =
          item.kind === "agent-event" &&
          item.event.type === "ready" &&
          thinkingTurnIds.has(item.id);
        return (
          <MessageView
            message={item}
            metadata={props.metadata}
            sessionId={props.sessionId}
            showAvatar={showAvatarMap.get(item.id) ?? false}
            isLatestAgent={item.id === latestAgentId}
            hasTurnsWithThinking={hasThinking}
            permissionModeKey={props.permissionModeKey}
            contentMaxWidth={props.contentMaxWidth}
          />
        );
      },
      [
        props.metadata,
        props.sessionId,
        showAvatarMap,
        latestAgentId,
        thinkingTurnIds,
        props.permissionModeKey,
        props.contentMaxWidth,
      ],
    );
    return (
      <FlatList
        ref={flatListRef}
        data={displayItems}
        inverted={true}
        keyExtractor={keyExtractor}
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
          autoscrollToTopThreshold: 300,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
        renderItem={renderItem}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        onScroll={handleScroll}
        scrollEventThrottle={400}
        showsVerticalScrollIndicator={false}
        viewabilityConfigCallbackPairs={viewabilityPairs.current}
        ListHeaderComponent={<ListFooter sessionId={props.sessionId} contentMaxWidth={props.contentMaxWidth} />}
        ListFooterComponent={<ListHeader />}
      />
    );
  }),
);
