import * as React from "react";
import { View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import type { ChainEntry, ChainRelation } from "@/hooks/useKnowledgeEvolution";

const TYPE_COLORS: Record<string, string> = {
    discovery: "#3B82F6",
    decision: "#8B5CF6",
    fix: "#22C55E",
    convention: "#F97316",
    warning: "#EF4444",
};

interface EvolutionTimelineProps {
    chain: ChainEntry[];
    relations: ChainRelation[];
    currentEntryId: string;
}

function formatDate(iso: string): string {
    const date = new Date(iso);
    return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

const RELATION_COLORS: Record<string, string> = {
    supersedes: "#EF4444",
    related: "#3B82F6",
    contradicts: "#F97316",
    refines: "#8B5CF6",
    combines: "#22C55E",
};

function getRelationInfo(
    entryId: string,
    relations: ChainRelation[],
): { label: string; color: string } | null {
    for (const rel of relations) {
        if (rel.from === entryId) {
            const label = (() => {
                switch (rel.type) {
                    case "supersedes":
                        return t("projects.knowledgeEvolutionSupersedes");
                    case "contradicts":
                        return t("projects.knowledgeEvolutionContradicts");
                    case "refines":
                        return t("projects.knowledgeEvolutionRefines");
                    case "combines":
                        return t("projects.knowledgeEvolutionCombines");
                    default:
                        return t("projects.knowledgeEvolutionRelated");
                }
            })();
            return { label, color: RELATION_COLORS[rel.type] ?? "#3B82F6" };
        }
    }
    return null;
}

export const EvolutionTimeline = React.memo<EvolutionTimelineProps>(
    ({ chain, relations, currentEntryId }) => {
        const { theme } = useUnistyles();

        return (
            <View style={styles.container}>
                {chain.map((entry, index) => {
                    const isCurrent = entry.id === currentEntryId;
                    const isLast = index === chain.length - 1;
                    const typeColor = TYPE_COLORS[entry.entryType] ?? theme.colors.textSecondary;
                    const relationInfo = getRelationInfo(entry.id, relations);

                    return (
                        <View key={entry.id} style={styles.nodeRow}>
                            {/* Timeline line + dot */}
                            <View style={styles.timelineColumn}>
                                <View
                                    style={[
                                        styles.dot,
                                        {
                                            backgroundColor: isCurrent
                                                ? theme.colors.header.tint
                                                : typeColor,
                                            borderColor: isCurrent
                                                ? theme.colors.header.tint
                                                : "transparent",
                                            borderWidth: isCurrent ? 2 : 0,
                                        },
                                    ]}
                                />
                                {!isLast && (
                                    <View
                                        style={[
                                            styles.line,
                                            { backgroundColor: theme.colors.textSecondary + "30" },
                                        ]}
                                    />
                                )}
                            </View>

                            {/* Content */}
                            <View
                                style={[
                                    styles.nodeContent,
                                    {
                                        backgroundColor: isCurrent
                                            ? theme.colors.header.tint + "10"
                                            : theme.colors.surface,
                                        borderColor: isCurrent
                                            ? theme.colors.header.tint + "40"
                                            : "transparent",
                                        borderWidth: isCurrent ? 1 : 0,
                                    },
                                ]}
                            >
                                {/* Header: type badge + current marker */}
                                <View style={styles.nodeHeader}>
                                    <View style={[styles.typeBadge, { backgroundColor: typeColor + "20" }]}>
                                        <Text style={[styles.typeBadgeText, { color: typeColor }]}>
                                            {entry.entryType}
                                        </Text>
                                    </View>
                                    {isCurrent && (
                                        <View style={[styles.currentBadge, { backgroundColor: theme.colors.header.tint + "20" }]}>
                                            <Ionicons name="locate" size={10} color={theme.colors.header.tint} />
                                            <Text style={[styles.currentBadgeText, { color: theme.colors.header.tint }]}>
                                                {t("projects.knowledgeEvolutionCurrent")}
                                            </Text>
                                        </View>
                                    )}
                                    {relationInfo && (
                                        <View style={[styles.relationBadge, { backgroundColor: relationInfo.color + "20" }]}>
                                            <Text style={[styles.relationBadgeText, { color: relationInfo.color }]}>
                                                {relationInfo.label}
                                            </Text>
                                        </View>
                                    )}
                                </View>

                                {/* Title */}
                                <Text
                                    style={[styles.nodeTitle, { color: theme.colors.text }]}
                                    numberOfLines={2}
                                >
                                    {entry.title}
                                </Text>

                                {/* Timestamp + status */}
                                <View style={styles.nodeFooter}>
                                    <Text style={[styles.nodeTimestamp, { color: theme.colors.textSecondary }]}>
                                        {formatDate(entry.createdAt)}
                                    </Text>
                                    {entry.status === "superseded" && (
                                        <Text style={[styles.statusText, { color: "#EF4444" }]}>
                                            {entry.status}
                                        </Text>
                                    )}
                                </View>
                            </View>
                        </View>
                    );
                })}
            </View>
        );
    },
);

const styles = StyleSheet.create((theme) => ({
    container: {
        paddingHorizontal: 16,
    },
    nodeRow: {
        flexDirection: "row",
        minHeight: 80,
    },
    timelineColumn: {
        width: 24,
        alignItems: "center",
    },
    dot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        marginTop: 14,
    },
    line: {
        width: 2,
        flex: 1,
        marginVertical: 4,
    },
    nodeContent: {
        flex: 1,
        marginLeft: 10,
        marginBottom: 8,
        padding: 12,
        borderRadius: 10,
    },
    nodeHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
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
    currentBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    currentBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
    },
    relationBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    relationBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
    },
    nodeTitle: {
        ...Typography.default("semiBold"),
        fontSize: 14,
        lineHeight: 19,
        marginBottom: 4,
    },
    nodeFooter: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    nodeTimestamp: {
        ...Typography.default("regular"),
        fontSize: 11,
    },
    statusText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
        textTransform: "uppercase",
    },
}));
