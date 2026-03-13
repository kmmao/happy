/**
 * Fixed Issue Summary Header displayed at the top of issue-linked sessions.
 *
 * Shows issue number, title, processing status, and optional PR link.
 * Supports collapse/expand (default: collapsed).
 * When expanded, shows structured sections: Metadata, Description, Worktree.
 */

import * as React from "react";
import { View, Pressable, Linking, Platform, ScrollView } from "react-native";
import { Text } from "@/components/StyledText";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import {
    ISSUE_STATUS_COLORS,
    ISSUE_STATUS_LABELS,
} from "@/constants/issueStatusColors";
import { t } from "@/text";
import type { IssueSessionLink } from "@/sync/issueSessionTypes";

const MAX_BODY_HEIGHT = 240;

interface WorktreeDisplayInfo {
    readonly branchName: string;
    readonly parentBranch: string;
}

interface IssueSummaryHeaderProps {
    readonly issueLink: IssueSessionLink;
    readonly issueBody?: string | null;
    readonly prUrl?: string | null;
    readonly worktree?: WorktreeDisplayInfo | null;
}

function formatCreatedAt(timestamp: number): string {
    const date = new Date(timestamp);
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 24) {
        const hours = Math.floor(diffHours);
        if (hours < 1) {
            const mins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
            return `${mins}m ago`;
        }
        return `${hours}h ago`;
    }

    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export const IssueSummaryHeader = React.memo<IssueSummaryHeaderProps>(
    function IssueSummaryHeader({ issueLink, issueBody, prUrl, worktree }) {
        const { theme } = useUnistyles();
        const [expanded, setExpanded] = React.useState(false);

        const statusColor = ISSUE_STATUS_COLORS[issueLink.status].text;
        const statusBg = ISSUE_STATUS_COLORS[issueLink.status].bg;
        const statusLabel = ISSUE_STATUS_LABELS[issueLink.status]();

        const effectivePrUrl = prUrl ?? issueLink.prUrl;

        return (
            <View
                style={[
                    styles.container,
                    {
                        backgroundColor: theme.colors.surfaceHigh,
                        borderBottomColor: theme.colors.divider,
                    },
                ]}
            >
                {/* Title row: status dot + #number + title + chevron */}
                <Pressable
                    style={styles.titleRow}
                    onPress={() => setExpanded((v) => !v)}
                >
                    <View
                        style={[
                            styles.statusBadge,
                            { backgroundColor: statusBg },
                        ]}
                    >
                        <View
                            style={[
                                styles.statusDot,
                                { backgroundColor: statusColor },
                            ]}
                        />
                        <Text
                            style={[
                                styles.statusText,
                                { color: statusColor },
                            ]}
                        >
                            {statusLabel}
                        </Text>
                    </View>

                    <Text
                        style={[
                            styles.issueNumber,
                            { color: theme.colors.textLink },
                        ]}
                    >
                        #{issueLink.issueNumber}
                    </Text>

                    <Text
                        style={[
                            styles.issueTitle,
                            { color: theme.colors.text },
                        ]}
                        numberOfLines={1}
                    >
                        {issueLink.issueTitle}
                    </Text>

                    {effectivePrUrl ? (
                        <Pressable
                            onPress={() => Linking.openURL(effectivePrUrl)}
                            hitSlop={8}
                        >
                            <Ionicons
                                name="git-pull-request-outline"
                                size={14}
                                color={theme.colors.textLink}
                            />
                        </Pressable>
                    ) : null}

                    <Ionicons
                        name={expanded ? "chevron-up" : "chevron-down"}
                        size={16}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>

                {/* Expanded content: structured sections */}
                {expanded && (
                    <View style={styles.expandedContent}>
                        {/* Metadata section */}
                        <View style={styles.metadataSection}>
                            <MetadataRow
                                icon="code-slash-outline"
                                label={issueLink.repoLabel}
                                color={theme.colors.textSecondary}
                                numberOfLines={1}
                            />
                            {issueLink.issueAuthor ? (
                                <MetadataRow
                                    icon="person-outline"
                                    label={`@${issueLink.issueAuthor}`}
                                    color={theme.colors.textSecondary}
                                />
                            ) : null}
                            {issueLink.issueLabels &&
                            issueLink.issueLabels.length > 0 ? (
                                <MetadataRow
                                    icon="pricetag-outline"
                                    label={issueLink.issueLabels.join(", ")}
                                    color={theme.colors.textSecondary}
                                />
                            ) : null}
                            {issueLink.createdAt ? (
                                <MetadataRow
                                    icon="time-outline"
                                    label={`${t("issues.createdAtLabel")}: ${formatCreatedAt(issueLink.createdAt)}`}
                                    color={theme.colors.textSecondary}
                                />
                            ) : null}
                            {issueLink.issueUrl ? (
                                <Pressable
                                    onPress={() =>
                                        Linking.openURL(
                                            issueLink.issueUrl!,
                                        )
                                    }
                                >
                                    <MetadataRow
                                        icon="link-outline"
                                        label={issueLink.issueUrl}
                                        color={theme.colors.textLink}
                                        numberOfLines={1}
                                    />
                                </Pressable>
                            ) : null}
                        </View>

                        {/* Issue body */}
                        {issueBody ? (
                            <ScrollView
                                style={[
                                    styles.bodyScroll,
                                    { borderColor: theme.colors.divider },
                                ]}
                                nestedScrollEnabled
                            >
                                <Text
                                    style={[
                                        styles.bodyText,
                                        {
                                            color: theme.colors.textSecondary,
                                        },
                                    ]}
                                >
                                    {issueBody}
                                </Text>
                            </ScrollView>
                        ) : null}

                        {/* Worktree section */}
                        {worktree && (
                            <View style={styles.worktreeSection}>
                                <Text
                                    style={[
                                        styles.sectionLabel,
                                        {
                                            color: theme.colors.textSecondary,
                                        },
                                    ]}
                                >
                                    {t("issues.worktreeSection")}
                                </Text>
                                <MetadataRow
                                    icon="git-branch-outline"
                                    label={worktree.branchName}
                                    color={theme.colors.textSecondary}
                                    mono
                                />
                                <MetadataRow
                                    icon="arrow-undo-outline"
                                    label={worktree.parentBranch}
                                    color={theme.colors.textSecondary}
                                    mono
                                />
                            </View>
                        )}

                        {/* Repo + PR link footer row */}
                        {effectivePrUrl ? (
                            <View style={styles.metaRow}>
                                <Ionicons
                                    name="git-branch-outline"
                                    size={12}
                                    color={theme.colors.textSecondary}
                                />
                                <Text
                                    style={[
                                        styles.repoLabel,
                                        {
                                            color: theme.colors.textSecondary,
                                        },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {issueLink.repoLabel}
                                </Text>
                                <Pressable
                                    style={styles.prLink}
                                    onPress={() =>
                                        Linking.openURL(effectivePrUrl)
                                    }
                                    hitSlop={8}
                                >
                                    <Ionicons
                                        name="git-pull-request-outline"
                                        size={13}
                                        color={theme.colors.textLink}
                                    />
                                    <Text
                                        style={[
                                            styles.prLinkText,
                                            { color: theme.colors.textLink },
                                        ]}
                                    >
                                        PR
                                    </Text>
                                </Pressable>
                            </View>
                        ) : null}
                    </View>
                )}
            </View>
        );
    },
);

/**
 * A single metadata row with an icon and label text.
 */
const MetadataRow = React.memo<{
    readonly icon: keyof typeof Ionicons.glyphMap;
    readonly label: string;
    readonly color: string;
    readonly numberOfLines?: number;
    readonly mono?: boolean;
}>(function MetadataRow({ icon, label, color, numberOfLines, mono }) {
    return (
        <View style={styles.metadataRow}>
            <Ionicons name={icon} size={12} color={color} />
            <Text
                style={[
                    mono ? styles.metadataTextMono : styles.metadataText,
                    { color },
                ]}
                numberOfLines={numberOfLines}
            >
                {label}
            </Text>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
        gap: 8,
    },
    titleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    statusBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        flexShrink: 0,
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    statusText: {
        fontSize: 11,
        ...Typography.default("semiBold"),
    },
    issueNumber: {
        fontSize: 14,
        flexShrink: 0,
        ...Typography.mono(),
    },
    issueTitle: {
        fontSize: 14,
        fontWeight: "600",
        flex: 1,
        ...Typography.default("semiBold"),
    },
    expandedContent: {
        gap: 8,
        paddingLeft: 4,
    },
    metadataSection: {
        gap: 4,
    },
    metadataRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    metadataText: {
        fontSize: 12,
        flex: 1,
        ...Typography.default(),
    },
    metadataTextMono: {
        fontSize: 12,
        flex: 1,
        ...Typography.mono(),
    },
    sectionLabel: {
        fontSize: 11,
        marginTop: 2,
        ...Typography.default("semiBold"),
    },
    worktreeSection: {
        gap: 4,
    },
    bodyScroll: {
        maxHeight: MAX_BODY_HEIGHT,
        borderWidth: Platform.select({ ios: 0.33, default: 1 }),
        borderRadius: 8,
        padding: 10,
    },
    bodyText: {
        fontSize: 13,
        lineHeight: 18,
        ...Typography.default(),
    },
    metaRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    repoLabel: {
        fontSize: 12,
        flex: 1,
        ...Typography.mono(),
    },
    prLink: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    prLinkText: {
        fontSize: 12,
        ...Typography.default("semiBold"),
    },
}));
