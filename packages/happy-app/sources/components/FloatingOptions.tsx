import * as React from "react";
import { Animated, View, Pressable, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { layout } from "./layout";

interface FloatingOptionsProps {
  options: string[];
  onOptionPress: (option: string) => void;
}

export const FloatingOptions = React.memo(
  ({ options, onOptionPress }: FloatingOptionsProps) => {
    const hasOptions = options.length > 0;
    const opacity = React.useRef(new Animated.Value(0)).current;
    const [shouldRender, setShouldRender] = React.useState(false);

    React.useEffect(() => {
      if (hasOptions) {
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
    }, [hasOptions]);

    if (!shouldRender) return null;

    return (
      <Animated.View style={[styles.container, { opacity }]}>
        <View style={styles.innerContainer}>
          {options.map((option, index) => (
            <Pressable
              key={index}
              style={({ pressed }) => [
                styles.optionItem,
                pressed && styles.optionItemPressed,
              ]}
              onPress={() => onOptionPress(option)}
            >
              <Text style={styles.optionText}>{option}</Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  container: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    alignItems: "center",
  },
  innerContainer: {
    width: "100%",
    maxWidth: layout.maxWidth,
    flexDirection: "column",
    gap: 8,
  },
  optionItem: {
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: theme.colors.divider,
  },
  optionItemPressed: {
    opacity: 0.7,
    backgroundColor: theme.colors.surfaceHigh,
  },
  optionText: {
    ...Typography.default(),
    fontSize: 16,
    lineHeight: 24,
    color: theme.colors.text,
  },
}));
