import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Ionicons } from "@expo/vector-icons";
import {
    type IdeationIdea,
    type IdeationCategory,
    type IdeationPriority,
    IDEATION_CATEGORY_LABELS,
    IDEATION_CATEGORY_ICONS,
    IDEATION_STATUS_LABELS,
} from "@/sync/ideationTypes";

interface IdeationIdeaCardProps {
    idea: IdeationIdea;
    onPress: (ideaId: string) => void;
    onLongPress?: (ideaId: string) => void;
}

const PRIORITY_COLORS: Record<IdeationPriority, string> = {
    low: "#6B7280",
    medium: "#3B82F6",
    high: "#F59E0B",
};

const CATEGORY_COLORS: Record<IdeationCategory, string> = {
    feature: "#8B5CF6",
    improvement: "#10B981",
    bugfix: "#EF4444",
    refactor: "#F59E0B",
    documentation: "#3B82F6",
    other: "#6B7280",
};

export const IdeationIdeaCard = React.memo(
    ({ idea, onPress, onLongPress }: IdeationIdeaCardProps) => {
        const { theme } = useUnistyles();
        const priorityColor = PRIORITY_COLORS[idea.priority];
        const categoryColor = CATEGORY_COLORS[idea.category];
        const isConverted = idea.status === "converted";
        const isDismissed = idea.status === "dismissed";
        const dimmed = isConverted || isDismissed;

        return (
            <Pressable
                onPress={() => onPress(idea.id)}
                onLongPress={() => onLongPress?.(idea.id)}
                style={({ pressed }) => [
                    styles.card,
                    { backgroundColor: theme.colors.surface },
                    pressed && { opacity: 0.7 },
                    dimmed && { opacity: 0.6 },
                ]}
            >
                <View style={styles.header}>
                    <View
                        style={[
                            styles.priorityDot,
                            { backgroundColor: priorityColor },
                        ]}
                    />
                    <Text
                        style={[styles.title, { color: theme.colors.text }]}
                        numberOfLines={2}
                    >
                        {idea.title}
                    </Text>
                </View>

                {idea.description.length > 0 && (
                    <Text
                        style={[
                            styles.description,
                            { color: theme.colors.textSecondary },
                        ]}
                        numberOfLines={2}
                    >
                        {idea.description}
                    </Text>
                )}

                <View style={styles.footer}>
                    <View
                        style={[
                            styles.categoryBadge,
                            { backgroundColor: `${categoryColor}20` },
                        ]}
                    >
                        <Ionicons
                            name={
                                IDEATION_CATEGORY_ICONS[
                                    idea.category
                                ] as keyof typeof Ionicons.glyphMap
                            }
                            size={12}
                            color={categoryColor}
                        />
                        <Text
                            style={[
                                styles.categoryText,
                                { color: categoryColor },
                            ]}
                        >
                            {t(IDEATION_CATEGORY_LABELS[idea.category])}
                        </Text>
                    </View>

                    <View style={styles.spacer} />

                    {isConverted && (
                        <View style={styles.statusBadge}>
                            <Ionicons
                                name="checkmark-circle"
                                size={14}
                                color="#10B981"
                            />
                            <Text
                                style={[
                                    styles.statusText,
                                    { color: "#10B981" },
                                ]}
                            >
                                {t(IDEATION_STATUS_LABELS.converted)}
                            </Text>
                        </View>
                    )}

                    {isDismissed && (
                        <View style={styles.statusBadge}>
                            <Ionicons
                                name="close-circle"
                                size={14}
                                color={theme.colors.textSecondary}
                            />
                            <Text
                                style={[
                                    styles.statusText,
                                    { color: theme.colors.textSecondary },
                                ]}
                            >
                                {t(IDEATION_STATUS_LABELS.dismissed)}
                            </Text>
                        </View>
                    )}
                </View>
            </Pressable>
        );
    },
);

const styles = StyleSheet.create(() => ({
    card: {
        marginHorizontal: 16,
        marginVertical: 4,
        borderRadius: 12,
        padding: 14,
        gap: 8,
    },
    header: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
    },
    priorityDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginTop: 5,
        flexShrink: 0,
    },
    title: {
        fontSize: 15,
        flex: 1,
        ...Typography.default("semiBold"),
    },
    description: {
        fontSize: 13,
        lineHeight: 18,
        paddingLeft: 16,
        ...Typography.default(),
    },
    footer: {
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 16,
        gap: 8,
    },
    categoryBadge: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        gap: 4,
    },
    categoryText: {
        fontSize: 11,
        ...Typography.default("semiBold"),
    },
    spacer: {
        flex: 1,
    },
    statusBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
    },
    statusText: {
        fontSize: 11,
        ...Typography.default(),
    },
}));
