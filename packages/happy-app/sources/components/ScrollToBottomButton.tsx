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
    zIndex: 10,
  },
  scrollBtnWrapper: {
    alignItems: "center" as const,
  },
  scrollBtnRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  badge: {
    position: "absolute" as const,
    top: 2,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.radio.dot,
  },
  navColumn: {
    position: "absolute",
    right: 12,
    bottom: 0,
    flexDirection: "column" as const,
    alignItems: "center" as const,
    gap: 8,
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

interface ScrollToBottomButtonProps {
  visible: boolean;
  onPress: () => void;
  onPrevUserMessage?: () => void;
  onNextUserMessage?: () => void;
  hasUserMessages?: boolean;
  optionCount?: number;
  onOptionsPress?: () => void;
}

export const ScrollToBottomButton = React.memo(
  ({
    visible,
    onPress,
    onPrevUserMessage,
    onNextUserMessage,
    hasUserMessages,
    optionCount = 0,
    onOptionsPress,
  }: ScrollToBottomButtonProps) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const scrollBtnOpacity = React.useRef(new Animated.Value(0)).current;
    const [shouldRenderScrollBtn, setShouldRenderScrollBtn] =
      React.useState(false);

    React.useEffect(() => {
      if (visible) {
        setShouldRenderScrollBtn(true);
        Animated.timing(scrollBtnOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
      } else {
        Animated.timing(scrollBtnOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) {
            setShouldRenderScrollBtn(false);
          }
        });
      }
    }, [visible]);

    const showNavButtons =
      hasUserMessages && onPrevUserMessage && onNextUserMessage;
    const showOptionsButton = optionCount > 0 && onOptionsPress;

    if (!shouldRenderScrollBtn && !showNavButtons && !showOptionsButton) {
      return null;
    }

    const renderButton = (
      icon: React.ComponentProps<typeof Ionicons>["name"],
      onButtonPress: () => void,
      size = 20,
    ) => (
      <Pressable
        style={({ pressed }) => [
          styles.button,
          pressed ? styles.buttonPressed : styles.buttonDefault,
        ]}
        onPress={onButtonPress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name={icon} size={size} color={theme.colors.fab.icon} />
      </Pressable>
    );

    return (
      <View style={styles.container} pointerEvents="box-none">
        <View style={styles.scrollBtnWrapper}>
          <View style={styles.scrollBtnRow}>
            {showOptionsButton && (
              <View>
                {renderButton("sparkles", onOptionsPress, 18)}
                <View style={styles.badge} />
              </View>
            )}
            {shouldRenderScrollBtn && (
              <Animated.View style={{ opacity: scrollBtnOpacity }}>
                {renderButton("chevron-down", onPress)}
              </Animated.View>
            )}
          </View>
        </View>
        {showNavButtons && (
          <View style={styles.navColumn}>
            {renderButton("arrow-up", onPrevUserMessage, 18)}
            {renderButton("arrow-down", onNextUserMessage, 18)}
          </View>
        )}
      </View>
    );
  },
);
