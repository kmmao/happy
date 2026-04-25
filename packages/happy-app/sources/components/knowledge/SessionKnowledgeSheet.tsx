import * as React from "react";
import { Animated, Pressable, Text, View, ScrollView } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { Modal } from "@/modal";
import { layout } from "@/components/layout";
import { SharedStateView } from "@/components/SharedStateView";
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
//   - urgent (≤3 turns) → red (about to be evicted)
//   - evicted           → grey (countdown hit zero, not injected anymore)
const HOT_BADGE_COLOR_FRESH = "#3B82F6";
const HOT_BADGE_COLOR_USED = "#F97316";
const HOT_BADGE_COLOR_URGENT = "#EF4444";
const EVICTED_BADGE_COLOR = "#9CA3AF";
const URGENT_THRESHOLD = 3;

interface SessionKnowledgeSheetProps {
    visible: boolean;
    onClose: () => void;
    projectServerId: string | undefined;
    sessionId: string;
    maxHeight?: `${number}%` | number;
    initialTab?: SessionKnowledgeTab;
    /**
     * When true, renders the tabs + entry list inline (no overlay, no backdrop,
     * no animated chrome). The caller controls layout. `visible` / `onClose` /
     * `maxHeight` are ignored in inline mode.
     */
    inline?: boolean;
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
    onEvict?: () => void;
    onReinject?: () => void;
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

    // Delta animation: show +N / −N when turnsRemaining changes
    const prevTurnsRef = React.useRef<number | undefined>(undefined);
    const [deltaText, setDeltaText] = React.useState<string | null>(null);
    const deltaOpacity = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
        if (prevTurnsRef.current !== undefined && turnsRemaining !== undefined) {
            const diff = turnsRemaining - prevTurnsRef.current;
            if (diff !== 0) {
                setDeltaText(diff > 0 ? `+${diff}` : `${diff}`);
                deltaOpacity.setValue(1);
                Animated.sequence([
                    Animated.delay(800),
                    Animated.timing(deltaOpacity, { toValue: 0, duration: 700, useNativeDriver: true }),
                ]).start(() => setDeltaText(null));
            }
        }
        prevTurnsRef.current = turnsRemaining;
    }, [turnsRemaining]);

    // Evicted pulse: scale 1 → 1.18 → 1 when transitioning hot → evicted
    const prevHotStatusRef = React.useRef<string | undefined>(undefined);
    const evictedScale = React.useRef(new Animated.Value(1)).current;

    React.useEffect(() => {
        if (prevHotStatusRef.current !== undefined &&
            prevHotStatusRef.current !== "evicted" &&
            hotStatus === "evicted") {
            Animated.sequence([
                Animated.timing(evictedScale, { toValue: 1.18, duration: 160, useNativeDriver: true }),
                Animated.timing(evictedScale, { toValue: 1, duration: 200, useNativeDriver: true }),
            ]).start();
        }
        prevHotStatusRef.current = hotStatus;
    }, [hotStatus]);

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
            <Animated.View style={{ transform: [{ scale: evictedScale }] }}>
                <Pressable
                    onLongPress={showTooltip}
                    delayLongPress={300}
                    style={[styles.hotBadge, { backgroundColor: EVICTED_BADGE_COLOR + "20" }]}
                    accessibilityRole="button"
                    accessibilityLabel={t("session.knowledgeBadgeTooltipTitle")}
                >
                    <Ionicons
                        name="close-circle-outline"
                        size={11}
                        color={EVICTED_BADGE_COLOR}
                        style={styles.hotBadgeIcon}
                    />
                    <Text style={[styles.hotBadgeText, { color: EVICTED_BADGE_COLOR }]}>
                        {t("session.knowledgeBadgeEvicted")}
                    </Text>
                </Pressable>
            </Animated.View>
        );
    }

    const isUrgent = turnsRemaining !== undefined && turnsRemaining <= URGENT_THRESHOLD;
    const color = isUrgent
        ? HOT_BADGE_COLOR_URGENT
        : hitCount > 0 ? HOT_BADGE_COLOR_USED : HOT_BADGE_COLOR_FRESH;
    const deltaColor = deltaText?.startsWith("+") ? HOT_BADGE_COLOR_FRESH : HOT_BADGE_COLOR_URGENT;

    // Use localised "7/14 轮 · 2 次" style labels so users can read the budget
    // at a glance without having to long-press for the tooltip.
    const label =
        turnsRemaining !== undefined && maxTurns !== undefined
            ? t("session.knowledgeBadgeHotLabel", {
                turns: turnsRemaining,
                max: maxTurns,
                hits: hitCount,
            })
            : t("session.knowledgeBadgeHotHitsOnly", { hits: hitCount });

    return (
        <View style={styles.hotBadgeWrapper}>
            <Pressable
                onLongPress={showTooltip}
                delayLongPress={300}
                style={[styles.hotBadge, { backgroundColor: color + "20" }]}
                accessibilityRole="button"
                accessibilityLabel={t("session.knowledgeBadgeTooltipTitle")}
            >
                <Ionicons
                    name={isUrgent ? "warning-outline" : "timer-outline"}
                    size={11}
                    color={color}
                    style={styles.hotBadgeIcon}
                />
                <Text style={[styles.hotBadgeText, { color }]}>
                    {label}
                </Text>
            </Pressable>
            {deltaText && (
                <Animated.Text style={[styles.hotBadgeDelta, { color: deltaColor, opacity: deltaOpacity }]}>
                    {deltaText}
                </Animated.Text>
            )}
        </View>
    );
});

