import * as React from "react";
import { View, Text, Pressable } from "react-native";
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

function getEntryTypeLabel(entryType: string): string {
    switch (entryType) {
        case "discovery": return t("projects.knowledgeEntryTypeDiscovery");
        case "decision": return t("projects.knowledgeEntryTypeDecision");
        case "fix": return t("projects.knowledgeEntryTypeFix");
        case "convention": return t("projects.knowledgeEntryTypeConvention");
        case "warning": return t("projects.knowledgeEntryTypeWarning");
        default: return entryType;
    }
}

function getRelationInfoList(
    entryId: string,
    relations: ChainRelation[],
): Array<{ label: string; color: string }> {
    // key = "label::color", value = count
    const counts = new Map<string, { label: string; color: string; count: number }>();

    for (const rel of relations) {
        let label: string | null = null;
        let color: string = RELATION_COLORS[rel.type] ?? "#3B82F6";

        if (rel.from === entryId) {
            switch (rel.type) {
                case "supersedes": label = t("projects.knowledgeEvolutionSupersedes"); break;
                case "contradicts": label = t("projects.knowledgeEvolutionContradicts"); break;
                case "refines": label = t("projects.knowledgeEvolutionRefines"); break;
                case "combines": label = t("projects.knowledgeEvolutionCombines"); break;
                default: label = t("projects.knowledgeEvolutionRelated"); break;
            }
        } else if (rel.to === entryId) {
            switch (rel.type) {
                case "supersedes": label = t("projects.knowledgeEvolutionSupersededBy"); break;
                case "contradicts": label = t("projects.knowledgeEvolutionContradictedBy"); break;
                case "refines": label = t("projects.knowledgeEvolutionRefinedBy"); break;
                case "combines": label = t("projects.knowledgeEvolutionCombinedFrom"); break;
                default: label = t("projects.knowledgeEvolutionRelated"); break;
            }
        }

        if (label !== null) {
            const key = `${label}::${color}`;
            const existing = counts.get(key);
            if (existing) {
                existing.count += 1;
            } else {
                counts.set(key, { label, color, count: 1 });
            }
        }
    }

    return Array.from(counts.values()).map(({ label, color, count }) => ({
        label: count > 1 ? `${label} ×${count}` : label,
        color,
    }));
}

interface TimelineNodeProps {
    entry: ChainEntry;
    isCurrent: boolean;
    isLast: boolean;
    relations: ChainRelation[];
}

const TimelineNode = React.memo<TimelineNodeProps>(({ entry, isCurrent, isLast, relations }) => {
    const { theme } = useUnistyles();
    const [expanded, setExpanded] = React.useState(false);

    const typeColor = TYPE_COLORS[entry.entryType] ?? theme.colors.textSecondary;
    const relationInfoList = getRelationInfoList(entry.id, relations);
    const showExpandToggle = !isCurrent && !!entry.content;

    return (
        <View style={styles.nodeRow}>
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
                {/* Header: type badge + current marker + relation badges */}
                <View style={styles.nodeHeader}>
                    <View style={[styles.typeBadge, { backgroundColor: typeColor + "20" }]}>
                        <Text style={[styles.typeBadgeText, { color: typeColor }]}>
                            {getEntryTypeLabel(entry.entryType)}
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
                    {relationInfoList.map((ri, idx) => (
                        <View key={idx} style={[styles.relationBadge, { backgroundColor: ri.color + "20" }]}>
                            <Text style={[styles.relationBadgeText, { color: ri.color }]}>
                                {ri.label}
                            </Text>
                        </View>
                    ))}
                </View>

                {/* Title */}
                <Text
                    style={[styles.nodeTitle, { color: theme.colors.text }]}
                    numberOfLines={2}
                >
                    {entry.title}
                </Text>

                {/* Content */}
                {!!entry.content && (
                    <Text
                        style={[styles.nodeBody, { color: theme.colors.textSecondary }]}
                        numberOfLines={isCurrent || expanded ? undefined : 3}
                    >
                        {entry.content}
                    </Text>
                )}

                {/* Expand / collapse toggle for historical entries */}
                {showExpandToggle && (
                    <Pressable
                        onPress={() => setExpanded((v) => !v)}
                        style={styles.expandToggle}
                        hitSlop={8}
                    >
                        <Text style={[styles.expandToggleText, { color: theme.colors.header.tint }]}>
                            {expanded
                                ? t("projects.knowledgeEvolutionCollapse")
                                : t("projects.knowledgeEvolutionExpand")}
                        </Text>
                        <Ionicons
                            name={expanded ? "chevron-up" : "chevron-down"}
                            size={12}
                            color={theme.colors.header.tint}
                        />
                    </Pressable>
                )}

                {/* Timestamp + status */}
                <View style={styles.nodeFooter}>
                    <Text style={[styles.nodeTimestamp, { color: theme.colors.textSecondary }]}>
                        {formatDate(entry.createdAt)}
                    </Text>
                    {entry.status === "superseded" && (
                        <Text style={[styles.statusText, { color: "#EF4444" }]}>
                            {t("projects.knowledgeStatusSuperseded")}
                        </Text>
                    )}
                </View>
            </View>
        </View>
    );
});

export const EvolutionTimeline = React.memo<EvolutionTimelineProps>(
    ({ chain, relations, currentEntryId }) => {
        return (
            <View style={styles.container}>
                {chain.map((entry, index) => (
                    <TimelineNode
                        key={entry.id}
                        entry={entry}
                        isCurrent={entry.id === currentEntryId}
                        isLast={index === chain.length - 1}
                        relations={relations}
                    />
                ))}
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
    nodeBody: {
        ...Typography.default("regular"),
        fontSize: 13,
        lineHeight: 18,
        marginBottom: 6,
    },
    expandToggle: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        marginBottom: 6,
    },
    expandToggleText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
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
