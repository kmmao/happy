import * as React from "react";
import { Animated, Pressable, Text, View, ScrollView, ActivityIndicator } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Typography } from "@/constants/Typography";
import { t } from "@/text";
import { layout } from "@/components/layout";
import { useSessionKnowledge, type SessionKnowledgeEntry } from "@/hooks/useSessionKnowledge";
import { useSessionKnowledgeAccesses, type SessionKnowledgeAccessEntry } from "@/hooks/useSessionKnowledgeAccesses";

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

interface SessionKnowledgeSheetProps {
    visible: boolean;
    onClose: () => void;
    projectServerId: string | undefined;
    sessionId: string;
}

function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
    });
}

type Tab = "changes" | "references";

interface EntryRowProps {
    entry: SessionKnowledgeEntry | SessionKnowledgeAccessEntry;
    onPress?: () => void;
}

const EntryRow = React.memo<EntryRowProps>(({ entry, onPress }) => {
    const { theme } = useUnistyles();
    const typeColor = TYPE_COLORS[entry.entryType] ?? theme.colors.textSecondary;
    const statusColor = STATUS_COLORS[entry.status] ?? theme.colors.textSecondary;

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
                <Text style={[styles.entryTime, { color: theme.colors.textSecondary }]}>
                    {formatTime(entry.createdAt)}
                </Text>
            </View>
            <Text style={[styles.entryTitle, { color: theme.colors.text }]} numberOfLines={2}>
                {entry.title}
            </Text>
            {entry.tags.length > 0 && (
                <View style={styles.tagsRow}>
                    {entry.tags.slice(0, 3).map((tag) => (
                        <View key={tag} style={[styles.tag, { backgroundColor: theme.colors.surfaceHighest }]}>
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
    ({ visible, onClose, projectServerId, sessionId }) => {
        const { theme } = useUnistyles();
        const insets = useSafeAreaInsets();
        const router = useRouter();
        const opacity = React.useRef(new Animated.Value(0)).current;
        const [shouldRender, setShouldRender] = React.useState(false);
        const [activeTab, setActiveTab] = React.useState<Tab>("changes");

        const { entries, loading: changesLoading } = useSessionKnowledge(
            visible ? projectServerId : undefined,
            visible ? sessionId : undefined,
        );

        const { accesses, loading: accessesLoading } = useSessionKnowledgeAccesses(
            visible ? projectServerId : undefined,
            visible ? sessionId : undefined,
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

        return (
            <Animated.View style={[styles.overlay, { opacity }]}>
                <Pressable style={styles.backdrop} onPress={onClose} />
                <View
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: theme.colors.surface,
                            maxWidth: layout.maxWidth,
                            paddingBottom: Math.max(20, insets.bottom + 8),
                        },
                    ]}
                >
                    <View style={styles.header}>
                        <Ionicons name="bulb-outline" size={18} color={theme.colors.primary} />
                        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                            {t("session.knowledgeChanges")}
                        </Text>
                        <Pressable onPress={onClose} hitSlop={8}>
                            <Ionicons name="close" size={20} color={theme.colors.textSecondary} />
                        </Pressable>
                    </View>

                    {/* Tabs */}
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
                            {entries.length > 0 && (
                                <View style={[styles.tabBadge, { backgroundColor: theme.colors.primary + "20" }]}>
                                    <Text style={[styles.tabBadgeText, { color: theme.colors.primary }]}>
                                        {entries.length}
                                    </Text>
                                </View>
                            )}
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
                            {accesses.length > 0 && (
                                <View style={[styles.tabBadge, { backgroundColor: theme.colors.primary + "20" }]}>
                                    <Text style={[styles.tabBadgeText, { color: theme.colors.primary }]}>
                                        {accesses.length}
                                    </Text>
                                </View>
                            )}
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
                                    <EntryRow key={entry.id} entry={entry} />
                                ))
                                : accesses.map((entry) => (
                                    <EntryRow
                                        key={entry.id}
                                        entry={entry}
                                        onPress={entry.sessionId ? () => handleAccessEntryPress(entry) : undefined}
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
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 10,
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
