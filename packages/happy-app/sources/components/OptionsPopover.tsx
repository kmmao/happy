import * as React from "react";
import { Animated, Platform, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { layout } from "./layout";

interface OptionsPopoverProps {
  visible: boolean;
  options: string[];
  onOptionPress: (option: string) => void;
  onClose: () => void;
  title?: string;
  onRemoveOption?: (option: string) => void;
}

export const OptionsPopover = React.memo(
  ({
    visible,
    options,
    onOptionPress,
    onClose,
    title,
    onRemoveOption,
  }: OptionsPopoverProps) => {
    const { theme } = useUnistyles();
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

    if (!shouldRender) return null;

    return (
      <Animated.View style={[styles.overlay, { opacity }]}>
        {/* Backdrop */}
        <Pressable style={styles.backdrop} onPress={onClose} />

        {/* Centered bubble */}
        <View style={styles.centerAnchor} pointerEvents="box-none">
          <View style={styles.bubble}>
            {title && (
              <View style={styles.titleContainer}>
                <Text style={styles.titleText}>{title}</Text>
              </View>
            )}
            {options.map((option, index) => (
              <View
                key={index}
                style={[
                  styles.optionRow,
                  index < options.length - 1 && styles.optionItemBorder,
                ]}
              >
                <Pressable
                  style={({ pressed }) => [
                    styles.optionItem,
                    onRemoveOption && styles.optionItemFlex,
                    pressed && styles.optionItemPressed,
                  ]}
                  onPress={() => onOptionPress(option)}
                >
                  <Text style={styles.optionText} numberOfLines={2}>
                    {option}
                  </Text>
                </Pressable>
                {onRemoveOption && (
                  <Pressable
                    style={({ pressed }) => [
                      styles.removeButton,
                      pressed && styles.removeButtonPressed,
                    ]}
                    onPress={() => onRemoveOption(option)}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                  >
                    <Ionicons
                      name="bookmark-outline"
                      size={16}
                      color={theme.colors.textSecondary}
                    />
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        </View>
      </Animated.View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  centerAnchor: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  bubble: {
    maxWidth: layout.maxWidth - 32,
    width: "90%",
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: theme.colors.radio.active,
    shadowColor: theme.colors.shadow.color,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    shadowOpacity: theme.colors.shadow.opacity * 2,
    elevation: 12,
    overflow: "hidden",
  },
  titleContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.divider,
  },
  titleText: {
    ...Typography.default("semiBold"),
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.textSecondary,
    textAlign: "center" as const,
  },
  optionRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  optionItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionItemFlex: {
    flex: 1,
  },
  optionItemBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.divider,
  },
  optionItemPressed: {
    backgroundColor: theme.colors.surfaceHigh,
  },
  optionText: {
    ...Typography.default(),
    fontSize: 15,
    lineHeight: 22,
    color: theme.colors.text,
  },
  removeButton: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  removeButtonPressed: {
    opacity: 0.5,
  },
}));
