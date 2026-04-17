import * as React from "react";
import { Animated, Pressable, Text, View, ScrollView, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal } from "@/modal";
import { layout } from "@/components/layout";
import { useSessionKnowledge, type SessionKnowledgeEntry } from "@/hooks/useSessionKnowledge";
import { useSessionKnowledgeAccesses, type SessionKnowledgeAccessEntry } from "@/hooks/useSessionKnowledgeAccesses";
import { getSessionKnowledgeDisplayTimestamp } from "./sessionKnowledgeDisplayTimestamp";
import { getSessionKnowledgeLoadState, type SessionKnowledgeTab } from "./sessionKnowledgeLoadState";

const TYPE_COLORS: Record<string, string> = {
    discovery: "#3B82F6",
    decision: "#8B5CF6",
    fix: "#22C55E",
    convention: "#F97316",
    warning: "#EF4444",
};

const STATUS_COLORS: Record<string, string> = {
    active: "#22C55E",
    superseded: "#F97316",
    archived: "#9CA3AF",
};

// Session TTL badge colors:
//   - hot + never hit   → blue (fresh, waiting to be referenced)
//   - hot + has hits    → orange (proven useful, banking turns)
//   - evicted           → grey (countdown hit zero, not injected anymore)
const HOT_BADGE_COLOR_FRESH = "#3B82F6";
const HOT_BADGE_COLOR_USED = "#F97316";
const EVICTED_BADGE_COLOR = "#9CA3AF";

interface SessionKnowledgeSheetProps {
    visible: boolean;
    onClose: () => void;
    projectServerId: string | undefined;
    sessionId: string;
    maxHeight?: `${number}%` | number;
    initialTab?: SessionKnowledgeTab;
}

function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
    });
}

interface EntryRowProps {
    activeTab: SessionKnowledgeTab;
    entry: SessionKnowledgeEntry | SessionKnowledgeAccessEntry;
    onPress?: () => void;
}

interface HotBadgeProps {
    entry: SessionKnowledgeEntry | SessionKnowledgeAccessEntry;
}

function isAccessEntry(
    entry: SessionKnowledgeEntry | SessionKnowledgeAccessEntry,
): entry is SessionKnowledgeAccessEntry {
    return "hotStatus" in entry || "turnsRemaining" in entry;
}

const HotBadge = React.memo<HotBadgeProps>(({ entry }) => {
    if (!isAccessEntry(entry)) return null;
    const hotStatus = entry.hotStatus;
    const turnsRemaining = entry.turnsRemaining;
    const maxTurns = entry.maxTurns;
    const hitCount = entry.hitCount ?? 0;

    // Backward compat: if server didn't include TTL fields, skip the badge entirely.
    if (hotStatus === undefined && turnsRemaining === undefined) return null;

    // Long-press opens an inline explanation so users understand why an entry
    // is "hot" vs "evicted" and how the turn-based countdown works.
    const showTooltip = () => {
        const title = t("session.knowledgeBadgeTooltipTitle");
        const body = hotStatus === "evicted"
            ? t("session.knowledgeBadgeTooltipEvicted")
            : t("session.knowledgeBadgeTooltipHot", {
                turns: turnsRemaining ?? 0,
                max: maxTurns ?? 0,
                hits: hitCount,
            });
        Modal.alert(title, body);
    };

    if (hotStatus === "evicted") {
        return (
            <Pressable
                onLongPress={showTooltip}
                delayLongPress={300}
                style={[styles.hotBadge, { backgroundColor: EVICTED_BADGE_COLOR + "20" }]}
                accessibilityRole="button"
                accessibilityLabel={t("session.knowledgeBadgeTooltipTitle")}
            >
                <Text style={[styles.hotBadgeText, { color: EVICTED_BADGE_COLOR }]}>
                    {t("session.knowledgeBadgeEvicted")}
                </Text>
            </Pressable>
        );
    }

    const color = hitCount > 0 ? HOT_BADGE_COLOR_USED : HOT_BADGE_COLOR_FRESH;
    const budget = turnsRemaining !== undefined && maxTurns !== undefined
        ? `${turnsRemaining}/${maxTurns}`
        : null;
    const hitText = hitCount > 0 ? ` · ${hitCount}×` : "";
    const label = budget ? `${budget}${hitText}` : `${hitCount}×`;

    return (
        <Pressable
            onLongPress={showTooltip}
            delayLongPress={300}
            style={[styles.hotBadge, { backgroundColor: color + "20" }]}
            accessibilityRole="button"
            accessibilityLabel={t("session.knowledgeBadgeTooltipTitle")}
        >
            <Text style={[styles.hotBadgeText, { color }]}>
                {label}
            </Text>
        </Pressable>
    );
});

