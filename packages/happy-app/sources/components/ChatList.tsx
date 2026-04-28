import * as React from "react";
import {
  useSession,
  useSessionMessages,
  useSetting,
  MAX_DISPLAY_MESSAGES,
} from "@/sync/storage";
import {
  ActivityIndicator,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  View,
  ViewToken,
} from "react-native";
import { useCallback } from "react";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import { useHeaderHeight } from "@/utils/responsive";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MessageView } from "./MessageView";
import { Metadata, Session } from "@/sync/storageTypes";
import { ChatFooter } from "./ChatFooter";
import { Message } from "@/sync/typesMessage";
import { knownTools } from "./tools/knownTools";
import { parseLegacyCodexDiffPreview } from "./tools/codexDiffCompat";
import {
  buildChatDisplayItems,
  isTurnTimelineDisplayItem,
  type ChatDisplayItem,
} from "./chatTimelineDisplay";
import { TurnTimelineMessageView } from "./TurnTimelineMessageView";
import { shouldLogChatListTiming } from "./chatListPerformanceTiming";
import { log } from "@/log";

export interface ChatListHandle {
  scrollToBottom: () => void;
  scrollToUserMessage: (direction: "prev" | "next") => number;
  getUserMessageCount: () => number;
}

export const LOAD_MORE_INCREMENT = 100;
const CHAT_LIST_TIMING_THRESHOLD_MS = 8;
const CHAT_LIST_TIMING_COOLDOWN_MS = 5_000;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const ChatList = React.memo(
  React.forwardRef<
    ChatListHandle,
    {
      session: Session;
      displayLimit: number;
      onLoadMore: () => void;
      onScrollAwayFromBottom?: (isAway: boolean) => void;
      onScrollActivity?: () => void;
      onVisibleUserMessageChange?: (msgIndex: number) => void;
      contentMaxWidth?: number;
    }
  >((props, ref) => {
    const { messages, hasOlderMessages, isBackfilling } = useSessionMessages(
      props.session.id,
      props.displayLimit,
    );
    return (
      <ChatListInternal
        ref={ref}
        metadata={props.session.metadata}
        sessionId={props.session.id}
        messages={messages}
        hasOlderMessages={hasOlderMessages}
        isBackfilling={isBackfilling}
        onLoadMore={props.onLoadMore}
        permissionModeKey={props.session.permissionMode}
        onScrollAwayFromBottom={props.onScrollAwayFromBottom}
        onScrollActivity={props.onScrollActivity}
        onVisibleUserMessageChange={props.onVisibleUserMessageChange}
        contentMaxWidth={props.contentMaxWidth}
      />
    );
  }),
);

const OlderMessagesArea = React.memo(
  ({
    hasOlderMessages,
    isBackfilling,
    onLoadMore,
  }: {
    hasOlderMessages: boolean;
    isBackfilling: boolean;
    onLoadMore: () => void;
  }) => {
    const headerHeight = useHeaderHeight();
    const safeArea = useSafeAreaInsets();
    return (
      <View>
        {isBackfilling && !hasOlderMessages && (
          <View style={{ paddingVertical: 12, alignItems: "center" }}>
            <ActivityIndicator size="small" />
          </View>
        )}
        {hasOlderMessages && (
          <Pressable
            onPress={onLoadMore}
            style={{ paddingVertical: 12, alignItems: "center" }}
          >
            <Text style={{ opacity: 0.4, fontSize: 12 }}>
              {t("session.loadOlderMessages")}
            </Text>
          </Pressable>
        )}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            height: headerHeight + safeArea.top + 32,
          }}
        />
      </View>
    );
  },
);

