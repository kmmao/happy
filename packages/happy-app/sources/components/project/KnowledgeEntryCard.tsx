import * as React from "react";
import { Animated, View, Text, Pressable, LayoutAnimation, ActivityIndicator, Easing } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";

interface KnowledgeEntryCardProps {
    entry: {
        id: string;
        entryType: string;
        contributorType: string;
        status: string;
        title: string;
        content: string;
        structured: {
            request?: string;
            findings?: string;
            analysis?: string;
            outcome?: string;
            nextSteps?: string;
        } | null;
        tags: string[];
        confidence: string;
        sessionId: string | null;
        pinned: boolean;
        createdAt: number;
    };
    onUpdate: (entryId: string, data: { status?: string; pinned?: boolean }) => void;
    onDelete?: (entryId: string) => void;
    onRefine?: (entryId: string) => Promise<void>;
    isArchived?: boolean;
    onViewEvolution?: (entryId: string) => void;
}

function entryTypeLabel(entryType: string): string {
    switch (entryType) {
        case "discovery":
            return t("projects.knowledgeFilterDiscovery");
        case "decision":
            return t("projects.knowledgeFilterDecision");
        case "fix":
            return t("projects.knowledgeFilterFix");
        case "convention":
            return t("projects.knowledgeFilterConvention");
        case "warning":
            return t("projects.knowledgeFilterWarning");
        default:
            return entryType;
    }
}

const TYPE_COLORS: Record<string, string> = {
    discovery: "#3B82F6",
    decision: "#8B5CF6",
    fix: "#22C55E",
    convention: "#F97316",
    warning: "#EF4444",
};

const CONFIDENCE_COLORS: Record<string, string> = {
    high: "#22C55E",
    medium: "#EAB308",
    low: "#9CA3AF",
};

function formatTimestamp(ts: number): string {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) {
        const diffMin = Math.floor(diffMs / (1000 * 60));
        return `${Math.max(1, diffMin)}m ago`;
    }
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) {
        return `${diffDays}d ago`;
    }
    return date.toLocaleDateString();
}

function confidenceLabel(confidence: string): string {
    switch (confidence) {
        case "high":
            return t("projects.knowledgeConfidenceHigh");
        case "medium":
            return t("projects.knowledgeConfidenceMedium");
        case "low":
            return t("projects.knowledgeConfidenceLow");
        default:
            return confidence;
    }
}

function soapLabel(field: string): string {
    switch (field) {
        case "request":
            return t("projects.knowledgeRequest");
        case "findings":
            return t("projects.knowledgeFindings");
        case "analysis":
            return t("projects.knowledgeAnalysis");
        case "outcome":
            return t("projects.knowledgeOutcome");
        case "nextSteps":
            return t("projects.knowledgeNextSteps");
        default:
            return field;
    }
}

