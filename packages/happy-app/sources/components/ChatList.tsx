import * as React from "react";
import { useUnistyles } from "react-native-unistyles";
import {
  useSession,
  useSessionMessages,
  useSetting,
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
import { ToolGroupView } from "./ToolGroupView";
import { Metadata, Session } from "@/sync/storageTypes";
import { ChatFooter } from "./ChatFooter";
import { Message } from "@/sync/typesMessage";
import {
  buildVisibleChatDisplayItems,
  groupToolCallItems,
  isTurnTimelineDisplayItem,
  isTurnStartSeparator,
  type ChatDisplayItem,
  type FinalChatDisplayItem,
  type ToolGroupItem,
} from "./chatTimelineDisplay";
import { TurnTimelineMessageView } from "./TurnTimelineMessageView";
import { shouldLogChatListTiming } from "./chatListPerformanceTiming";
import { log } from "@/log";

export interface ChatListHandle {
  scrollToBottom: () => void;
  scrollToUserMessage: (direction: "prev" | "next") => number;
  getUserMessageCount: () => number;
  /** Scrolls the chat to the (inverted) display row that contains a message
   *  with the given id. Returns true when a match was found. Used by the
   *  BackgroundTaskBar sub-agent chips to jump to the launched-agent card. */
  scrollToMessage: (messageId: string) => boolean;
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
      onFetchOlderMessages?: () => void;
      isFetchingOlder?: boolean;
      onScrollAwayFromBottom?: (isAway: boolean) => void;
      onScrollActivity?: () => void;
      onVisibleUserMessageChange?: (msgIndex: number) => void;
      contentMaxWidth?: number;
    }
  >((props, ref) => {
    const { messages, hasOlderMessages, hasServerOlderMessages, isBackfilling } = useSessionMessages(
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
        hasServerOlderMessages={hasServerOlderMessages}
        isBackfilling={isBackfilling}
        isFetchingOlder={props.isFetchingOlder ?? false}
        onLoadMore={props.onLoadMore}
        onFetchOlderMessages={props.onFetchOlderMessages}
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
    hasServerOlderMessages,
    isBackfilling,
    isFetchingOlder,
    onLoadMore,
    onFetchOlderMessages,
  }: {
    hasOlderMessages: boolean;
    hasServerOlderMessages: boolean;
    isBackfilling: boolean;
    isFetchingOlder: boolean;
    onLoadMore: () => void;
    onFetchOlderMessages?: () => void;
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
        {!hasOlderMessages && !isBackfilling && hasServerOlderMessages && (
          <Pressable
            onPress={onFetchOlderMessages}
            disabled={isFetchingOlder}
            style={{ paddingVertical: 12, alignItems: "center" }}
          >
            {isFetchingOlder ? (
              <ActivityIndicator size="small" />
            ) : (
              <Text style={{ opacity: 0.4, fontSize: 12 }}>
                {t("session.loadOlderMessages")}
              </Text>
            )}
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
      hasServerOlderMessages: boolean;
      isBackfilling: boolean;
      isFetchingOlder: boolean;
      onLoadMore: () => void;
      onFetchOlderMessages?: () => void;
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
    const { theme } = useUnistyles();
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
        if (__DEV__) {
          console.log(`[stream-perf] ChatList.${label}: ${durationMs.toFixed(1)}ms, msgs=${props.messages.length}`);
        }
      },
      [props.messages.length],
    );

    // Pre-compute which agent-text messages should show an avatar.
    // In an inverted list, index+1 is the visually "previous" (above) message.
    // Show avatar on the first agent-text in a consecutive run.
    // Also find the latest (newest) agent-text message ID (index 0 = newest).
    // Stored in refs so renderItem stays stable across messages updates.
    const showAvatarMapRef = React.useRef(new Map<string, boolean>());
    const latestAgentIdRef = React.useRef<string | null>(null);
    React.useMemo(() => {
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
      showAvatarMapRef.current = map;
      latestAgentIdRef.current = latestId;
    }, [props.messages]);

    // For each "ready" agent-event, check if the same turn had thinking messages.
    // Stored in ref so renderItem stays stable.
    const thinkingTurnIdsRef = React.useRef(new Map<string, "adaptive" | "enabled" | null>());
    React.useMemo(() => {
      const startedAt = now();
      const map = new Map<string, "adaptive" | "enabled" | null>();
      const MAX_INNER_SCAN = 100;
      for (let i = 0; i < props.messages.length; i++) {
        const msg = props.messages[i];
        if (msg.kind === "agent-event" && msg.event.type === "ready") {
          let hasThinkingMsg = false;
          let thinkingMode: "adaptive" | "enabled" | null = null;
          const limit = Math.min(i + 1 + MAX_INNER_SCAN, props.messages.length);
          for (let j = i + 1; j < limit; j++) {
            const m = props.messages[j];
            if (m.kind === "user-text") {
              const mt = m.meta?.thinking?.type;
              thinkingMode = mt === "adaptive" || mt === "enabled" ? mt : null;
              break;
            }
            if (m.kind === "agent-event" && m.event.type === "ready") break;
            if (m.kind === "agent-text" && m.isThinking) {
              hasThinkingMsg = true;
            }
          }
          if (hasThinkingMsg) {
            map.set(msg.id, thinkingMode);
          }
        }
      }
      logTiming("thinkingTurnIds", now() - startedAt);
      thinkingTurnIdsRef.current = map;
    }, [props.messages, logTiming]);

    // Filter tool-call messages based on viewInline setting.
    // When viewInline is off, hide main agent tool calls (except special ones).
    const viewInline = useSetting("viewInline");
    const groupToolCalls = useSetting("groupToolCalls");
    const displayItems: ChatDisplayItem[] = React.useMemo(() => {
      const startedAt = now();
      const items = buildVisibleChatDisplayItems(props.messages, {
        viewInline,
        showThinkingTimeline: experiments,
      });
      logTiming("displayItems", now() - startedAt);
      return items;
    }, [props.messages, viewInline, experiments, logTiming]);

    // Group consecutive tool calls between text messages into collapsible
    // containers — unless the user disabled it in settings.
    const finalDisplayItems: FinalChatDisplayItem[] = React.useMemo(() => {
      if (!groupToolCalls) return displayItems;
      return groupToolCallItems(displayItems);
    }, [displayItems, groupToolCalls]);

    // Track which groups the user has manually toggled (flips their default state)
    const [toggledGroups, setToggledGroups] = React.useState<Set<string>>(new Set());

    // Auto-collapse groups when they finish running: clear toggle state so
    // they return to the default (collapsed for completed groups)
    React.useEffect(() => {
      if (!groupToolCalls) return;
      setToggledGroups((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const item of finalDisplayItems) {
          if (
            "type" in item &&
            (item as ToolGroupItem).type === "tool-group" &&
            !(item as ToolGroupItem).hasRunning &&
            prev.has(item.id)
          ) {
            next.delete(item.id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, [finalDisplayItems, groupToolCalls]);

    const handleToggleGroup = React.useCallback((groupId: string) => {
      setToggledGroups((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) {
          next.delete(groupId);
        } else {
          next.add(groupId);
        }
        return next;
      });
    }, []);

    // Collect user-text message indices in displayItems (not props.messages)
    // since the FlatList now uses displayItems as data.
    const userMessageIndices = React.useMemo(
      () =>
        finalDisplayItems
          .map((item, i) => ("kind" in item && item.kind === "user-text" ? i : -1))
          .filter((i) => i !== -1),
      [finalDisplayItems],
    );

    // Map finalDisplayItems index → original messages index.
    // When viewInline is off, some messages are filtered out, so indices diverge.
    const displayToMsgIndex = React.useMemo(() => {
      const map = new Map<number, number>();
      let messageIndex = 0;
      for (let displayIndex = 0; displayIndex < finalDisplayItems.length; displayIndex += 1) {
        const item = finalDisplayItems[displayIndex]!;
        if (
          ("type" in item && (item as ToolGroupItem).type === "tool-group") ||
          isTurnTimelineDisplayItem(item as ChatDisplayItem) ||
          isTurnStartSeparator(item as ChatDisplayItem)
        ) {
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
    }, [finalDisplayItems, props.messages, viewInline]);

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
        if (targetIndex >= 0 && targetIndex < finalDisplayItems.length) {
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
      scrollToMessage: (messageId: string): boolean => {
        for (let i = 0; i < finalDisplayItems.length; i += 1) {
          const item = finalDisplayItems[i];
          if (!item) continue;
          // Raw message row — most sub-agent (Agent/Task) tool-calls land here
          // because the reducer explicitly skips them when forming tool groups.
          if (
            typeof item === "object" &&
            "id" in item &&
            (item as { id?: unknown }).id === messageId
          ) {
            flatListRef.current?.scrollToIndex({
              index: i,
              animated: true,
              viewPosition: 0.5,
            });
            return true;
          }
          // ToolGroupItem — defensive path in case grouping ever covers Agent.
          if (
            typeof item === "object" &&
            "type" in item &&
            (item as ToolGroupItem).type === "tool-group"
          ) {
            const group = item as ToolGroupItem;
            const groupItems = (group as unknown as { items?: ReadonlyArray<{ id?: string }> }).items;
            if (groupItems?.some((m) => m?.id === messageId)) {
              flatListRef.current?.scrollToIndex({
                index: i,
                animated: true,
                viewPosition: 0.5,
              });
              return true;
            }
          }
        }
        return false;
      },
    }));

    const handleScrollToIndexFailed = useCallback(
      (info: { index: number; averageItemLength: number }) => {
        // Scroll to approximate offset, then retry after layout settles
        flatListRef.current?.scrollToOffset({
          offset: info.averageItemLength * info.index,
          animated: true,
        });
        setTimeout(() => {
          if (info.index >= 0 && info.index < finalDisplayItems.length) {
            flatListRef.current?.scrollToIndex({
              index: info.index,
              animated: true,
              viewPosition: 0.5,
            });
          }
        }, 200);
      },
      [finalDisplayItems.length],
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
    const displayItemsRef = React.useRef(finalDisplayItems);
    displayItemsRef.current = finalDisplayItems;

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
            if (item && "kind" in item && item.kind === "user-text") {
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

    const keyExtractor = useCallback((item: FinalChatDisplayItem) => item.id, []);
    const renderItem = useCallback(
      ({ item }: { item: FinalChatDisplayItem }) => {
        // Tool group (only when groupToolCalls is on)
        if ("type" in item && (item as ToolGroupItem).type === "tool-group") {
          const group = item as ToolGroupItem;
          const defaultExpanded = group.hasRunning;
          const expanded = toggledGroups.has(group.id) ? !defaultExpanded : defaultExpanded;
          return (
            <ToolGroupView
              group={group}
              metadata={props.metadata}
              sessionId={props.sessionId}
              expanded={expanded}
              onToggle={() => handleToggleGroup(group.id)}
              permissionModeKey={props.permissionModeKey}
              contentMaxWidth={props.contentMaxWidth}
            />
          );
        }

        if (isTurnStartSeparator(item as ChatDisplayItem)) {
          return (
            <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 2 }}>
              <View
                style={{
                  alignSelf: "flex-start",
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: theme.colors.agentEventText + "20",
                  backgroundColor: theme.colors.agentEventText + "0E",
                }}
              >
                <Text style={{ fontSize: 11, color: theme.colors.agentEventText, opacity: 0.6 }}>
                  {t("message.turnStart")}
                </Text>
              </View>
            </View>
          );
        }

        if (isTurnTimelineDisplayItem(item as ChatDisplayItem)) {
          const timelineItem = item as import("./chatTimelineDisplay").TurnTimelineDisplayItem;
          const timelineHasAvatar = timelineItem.steps.some(
            (step) =>
              step.kind === "thinking" &&
              (showAvatarMapRef.current.get(step.message.id) ?? false),
          );
          const timelineIsLatest = timelineItem.steps.some(
            (step) => step.kind === "thinking" && step.message.id === latestAgentIdRef.current,
          );
          return (
            <TurnTimelineMessageView
              item={timelineItem}
              metadata={props.metadata}
              sessionId={props.sessionId}
              showAvatar={timelineHasAvatar}
              isLatestAgent={timelineIsLatest}
              permissionModeKey={props.permissionModeKey}
            />
          );
        }

        // Remaining items are regular Messages
        const msg = item as Message;
        const isReadyWithThinking =
          msg.kind === "agent-event" &&
          msg.event.type === "ready" &&
          thinkingTurnIdsRef.current.has(msg.id);
        return (
          <MessageView
            message={msg}
            metadata={props.metadata}
            sessionId={props.sessionId}
            showAvatar={showAvatarMapRef.current.get(msg.id) ?? false}
            isLatestAgent={msg.id === latestAgentIdRef.current}
            hasTurnsWithThinking={isReadyWithThinking}
            thinkingMode={isReadyWithThinking ? (thinkingTurnIdsRef.current.get(msg.id) ?? null) : null}
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
        theme,
        toggledGroups,
        handleToggleGroup,
      ],
    );
    return (
      <FlatList
        ref={flatListRef}
        data={finalDisplayItems}
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
        windowSize={Platform.OS === "web" ? 5 : 7}
        maxToRenderPerBatch={Platform.OS === "web" ? 5 : 8}
        initialNumToRender={Platform.OS === "web" ? 10 : 15}
        removeClippedSubviews={Platform.OS !== "web"}
        ListHeaderComponent={<ListFooter sessionId={props.sessionId} contentMaxWidth={props.contentMaxWidth} />}
        ListFooterComponent={
          <OlderMessagesArea
            hasOlderMessages={props.hasOlderMessages}
            hasServerOlderMessages={props.hasServerOlderMessages}
            isBackfilling={props.isBackfilling}
            isFetchingOlder={props.isFetchingOlder}
            onLoadMore={props.onLoadMore}
            onFetchOlderMessages={props.onFetchOlderMessages}
          />
        }
      />
    );
  }),
);
