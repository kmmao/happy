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
    ...Platform.select({
      web: {
        position: "fixed" as any,
      },
      default: {
        position: "absolute",
      },
    }),
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  backdrop: {
    ...Platform.select({
      web: {
        position: "fixed" as any,
      },
      default: {
        position: "absolute",
      },
    }),
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
    borderRadius: 12,
    borderWidth: Platform.OS === "web" ? 0 : 0.5,
    borderColor: theme.colors.modal.border,
    shadowColor: theme.colors.shadow.color,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    shadowOpacity: theme.colors.shadow.opacity * 1.5,
    elevation: 8,
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
