import * as React from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { layout } from "./layout";
import { t } from "@/text";
import { useAppendToInput } from "@/hooks/useInputContext";

export interface OptionItem {
  text: string;
  source?: "ai" | "user";
}

interface OptionsPopoverProps {
  visible: boolean;
  options: readonly (string | OptionItem)[];
  onOptionPress: (text: string) => void;
  onClose: () => void;
  title?: string;
  onRemoveOption?: (text: string) => void;
  recommendedIndex?: number | null;
  recommendedRemainingMs?: number | null;
}

function normalizeOption(option: string | OptionItem): OptionItem {
  return typeof option === "string" ? { text: option } : option;
}

export const OptionsPopover = React.memo(
  ({
    visible,
    options,
    onOptionPress,
    onClose,
    title,
    onRemoveOption,
    recommendedIndex,
    recommendedRemainingMs,
  }: OptionsPopoverProps) => {
    const { theme } = useUnistyles();
    const appendToInput = useAppendToInput();
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
    }, [visible, opacity]);

    if (!shouldRender) return null;

    return (
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.centerAnchor} pointerEvents="box-none">
          <View style={styles.bubble}>
            {title && (
              <View style={styles.titleContainer}>
                <Text style={styles.titleText}>{title}</Text>
              </View>
            )}
            {options.map((raw, index) => {
              const option = normalizeOption(raw);
              const isRecommended = recommendedIndex === index;
              const countdownLabel =
                isRecommended && recommendedRemainingMs != null
                  ? `${Math.max(0, Math.ceil(recommendedRemainingMs / 1000))}s`
                  : null;

              return (
                <View
                  key={`${option.source ?? "plain"}:${option.text}:${index}`}
                  style={[
                    styles.optionRow,
                    index < options.length - 1 && styles.optionItemBorder,
                  ]}
                >
                  <Pressable
                    style={({ pressed }) => [
                      styles.optionItem,
                      onRemoveOption && styles.optionItemFlex,
                      isRecommended && styles.optionItemRecommended,
                      pressed && styles.optionItemPressed,
                    ]}
                    onPress={() => onOptionPress(option.text)}
                  >
                    <View style={styles.optionContent}>
                      <Text style={styles.optionText} numberOfLines={2}>
                        {option.text}
                      </Text>
                      {isRecommended && (
                        <View style={styles.recommendedTag}>
                          <Ionicons
                            name="sparkles"
                            size={11}
                            color={theme.colors.radio.active}
                          />
                          <Text style={styles.recommendedTagText}>
                            {t("tools.askUserQuestion.recommended")}
                          </Text>
                          {countdownLabel ? (
                            <Text style={styles.recommendedCountdownText}>
                              {countdownLabel}
                            </Text>
                          ) : null}
                        </View>
                      )}
                      {option.source && (
                        <View
                          style={[
                            styles.sourceTag,
                            option.source === "ai"
                              ? {
                                  backgroundColor:
                                    theme.colors.radio.active + "20",
                                }
                              : {
                                  backgroundColor:
                                    theme.colors.box.warning.background,
                                },
                          ]}
                        >
                          <Text
                            style={[
                              styles.sourceTagText,
                              option.source === "ai"
                                ? { color: theme.colors.radio.active }
                                : { color: theme.colors.box.warning.text },
                            ]}
                          >
                            {option.source === "ai"
                              ? t("bookmark.sourceAI")
                              : t("bookmark.sourceUser")}
                          </Text>
                        </View>
                      )}
                    </View>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.removeButton,
                      pressed && styles.removeButtonPressed,
                    ]}
                    onPress={() => {
                      onClose();
                      appendToInput(option.text);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  >
                    <Ionicons
                      name="copy-outline"
                      size={16}
                      color={theme.colors.textSecondary}
                    />
                  </Pressable>
                  {onRemoveOption && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.removeButton,
                        pressed && styles.removeButtonPressed,
                      ]}
                      onPress={() => onRemoveOption(option.text)}
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
              );
            })}
          </View>
        </View>
      </Animated.View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  overlay: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  backdrop: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  centerAnchor: {
    flex: 1,
    justifyContent: "center" as const,
    alignItems: "center" as const,
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
    overflow: "hidden" as const,
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
  optionItemRecommended: {
    backgroundColor: theme.colors.radio.active + "08",
  },
  optionItemBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.divider,
  },
  optionItemPressed: {
    backgroundColor: theme.colors.surfaceHigh,
  },
  optionContent: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  optionText: {
    ...Typography.default(),
    fontSize: 15,
    lineHeight: 22,
    color: theme.colors.text,
    flexShrink: 1,
  },
  recommendedTag: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: theme.colors.radio.active + "20",
    flexShrink: 0,
  },
  recommendedTagText: {
    fontSize: 10,
    color: theme.colors.radio.active,
    ...Typography.default("semiBold"),
  },
  recommendedCountdownText: {
    fontSize: 10,
    color: theme.colors.radio.active,
    ...Typography.default("semiBold"),
  },
  sourceTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    flexShrink: 0,
  },
  sourceTagText: {
    fontSize: 10,
    ...Typography.default("semiBold"),
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
