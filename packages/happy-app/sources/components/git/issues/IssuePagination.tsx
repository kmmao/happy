import * as React from "react";
import { View, Pressable } from "react-native";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";

interface IssuePaginationProps {
  readonly currentPage: number;
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly onPageChange: (page: number) => void;
}

export const IssuePagination = React.memo<IssuePaginationProps>(
  function IssuePagination({ currentPage, hasMore, loading, onPageChange }) {
    const { theme } = useUnistyles();

    const canGoPrev = currentPage > 1 && !loading;
    const canGoNext = hasMore && !loading;

    const handlePrev = React.useCallback(() => {
      if (canGoPrev) onPageChange(currentPage - 1);
    }, [canGoPrev, currentPage, onPageChange]);

    const handleNext = React.useCallback(() => {
      if (canGoNext) onPageChange(currentPage + 1);
    }, [canGoNext, currentPage, onPageChange]);

    // Don't show pagination if on page 1 with no more pages
    if (currentPage === 1 && !hasMore) return null;

    return (
      <View
        style={[
          styles.container,
          {
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
            backgroundColor: theme.colors.surface,
          },
        ]}
      >
        <Pressable
          onPress={handlePrev}
          disabled={!canGoPrev}
          style={[
            styles.button,
            {
              backgroundColor: canGoPrev
                ? theme.colors.surfaceHigh
                : "transparent",
              opacity: canGoPrev ? 1 : 0.35,
            },
          ]}
        >
          <Ionicons name="chevron-back" size={16} color={theme.colors.text} />
        </Pressable>

        <Text
          style={{
            fontSize: 14,
            color: theme.colors.textSecondary,
            ...Typography.default(),
          }}
        >
          {t("issues.pageOf", { page: currentPage })}
        </Text>

        <Pressable
          onPress={handleNext}
          disabled={!canGoNext}
          style={[
            styles.button,
            {
              backgroundColor: canGoNext
                ? theme.colors.surfaceHigh
                : "transparent",
              opacity: canGoNext ? 1 : 0.35,
            },
          ]}
        >
          <Ionicons
            name="chevron-forward"
            size={16}
            color={theme.colors.text}
          />
        </Pressable>
      </View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    gap: 16,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
}));
