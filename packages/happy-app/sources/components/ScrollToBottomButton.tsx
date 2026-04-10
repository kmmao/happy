import { Ionicons } from "@expo/vector-icons";
import * as React from "react";
import { Animated, Pressable, View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

const stylesheet = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    bottom: 0,
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
  button: {
    minWidth: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    shadowColor: theme.colors.shadow.color,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    shadowOpacity: theme.colors.shadow.opacity,
    elevation: 3,
    paddingHorizontal: 10,
    flexDirection: "row" as const,
    gap: 4,
  },
  buttonDefault: {
    backgroundColor: theme.colors.fab.background,
  },
  buttonPressed: {
    backgroundColor: theme.colors.fab.backgroundPressed,
  },
  buttonDisabled: {
    backgroundColor: theme.colors.fab.background,
  },
  buttonLabel: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: theme.colors.fab.icon,
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
  bookmarkCount?: number;
  onBookmarksPress?: () => void;
  /** Callback to collapse the input area */
  onCollapseInput?: () => void;
  /** Whether there is a pending AI suggestion or needsContinue */
  hasPendingAction?: boolean;
  /** Callback when the pending action button is pressed */
  onPendingActionPress?: () => void;
  autoOptionSend?: {
    visible: boolean;
    enabled: boolean;
    remainingMs: number | null;
    onToggle: (next: boolean) => void;
  };
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
    bookmarkCount = 0,
    onBookmarksPress,
    onCollapseInput,
    hasPendingAction,
    onPendingActionPress,
    autoOptionSend,
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
    const showBookmarkButton = bookmarkCount > 0 && onBookmarksPress;
    const showPendingAction =
      !showOptionsButton && hasPendingAction && onPendingActionPress;

    const noop = () => {};

    // sparkles button: active if options available OR pending action
    const sparklesActive = showOptionsButton || showPendingAction;
    const sparklesHandler = showOptionsButton
      ? onOptionsPress!
      : showPendingAction
        ? onPendingActionPress!
        : noop;

    const iconColor = theme.colors.fab.icon;
    const disabledIconColor = theme.colors.textSecondary;

    return (
      <View style={styles.container} pointerEvents="box-none">
        <View style={styles.scrollBtnWrapper}>
          <View style={styles.scrollBtnRow}>
            <PulseButton
              icon={showPendingAction ? "sparkles-outline" : "sparkles"}
              onPress={sparklesHandler}
              size={18}
              styles={styles}
              iconColor={iconColor}
              disabledIconColor={disabledIconColor}
              disabled={!sparklesActive}
            />
            {autoOptionSend?.visible && (
              <PulseButton
                icon={autoOptionSend.enabled ? "pause" : "play"}
                label={
                  autoOptionSend.enabled && autoOptionSend.remainingMs != null
                    ? `${Math.max(1, Math.ceil(autoOptionSend.remainingMs / 1000))}s`
                    : undefined
                }
                onPress={() => autoOptionSend.onToggle(!autoOptionSend.enabled)}
                size={18}
                styles={styles}
                iconColor={iconColor}
                disabledIconColor={disabledIconColor}
              />
            )}
            <PulseButton
              icon="bookmark"
              onPress={onBookmarksPress ?? noop}
              size={18}
              styles={styles}
              iconColor={iconColor}
              disabledIconColor={disabledIconColor}
              disabled={!showBookmarkButton}
            />
            <PulseButton
              icon="arrow-up"
              onPress={onPrevUserMessage ?? noop}
              size={18}
              styles={styles}
              iconColor={iconColor}
              disabledIconColor={disabledIconColor}
              disabled={!showNavButtons}
            />
            {shouldRenderScrollBtn ? (
              <Animated.View style={{ opacity: scrollBtnOpacity }}>
                <PulseButton
                  icon="chevron-down"
                  onPress={onPress}
                  size={20}
                  styles={styles}
                  iconColor={iconColor}
                  disabledIconColor={disabledIconColor}
                />
              </Animated.View>
            ) : (
              <PulseButton
                icon="chevron-down"
                onPress={noop}
                size={20}
                styles={styles}
                iconColor={iconColor}
                disabledIconColor={disabledIconColor}
                disabled
              />
            )}
            <PulseButton
              icon="arrow-down"
              onPress={onNextUserMessage ?? noop}
              size={18}
              styles={styles}
              iconColor={iconColor}
              disabledIconColor={disabledIconColor}
              disabled={!showNavButtons}
            />
            {onCollapseInput && (
              <PulseButton
                icon="contract-outline"
                onPress={onCollapseInput}
                size={18}
                styles={styles}
                iconColor={iconColor}
                disabledIconColor={disabledIconColor}
              />
            )}
          </View>
        </View>
      </View>
    );
  },
);

const PulseButton = React.memo(function PulseButton({
  icon,
  onPress,
  size = 20,
  label,
  styles,
  iconColor,
  disabledIconColor,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  size?: number;
  label?: string;
  styles: typeof stylesheet;
  iconColor: string;
  disabledIconColor: string;
  disabled?: boolean;
}) {
  const scaleAnim = React.useRef(new Animated.Value(1)).current;
  const wasDisabled = React.useRef(disabled);

  React.useEffect(() => {
    if (wasDisabled.current && !disabled) {
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.25,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
    wasDisabled.current = disabled;
  }, [disabled, scaleAnim]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Pressable
        style={({ pressed }) => [
          styles.button,
          pressed && !disabled ? styles.buttonPressed : styles.buttonDefault,
          disabled ? styles.buttonDisabled : undefined,
        ]}
        onPress={disabled ? undefined : onPress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        disabled={disabled}
      >
        <Ionicons
          name={icon}
          size={size}
          color={disabled ? disabledIconColor : iconColor}
        />
        {label ? (
          <Text
            style={[
              styles.buttonLabel,
              { color: disabled ? disabledIconColor : iconColor },
            ]}
          >
            {label}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
});
