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

    React.useImperativeHandle(ref, () => ({
      scrollToBottom: () => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      },
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

    const keyExtractor = useCallback((item: any) => item.id, []);
    const renderItem = useCallback(
      ({ item }: { item: any }) => (
        <MessageView
          message={item}
          metadata={props.metadata}
          sessionId={props.sessionId}
        />
      ),
      [props.metadata, props.sessionId],
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
