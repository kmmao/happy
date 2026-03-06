import * as React from "react";
import { View, Pressable } from "react-native";
import { Octicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import type { Issue } from "@/sync/issueTypes";

interface IssueCardProps {
  readonly issue: Issue;
  readonly onPress: (issue: Issue) => void;
}

export const IssueCard = React.memo<IssueCardProps>(function IssueCard({
  issue,
  onPress,
}) {
  const { theme } = useUnistyles();
  const isOpen = issue.state === "open";

  return (
    <Pressable
      onPress={() => onPress(issue)}
      style={(p) => [
        styles.container,
        {
          backgroundColor: p.pressed
            ? theme.colors.surfaceHigh
            : theme.colors.surface,
          borderBottomColor: theme.colors.divider,
        },
      ]}
    >
      <Octicons
        name={isOpen ? "issue-opened" : "issue-closed"}
        size={16}
        color={isOpen ? theme.colors.success : theme.colors.textSecondary}
        style={{ marginTop: 2 }}
      />
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text
            style={{
              fontSize: 15,
              fontWeight: "500",
              color: theme.colors.text,
              flex: 1,
              ...Typography.default(),
            }}
            numberOfLines={2}
          >
            {issue.title}
          </Text>
        </View>
        <View style={styles.meta}>
          <Text
            style={{
              fontSize: 13,
              color: theme.colors.textSecondary,
              ...Typography.mono(),
            }}
          >
            #{issue.number}
          </Text>
          {issue.author !== "" && (
            <Text
              style={{
                fontSize: 13,
                color: theme.colors.textSecondary,
                ...Typography.default(),
              }}
            >
              {issue.author}
            </Text>
          )}
          {issue.commentCount > 0 && (
            <View style={styles.commentCount}>
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
                  numberOfLines={1}
                >
                  {label.name}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
    borderBottomWidth: 0.5,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  commentCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  labels: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 2,
  },
  label: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
}));
