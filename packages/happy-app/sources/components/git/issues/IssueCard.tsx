import * as React from "react";
import { View, Pressable } from "react-native";
import { Octicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import type { Issue, AggregatedIssue } from "@/sync/issueTypes";
import { useIssueSessionStatus } from "@/hooks/useIssueSessionStatus";
import { formatLastSeen } from "@/utils/sessionUtils";

interface IssueCardProps {
    readonly issue: Issue | AggregatedIssue;
    readonly onPress: (issue: Issue | AggregatedIssue) => void;
    readonly repoLabel?: string;
}

export const IssueCard = React.memo<IssueCardProps>(function IssueCard({
    issue,
    onPress,
    repoLabel,
}) {
    const { theme } = useUnistyles();
    const isOpen = issue.state === "open";

    // Check processing status — only for AggregatedIssue (has projectKey)
    const projectKey =
        "projectKey" in issue ? (issue as AggregatedIssue).projectKey : "";
    const issueSessionLink = useIssueSessionStatus(projectKey, issue.number);
    const isProcessing = issueSessionLink?.status === "processing";

    const bodyPreview = issue.body.trim().split("\n")[0] ?? "";

    return (
        <Pressable
            onPress={() => onPress(issue)}
            style={(p) => [
                styles.container,
                {
                    backgroundColor: p.pressed
                        ? theme.colors.surfaceHigh
                        : "transparent",
                },
            ]}
        >
            {/* State icon */}
            <Octicons
                name={isOpen ? "issue-opened" : "issue-closed"}
                size={16}
                color={
                    isProcessing
                        ? theme.colors.button.primary.background
                        : isOpen
                          ? theme.colors.success
                          : theme.colors.textSecondary
                }
                style={{ marginTop: 2 }}
            />

            {/* Content */}
            <View style={styles.content}>
                {/* Title row */}
                <View style={styles.titleRow}>
                    <Text
                        style={{
                            fontSize: 15,
                            fontWeight: "600",
                            color: theme.colors.text,
                            flex: 1,
                            ...Typography.default(),
                        }}
                        numberOfLines={2}
                    >
                        <Text
                            style={{
                                fontSize: 13,
                                fontWeight: "400",
                                color: theme.colors.textSecondary,
                                ...Typography.mono(),
                            }}
                        >
                            #{issue.number}
                        </Text>{" "}
                        {issue.title}
                    </Text>
                </View>

                {/* Meta: author · time · comments · processing badge — single line */}
                <View style={styles.meta}>
                    {issue.author !== "" && (
                        <Text style={[styles.metaText, { color: theme.colors.textSecondary }]}>
                            {issue.author}
                        </Text>
                    )}
                    <Text style={[styles.metaText, { color: theme.colors.textSecondary }]}>
                        {formatLastSeen(issue.updatedAt)}
                    </Text>
                    {issue.commentCount > 0 && (
                        <View style={styles.commentCount}>
                            <Octicons
                                name="comment"
                                size={11}
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
                    {isProcessing && (
                        <View
                            style={[
                                styles.processingBadge,
                                {
                                    backgroundColor:
                                        theme.colors.button.primary.background + "20",
                                },
                            ]}
                        >
                            <Octicons
                                name="sync"
                                size={10}
                                color={theme.colors.button.primary.background}
                            />
                            <Text
                                style={{
                                    fontSize: 11,
                                    fontWeight: "600",
                                    color: theme.colors.button.primary.background,
                                    ...Typography.default(),
                                }}
                            >
                                {t("issues.processing")}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Labels row — combine repo label + issue labels in one row */}
                {(issue.labels.length > 0 || repoLabel) && (
                    <View style={styles.labels}>
                        {repoLabel && (
                            <View
                                style={[
                                    styles.label,
                                    {
                                        backgroundColor: theme.colors.textLink + "18",
                                        borderColor: theme.colors.textLink + "40",
                                    },
                                ]}
                            >
                                <Text
                                    style={{
                                        fontSize: 11,
                                        fontWeight: "500",
                                        color: theme.colors.textLink,
                                        ...Typography.mono(),
                                    }}
                                    numberOfLines={1}
                                >
                                    {repoLabel}
                                </Text>
                            </View>
                        )}
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
        paddingVertical: 10,
        gap: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
    },
    content: {
        flex: 1,
        gap: 3,
    },
    titleRow: {
        flexDirection: "row",
        alignItems: "flex-start",
    },
    meta: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
    },
    metaText: {
        fontSize: 12,
        ...Typography.default(),
    },
    commentCount: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
    },
    processingBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 8,
    },
    labels: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 4,
        marginTop: 2,
    },
    label: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 10,
        borderWidth: 1,
    },
}));