const EntryRow = React.memo<EntryRowProps>(({ activeTab, entry, onPress, onEvict, onReinject }) => {
    const { theme } = useUnistyles();
    const typeColor = TYPE_COLORS[entry.entryType] ?? theme.colors.textSecondary;
    const statusColor = STATUS_COLORS[entry.status] ?? theme.colors.textSecondary;
    const contentPreview = typeof entry.content === "string" ? entry.content.trim() : "";
    const showHotBadge = activeTab !== "changes";

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
                {showHotBadge && <HotBadge entry={entry} />}
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
            <View style={styles.actionsRow}>
                {onPress && (
                    <View style={styles.sourceRow}>
                        <Ionicons name="arrow-forward-outline" size={12} color={theme.colors.textSecondary} />
                        <Text style={[styles.sourceText, { color: theme.colors.textSecondary }]}>
                            {t("session.knowledgeAccessGoToSource")}
                        </Text>
                    </View>
                )}
                {onEvict && (
                    <Pressable
                        onPress={(event) => {
                            // Stop bubbling so the outer Pressable (navigate to source
                            // session) doesn't also fire on the same tap. Works on both
                            // React Native native and Web (SyntheticEvent).
                            const maybeEvent = event as unknown as { stopPropagation?: () => void };
                            if (typeof maybeEvent?.stopPropagation === "function") {
                                maybeEvent.stopPropagation();
                            }
                            onEvict();
                        }}
                        hitSlop={8}
                        style={[styles.evictButton, { borderColor: EVICTED_BADGE_COLOR }]}
                        accessibilityRole="button"
                    >
                        <Ionicons name="log-out-outline" size={12} color={EVICTED_BADGE_COLOR} />
                        <Text style={[styles.evictButtonText, { color: EVICTED_BADGE_COLOR }]}>
                            {t("session.knowledgeEvictAction")}
                        </Text>
                    </Pressable>
                )}
                {onReinject && (
                    <Pressable
                        onPress={(event) => {
                            const maybeEvent = event as unknown as { stopPropagation?: () => void };
                            if (typeof maybeEvent?.stopPropagation === "function") {
                                maybeEvent.stopPropagation();
                            }
                            onReinject();
                        }}
                        hitSlop={8}
                        style={[styles.evictButton, { borderColor: HOT_BADGE_COLOR_FRESH }]}
                        accessibilityRole="button"
                    >
                        <Ionicons name="refresh-outline" size={12} color={HOT_BADGE_COLOR_FRESH} />
                        <Text style={[styles.evictButtonText, { color: HOT_BADGE_COLOR_FRESH }]}>
                            {t("session.knowledgeReinjectAction")}
                        </Text>
                    </Pressable>
                )}
            </View>
        </Pressable>
    );
});

