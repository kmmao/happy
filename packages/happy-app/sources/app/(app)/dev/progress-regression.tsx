import * as React from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { MessageView } from "@/components/MessageView";
import { TurnTimelineMessageView } from "@/components/TurnTimelineMessageView";
import {
  buildChatDisplayItems,
  isTurnTimelineDisplayItem,
} from "@/components/chatTimelineDisplay";
import {
  progressRegressionMessages,
  progressRegressionMetadata,
} from "@/fixtures/progress-regression-data";

const SESSION_ID = "progress-regression-session";

export default React.memo(function ProgressRegressionScreen() {
  const displayItems = React.useMemo(
    () =>
      buildChatDisplayItems(
        [...progressRegressionMessages].sort((a, b) => b.createdAt - a.createdAt),
        { showThinkingTimeline: true },
      ),
    [],
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {displayItems.map((item, index) => (
        <View key={item.id} style={index > 0 ? styles.itemSpacing : undefined}>
          {isTurnTimelineDisplayItem(item) ? (
            <TurnTimelineMessageView
              item={item}
              metadata={progressRegressionMetadata}
              sessionId={SESSION_ID}
              showAvatar={index === 0}
              isLatestAgent={index === 0}
              permissionModeKey="default"
            />
          ) : (
            <MessageView
              message={item}
              metadata={progressRegressionMetadata}
              sessionId={SESSION_ID}
              showAvatar={index === 0 && item.kind === "agent-text"}
              isLatestAgent={index === 0 && item.kind === "agent-text"}
              permissionModeKey="default"
            />
          )}
        </View>
      ))}
    </ScrollView>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  content: {
    paddingVertical: 20,
  },
  itemSpacing: {
    marginTop: 8,
  },
}));