const EntryRow = React.memo<EntryRowProps>(({ activeTab, entry, onPress }) => {
    const { theme } = useUnistyles();
    const typeColor = TYPE_COLORS[entry.entryType] ?? theme.colors.textSecondary;
    const statusColor = STATUS_COLORS[entry.status] ?? theme.colors.textSecondary;
    const contentPreview = typeof entry.content === "string" ? entry.content.trim() : "";

    return (
        <Pressable
            style={[styles.entryRow, { backgroundColor: theme.colors.surface }]}
            onPress={onPress}
            disabled={!onPress}
        >
            <View style={styles.entryHeader}>
                <View style={[styles.typeBadge, { backgroundColor: typeColor + "20" }]}>
                    <Text style={[styles.typeBadgeText, { color: typeColor }]}>
                        {entry.entryType}
                    </Text>
                </View>
                {entry.status !== "active" && (
                    <View style={[styles.statusBadge, { backgroundColor: statusColor + "20" }]}>
                        <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                            {entry.status}
                        </Text>
                    </View>
                )}
                {activeTab === "references" && <HotBadge entry={entry} />}
                <Text style={[styles.entryTime, { color: theme.colors.textSecondary }]}>
                    {formatTime(getSessionKnowledgeDisplayTimestamp({ activeTab, entry }))}
                </Text>
            </View>
            <Text style={[styles.entryTitle, { color: theme.colors.text }]} numberOfLines={2}>
                {entry.title}
            </Text>
            {contentPreview.length > 0 && (
                <Text style={[styles.entryContent, { color: theme.colors.textSecondary }]} numberOfLines={4}>
                    {contentPreview}
                </Text>
            )}
            {entry.tags.length > 0 && (
                <View style={styles.tagsRow}>
                    {entry.tags.slice(0, 3).map((tag, index) => (
                        <View key={`${tag}-${index}`} style={[styles.tag, { backgroundColor: theme.colors.surfaceHighest }]}>
                            <Text style={[styles.tagText, { color: theme.colors.textSecondary }]}>
                                {tag}
                            </Text>
                        </View>
                    ))}
                </View>
            )}
            {onPress && (
                <View style={styles.sourceRow}>
                    <Ionicons name="arrow-forward-outline" size={12} color={theme.colors.textSecondary} />
                    <Text style={[styles.sourceText, { color: theme.colors.textSecondary }]}>
                        {t("session.knowledgeAccessGoToSource")}
                    </Text>
                </View>
            )}
        </Pressable>
    );
});