export const SessionKnowledgeSheet = React.memo<SessionKnowledgeSheetProps>(
    ({ visible, onClose, projectServerId, sessionId, maxHeight = "84%", initialTab = "changes", inline = false }) => {
        const { theme } = useUnistyles();
        const insets = useSafeAreaInsets();
        const router = useRouter();
        const opacity = React.useRef(new Animated.Value(0)).current;
        const [shouldRender, setShouldRender] = React.useState(false);
        const [activeTab, setActiveTab] = React.useState<SessionKnowledgeTab>(initialTab);
        const [hasLoadedChanges, setHasLoadedChanges] = React.useState(false);

        // Inline mode: always-visible, skip overlay chrome + animation state.
        const effectiveVisible = inline ? true : visible;

        React.useEffect(() => {
            if (effectiveVisible) {
                setActiveTab(initialTab);
            }
        }, [initialTab, effectiveVisible]);

        React.useEffect(() => {
            if (!effectiveVisible) return;
            if (activeTab === "changes") {
                setHasLoadedChanges(true);
            }
        }, [activeTab, effectiveVisible]);

        const loadState = getSessionKnowledgeLoadState({
            visible: effectiveVisible,
            activeTab,
            hasLoadedChanges,
        });

        const {
            entries,
            error: changesError,
            state: changesState,
            refresh: refreshChanges,
        } = useSessionKnowledge(
            loadState.shouldLoadChanges ? projectServerId : undefined,
            loadState.shouldLoadChanges ? sessionId : undefined,
        );

        const {
            accesses,
            error: accessesError,
            state: accessesState,
            refresh: refreshAccesses,
            evict,
            reinject,
        } = useSessionKnowledgeAccesses(
            loadState.shouldLoadReferences ? projectServerId : undefined,
            loadState.shouldLoadReferences ? sessionId : undefined,
        );

        // Three-way split of this session's access rows:
        //   - hotAccesses: live injection pool (hotStatus=hot, status=active)
        //   - evictedAccesses: manually kicked out or TTL-zero (hotStatus=evicted,
        //     status=active) → can be revived with reinject
        //   - archivedAccesses: globally archived/superseded (status!=active) →
        //     read-only, cannot be revived at session level
        const { hotAccesses, evictedAccesses, archivedAccesses } = React.useMemo(() => {
            const hot: SessionKnowledgeAccessEntry[] = [];
            const evicted: SessionKnowledgeAccessEntry[] = [];
            const archived: SessionKnowledgeAccessEntry[] = [];
            for (const access of accesses) {
                if (access.status !== "active") {
                    archived.push(access);
                } else if (access.hotStatus === "evicted") {
                    evicted.push(access);
                } else {
                    hot.push(access);
                }
            }
            return { hotAccesses: hot, evictedAccesses: evicted, archivedAccesses: archived };
        }, [accesses]);

        // One-tap evict — no confirmation modal. Restoring from the Evicted
        // tab with the Re-inject button provides the undo path.
        const handleEvict = React.useCallback(
            (entry: SessionKnowledgeAccessEntry) => {
                void evict(entry.id);
            },
            [evict],
        );

        const handleReinject = React.useCallback(
            (entry: SessionKnowledgeAccessEntry) => {
                void reinject(entry.id);
            },
            [reinject],
        );

        React.useEffect(() => {
            if (inline) {
                // Inline mode: always mounted, no animation needed.
                setShouldRender(true);
                return undefined;
            }
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
        }, [inline, visible, opacity]);

        const handleAccessEntryPress = React.useCallback((entry: SessionKnowledgeAccessEntry) => {
            if (!entry.sessionId) return;
            if (!inline) onClose();
            router.push(`/session/${entry.sessionId}` as any);
        }, [inline, onClose, router]);

        if (!inline && !shouldRender) return null;

        const isChangesTab = activeTab === "changes";
        const isReferencesTab = activeTab === "references";
        const isEvictedTab = activeTab === "evicted";
        const isArchiveTab = activeTab === "archive";

        const activeEntries: Array<SessionKnowledgeEntry | SessionKnowledgeAccessEntry> =
            isChangesTab ? entries
                : isReferencesTab ? hotAccesses
                    : isEvictedTab ? evictedAccesses
                        : isArchiveTab ? archivedAccesses
                            : [];
        const activeCollectionState = isChangesTab ? changesState : accessesState;
        const activeError = isChangesTab ? changesError : accessesError;
        const isEmpty = activeEntries.length === 0;
        const headerTitle = isChangesTab
            ? t("session.knowledgeChanges")
            : isEvictedTab
                ? t("session.knowledgeTabEvicted")
                : isArchiveTab
                    ? t("session.knowledgeTabArchive")
                    : t("session.knowledgeTabReferences");
        const currentCount = activeEntries.length;
        const handleRefreshActiveTab = React.useCallback(() => {
            if (isChangesTab) {
                void refreshChanges();
                return;
            }
            void refreshAccesses();
        }, [isChangesTab, refreshAccesses, refreshChanges]);

        const body = (
            <>
                {!inline && (
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
                )}

                <View style={[styles.tabBar, { borderBottomColor: theme.colors.surfaceHighest }]}>
                        {([
                            { key: "changes", label: t("session.knowledgeTabChanges"), count: entries.length, active: isChangesTab },
                            { key: "references", label: t("session.knowledgeTabReferences"), count: hotAccesses.length, active: isReferencesTab },
                            { key: "evicted", label: t("session.knowledgeTabEvicted"), count: evictedAccesses.length, active: isEvictedTab },
                            { key: "archive", label: t("session.knowledgeTabArchive"), count: archivedAccesses.length, active: isArchiveTab },
                        ] as const).map((tab) => (
                            <Pressable
                                key={tab.key}
                                style={[
                                    styles.tab,
                                    tab.active && { borderBottomColor: theme.colors.primary, borderBottomWidth: 2 },
                                ]}
                                onPress={() => setActiveTab(tab.key)}
                            >
                                <Text style={[
                                    styles.tabText,
                                    { color: tab.active ? theme.colors.primary : theme.colors.textSecondary },
                                ]}>
                                    {tab.label}
                                </Text>
                                {tab.count !== null && (
                                    <View style={[
                                        styles.tabBadge,
                                        { backgroundColor: (tab.active ? theme.colors.primary : theme.colors.textSecondary) + "20" },
                                    ]}>
                                        <Text style={[
                                            styles.tabBadgeText,
                                            { color: tab.active ? theme.colors.primary : theme.colors.textSecondary },
                                        ]}>
                                            {tab.count}
                                        </Text>
                                    </View>
                                )}
                            </Pressable>
                        ))}
                    </View>

                    <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                        {isChangesTab
                            ? t("session.knowledgeChangesSubtitle")
                            : isEvictedTab
                                ? t("session.knowledgeEvictedSubtitle")
                                : isArchiveTab
                                    ? t("session.knowledgeArchiveSubtitle")
                                    : t("session.knowledgeAccessesSubtitle")}
                    </Text>

                    {activeCollectionState.kind === "loading" && isEmpty ? (
                        <SharedStateView
                            inline
                            kind="loading"
                            title={t("common.loading")}
                        />
                    ) : activeCollectionState.kind === "error" && isEmpty ? (
                        <SharedStateView
                            inline
                            kind="error"
                            title={t("common.error")}
                            description={activeError ?? undefined}
                            onAction={handleRefreshActiveTab}
                        />
                    ) : isEmpty ? (
                        <SharedStateView
                            inline
                            kind="empty"
                            icon={
                                <Ionicons
                                    name="document-outline"
                                    size={32}
                                    color={theme.colors.textSecondary}
                                />
                            }
                            title={
                                isChangesTab
                                    ? t("session.knowledgeChangesEmpty")
                                    : isEvictedTab
                                        ? t("session.knowledgeEvictedEmpty")
                                        : isArchiveTab
                                            ? t("session.knowledgeArchiveEmpty")
                                            : t("session.knowledgeAccessesEmpty")
                            }
                        />
                    ) : (
                        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
                            {isChangesTab
                                ? entries.map((entry) => (
                                    <EntryRow key={entry.id} entry={entry} activeTab={activeTab} />
                                ))
                                : (activeEntries as SessionKnowledgeAccessEntry[]).map((entry) => (
                                    <EntryRow
                                        key={entry.id}
                                        entry={entry}
                                        onPress={entry.sessionId ? () => handleAccessEntryPress(entry) : undefined}
                                        onEvict={isReferencesTab ? () => handleEvict(entry) : undefined}
                                        onReinject={isEvictedTab ? () => handleReinject(entry) : undefined}
                                        activeTab={activeTab}
                                    />
                                ))}
                        </ScrollView>
                    )}
            </>
        );

        if (inline) {
            return <View style={styles.inlineContainer}>{body}</View>;
        }

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
                    {body}
                </View>
            </Animated.View>
        );
    },
);

const styles = StyleSheet.create({
    inlineContainer: {
        flex: 1,
    },
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
    hotBadgeWrapper: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    hotBadge: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        gap: 3,
    },
    hotBadgeIcon: {
        marginRight: 0,
    },
    hotBadgeText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
    },
    hotBadgeDelta: {
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
    },
    sourceText: {
        ...Typography.default("regular"),
        fontSize: 10,
    },
    actionsRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 4,
        gap: 8,
    },
    evictButton: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        borderWidth: 1,
    },
    evictButtonText: {
        ...Typography.default("semiBold"),
        fontSize: 10,
    },
});
