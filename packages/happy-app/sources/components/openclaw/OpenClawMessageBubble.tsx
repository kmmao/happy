import * as React from "react";
import { View, Pressable } from "react-native";
import { Text } from "@/components/StyledText";
import { MarkdownView } from "@/components/markdown/MarkdownView";
import { Typography } from "@/constants/Typography";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { DisplayBlock } from "@/openclaw";

interface Props {
    block: DisplayBlock;
}

export const OpenClawMessageBubble = React.memo(({ block }: Props) => {
    switch (block.kind) {
        case "user":
            return <UserBubble block={block} />;
        case "assistant":
            return <AssistantBubble block={block} />;
        case "thinking":
            return <ThinkingBubble block={block} />;
        case "error":
            return <ErrorBubble block={block} />;
        default:
            return null;
    }
});

// ── User message ────────────────────────────────────────────────────

const UserBubble = React.memo(
    ({
        block,
    }: {
        block: Extract<DisplayBlock, { kind: "user" }>;
    }) => {
        const { theme } = useUnistyles();
        return (
            <View style={styles.userContainer}>
                <View
                    style={[
                        styles.userBubble,
                        {
                            backgroundColor:
                                theme.colors.button.primary.background,
                        },
                    ]}
                >
                    <Text style={styles.userText}>{block.content}</Text>
                    {block.imageCount != null && block.imageCount > 0 && (
                        <Text style={styles.userImageHint}>
                            [{block.imageCount}{" "}
                            {t("session.imageAttached")}]
                        </Text>
                    )}
                </View>
                {block.timestamp != null && (
                    <Text
                        style={[
                            styles.timestamp,
                            { color: theme.colors.textSecondary },
                        ]}
                    >
                        {formatTime(block.timestamp)}
                    </Text>
                )}
            </View>
        );
    },
);

// ── Assistant message ───────────────────────────────────────────────

const AssistantBubble = React.memo(
    ({
        block,
    }: {
        block: Extract<DisplayBlock, { kind: "assistant" }>;
    }) => {
        const { theme } = useUnistyles();
        return (
            <View style={styles.assistantContainer}>
                <MarkdownView markdown={block.content} />
                {block.timestamp != null && (
                    <Text
                        style={[
                            styles.timestamp,
                            { color: theme.colors.textSecondary },
                        ]}
                    >
                        {formatTime(block.timestamp)}
                    </Text>
                )}
            </View>
        );
    },
);

// ── Thinking block ──────────────────────────────────────────────────

const ThinkingBubble = React.memo(
    ({
        block,
    }: {
        block: Extract<DisplayBlock, { kind: "thinking" }>;
    }) => {
        const { theme } = useUnistyles();
        const [expanded, setExpanded] = React.useState(false);

        return (
            <View style={styles.thinkingContainer}>
                <Pressable
                    style={({ pressed }) => [
                        styles.thinkingHeader,
                        pressed && { opacity: 0.6 },
                    ]}
                    onPress={() => setExpanded((v) => !v)}
                >
                    <Ionicons
                        name={expanded ? "chevron-down" : "chevron-forward"}
                        size={14}
                        color={theme.colors.textSecondary}
                    />
                    <Text
                        style={[
                            styles.thinkingLabel,
                            { color: theme.colors.textSecondary },
                        ]}
                    >
                        {t("openclaw.thinking")}
                    </Text>
                </Pressable>
                {expanded && (
                    <View style={styles.thinkingContent}>
                        <MarkdownView markdown={block.content} />
                    </View>
                )}
            </View>
        );
    },
);

// ── Error block ─────────────────────────────────────────────────────

const ErrorBubble = React.memo(
    ({
        block,
    }: {
        block: Extract<DisplayBlock, { kind: "error" }>;
    }) => {
        const { theme } = useUnistyles();
        return (
            <View
                style={[
                    styles.errorContainer,
                    { backgroundColor: theme.colors.status.error + "15" },
                ]}
            >
                <Ionicons name="warning-outline" size={16} color="#FF3B30" />
                <Text style={styles.errorText}>
                    {block.message || t("openclaw.errorOccurred")}
                </Text>
            </View>
        );
    },
);

// ── Helpers ─────────────────────────────────────────────────────────

function formatTime(timestamp: number): string {
    try {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return "";
    }
}

// ── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create((theme) => ({
    // User
    userContainer: {
        alignSelf: "flex-end",
        maxWidth: "85%",
        marginBottom: 12,
        alignItems: "flex-end",
    },
    userBubble: {
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    userText: {
        ...Typography.default(),
        fontSize: 16,
        lineHeight: 22,
        color: "#FFFFFF",
    },
    userImageHint: {
        ...Typography.default(),
        fontSize: 12,
        color: "rgba(255,255,255,0.7)",
        marginTop: 4,
    },
    // Assistant
    assistantContainer: {
        alignSelf: "flex-start",
        width: "100%",
        marginBottom: 12,
    },
    // Thinking
    thinkingContainer: {
        alignSelf: "flex-start",
        width: "100%",
        marginBottom: 8,
    },
    thinkingHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingVertical: 6,
        paddingHorizontal: 4,
        opacity: 0.5,
    },
    thinkingLabel: {
        fontSize: 13,
        ...Typography.default(),
    },
    thinkingContent: {
        opacity: 0.4,
        paddingLeft: 4,
    },
    // Error
    errorContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        marginBottom: 12,
        alignSelf: "flex-start",
    },
    errorText: {
        ...Typography.default(),
        fontSize: 14,
        color: "#FF3B30",
        flex: 1,
    },
    // Timestamp
    timestamp: {
        ...Typography.default(),
        fontSize: 11,
        marginTop: 4,
        paddingHorizontal: 4,
    },
}));
