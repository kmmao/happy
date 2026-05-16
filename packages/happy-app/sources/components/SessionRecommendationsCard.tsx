import React from "react";
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type { ActionItem } from "@/hooks/useProjectActionItems";

const ENTRY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
    warning: "warning-outline",
    decision: "checkmark-circle-outline",
    fix: "build-outline",
    discovery: "bulb-outline",
    convention: "document-text-outline",
    summary: "reader-outline",
};

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        width: "100%",
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginBottom: 10,
    },
    title: {
        fontSize: 13,
        color: theme.colors.textSecondary,
        ...Typography.default("semiBold"),
        letterSpacing: 0.3,
    },
    hint: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        ...Typography.default("regular"),
        marginLeft: "auto" as any,
    },
    item: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 10,
        marginBottom: 6,
        backgroundColor: theme.colors.surfaceHigh,
        borderWidth: 1,
        borderColor: theme.colors.divider,
    },
    itemPressed: {
        opacity: 0.7,
    },
    iconWrapper: {
        marginTop: 1,
    },
    itemText: {
        flex: 1,
    },
    itemTitle: {
        fontSize: 13,
        color: theme.colors.text,
        ...Typography.default("semiBold"),
        lineHeight: 18,
    },
    itemContent: {
        fontSize: 12,
        color: theme.colors.textSecondary,
        ...Typography.default("regular"),
        marginTop: 2,
        lineHeight: 17,
    },
    chevron: {
        marginTop: 2,
    },
}));

interface SessionRecommendationsCardProps {
    actionItems: ActionItem[];
    onSelect: (text: string) => void;
}

function entryIcon(entryType: string): keyof typeof Ionicons.glyphMap {
    return ENTRY_ICONS[entryType] ?? "ellipse-outline";
}

function entryColor(entryType: string, textSecondary: string): string {
    if (entryType === "warning") return textSecondary;
    return textSecondary;
}

export const SessionRecommendationsCard = React.memo<SessionRecommendationsCardProps>(
    ({ actionItems, onSelect }) => {
        const { theme } = useUnistyles();
        const styles = stylesheet;

        if (actionItems.length === 0) return null;

        return (
            <View style={styles.container}>
                <View style={styles.header}>
                    <Ionicons
                        name="flag-outline"
                        size={13}
                        color={theme.colors.textSecondary}
                    />
                    <Text style={styles.title}>{t("session.recommendationsTitle")}</Text>
                    <Text style={styles.hint}>{t("session.recommendationsTapHint")}</Text>
                </View>
                {actionItems.map((item) => (
                    <Pressable
                        key={item.id}
                        style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                        onPress={() => onSelect(item.title)}
                        hitSlop={4}
                    >
                        <View style={styles.iconWrapper}>
                            <Ionicons
                                name={entryIcon(item.entryType)}
                                size={16}
                                color={entryColor(item.entryType, theme.colors.textSecondary)}
                            />
                        </View>
                        <View style={styles.itemText}>
                            <Text style={styles.itemTitle} numberOfLines={2}>
                                {item.title}
                            </Text>
                            {item.content.length > 0 && (
                                <Text style={styles.itemContent} numberOfLines={2}>
                                    {item.content}
                                </Text>
                            )}
                        </View>
                        <View style={styles.chevron}>
                            <Ionicons
                                name="chevron-forward"
                                size={14}
                                color={theme.colors.textSecondary}
                            />
                        </View>
                    </Pressable>
                ))}
            </View>
        );
    },
);
