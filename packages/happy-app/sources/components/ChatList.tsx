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
import { Message } from "@/sync/typesMessage";

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
    }
  >((props, ref) => {
    const flatListRef = React.useRef<FlatList>(null);
    const isAwayRef = React.useRef(false);
    const currentUserMsgIndexRef = React.useRef(-1);

    // Collect user-text message indices (in the inverted list)
    const userMessageIndices = React.useMemo(
      () =>
        props.messages
          .map((msg, i) => (msg.kind === "user-text" ? i : -1))
          .filter((i) => i !== -1),
      [props.messages],
    );

    React.useImperativeHandle(ref, () => ({
      scrollToBottom: () => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
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

        flatListRef.current?.scrollToIndex({
          index: currentUserMsgIndexRef.current,
          animated: true,
          viewPosition: 0.5,
        });
        return currentUserMsgIndexRef.current;
      },
      getUserMessageCount: () => userMessageIndices.length,
    }));

    const handleScroll = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offsetY = event.nativeEvent.contentOffset.y;
        const isAway = offsetY > SCROLL_AWAY_THRESHOLD;
        if (isAway !== isAwayRef.current) {
          isAwayRef.current = isAway;
          props.onScrollAwayFromBottom?.(isAway);
        }
      },
      [props.onScrollAwayFromBottom],
    );

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

    const keyExtractor = useCallback((item: any) => item.id, []);
    const renderItem = useCallback(
      ({ item }: { item: Message }) => (
        <MessageView
          message={item}
          metadata={props.metadata}
          sessionId={props.sessionId}
          showAvatar={showAvatarMap.get(item.id) ?? false}
        />
      ),
      [props.metadata, props.sessionId, showAvatarMap],
    );
    return (
      <FlatList
        ref={flatListRef}
        data={props.messages}
        inverted={true}
        keyExtractor={keyExtractor}
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
          autoscrollToTopThreshold: 10,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
        renderItem={renderItem}
        onScroll={handleScroll}
        scrollEventThrottle={400}
        ListHeaderComponent={<ListFooter sessionId={props.sessionId} />}
        ListFooterComponent={<ListHeader />}
      />
    );
  }),
);
