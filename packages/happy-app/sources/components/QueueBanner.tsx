import { Ionicons } from "@expo/vector-icons";
import * as React from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { Text } from "./StyledText";
import { t } from "@/text";

interface QueuedMessageItem {
    localId: string;
    displayText: string;
}

interface QueueBannerProps {
    queuedMessages: QueuedMessageItem[];
    onSendNow: () => void;
    onSendItemNow?: (localId: string) => void;
    onCancelItem: (localId: string) => void;
    isRunning?: boolean;
}

export const QueueBanner = React.memo(({ queuedMessages, onSendNow, onSendItemNow, onCancelItem, isRunning }: QueueBannerProps) => {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);
    const count = queuedMessages.length;

    if (count === 0) return null;

    return (
        <View style={styles.container}>
            <Pressable
                style={styles.header}
                onPress={() => setExpanded((v) => !v)}
            >
                <Ionicons
                    name="time-outline"
                    size={13}
                    color={theme.colors.textSecondary}
                    style={{ marginRight: 6 }}
                />
                <Text style={styles.label} numberOfLines={1}>
                    {t("session.messagesQueued", { n: count })}
                </Text>
                <Ionicons
                    name={expanded ? "chevron-down" : "chevron-up"}
                    size={13}
                    color={theme.colors.textSecondary}
                    style={{ marginLeft: 4 }}
                />
                {isRunning && (
                    <View style={styles.sendNowButton}>
                        <Pressable
                            onPress={onSendNow}
                            hitSlop={8}
                            style={({ pressed }) => [
                                styles.sendNowPressable,
                                { backgroundColor: theme.colors.button.primary.background },
                                pressed && { opacity: 0.8 },
                            ]}
                        >
                            <Text style={[styles.sendNowText, { color: theme.colors.button.primary.tint }]}>
                                {t("session.sendNow")}
                            </Text>
                        </Pressable>
                    </View>
                )}
            </Pressable>

            {expanded && (
                <View style={[styles.list, { borderTopColor: theme.colors.divider }]}>
                    {queuedMessages.map((msg) => (
                        <View key={msg.localId} style={[styles.listItem, { borderBottomColor: theme.colors.divider }]}>
                            <Text style={styles.itemText} numberOfLines={1}>
                                {msg.displayText}
                            </Text>
                            {isRunning && onSendItemNow && (
                                <Pressable
                                    onPress={() => onSendItemNow(msg.localId)}
                                    hitSlop={8}
                                    style={({ pressed }) => ({ opacity: pressed ? 0.5 : 0.8 })}
                                >
                                    <Ionicons
                                        name="play-circle-outline"
                                        size={16}
                                        color={theme.colors.button.primary.background}
                                    />
                                </Pressable>
                            )}
                            <Pressable
                                onPress={() => onCancelItem(msg.localId)}
                                hitSlop={8}
                                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 0.7 })}
                            >
                                <Ionicons name="close" size={14} color={theme.colors.textSecondary} />
                            </Pressable>
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
});

QueueBanner.displayName = "QueueBanner";

const styles = StyleSheet.create((theme) => ({
    container: {
        backgroundColor: theme.colors.surfaceHigh,
        borderTopWidth: 1,
        borderTopColor: theme.colors.divider,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    label: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        flex: 1,
    },
    sendNowButton: {
        marginLeft: 8,
    },
    sendNowPressable: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
    },
    sendNowText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
    },
    list: {
        borderTopWidth: 1,
    },
    listItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderBottomWidth: 1,
        gap: 8,
    },
    itemText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
        flex: 1,
    },
}));
