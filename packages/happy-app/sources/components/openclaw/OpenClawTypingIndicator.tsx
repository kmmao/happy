import * as React from "react";
import { View, Animated, ActivityIndicator } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { ChatPhase } from "@/openclaw";

export const OpenClawTypingIndicator = React.memo(
  function OpenClawTypingIndicator(props: { phase: ChatPhase }) {
    const { theme } = useUnistyles();
    const pulseAnim = React.useRef(new Animated.Value(0.3)).current;

    React.useEffect(() => {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
      return () => animation.stop();
    }, [pulseAnim]);

    const label =
      props.phase === "thinking"
        ? t("openclaw.thinking")
        : props.phase === "tool"
          ? t("openclaw.usingTools")
          : "...";

    return (
      <Animated.View style={[styles.container, { opacity: pulseAnim }]}>
        {props.phase === "tool" ? (
          <ActivityIndicator size="small" color={theme.colors.textSecondary} />
        ) : (
          <View style={styles.dots}>
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  { backgroundColor: theme.colors.textSecondary },
                ]}
              />
            ))}
          </View>
        )}
        <Text style={[styles.label, { color: theme.colors.textSecondary }]}>
          {label}
        </Text>
      </Animated.View>
    );
  },
);

const styles = StyleSheet.create((_, rt) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  dots: {
    flexDirection: "row",
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    ...Typography.default(),
    fontSize: 13,
  },
}));