export const SessionKnowledgeSheet = React.memo<SessionKnowledgeSheetProps>(
    ({ visible, onClose, projectServerId, sessionId, maxHeight = "84%", initialTab = "changes" }) => {
        const { theme } = useUnistyles();
        const insets = useSafeAreaInsets();
        const router = useRouter();
        const opacity = React.useRef(new Animated.Value(0)).current;
        const [shouldRender, setShouldRender] = React.useState(false);
        const [activeTab, setActiveTab] = React.useState<SessionKnowledgeTab>(initialTab);
        const [hasLoadedChanges, setHasLoadedChanges] = React.useState(false);
        const [hasLoadedReferences, setHasLoadedReferences] = React.useState(false);

        React.useEffect(() => {
            if (visible) {
                setActiveTab(initialTab);
            }
        }, [initialTab, visible]);

        React.useEffect(() => {
            if (!visible) return;
            if (activeTab === "changes") {
                setHasLoadedChanges(true);
                return;
            }
            setHasLoadedReferences(true);
        }, [activeTab, visible]);

        const loadState = getSessionKnowledgeLoadState({
            visible,
            activeTab,
            hasLoadedChanges,
            hasLoadedReferences,
        });

        const { entries, loading: changesLoading } = useSessionKnowledge(
            loadState.shouldLoadChanges ? projectServerId : undefined,
            loadState.shouldLoadChanges ? sessionId : undefined,
        );

        const { accesses, loading: accessesLoading } = useSessionKnowledgeAccesses(
            loadState.shouldLoadReferences ? projectServerId : undefined,
            loadState.shouldLoadReferences ? sessionId : undefined,
        );

        React.useEffect(() => {
            let anim: Animated.CompositeAnimation;
            if (visible) {
                setShouldRender(true);
                anim = Animated.timing(opacity, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true,
                });
                anim.start();
            } else {
                anim = Animated.timing(opacity, {
                    toValue: 0,
                    duration: 150,
                    useNativeDriver: true,
                });
                anim.start(() => setShouldRender(false));
            }
            return () => anim?.stop();
        }, [visible, opacity]);

        const handleAccessEntryPress = React.useCallback((entry: SessionKnowledgeAccessEntry) => {
            if (!entry.sessionId) return;
            onClose();
            router.push(`/session/${entry.sessionId}` as any);
        }, [onClose, router]);

        if (!shouldRender) return null;

        const isChangesTab = activeTab === "changes";
        const loading = isChangesTab ? changesLoading : accessesLoading;
        const isEmpty = isChangesTab ? entries.length === 0 : accesses.length === 0;
        const headerTitle = isChangesTab
            ? t("session.knowledgeChanges")
            : t("session.knowledgeTabReferences");
        const currentCount = isChangesTab ? entries.length : accesses.length;

        return (
            <Animated.View style={[styles.overlay, { opacity }]}>
                <Pressable style={styles.backdrop} onPress={onClose} />
                <View
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: theme.colors.surface,
                            maxWidth: layout.maxWidth,
                            height: maxHeight,
                            maxHeight,
                            paddingBottom: Math.max(20, insets.bottom + 8),
                        },
                    ]}
                >
                    <View style={styles.header}>
                        <Ionicons name="bulb-outline" size={18} color={theme.colors.primary} />
                        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                            {headerTitle}
                        </Text>
                        <View style={[styles.headerCountBadge, { backgroundColor: theme.colors.primary + "20" }]}>
                            <Text style={[styles.headerCountText, { color: theme.colors.primary }]}>
                                {currentCount}
                            </Text>
                        </View>
                        <Pressable onPress={onClose} hitSlop={8}>
                            <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>

                    <View style={[styles.tabBar, { borderBottomColor: theme.colors.surfaceHighest }]}>
                        <Pressable
                            style={[
                                styles.tab,
                                isChangesTab && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 },
                            ]}
                            onPress={() => setActiveTab("changes")}
                        >
                            <Text style={[
                                styles.tabText,
                                { color: isChangesTab ? theme.colors.primary : theme.colors.textSecondary },
                            ]}>
                                {t("session.knowledgeTabChanges")}
                            </Text>
                            <View style={[
                                styles.tabBadge,
                                { backgroundColor: (isChangesTab ? theme.colors.primary : theme.colors.textSecondary) + "20" },
                            ]}>
                                <Text style={[
                                    styles.tabBadgeText,
                                    { color: isChangesTab ? theme.colors.primary : theme.colors.textSecondary },
                                ]}>
                                    {entries.length}
                                </Text>
                            </View>
                        </Pressable>
                        <Pressable
                            style={[
                                styles.tab,
                                !isChangesTab && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 },
                            ]}
                            onPress={() => setActiveTab("references")}
                        >
                            <Text style={[
                                styles.tabText,
                                { color: !isChangesTab ? theme.colors.primary : theme.colors.textSecondary },
                            ]}>
                                {t("session.knowledgeTabReferences")}
                            </Text>
                            <View style={[
                                styles.tabBadge,
                                { backgroundColor: (!isChangesTab ? theme.colors.primary : theme.colors.textSecondary) + "20" },
                            ]}>
                                <Text style={[
                                    styles.tabBadgeText,
                                    { color: !isChangesTab ? theme.colors.primary : theme.colors.textSecondary },
                                ]}>
                                    {accesses.length}
                                </Text>
                            </View>
                        </Pressable>
                    </View>

                    <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                        {isChangesTab
                            ? t("session.knowledgeChangesSubtitle")
                            : t("session.knowledgeAccessesSubtitle")}
                    </Text>

                    {loading && isEmpty ? (
                        <View style={styles.centerContainer}>
                            <ActivityIndicator size="small" color={theme.colors.primary} />
                        </View>
                    ) : isEmpty ? (
                        <View style={styles.centerContainer}>
                            <Ionicons name="document-outline" size={32} color={theme.colors.textSecondary} />
                            <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                                {isChangesTab
                                    ? t("session.knowledgeChangesEmpty")
                                    : t("session.knowledgeAccessesEmpty")}
                            </Text>
                        </View>
                    ) : (
                        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
                            {isChangesTab
                                ? entries.map((entry) => (
                                    <EntryRow key={entry.id} entry={entry} activeTab={activeTab} />
                                ))
                                : accesses.map((entry) => (
                                    <EntryRow
                                        key={entry.id}
                                        entry={entry}
                                        onPress={entry.sessionId ? () => handleAccessEntryPress(entry) : undefined}
                                        activeTab={activeTab}
                                    />
                                ))}
                        </ScrollView>
                    )}
                </View>
            </Animated.View>
        );
    },
);

