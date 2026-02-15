import { Ionicons } from "@expo/vector-icons";
import * as React from "react";
import { Animated, Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

const stylesheet = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    bottom: 8,
    left: 0,
    right: 0,
    alignItems: "center" as const,
    zIndex: 10,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    shadowColor: theme.colors.shadow.color,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    shadowOpacity: theme.colors.shadow.opacity,
    elevation: 3,
  },
  buttonDefault: {
    backgroundColor: theme.colors.fab.background,
  },
  buttonPressed: {
    backgroundColor: theme.colors.fab.backgroundPressed,
  },
}));

export const ScrollToBottomButton = React.memo(
  ({ visible, onPress }: { visible: boolean; onPress: () => void }) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const opacity = React.useRef(new Animated.Value(0)).current;
    const [shouldRender, setShouldRender] = React.useState(false);

    React.useEffect(() => {
      if (visible) {
        setShouldRender(true);
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
      } else {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) {
            setShouldRender(false);
          }
        });
      }
    }, [visible]);

    if (!shouldRender) {
      return null;
    }

    return (
      <Animated.View
        style={[styles.container, { opacity }]}
        pointerEvents="box-none"
      >
        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed ? styles.buttonPressed : styles.buttonDefault,
          ]}
          onPress={onPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name="chevron-down"
            size={20}
            color={theme.colors.fab.icon}
          />
        </Pressable>
      </Animated.View>
    );
  },
);
