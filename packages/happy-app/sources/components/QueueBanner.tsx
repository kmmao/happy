import { Ionicons } from "@expo/vector-icons";
import * as React from "react";
import { Animated, Image, Pressable, ScrollView, TouchableOpacity, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Typography } from "@/constants/Typography";
import { Text } from "./StyledText";
import { t } from "@/text";

export interface QueuedMessageItem {
    localId: string;
    displayText: string;
    fullMessage?: string;
}

interface QueueBannerProps {
    queuedMessages: QueuedMessageItem[];
    onSendNow: () => void;
    onSendItemNow?: (localId: string) => void;
    onCancelItem: (localId: string) => void;
    onOpenPreview?: (item: QueuedMessageItem) => void;
    isRunning?: boolean;
}

/** Parse [image: /path] tags out of a message string. Returns alternating text/image segments. */
function parseMessageSegments(message: string): Array<{ type: "text"; text: string } | { type: "image"; uri: string }> {
    const segments: Array<{ type: "text"; text: string } | { type: "image"; uri: string }> = [];
    const imageRegex = /\[image:\s*([^\]]+)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = imageRegex.exec(message)) !== null) {
        if (match.index > lastIndex) {
            const text = message.slice(lastIndex, match.index).trim();
            if (text) segments.push({ type: "text", text });
        }
        segments.push({ type: "image", uri: match[1]!.trim() });
        lastIndex = match.index + match[0].length;
    }

    const remaining = message.slice(lastIndex).trim();
    if (remaining) segments.push({ type: "text", text: remaining });

    return segments;
}

interface QueuePreviewOverlayProps {
    item: QueuedMessageItem;
    onClose: () => void;
    onSendNow?: () => void;
}

