import * as React from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { layout } from "@/components/layout";
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

const styles = StyleSheet.create(() => ({
  container: {
    flex: 1,
    maxWidth: layout.maxWidth,
    alignSelf: "center" as const,
    width: "100%",
  },
}));