const ListFooter = React.memo((props: { sessionId: string; contentMaxWidth?: number }) => {
  const session = useSession(props.sessionId)!;
  return (
    <>
      {/* TypingBubble hidden */}
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
      hasOlderMessages: boolean;
      isBackfilling: boolean;
      onLoadMore: () => void;
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
    const experiments = useSetting("experiments");
    const lastTimingLogAtRef = React.useRef<Record<string, number | null>>({
      thinkingTurnIds: null,
      displayItems: null,
    });

    const logTiming = React.useCallback(
      (label: "thinkingTurnIds" | "displayItems", durationMs: number) => {
        const nowMs = now();
        if (!shouldLogChatListTiming({
          durationMs,
          thresholdMs: CHAT_LIST_TIMING_THRESHOLD_MS,
          nowMs,
          lastLoggedAtMs: lastTimingLogAtRef.current[label],
          cooldownMs: CHAT_LIST_TIMING_COOLDOWN_MS,
        })) {
          return;
        }
        lastTimingLogAtRef.current = {
          ...lastTimingLogAtRef.current,
          [label]: nowMs,
        };
        log.warn(
          `[ChatList] ${label} took ${durationMs.toFixed(1)}ms for ${props.messages.length} messages`,
        );
      },
      [props.messages.length],
    );

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
      const startedAt = now();
      const set = new Set<string>();
      const MAX_INNER_SCAN = 100; // safety cap per turn
      for (let i = 0; i < props.messages.length; i++) {
        const msg = props.messages[i];
        if (msg.kind === "agent-event" && msg.event.type === "ready") {
          // Scan forward (older messages in the same turn)
          const limit = Math.min(i + 1 + MAX_INNER_SCAN, props.messages.length);
          for (let j = i + 1; j < limit; j++) {
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
      logTiming("thinkingTurnIds", now() - startedAt);
      return set;
    }, [props.messages, logTiming]);

    // Filter tool-call messages based on viewInline setting.
    // When viewInline is off, hide main agent tool calls (except special ones).
    const viewInline = useSetting("viewInline");
    const displayItems: ChatDisplayItem[] = React.useMemo(() => {
      const startedAt = now();
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

      const dedupedMessages: Message[] = [];
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

      const items = buildChatDisplayItems(dedupedMessages, {
        showThinkingTimeline: experiments,
      });
      logTiming("displayItems", now() - startedAt);
      return items;
    }, [props.messages, viewInline, experiments, logTiming]);

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
      const map = new Map<number, number>();
      let messageIndex = 0;
      for (let displayIndex = 0; displayIndex < displayItems.length; displayIndex += 1) {
        const item = displayItems[displayIndex]!;
        if (isTurnTimelineDisplayItem(item)) {
          continue;
        }
        while (
          messageIndex < props.messages.length &&
          props.messages[messageIndex] !== item
        ) {
          messageIndex += 1;
        }
        if (messageIndex < props.messages.length) {
          map.set(displayIndex, messageIndex);
          messageIndex += 1;
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

    const keyExtractor = useCallback((item: ChatDisplayItem) => item.id, []);
    const renderItem = useCallback(
      ({ item }: { item: ChatDisplayItem }) => {
        if (isTurnTimelineDisplayItem(item)) {
          const timelineHasAvatar = item.steps.some(
            (step) =>
              step.kind === "thinking" &&
              (showAvatarMap.get(step.message.id) ?? false),
          );
          const timelineIsLatest = item.steps.some(
            (step) => step.kind === "thinking" && step.message.id === latestAgentId,
          );
          return (
            <TurnTimelineMessageView
              item={item}
              metadata={props.metadata}
              sessionId={props.sessionId}
              showAvatar={timelineHasAvatar}
              isLatestAgent={timelineIsLatest}
              permissionModeKey={props.permissionModeKey}
            />
          );
        }

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
        props.permissionModeKey,
        props.contentMaxWidth,
        showAvatarMap,
        latestAgentId,
        thinkingTurnIds,
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
        onEndReached={props.hasOlderMessages ? props.onLoadMore : undefined}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={<ListFooter sessionId={props.sessionId} contentMaxWidth={props.contentMaxWidth} />}
        ListFooterComponent={
          <OlderMessagesArea
            hasOlderMessages={props.hasOlderMessages}
            isBackfilling={props.isBackfilling}
            onLoadMore={props.onLoadMore}
          />
        }
      />
    );
  }),
);