const styles = StyleSheet.create({
    overlay: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1100,
        justifyContent: "flex-end",
    },
    backdrop: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.4)",
    },
    sheet: {
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        maxHeight: "60%",
        width: "100%",
        alignSelf: "center",
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 4,
    },
    headerTitle: {
        ...Typography.default("semiBold"),
        fontSize: 16,
        flex: 1,
    },
    headerCountBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
    },
    headerCountText: {
        ...Typography.default("semiBold"),
        fontSize: 11,
    },
    tabBar: {
        flexDirection: "row",
        marginHorizontal: 16,
        marginTop: 8,
        borderBottomWidth: 1,
    },
    tab: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 4,
        marginRight: 20,
    },
    tabText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
    },
    tabBadge: {
        minWidth: 22,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 10,
        alignItems: "center",
    },
    tabBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
    },
    subtitle: {
        ...Typography.default("regular"),
        fontSize: 12,
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 12,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        paddingHorizontal: 16,
        gap: 8,
        paddingBottom: 8,
    },
    centerContainer: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 40,
        gap: 8,
    },
    emptyText: {
        ...Typography.default("regular"),
        fontSize: 13,
    },
    entryRow: {
        padding: 12,
        borderRadius: 10,
        gap: 6,
    },
    entryHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    typeBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    typeBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
        textTransform: "uppercase",
    },
    statusBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    statusBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
        textTransform: "uppercase",
    },
    hotBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    hotBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
    },
    entryTime: {
        ...Typography.default("regular"),
        fontSize: 10,
        marginLeft: "auto",
    },
    entryTitle: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        lineHeight: 18,
    },
    entryContent: {
        ...Typography.default("regular"),
        fontSize: 12,
        lineHeight: 18,
    },
    tagsRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 4,
    },
    tag: {
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
    },
    tagText: {
        ...Typography.default("regular"),
        fontSize: 10,
    },
    sourceRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        marginTop: 2,
    },
    sourceText: {
        ...Typography.default("regular"),
        fontSize: 10,
    },
});
