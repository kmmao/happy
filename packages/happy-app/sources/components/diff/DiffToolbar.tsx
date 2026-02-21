import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";

type ViewMode = "unified" | "split";

interface DiffToolbarProps {
    viewMode: ViewMode;
    onViewModeChange: (mode: ViewMode) => void;
    expandedContext: boolean;
    onExpandedContextChange: (expanded: boolean) => void;
    onCopyDiff: () => void;
    showSplitOption?: boolean;
}

export const DiffToolbar = React.memo<DiffToolbarProps>(
    ({
        viewMode,
        onViewModeChange,
        expandedContext,
        onExpandedContextChange,
        onCopyDiff,
        showSplitOption = false,
    }) => {
        const { theme } = useUnistyles();
        const [copied, setCopied] = React.useState(false);

        const handleCopy = React.useCallback(() => {
            onCopyDiff();
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }, [onCopyDiff]);

        return (
            <View style={styles.container}>
                {/* View Mode Toggle */}
                {showSplitOption && (
                    <View
                        style={[
                            styles.segmentContainer,
                            { backgroundColor: theme.colors.surfaceHighest },
                        ]}
                    >
                        <Pressable
                            onPress={() => onViewModeChange("unified")}
                            style={[
                                styles.segment,
                                viewMode === "unified" && {
                                    backgroundColor: theme.colors.surface,
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.segmentText,
                                    {
                                        color:
                                            viewMode === "unified"
                                                ? theme.colors.textLink
                                                : theme.colors.textSecondary,
                                    },
                                ]}
                            >
                                {t("diff.toolbar.unified")}
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={() => onViewModeChange("split")}
                            style={[
                                styles.segment,
                                viewMode === "split" && {
                                    backgroundColor: theme.colors.surface,
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.segmentText,
                                    {
                                        color:
                                            viewMode === "split"
                                                ? theme.colors.textLink
                                                : theme.colors.textSecondary,
                                    },
                                ]}
                            >
                                {t("diff.toolbar.split")}
                            </Text>
                        </Pressable>
                    </View>
                )}

                <View style={styles.spacer} />

                {/* Expand Context Toggle */}
                <Pressable
                    onPress={() => onExpandedContextChange(!expandedContext)}
                    style={styles.actionButton}
                >
                    <Ionicons
                        name={expandedContext ? "contract-outline" : "expand-outline"}
                        size={16}
                        color={
                            expandedContext
                                ? theme.colors.textLink
                                : theme.colors.textSecondary
                        }
                    />
                    <Text
                        style={[
                            styles.actionText,
                            {
                                color: expandedContext
                                    ? theme.colors.textLink
                                    : theme.colors.textSecondary,
                            },
                        ]}
                    >
                        {expandedContext
                            ? t("diff.toolbar.collapse")
                            : t("diff.toolbar.expand")}
                    </Text>
                </Pressable>

                {/* Copy Diff Button */}
                <Pressable onPress={handleCopy} style={styles.actionButton}>
                    <Ionicons
                        name={copied ? "checkmark" : "copy-outline"}
                        size={16}
                        color={
                            copied
                                ? theme.colors.diff.success
                                : theme.colors.textSecondary
                        }
                    />
                    <Text
                        style={[
                            styles.actionText,
                            {
                                color: copied
                                    ? theme.colors.diff.success
                                    : theme.colors.textSecondary,
                            },
                        ]}
                    >
                        {copied
                            ? t("diff.toolbar.copied")
                            : t("diff.toolbar.copyDiff")}
                    </Text>
                </Pressable>
            </View>
        );
    },
);

const styles = StyleSheet.create({
    container: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        paddingVertical: 6,
        gap: 8,
    },
    segmentContainer: {
        flexDirection: "row",
        borderRadius: 6,
        padding: 2,
    },
    segment: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 5,
    },
    segmentText: {
        ...Typography.mono(),
        fontSize: 12,
        fontWeight: "500",
    },
    spacer: {
        flex: 1,
    },
    actionButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 4,
    },
    actionText: {
        ...Typography.mono(),
        fontSize: 11,
    },
});
