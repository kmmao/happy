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
    const count = queuedMessages.length;

    if (count === 0) return null;

    return (
        <View style={[styles.container, { borderTopColor: theme.colors.divider }]}>
            {/* Header row */}
            <View style={styles.header}>
                <Ionicons
                    name="time-outline"
                    size={12}
                    color={theme.colors.textSecondary}
                    style={{ marginRight: 5 }}
                />
                <Text style={[styles.headerLabel, { color: theme.colors.textSecondary }]}>
                    {t("session.messagesQueued", { n: count })}
                </Text>
                {isRunning && (
                    <Pressable
                        onPress={onSendNow}
                        hitSlop={8}
                        style={({ pressed }) => [
                            styles.sendNowPill,
                            { backgroundColor: `${theme.colors.button.primary.background}18` },
                            pressed && { opacity: 0.7 },
                        ]}
                    >
                        <Ionicons
                            name="play"
                            size={9}
                            color={theme.colors.button.primary.background}
                        />
                        <Text style={[styles.sendNowText, { color: theme.colors.button.primary.background }]}>
                            {t("session.sendNow")}
                        </Text>
                    </Pressable>
                )}
            </View>

            {/* Message chips — always expanded */}
            <View style={styles.list}>
                {queuedMessages.map((msg) => (
                    <View
                        key={msg.localId}
                        style={[
                            styles.chip,
                            { backgroundColor: `${theme.colors.textSecondary}12` },
                        ]}
                    >
                        <Text style={[styles.chipText, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                            {msg.displayText}
                        </Text>
                        <View style={styles.chipActions}>
                            {isRunning && onSendItemNow && (
                                <Pressable
                                    onPress={() => onSendItemNow(msg.localId)}
                                    hitSlop={8}
                                    style={({ pressed }) => ({ opacity: pressed ? 0.4 : 0.8 })}
                                >
                                    <Ionicons
                                        name="play-circle-outline"
                                        size={15}
                                        color={theme.colors.button.primary.background}
                                    />
                                </Pressable>
                            )}
                            <Pressable
                                onPress={() => onCancelItem(msg.localId)}
                                hitSlop={8}
                                style={({ pressed }) => ({ opacity: pressed ? 0.4 : 0.6 })}
                            >
                                <Ionicons name="close-circle" size={15} color={theme.colors.textSecondary} />
                            </Pressable>
                        </View>
                    </View>
                ))}
            </View>
        </View>
    );
});

QueueBanner.displayName = "QueueBanner";

const styles = StyleSheet.create(() => ({
    container: {
        borderTopWidth: 1,
        paddingHorizontal: 12,
        paddingTop: 6,
        paddingBottom: 6,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 5,
    },
    headerLabel: {
        ...Typography.default(),
        fontSize: 11,
        flex: 1,
    },
    sendNowPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
    },
    sendNowText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    list: {
        gap: 4,
    },
    chip: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        gap: 6,
    },
    chipText: {
        ...Typography.default(),
        fontSize: 12,
        flex: 1,
    },
    chipActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
}));
