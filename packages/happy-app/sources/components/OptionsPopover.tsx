import * as React from "react";
import { Animated, Platform, Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { layout } from "./layout";

interface OptionsPopoverProps {
  visible: boolean;
  options: string[];
  onOptionPress: (option: string) => void;
  onClose: () => void;
}

export const OptionsPopover = React.memo(
  ({ visible, options, onOptionPress, onClose }: OptionsPopoverProps) => {
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
            {options.map((option, index) => (
              <Pressable
                key={index}
                style={({ pressed }) => [
                  styles.optionItem,
                  index < options.length - 1 && styles.optionItemBorder,
                  pressed && styles.optionItemPressed,
                ]}
                onPress={() => onOptionPress(option)}
              >
                <Text style={styles.optionText} numberOfLines={2}>
                  {option}
                </Text>
              </Pressable>
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
  optionItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
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
}));
