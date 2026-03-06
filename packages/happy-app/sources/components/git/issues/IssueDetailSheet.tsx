import * as React from "react";
import {
  View,
  Pressable,
  ScrollView,
  Linking,
  ActivityIndicator,
} from "react-native";
import { Ionicons, Octicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "@/text";
import { Modal } from "@/modal";
import { useHappyAction } from "@/hooks/useHappyAction";
import { issueStore } from "@/sync/issueStore";
import type { AggregatedIssue } from "@/sync/issueTypes";

interface IssueDetailSheetProps {
  readonly issue: AggregatedIssue;
  readonly sessionId: string;
  readonly repoPath?: string;
  readonly onClose: () => void;
  readonly onSendToChat?: (text: string) => void;
}

export const IssueDetailSheet = React.memo<IssueDetailSheetProps>(
  function IssueDetailSheet({
    issue,
    sessionId,
    repoPath,
    onClose,
    onSendToChat,
  }) {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const [issueState, setIssueState] = React.useState(issue.state);
    const isOpen = issueState === "open";

    const handleOpenInBrowser = React.useCallback(() => {
      if (issue.url) {
        Linking.openURL(issue.url);
      }
    }, [issue.url]);

    const handleSendToChat = React.useCallback(() => {
      if (onSendToChat) {
        onSendToChat(`#${issue.number} ${issue.title}`);
      }
      onClose();
    }, [issue.number, issue.title, onSendToChat, onClose]);

    const [stateLoading, doToggleState] = useHappyAction(
      React.useCallback(async () => {
        const newState = issueState === "open" ? "closed" : "open";
        await issueStore
          .getState()
          .updateIssueState(
            issue.projectKey,
            issue.number,
            newState,
            sessionId,
            repoPath,
          );
        setIssueState(newState);
      }, [issueState, issue.projectKey, issue.number, sessionId, repoPath]),
    );

    const [commentLoading, doAddComment] = useHappyAction(
      React.useCallback(async () => {
        const body = await Modal.prompt(t("issues.addComment"), "", {
          placeholder: t("issues.commentPlaceholder"),
        });
        if (!body || body.trim() === "") return;
        await issueStore
          .getState()
          .addComment(
            issue.projectKey,
            issue.number,
            body.trim(),
            sessionId,
            repoPath,
          );
      }, [issue.projectKey, issue.number, sessionId, repoPath]),
    );

    const formattedDate =
      issue.createdAt > 0 ? new Date(issue.createdAt).toLocaleDateString() : "";

    return (
      <View style={styles.overlay}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.surface,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
        >
          {/* Header: number + state badge */}
          <View style={styles.header}>
            <Octicons
              name={isOpen ? "issue-opened" : "issue-closed"}
              size={18}
              color={isOpen ? theme.colors.success : theme.colors.textSecondary}
            />
            <Text
              style={{
                fontSize: 13,
                color: theme.colors.textSecondary,
                ...Typography.mono(),
              }}
            >
              #{issue.number}
            </Text>
            <View
              style={[
                styles.stateBadge,
                {
                  backgroundColor: isOpen
                    ? theme.colors.success + "20"
                    : theme.colors.textSecondary + "20",
                },
              ]}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "600",
                  color: isOpen
                    ? theme.colors.success
                    : theme.colors.textSecondary,
                  ...Typography.default(),
                }}
              >
                {isOpen ? t("issues.open") : t("issues.closed")}
              </Text>
            </View>
          </View>

          {/* Title */}
          <Text style={[styles.title, { color: theme.colors.text }]}>
            {issue.title}
          </Text>

          {/* Meta row: author + date + comments */}
          <View style={styles.metaRow}>
            <Text
              style={{
                fontSize: 13,
                color: theme.colors.textSecondary,
                ...Typography.default(),
              }}
            >
              {issue.author}
              {formattedDate !== "" && ` · ${formattedDate}`}
            </Text>
            {issue.commentCount > 0 && (
              <View style={styles.commentBadge}>
                <Octicons
                  name="comment"
                  size={12}
                  color={theme.colors.textSecondary}
                />
                <Text
                  style={{
                    fontSize: 12,
                    color: theme.colors.textSecondary,
                    ...Typography.mono(),
                  }}
                >
                  {issue.commentCount}
                </Text>
              </View>
            )}
          </View>

          {/* Labels */}
          {issue.labels.length > 0 && (
            <View style={styles.labels}>
              {issue.labels.map((label) => (
                <View
                  key={label.name}
                  style={[
                    styles.label,
                    {
                      backgroundColor: label.color
                        ? `#${label.color}30`
                        : theme.colors.surfaceHigh,
                      borderColor: label.color
                        ? `#${label.color}60`
                        : theme.colors.divider,
                    },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "500",
                      color: label.color
                        ? `#${label.color}`
                        : theme.colors.textSecondary,
                      ...Typography.default(),
                    }}
                  >
                    {label.name}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Body — always rendered with consistent container */}
          <View
            style={[
              styles.bodyContainer,
              { backgroundColor: theme.colors.surfaceHigh },
            ]}
          >
            {issue.body !== "" ? (
              <ScrollView
                style={styles.bodyScroll}
                contentContainerStyle={styles.bodyContent}
              >
                <Text
                  style={{
                    fontSize: 14,
                    color: theme.colors.text,
                    lineHeight: 20,
                    ...Typography.default(),
                  }}
                >
                  {issue.body}
                </Text>
              </ScrollView>
            ) : (
              <Text
                style={{
                  fontSize: 13,
                  color: theme.colors.textSecondary,
                  fontStyle: "italic",
                  textAlign: "center",
                  paddingVertical: 12,
                  ...Typography.default(),
                }}
              >
                {t("issues.noBody")}
              </Text>
            )}
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            {/* Close / Reopen */}
            <Pressable
              onPress={doToggleState}
              disabled={stateLoading}
              style={styles.actionItem}
            >
              {stateLoading ? (
                <ActivityIndicator size={18} color={theme.colors.text} />
              ) : (
                <Octicons
                  name={isOpen ? "issue-closed" : "issue-reopened"}
                  size={18}
                  color={
                    isOpen
                      ? theme.colors.box.warning.text
                      : theme.colors.success
                  }
                />
              )}
              <Text
                style={{
                  fontSize: 15,
                  color: isOpen
                    ? theme.colors.box.warning.text
                    : theme.colors.success,
                  ...Typography.default(),
                }}
              >
                {isOpen ? t("issues.closeIssue") : t("issues.reopenIssue")}
              </Text>
            </Pressable>

            {/* Add Comment */}
            <Pressable
              onPress={doAddComment}
              disabled={commentLoading}
              style={styles.actionItem}
            >
              {commentLoading ? (
                <ActivityIndicator size={18} color={theme.colors.text} />
              ) : (
                <Octicons
                  name="comment-discussion"
                  size={18}
                  color={theme.colors.text}
                />
              )}
              <Text
                style={{
                  fontSize: 15,
                  color: theme.colors.text,
                  ...Typography.default(),
                }}
              >
                {t("issues.addComment")}
              </Text>
            </Pressable>

            {onSendToChat && (
              <Pressable onPress={handleSendToChat} style={styles.actionItem}>
                <Ionicons
                  name="chatbubble-outline"
                  size={18}
                  color={theme.colors.text}
                />
                <Text
                  style={{
                    fontSize: 15,
                    color: theme.colors.text,
                    ...Typography.default(),
                  }}
                >
                  {t("issues.sendToChat")}
                </Text>
              </Pressable>
            )}

            {issue.url !== "" && (
              <Pressable
                onPress={handleOpenInBrowser}
                style={styles.actionItem}
              >
                <Ionicons
                  name="open-outline"
                  size={18}
                  color={theme.colors.text}
                />
                <Text
                  style={{
                    fontSize: 15,
                    color: theme.colors.text,
                    ...Typography.default(),
                  }}
                >
                  {t("issues.openInBrowser")}
                </Text>
              </Pressable>
            )}
          </View>

          {/* Cancel */}
          <View
            style={[styles.divider, { backgroundColor: theme.colors.divider }]}
          />
          <Pressable onPress={onClose} style={styles.cancelItem}>
            <Text
              style={{
                fontSize: 15,
                fontWeight: "600",
                color: theme.colors.header.tint,
                ...Typography.default(),
              }}
            >
              {t("common.cancel")}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  overlay: {
    width: "100%",
    maxWidth: 500,
    minWidth: 320,
  },
  sheet: {
    borderRadius: 14,
    overflow: "hidden",
    paddingTop: 16,
    minHeight: 360,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  stateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    paddingHorizontal: 16,
    marginBottom: 4,
    ...Typography.default("semiBold"),
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  commentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  labels: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  label: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  bodyContainer: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  bodyScroll: {
    maxHeight: 200,
  },
  bodyContent: {
    padding: 12,
  },
  actions: {
    gap: 0,
  },
  actionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  divider: {
    height: 0.5,
    marginHorizontal: 16,
    marginVertical: 4,
  },
  cancelItem: {
    alignItems: "center",
    paddingVertical: 14,
  },
}));