export const QueuePreviewOverlay = React.memo(({ item, onClose, onSendNow }: QueuePreviewOverlayProps) => {
    const { theme } = useUnistyles();
    const insets = useSafeAreaInsets();
    const segments = parseMessageSegments(item.fullMessage ?? item.displayText);

    const translateY = React.useRef(new Animated.Value(320)).current;
    const backdropOpacity = React.useRef(new Animated.Value(0)).current;
    const isClosingRef = React.useRef(false);

    React.useEffect(() => {
        Animated.parallel([
            Animated.timing(translateY, { toValue: 0, duration: 280, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 1, duration: 240, useNativeDriver: true }),
        ]).start();
    }, [translateY, backdropOpacity]);

    const animateClose = React.useCallback((callback: () => void) => {
        if (isClosingRef.current) return;
        isClosingRef.current = true;
        Animated.parallel([
            Animated.timing(translateY, { toValue: 320, duration: 220, useNativeDriver: true }),
            Animated.timing(backdropOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
        ]).start(() => callback());
    }, [translateY, backdropOpacity]);

    const handleClose = React.useCallback(() => {
        animateClose(onClose);
    }, [animateClose, onClose]);

    const handleSendNow = React.useCallback(() => {
        if (onSendNow) animateClose(onSendNow);
    }, [animateClose, onSendNow]);

    return (
        <View style={modalStyles.overlay} pointerEvents="box-none">
            <Animated.View
                style={[modalStyles.backdrop, { opacity: backdropOpacity }]}
                pointerEvents="auto"
            >
                <Pressable style={modalStyles.backdropPress} onPress={handleClose} />
            </Animated.View>
            <Animated.View style={[modalStyles.sheet, { paddingBottom: insets.bottom + 16, transform: [{ translateY }] }]}>
                {/* Handle bar */}
                <View style={modalStyles.handle} />

                {/* Header */}
                <View style={[modalStyles.modalHeader, { borderBottomColor: theme.colors.divider }]}>
                    <Text style={[modalStyles.modalTitle, { color: theme.colors.text }]}>
                        {t("session.queuedMessagePreview")}
                    </Text>
                    <TouchableOpacity onPress={handleClose} hitSlop={10} style={modalStyles.closeBtn}>
                        <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
                    </TouchableOpacity>
                </View>

                {/* Content */}
                <ScrollView
                    style={modalStyles.scrollView}
                    contentContainerStyle={modalStyles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {segments.length > 0 ? (
                        segments.map((seg, idx) =>
                            seg.type === "image" ? (
                                <View key={idx} style={[modalStyles.imageWrapper, { backgroundColor: theme.colors.surfaceHigh }]}>
                                    <Image
                                        source={{ uri: seg.uri.startsWith("/") ? `file://${seg.uri}` : seg.uri }}
                                        style={modalStyles.previewImage}
                                        resizeMode="contain"
                                    />
                                </View>
                            ) : (
                                <Text key={idx} style={[modalStyles.fullText, { color: theme.colors.text }]}>
                                    {seg.text}
                                </Text>
                            )
                        )
                    ) : (
                        <Text style={[modalStyles.fullText, { color: theme.colors.textSecondary }]}>
                            {item.displayText}
                        </Text>
                    )}
                </ScrollView>

                {/* Send Now button */}
                {onSendNow && (
                    <View style={[modalStyles.footer, { borderTopColor: theme.colors.divider }]}>
                        <TouchableOpacity
                            style={[modalStyles.sendNowBtn, { backgroundColor: theme.colors.button.primary.background }]}
                            onPress={handleSendNow}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="play" size={14} color={theme.colors.button.primary.tint} />
                            <Text style={[modalStyles.sendNowBtnText, { color: theme.colors.button.primary.tint }]}>
                                {t("session.sendNow")}
                            </Text>
                        </TouchableOpacity>
                    </View>
                )}
            </Animated.View>
        </View>
    );
});

QueuePreviewOverlay.displayName = "QueuePreviewOverlay";

export const QueueBanner = React.memo(({ queuedMessages, onSendNow, onSendItemNow, onCancelItem, onOpenPreview, isRunning }: QueueBannerProps) => {
    const { theme } = useUnistyles();
    const count = queuedMessages.length;

    if (count === 0) return null;

    return (
        <View style={styles.container}>
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

            {/* Message chips — horizontal scroll */}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.list}
            >
                {queuedMessages.map((msg) => (
                    <Pressable
                        key={msg.localId}
                        style={({ pressed }) => [
                            styles.chip,
                            { backgroundColor: `${theme.colors.textSecondary}12` },
                            pressed && { opacity: 0.7 },
                        ]}
                        onPress={() => onOpenPreview?.(msg)}
                    >
                        <Text style={[styles.chipText, { color: theme.colors.textSecondary }]}>
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
                    </Pressable>
                ))}
            </ScrollView>
        </View>
    );
});

QueueBanner.displayName = "QueueBanner";

const styles = StyleSheet.create(() => ({
    container: {
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
        flexDirection: "row",
        gap: 6,
        paddingBottom: 2,
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
        flexShrink: 1,
    },
    chipActions: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
}));

const modalStyles = StyleSheet.create((theme) => ({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 999,
        justifyContent: "flex-end",
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: "rgba(0,0,0,0.5)",
    },
    backdropPress: {
        flex: 1,
    },
    sheet: {
        backgroundColor: theme.colors.surface,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        paddingTop: 10,
        maxHeight: "85%",
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.colors.textSecondary + "40",
        alignSelf: "center",
        marginBottom: 10,
    },
    modalHeader: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
    },
    modalTitle: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        flex: 1,
    },
    closeBtn: {
        padding: 4,
    },
    scrollView: {
        maxHeight: 500,
    },
    scrollContent: {
        padding: 16,
        gap: 12,
    },
    fullText: {
        ...Typography.default(),
        fontSize: 14,
        lineHeight: 22,
    },
    imageWrapper: {
        borderRadius: 10,
        overflow: "hidden",
        alignItems: "center",
    },
    previewImage: {
        width: "100%",
        height: 260,
    },
    footer: {
        borderTopWidth: 1,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
    },
    sendNowBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        paddingVertical: 12,
        borderRadius: 12,
    },
    sendNowBtnText: {
        ...Typography.default("semiBold"),
        fontSize: 15,
    },
}));
