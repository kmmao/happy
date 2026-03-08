import * as React from "react";
import { View, Pressable, Linking } from "react-native";
import { Octicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import type { Issue, AggregatedIssue } from "@/sync/issueTypes";
import { useIssueSessionStatus } from "@/hooks/useIssueSessionStatus";
import { formatLastSeen } from "@/utils/sessionUtils";
import type { IssueSessionStatus } from "@/sync/issueSessionTypes";

const STATUS_COLORS: Record<IssueSessionStatus, string> = {
    processing: "#007AFF",
    completed: "#34C759",
    failed: "#FF3B30",
    cancelled: "#8E8E93",
};

const STATUS_ICONS: Record<IssueSessionStatus, React.ComponentProps<typeof Octicons>["name"]> = {
    processing: "sync",
    completed: "check-circle",
    failed: "x-circle",
    cancelled: "skip",
};

const STATUS_LABELS: Record<IssueSessionStatus, () => string> = {
    processing: () => t("issues.statusProcessing"),
    completed: () => t("issues.statusCompleted"),
    failed: () => t("issues.statusFailed"),
    cancelled: () => t("issues.statusCancelled"),
};

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

    const statusColor = issueSessionLink
        ? STATUS_COLORS[issueSessionLink.status]
        : undefined;

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
                    issueSessionLink
                        ? statusColor
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

                {/* Meta: author · time · comments — single line */}
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
                </View>

                {/* Session status + PR link row */}
                {issueSessionLink && statusColor && (
                    <View style={styles.statusRow}>
                        <View
                            style={[
                                styles.statusBadge,
                                { backgroundColor: statusColor + "20" },
                            ]}
                        >
                            <Octicons
                                name={STATUS_ICONS[issueSessionLink.status]}
                                size={10}
                                color={statusColor}
                            />
                            <Text
                                style={{
                                    fontSize: 11,
                                    fontWeight: "600",
                                    color: statusColor,
                                    ...Typography.default(),
                                }}
                            >
                                {STATUS_LABELS[issueSessionLink.status]()}
                            </Text>
                        </View>
                        {issueSessionLink.prUrl ? (
                            <Pressable
                                onPress={(e) => {
                                    e.stopPropagation();
                                    Linking.openURL(issueSessionLink.prUrl!);
                                }}
                                hitSlop={8}
                                style={[
                                    styles.prBadge,
                                    { backgroundColor: theme.colors.textLink + "18" },
                                ]}
                            >
                                <Octicons
                                    name="git-pull-request"
                                    size={10}
                                    color={theme.colors.textLink}
                                />
                                <Text
                                    style={{
                                        fontSize: 11,
                                        fontWeight: "500",
                                        color: theme.colors.textLink,
                                        ...Typography.mono(),
                                    }}
                                    numberOfLines={1}
                                >
                                    PR
                                </Text>
                            </Pressable>
                        ) : null}
                    </View>
                )}

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
    statusRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginTop: 1,
    },
    statusBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 8,
    },
    prBadge: {
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
