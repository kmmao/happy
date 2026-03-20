import * as React from "react";
import { Animated, View, Pressable, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { ShimmerOverlay } from "./ShimmerOverlay";
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
    const { theme } = useUnistyles();

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
          {options.map((option, index) => {
            const isRecommended = index === 0 && options.length > 1;
            return (
              <Pressable
                key={index}
                style={({ pressed }) => [
                  styles.optionItem,
                  isRecommended && styles.optionItemRecommended,
                  pressed && styles.optionItemPressed,
                ]}
                onPress={() => onOptionPress(option)}
              >
                <View style={styles.optionContentRow}>
                  <Text style={[styles.optionText, styles.optionTextFlex]}>{option}</Text>
                  {isRecommended && (
                    <View style={styles.recommendedTag}>
                      <Ionicons
                        name="sparkles"
                        size={11}
                        color={theme.colors.radio.active}
                        style={styles.recommendedIcon}
                      />
                      <Text style={styles.recommendedText}>
                        {t("tools.askUserQuestion.recommended")}
                      </Text>
                    </View>
                  )}
                </View>
                {isRecommended && <ShimmerOverlay />}
              </Pressable>
            );
          })}
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
  optionItemRecommended: {
    // same as other options, only shimmer + tag differentiates
  },
  optionItemPressed: {
    opacity: 0.7,
    backgroundColor: theme.colors.surfaceHigh,
  },
  optionContentRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  optionText: {
    ...Typography.default(),
    fontSize: 16,
    lineHeight: 24,
    color: theme.colors.text,
  },
  optionTextFlex: {
    flex: 1,
  },
  recommendedTag: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: theme.colors.radio.active + "20",
  },
  recommendedIcon: {
    marginRight: 3,
  },
  recommendedText: {
    ...Typography.default(),
    fontSize: 11,
    fontWeight: "600" as const,
    color: theme.colors.radio.active,
  },
}));
