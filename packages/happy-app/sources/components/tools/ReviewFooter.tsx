import * as React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useUnistyles } from "react-native-unistyles";
import { ToolCall } from "@/sync/typesMessage";
import { Metadata } from "@/sync/storageTypes";
import { useToolReview } from "./useToolReview";
import { t } from "@/text";

interface ReviewFooterProps {
  tool: ToolCall;
  sessionId: string;
  messageId: string;
  metadata: Metadata | null;
}

export const ReviewFooter = React.memo<ReviewFooterProps>(
  ({ tool, sessionId, messageId }) => {
    const { theme } = useUnistyles();
    const { isReviewable, reviewState, onAccept, onReject } = useToolReview({
      tool,
      messageId,
      sessionId,
    });

    if (!isReviewable) return null;

    const styles = {
      container: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        justifyContent: "center" as const,
      },
      buttonContainer: {
        flexDirection: "column" as const,
        gap: 4,
        alignItems: "flex-start" as const,
      },
      button: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 1,
        backgroundColor: "transparent",
        alignItems: "flex-start" as const,
        justifyContent: "center" as const,
        minHeight: 32,
        borderLeftWidth: 3,
        borderLeftColor: "transparent",
        alignSelf: "stretch" as const,
      },
      buttonSelected: {
        borderLeftColor: theme.colors.text,
      },
      buttonInactive: {
        opacity: 0.3,
      },
      buttonContent: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        minHeight: 20,
      },
      buttonText: {
        fontSize: 14,
        fontWeight: "400" as const,
        color: theme.colors.textSecondary,
      },
      buttonTextAccept: {
        color: theme.colors.permissionButton.allow.background,
        fontWeight: "500" as const,
      },
      buttonTextReject: {
        color: theme.colors.permissionButton.deny.background,
        fontWeight: "500" as const,
      },
      buttonTextSelected: {
        color: theme.colors.text,
        fontWeight: "500" as const,
      },
    };

    const isAccepted = reviewState === "accepted";
    const isRejected = reviewState === "rejected";
    const isPending = !reviewState;

    return (
      <View style={styles.container}>
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[
              styles.button,
              isAccepted && styles.buttonSelected,
              isRejected && styles.buttonInactive,
            ]}
            onPress={onAccept}
            disabled={!isPending}
            activeOpacity={isPending ? 0.7 : 1}
          >
            <View style={styles.buttonContent}>
              <Text
                style={[
                  styles.buttonText,
                  isPending && styles.buttonTextAccept,
                  isAccepted && styles.buttonTextSelected,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {isAccepted ? t("codeReview.accepted") : t("codeReview.accept")}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.button,
              isRejected && styles.buttonSelected,
              isAccepted && styles.buttonInactive,
            ]}
            onPress={onReject}
            disabled={!isPending}
            activeOpacity={isPending ? 0.7 : 1}
          >
            <View style={styles.buttonContent}>
              <Text
                style={[
                  styles.buttonText,
                  isPending && styles.buttonTextReject,
                  isRejected && styles.buttonTextSelected,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {isRejected ? t("codeReview.rejected") : t("codeReview.reject")}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    );
  },
);