export const KnowledgeEntryCard = React.memo<KnowledgeEntryCardProps>(
    ({ entry, onUpdate, onDelete, onRefine, isArchived, onViewEvolution }) => {
        const { theme } = useUnistyles();
        const [expanded, setExpanded] = React.useState(false);
        const [refining, setRefining] = React.useState(false);
        const pulseAnim = React.useRef(new Animated.Value(1)).current;

        React.useEffect(() => {
            if (refining) {
                const loop = Animated.loop(
                    Animated.sequence([
                        Animated.timing(pulseAnim, {
                            toValue: 0.45,
                            duration: 800,
                            easing: Easing.inOut(Easing.ease),
                            useNativeDriver: true,
                        }),
                        Animated.timing(pulseAnim, {
                            toValue: 1,
                            duration: 800,
                            easing: Easing.inOut(Easing.ease),
                            useNativeDriver: true,
                        }),
                    ]),
                );
                loop.start();
                return () => loop.stop();
            } else {
                pulseAnim.setValue(1);
            }
        }, [refining, pulseAnim]);

        const typeColor = TYPE_COLORS[entry.entryType] ?? theme.colors.textSecondary;
        const confColor = CONFIDENCE_COLORS[entry.confidence] ?? "#9CA3AF";

        const handleTogglePin = React.useCallback(() => {
            onUpdate(entry.id, { pinned: !entry.pinned });
        }, [entry.id, entry.pinned, onUpdate]);

        const handleArchive = React.useCallback(() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            onUpdate(entry.id, { status: "archived" });
        }, [entry.id, onUpdate]);

        const handleRestore = React.useCallback(() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            onUpdate(entry.id, { status: "active" });
        }, [entry.id, onUpdate]);

        const handleDelete = React.useCallback(() => {
            if (!onDelete) return;
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            onDelete(entry.id);
        }, [entry.id, onDelete]);

        const soapFields = React.useMemo(() => {
            if (!entry.structured) {
                return [];
            }
            const fields: { key: string; value: string }[] = [];
            const order = ["request", "findings", "analysis", "outcome", "nextSteps"] as const;
            for (const key of order) {
                const value = entry.structured[key];
                if (value) {
                    fields.push({ key, value });
                }
            }
            return fields;
        }, [entry.structured]);

        return (
            <Animated.View style={[styles.card, { backgroundColor: theme.colors.surface, opacity: pulseAnim }]}>
                {/* Header row: type badge + title + pinned */}
                <Pressable
                    style={styles.headerRow}
                    onPress={() => setExpanded((prev) => !prev)}
                >
                    <View style={styles.headerLeft}>
                        <View style={[styles.typeBadge, { backgroundColor: typeColor + "20" }]}>
                            <Text style={[styles.typeBadgeText, { color: typeColor }]}>
                                {entryTypeLabel(entry.entryType)}
                            </Text>
                        </View>
                        <View style={[styles.confidenceBadge, { backgroundColor: confColor + "20" }]}>
                            <Text style={[styles.confidenceBadgeText, { color: confColor }]}>
                                {confidenceLabel(entry.confidence)}
                            </Text>
                        </View>
                        {entry.pinned && (
                            <Ionicons
                                name="pin"
                                size={14}
                                color={theme.colors.header.tint}
                            />
                        )}
                    </View>
                    <Ionicons
                        name={expanded ? "chevron-up" : "chevron-down"}
                        size={16}
                        color={theme.colors.textSecondary}
                    />
                </Pressable>

                {/* Title */}
                <Text
                    style={[styles.title, { color: theme.colors.text }]}
                    numberOfLines={expanded ? undefined : 2}
                >
                    {entry.title}
                </Text>

                {/* Expanded: SOAP fields */}
                {expanded && soapFields.length > 0 && (
                    <View style={styles.soapSection}>
                        {soapFields.map((field) => (
                            <View key={field.key} style={styles.soapField}>
                                <Text style={[styles.soapLabel, { color: theme.colors.textSecondary }]}>
                                    {soapLabel(field.key)}
                                </Text>
                                <Text style={[styles.soapValue, { color: theme.colors.text }]}>
                                    {field.value}
                                </Text>
                            </View>
                        ))}
                    </View>
                )}

                {/* Tags */}
                {entry.tags.length > 0 && (
                    <View style={styles.tagsRow}>
                        {entry.tags.map((tag) => (
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

                {/* Footer: timestamp + contributor + actions */}
                <View style={styles.footerRow}>
                    <View style={styles.footerLeft}>
                        <Text style={[styles.timestamp, { color: theme.colors.textSecondary }]}>
                            {formatTimestamp(entry.createdAt)}
                        </Text>
                        <Text style={[styles.contributorText, { color: theme.colors.textSecondary }]}>
                            {entry.contributorType === "human"
                                ? t("projects.knowledgeContributorHuman")
                                : t("projects.knowledgeContributorAgent")}
                        </Text>
                    </View>
                    <View style={styles.actionRow}>
                        {isArchived ? (
                            <>
                                <Pressable
                                    onPress={handleRestore}
                                    style={styles.actionButton}
                                    hitSlop={8}
                                >
                                    <Ionicons
                                        name="arrow-undo-outline"
                                        size={18}
                                        color={theme.colors.textSecondary}
                                    />
                                    <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>
                                        {t("projects.knowledgeRestore")}
                                    </Text>
                                </Pressable>
                                {onDelete && (
                                    <Pressable
                                        onPress={handleDelete}
                                        style={styles.actionButton}
                                        hitSlop={8}
                                    >
                                        <Ionicons
                                            name="trash-outline"
                                            size={18}
                                            color="#EF4444"
                                        />
                                        <Text style={[styles.actionText, { color: "#EF4444" }]}>
                                            {t("projects.knowledgeDelete")}
                                        </Text>
                                    </Pressable>
                                )}
                            </>
                        ) : (
                            <>
                                <Pressable
                                    onPress={handleTogglePin}
                                    style={styles.actionButton}
                                    hitSlop={8}
                                >
                                    <Ionicons
                                        name={entry.pinned ? "pin" : "pin-outline"}
                                        size={18}
                                        color={entry.pinned ? theme.colors.header.tint : theme.colors.textSecondary}
                                    />
                                    <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>
                                        {entry.pinned ? t("projects.knowledgeUnpin") : t("projects.knowledgePin")}
                                    </Text>
                                </Pressable>
                                <Pressable
                                    onPress={handleArchive}
                                    style={styles.actionButton}
                                    hitSlop={8}
                                >
                                    <Ionicons
                                        name="archive-outline"
                                        size={18}
                                        color={theme.colors.textSecondary}
                                    />
                                    <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>
                                        {t("projects.knowledgeArchive")}
                                    </Text>
                                </Pressable>
                                {onViewEvolution && (
                                    <Pressable
                                        onPress={() => onViewEvolution(entry.id)}
                                        style={styles.actionButton}
                                        hitSlop={8}
                                    >
                                        <Ionicons
                                            name="git-branch-outline"
                                            size={18}
                                            color={theme.colors.textSecondary}
                                        />
                                        <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>
                                            {t("projects.knowledgeViewEvolution")}
                                        </Text>
                                    </Pressable>
                                )}
                                {onRefine && (
                                    <Pressable
                                        onPress={async () => {
                                            if (refining) return;
                                            setRefining(true);
                                            try {
                                                await onRefine(entry.id);
                                            } finally {
                                                setRefining(false);
                                            }
                                        }}
                                        style={[styles.actionButton, refining && { opacity: 0.5 }]}
                                        hitSlop={8}
                                        disabled={refining}
                                    >
                                        {refining ? (
                                            <ActivityIndicator size={14} color={theme.colors.primary} />
                                        ) : (
                                            <Ionicons
                                                name="sparkles-outline"
                                                size={18}
                                                color={theme.colors.textSecondary}
                                            />
                                        )}
                                        <Text style={[styles.actionText, { color: refining ? theme.colors.primary : theme.colors.textSecondary }]}>
                                            {refining ? t("projects.knowledgeRefining") : t("projects.knowledgeRefine")}
                                        </Text>
                                    </Pressable>
                                )}
                            </>
                        )}
                    </View>
                </View>
            </Animated.View>
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
        justifyContent: "space-between",
        marginBottom: 8,
    },
    headerLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexShrink: 1,
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
    confidenceBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    confidenceBadgeText: {
        ...Typography.default("regular"),
        fontSize: 10,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        lineHeight: 20,
        marginBottom: 6,
    },
    soapSection: {
        marginTop: 4,
        marginBottom: 8,
        gap: 8,
    },
    soapField: {
        gap: 2,
    },
    soapLabel: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        textTransform: "uppercase",
    },
    soapValue: {
        ...Typography.default("regular"),
        fontSize: 13,
        lineHeight: 18,
    },
    tagsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 4,
        marginBottom: 8,
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
    footerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
    },
    footerLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    timestamp: {
        ...Typography.default("regular"),
        fontSize: 11,
    },
    contributorText: {
        ...Typography.default("regular"),
        fontSize: 11,
    },
    actionRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
    },
    actionButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    actionText: {
        ...Typography.default("regular"),
        fontSize: 12,
    },
}));
