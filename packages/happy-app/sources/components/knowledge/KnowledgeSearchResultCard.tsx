import * as React from "react";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type { KnowledgeSearchResult } from "@/hooks/useKnowledgeSearch";

const TYPE_COLORS: Record<string, string> = {
    discovery: "#3B82F6",
    decision: "#8B5CF6",
    fix: "#22C55E",
    convention: "#F97316",
    warning: "#EF4444",
};

interface KnowledgeSearchResultCardProps {
    result: KnowledgeSearchResult;
    onPress: () => void;
}

function projectDisplayName(path: string): string {
    if (!path) return "";
    const parts = path.split("/");
    return parts[parts.length - 1] || path;
}

export const KnowledgeSearchResultCard = React.memo<KnowledgeSearchResultCardProps>(
    ({ result, onPress }) => {
        const { theme } = useUnistyles();
        const typeColor = TYPE_COLORS[result.entryType] ?? theme.colors.textSecondary;

        return (
            <Pressable
                style={[styles.card, { backgroundColor: theme.colors.surface }]}
                onPress={onPress}
            >
                {/* Header: type badge + project name */}
                <View style={styles.headerRow}>
                    <View style={[styles.typeBadge, { backgroundColor: typeColor + "20" }]}>
                        <Text style={[styles.typeBadgeText, { color: typeColor }]}>
                            {result.entryType}
                        </Text>
                    </View>
                    <Text
                        style={[styles.projectName, { color: theme.colors.textSecondary }]}
                        numberOfLines={1}
                    >
                        {t("projects.knowledgeSearchInProject", { project: projectDisplayName(result.projectPath) })}
                    </Text>
                </View>

                {/* Title */}
                <Text
                    style={[styles.title, { color: theme.colors.text }]}
                    numberOfLines={2}
                >
                    {result.title}
                </Text>

                {/* Content preview */}
                <Text
                    style={[styles.content, { color: theme.colors.textSecondary }]}
                    numberOfLines={2}
                >
                    {result.content}
                </Text>

                {/* Tags */}
                {result.tags.length > 0 && (
                    <View style={styles.tagsRow}>
                        {result.tags.slice(0, 5).map((tag) => (
                            <View
                                key={tag}
                                style={[styles.tagBadge, { backgroundColor: theme.colors.groupped.background }]}
                            >
                                <Text style={[styles.tagText, { color: theme.colors.textSecondary }]}>
                                    {tag}
                                </Text>
                            </View>
                        ))}
                    </View>
                )}
            </Pressable>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 12,
        padding: 14,
        marginHorizontal: 16,
        marginBottom: 10,
    },
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginBottom: 6,
    },
    typeBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    typeBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
        textTransform: "uppercase",
    },
    projectName: {
        ...Typography.default("regular"),
        fontSize: 12,
        flex: 1,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        lineHeight: 20,
        marginBottom: 4,
    },
    content: {
        ...Typography.default("regular"),
        fontSize: 13,
        lineHeight: 18,
        marginBottom: 6,
    },
    tagsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 4,
    },
    tagBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    tagText: {
        ...Typography.default("regular"),
        fontSize: 11,
    },
}));
