import * as React from "react";
import { Animated, View, Text, Pressable, LayoutAnimation, ActivityIndicator, Easing } from "react-native";
import { BlurView } from "expo-blur";
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
            sources?: Array<{ id: string; title: string; sessionId: string | null }>;
        } | null;
        tags: string[];
        confidence: string;
        sessionId: string | null;
        pinned: boolean;
        createdAt: number;
        evolutionSize?: number;
    };
    onUpdate: (entryId: string, data: { status?: string; pinned?: boolean }) => void;
    onDelete?: (entryId: string) => void;
    onRefine?: (entryId: string) => Promise<void>;
    onExtractSkill?: (entry: KnowledgeEntryCardProps["entry"]) => void;
    isArchived?: boolean;
    onViewEvolution?: (entryId: string) => void;
    onNavigateToSession?: (sessionId: string) => void;
    onNavigateToSourceEntry?: (entryId: string) => void;
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
    ({ entry, onUpdate, onDelete, onRefine, onExtractSkill, isArchived, onViewEvolution, onNavigateToSession, onNavigateToSourceEntry }) => {
        const { theme } = useUnistyles();
        const [expanded, setExpanded] = React.useState(false);
        const [refining, setRefining] = React.useState(false);
        const glowAnim = React.useRef(new Animated.Value(0)).current;
        const breatheAnim = React.useRef(new Animated.Value(0)).current;

        React.useEffect(() => {
            if (refining) {
                glowAnim.setValue(0);
                breatheAnim.setValue(0);
                const colorLoop = Animated.loop(
                    Animated.timing(glowAnim, {
                        toValue: 1,
                        duration: 2000,
                        easing: Easing.linear,
                        useNativeDriver: false,
                    }),
                );
                const breatheLoop = Animated.loop(
                    Animated.sequence([
                        Animated.timing(breatheAnim, {
                            toValue: 1,
                            duration: 600,
                            easing: Easing.inOut(Easing.ease),
                            useNativeDriver: true,
                        }),
                        Animated.timing(breatheAnim, {
                            toValue: 0,
                            duration: 600,
                            easing: Easing.inOut(Easing.ease),
                            useNativeDriver: true,
                        }),
                    ]),
                );
                colorLoop.start();
                breatheLoop.start();
                return () => { colorLoop.stop(); breatheLoop.stop(); };
            } else {
                glowAnim.setValue(0);
                breatheAnim.setValue(0);
            }
        }, [refining, glowAnim, breatheAnim]);

        const glowColor = glowAnim.interpolate({
            inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1],
            outputRange: ["#6366F1", "#A855F7", "#EC4899", "#F97316", "#3B82F6", "#6366F1"],
        });
        const titleScale = breatheAnim.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [1, 1.015, 1],
        });
        const titleTranslateX = breatheAnim.interpolate({
            inputRange: [0, 0.25, 0.5, 0.75, 1],
            outputRange: [0, -0.5, 0, 0.5, 0],
        });
        const shimmerOpacity = breatheAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.15, 0.08],
        });

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

        const MERGED_FROM_RE = /^Merged from (\d+) entries$/;
        const SOURCE_IDS_RE = /^Source IDs: (.+)$/;

        const soapFields = React.useMemo(() => {
            if (!entry.structured) return [];
            const fields: { key: string; value: string }[] = [];
            const order = ["request", "findings", "analysis", "outcome", "nextSteps"] as const;
            for (const key of order) {
                const value = entry.structured[key];
                if (!value) continue;
                if (key === "findings" && SOURCE_IDS_RE.test(value)) continue; // shown as chips
                if (key === "request") {
                    const m = MERGED_FROM_RE.exec(value);
                    if (m) {
                        fields.push({ key, value: t("projects.knowledgeMergedFrom", { count: parseInt(m[1], 10) }) });
                        continue;
                    }
                }
                fields.push({ key, value });
            }
            return fields;
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [entry.structured]);

        // New data: structured.sources has title + sessionId
        // Old data: parse IDs from findings string "Source IDs: id1, id2"
        const sources = React.useMemo(() => {
            if (entry.structured?.sources && entry.structured.sources.length > 0) {
                return entry.structured.sources;
            }
            const findings = entry.structured?.findings ?? "";
            const m = SOURCE_IDS_RE.exec(findings);
            if (!m) return [];
            return m[1].split(",").map((id) => ({ id: id.trim(), title: null as string | null, sessionId: null }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [entry.structured]);

        return (
            <Animated.View style={[
                styles.card,
                { backgroundColor: theme.colors.surface },
                refining && {
                    borderWidth: 1.5,
                    borderColor: glowColor as unknown as string,
                    shadowColor: glowColor as unknown as string,
                    shadowOffset: { width: 0, height: 0 },
                    shadowOpacity: 0.6,
                    shadowRadius: 8,
                    elevation: 8,
                },
            ]}>
                {/* Frosted glass overlay when refining */}
                {refining && (
                    <BlurView
                        intensity={15}
                        tint="default"
                        style={{
                            position: "absolute",
                            top: 0, left: 0, right: 0, bottom: 0,
                            borderRadius: 12,
                            overflow: "hidden",
                            zIndex: 0,
                        }}
                    />
                )}

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
                {refining ? (
                    <Animated.Text
                        style={[styles.title, {
                            color: glowColor as unknown as string,
                            transform: [{ scale: titleScale }, { translateX: titleTranslateX }],
                        }]}
                        numberOfLines={expanded ? undefined : 2}
                    >
                        {entry.title}
                    </Animated.Text>
                ) : (
                    <Text
                        style={[styles.title, { color: theme.colors.text }]}
                        numberOfLines={expanded ? undefined : 2}
                    >
                        {entry.title}
                    </Text>
                )}

                {refining ? (
                    /* Skeleton lines while refining */
                    <Animated.View style={[styles.soapSection, { opacity: shimmerOpacity }]}>
                        <Animated.View style={{ width: "90%", height: 13, borderRadius: 4, backgroundColor: glowColor as unknown as string, marginBottom: 6 }} />
                        <Animated.View style={{ width: "75%", height: 13, borderRadius: 4, backgroundColor: glowColor as unknown as string, marginBottom: 6 }} />
                        <Animated.View style={{ width: "60%", height: 13, borderRadius: 4, backgroundColor: glowColor as unknown as string, marginBottom: 6 }} />
                        <View style={[styles.tagsRow, { marginTop: 4 }]}>
                            <Animated.View style={{ width: 50, height: 16, borderRadius: 4, backgroundColor: glowColor as unknown as string }} />
                            <Animated.View style={{ width: 65, height: 16, borderRadius: 4, backgroundColor: glowColor as unknown as string }} />
                            <Animated.View style={{ width: 45, height: 16, borderRadius: 4, backgroundColor: glowColor as unknown as string }} />
                        </View>
                    </Animated.View>
                ) : (
                    <>
                        {/* Expanded: SOAP fields or merged content */}
                        {expanded && !!entry.content && (
                            <Text style={[styles.soapValue, { color: theme.colors.text, marginBottom: 8 }]}>
                                {entry.content}
                            </Text>
                        )}
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
                        {/* Sources: clickable chips for merged entries */}
                        {expanded && sources.length > 0 && (
                            <View style={styles.sourcesSection}>
                                <Text style={[styles.soapLabel, { color: theme.colors.textSecondary }]}>
                                    {t("projects.knowledgeSources")}
                                </Text>
                                <View style={styles.sourcesRow}>
                                    {sources.map((src) => {
                                        const isNavigable = !!(src.sessionId || onNavigateToSourceEntry);
                                        const handlePress = () => {
                                            if (src.sessionId) {
                                                onNavigateToSession?.(src.sessionId);
                                            } else {
                                                onNavigateToSourceEntry?.(src.id);
                                            }
                                        };
                                        return (
                                            <Pressable
                                                key={src.id}
                                                style={[styles.sourceChip, { backgroundColor: theme.colors.groupped.background }]}
                                                onPress={isNavigable ? handlePress : undefined}
                                                hitSlop={4}
                                            >
                                                <Ionicons name="git-merge-outline" size={11} color={theme.colors.textSecondary} />
                                                <Text
                                                    style={[styles.sourceChipText, { color: isNavigable ? theme.colors.header.tint : theme.colors.textSecondary }]}
                                                    numberOfLines={1}
                                                >
                                                    {src.title ?? src.id.slice(-8)}
                                                </Text>
                                                {isNavigable && (
                                                    <Ionicons name="arrow-forward" size={10} color={theme.colors.header.tint} />
                                                )}
                                            </Pressable>
                                        );
                                    })}
                                </View>
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
                    </>
                )}

                {/* Footer: timestamp + contributor + actions */}
                <View style={styles.footerRow}>
                    <Pressable
                        style={styles.footerLeft}
                        onPress={entry.sessionId ? () => onNavigateToSession?.(entry.sessionId!) : undefined}
                        hitSlop={8}
                    >
                        <Text style={[styles.timestamp, { color: theme.colors.textSecondary }]}>
                            {formatTimestamp(entry.createdAt)}
                        </Text>
                        {entry.contributorType !== "session" && (
                            <Text style={[styles.contributorText, { color: entry.sessionId ? theme.colors.header.tint : theme.colors.textSecondary }]}>
                                {entry.contributorType === "user"
                                    ? t("projects.knowledgeContributorHuman")
                                    : t("projects.knowledgeContributorAgent")}
                            </Text>
                        )}
                        {!!entry.sessionId && (
                            <Ionicons name="arrow-forward" size={10} color={theme.colors.header.tint} />
                        )}
                    </Pressable>
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
                                {onViewEvolution && (entry.evolutionSize == null || entry.evolutionSize > 1) && (
                                    <Pressable
                                        onPress={() => onViewEvolution(entry.id)}
                                        style={styles.actionButton}
                                        hitSlop={8}
                                    >
                                        <Ionicons
                                            name="git-branch-outline"
                                            size={18}
                                            color={entry.evolutionSize != null && entry.evolutionSize > 1 ? theme.colors.primary : theme.colors.textSecondary}
                                        />
                                        <Text style={[styles.actionText, { color: entry.evolutionSize != null && entry.evolutionSize > 1 ? theme.colors.primary : theme.colors.textSecondary }]}>
                                            {t("projects.knowledgeViewEvolution")}
                                        </Text>
                                        {entry.evolutionSize != null && entry.evolutionSize > 1 && (
                                            <View style={[styles.evolutionBadge, { backgroundColor: theme.colors.primary + "20" }]}>
                                                <Text style={[styles.evolutionBadgeText, { color: theme.colors.primary }]}>
                                                    {entry.evolutionSize}
                                                </Text>
                                            </View>
                                        )}
                                    </Pressable>
                                )}
                                {onExtractSkill && (
                                    <Pressable
                                        onPress={() => onExtractSkill(entry)}
                                        style={styles.actionButton}
                                        hitSlop={8}
                                    >
                                        <Ionicons
                                            name="flash-outline"
                                            size={18}
                                            color={theme.colors.textSecondary}
                                        />
                                        <Text style={[styles.actionText, { color: theme.colors.textSecondary }]}>
                                            {t("skills.extractSkill")}
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
    evolutionBadge: {
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 8,
        minWidth: 18,
        alignItems: "center",
    },
    evolutionBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
    },
    sourcesSection: {
        marginBottom: 8,
    },
    sourcesRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 4,
    },
    sourceChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        maxWidth: 220,
    },
    sourceChipText: {
        ...Typography.default("regular"),
        fontSize: 12,
        flex: 1,
    },
}));
