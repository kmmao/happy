import * as React from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { screenLayoutMaxWidth } from "@/components/layout";
import { SessionCodeChangesView } from "@/components/session/SessionCodeChangesView";

export default React.memo(function ChangesScreen() {
  const { id: sessionId } = useLocalSearchParams<{ id: string }>();
  const { theme } = useUnistyles();

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
      <SessionCodeChangesView sessionId={sessionId} />
    </View>
  );
});

const styles = StyleSheet.create((_, rt) => ({
  container: {
    flex: 1,
    maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
    alignSelf: "center" as const,
    width: "100%",
  },
}));
