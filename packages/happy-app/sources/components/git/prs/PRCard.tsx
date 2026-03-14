import * as React from "react";
import { View, Pressable } from "react-native";
import { Octicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { Typography } from "@/constants/Typography";
import { useUnistyles, StyleSheet } from "react-native-unistyles";
import { t } from "@/text";
import type { PullRequest, AggregatedPR } from "@/sync/prTypes";
import { formatLastSeen } from "@/utils/sessionUtils";

const STATE_ICON: Record<string, React.ComponentProps<typeof Octicons>["name"]> = {
    open: "git-pull-request",
    closed: "git-pull-request-closed",
    merged: "git-merge",
};

interface PRCardProps {
    readonly pr: PullRequest | AggregatedPR;
    readonly onPress: (pr: PullRequest | AggregatedPR) => void;
    readonly repoLabel?: string;
}

export const PRCard = React.memo<PRCardProps>(function PRCard({
    pr,
    onPress,
    repoLabel,
}) {
    const { theme } = useUnistyles();

    const stateColor =
        pr.state === "open"
            ? theme.colors.success
            : pr.state === "merged"
              ? "#8957e5"
              : theme.colors.textSecondary;

    return (
        <Pressable
            onPress={() => onPress(pr)}
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
                name={STATE_ICON[pr.state] ?? "git-pull-request"}
                size={16}
                color={stateColor}
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
                            #{pr.number}
                        </Text>{" "}
                        {pr.title}
                    </Text>
                    {pr.draft && (
                        <View
                            style={[
                                styles.draftBadge,
                                { backgroundColor: theme.colors.textSecondary + "20" },
                            ]}
                        >
                            <Text
                                style={{
                                    fontSize: 10,
                                    fontWeight: "600",
                                    color: theme.colors.textSecondary,
                                    ...Typography.default(),
                                }}
                            >
                                {t("prs.draft")}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Branch info */}
                <Text
                    style={{
                        fontSize: 12,
                        color: theme.colors.textSecondary,
                        ...Typography.mono(),
                    }}
                    numberOfLines={1}
                >
                    {pr.headBranch} → {pr.baseBranch}
                </Text>

                {/* Meta: author · time · comments · changes */}
                <View style={styles.meta}>
                    {pr.author !== "" && (
                        <Text style={[styles.metaText, { color: theme.colors.textSecondary }]}>
                            {pr.author}
                        </Text>
                    )}
                    <Text style={[styles.metaText, { color: theme.colors.textSecondary }]}>
                        {formatLastSeen(pr.updatedAt)}
                    </Text>
                    {pr.commentCount > 0 && (
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
                                {pr.commentCount}
                            </Text>
                        </View>
                    )}
                    {(pr.additions > 0 || pr.deletions > 0) && (
                        <View style={styles.diffStats}>
                            {pr.additions > 0 && (
                                <Text
                                    style={{
                                        fontSize: 11,
                                        fontWeight: "500",
                                        color: theme.colors.success,
                                        ...Typography.mono(),
                                    }}
                                >
                                    +{pr.additions}
                                </Text>
                            )}
                            {pr.deletions > 0 && (
                                <Text
                                    style={{
                                        fontSize: 11,
                                        fontWeight: "500",
                                        color: theme.colors.deleteAction,
                                        ...Typography.mono(),
                                    }}
                                >
                                    -{pr.deletions}
                                </Text>
                            )}
                        </View>
                    )}
                </View>

                {/* CI + Review status */}
                {(pr.checksStatus || pr.reviewDecision) && (
                    <View style={styles.statusRow}>
                        {pr.checksStatus && (
                            <View
                                style={[
                                    styles.statusBadge,
                                    {
                                        backgroundColor:
                                            (pr.checksStatus === "success"
                                                ? theme.colors.success
                                                : pr.checksStatus === "failure" ||
                                                    pr.checksStatus === "error"
                                                  ? theme.colors.deleteAction
                                                  : theme.colors.textSecondary) + "20",
                                    },
                                ]}
                            >
                                <Octicons
                                    name={
                                        pr.checksStatus === "success"
                                            ? "check"
                                            : pr.checksStatus === "failure" ||
                                                pr.checksStatus === "error"
                                              ? "x"
                                              : "clock"
                                    }
                                    size={10}
                                    color={
                                        pr.checksStatus === "success"
                                            ? theme.colors.success
                                            : pr.checksStatus === "failure" ||
                                                pr.checksStatus === "error"
                                              ? theme.colors.deleteAction
                                              : theme.colors.textSecondary
                                    }
                                />
                                <Text
                                    style={{
                                        fontSize: 11,
                                        fontWeight: "600",
                                        color:
                                            pr.checksStatus === "success"
                                                ? theme.colors.success
                                                : pr.checksStatus === "failure" ||
                                                    pr.checksStatus === "error"
                                                  ? theme.colors.deleteAction
                                                  : theme.colors.textSecondary,
                                        ...Typography.default(),
                                    }}
                                >
                                    {t(`prs.ci_${pr.checksStatus}`)}
                                </Text>
                            </View>
                        )}
                        {pr.reviewDecision && (
                            <View
                                style={[
                                    styles.statusBadge,
                                    {
                                        backgroundColor:
                                            (pr.reviewDecision === "approved"
                                                ? theme.colors.success
                                                : pr.reviewDecision === "changes_requested"
                                                  ? theme.colors.deleteAction
                                                  : theme.colors.textSecondary) + "20",
                                    },
                                ]}
                            >
                                <Octicons
                                    name={
                                        pr.reviewDecision === "approved"
                                            ? "check-circle"
                                            : pr.reviewDecision === "changes_requested"
                                              ? "file-diff"
                                              : "code-review"
                                    }
                                    size={10}
                                    color={
                                        pr.reviewDecision === "approved"
                                            ? theme.colors.success
                                            : pr.reviewDecision === "changes_requested"
                                              ? theme.colors.deleteAction
                                              : theme.colors.textSecondary
                                    }
                                />
                                <Text
                                    style={{
                                        fontSize: 11,
                                        fontWeight: "600",
                                        color:
                                            pr.reviewDecision === "approved"
                                                ? theme.colors.success
                                                : pr.reviewDecision === "changes_requested"
                                                  ? theme.colors.deleteAction
                                                  : theme.colors.textSecondary,
                                        ...Typography.default(),
                                    }}
                                >
                                    {t(`prs.review_${pr.reviewDecision}`)}
                                </Text>
                            </View>
                        )}
                    </View>
                )}

                {/* Labels row */}
                {(pr.labels.length > 0 || repoLabel) && (
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
                        {pr.labels.map((label) => (
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
        gap: 6,
    },
    draftBadge: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 8,
        marginTop: 2,
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
    diffStats: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
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
