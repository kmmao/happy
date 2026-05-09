import * as React from "react";
import { View, ScrollView, RefreshControl, TouchableOpacity, LayoutAnimation } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import type { WorldEvent } from "./worldTypes";
import {
    type IntentChain,
    type ProjectChain,
    extractStatus,
    groupIntoChains,
} from "./worldChainUtils";

interface WorldChainModeProps {
    events: WorldEvent[];
    loading: boolean;
    onRefresh: () => void;
    searchQuery?: string;
}

export const WorldChainMode = React.memo(function WorldChainMode({
    events,
    loading,
    onRefresh,
    searchQuery = "",
}: WorldChainModeProps) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const chains = React.useMemo(() => {
        const all = groupIntoChains(events);
        const q = searchQuery.trim().toLowerCase();
        if (!q) return all;
        return all.filter((chain) =>
            chain.kind === "intent"
                ? chain.parentEvent.title.toLowerCase().includes(q) ||
                  chain.steps.some((s) => s.title.toLowerCase().includes(q))
                : chain.projectLabel.toLowerCase().includes(q) ||
                  chain.tasks.some((t) => t.title.toLowerCase().includes(q)),
        );
    }, [events, searchQuery]);

    if (chains.length === 0 && !loading) {
        const isFiltered = !!searchQuery.trim();
        return (
            <ScrollView
                contentContainerStyle={styles.empty}
                refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
            >
                <Ionicons
                    name={isFiltered ? "search-outline" : "git-branch-outline"}
                    size={40}
                    color={theme.colors.textSecondary}
                />
                <Text style={styles.emptyText}>
                    {isFiltered ? t("world.noChainResults") : t("world.noEvents")}
                </Text>
            </ScrollView>
        );
    }

    return (
        <ScrollView
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
        >
            {chains.map((chain) =>
                chain.kind === "intent"
                    ? <IntentCard key={chain.parentEvent.id} chain={chain} />
                    : <ChainCard key={chain.projectLabel} chain={chain} />,
            )}
        </ScrollView>
    );
});

// ─── IntentCard ───────────────────────────────────────────────────────────────

const IntentCard = React.memo(function IntentCard({ chain }: { chain: IntentChain }) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const router = useRouter();
    const [expanded, setExpanded] = React.useState(false);

    const progress = chain.total > 0 ? chain.completed / chain.total : 0;
    const hasFailures = chain.failed > 0;
    const isActive = chain.running > 0;
    const parentSessionId = chain.parentEvent.source.sessionId;

    const handlePress = React.useCallback(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((v) => !v);
    }, []);

    const handleTitlePress = React.useCallback(() => {
        if (parentSessionId) {
            router.push(`/(app)/session/${parentSessionId}`);
        }
    }, [parentSessionId, router]);

    return (
        <TouchableOpacity style={[styles.card, styles.intentCard]} onPress={handlePress} activeOpacity={0.7}>
            <View style={styles.cardHeader}>
                <Ionicons
                    name={isActive ? "flash" : hasFailures ? "alert-circle" : "checkmark-circle"}
                    size={16}
                    color={isActive ? theme.colors.success : hasFailures ? theme.colors.warningCritical : theme.colors.textSecondary}
                />
                <TouchableOpacity
                    style={styles.intentTitleArea}
                    onPress={parentSessionId ? handleTitlePress : undefined}
                    activeOpacity={parentSessionId ? 0.5 : 1}
                    disabled={!parentSessionId}
                >
                    <View style={styles.intentBadge}>
                        <Text style={styles.intentBadgeText}>Intent</Text>
                    </View>
                    <Text style={styles.cardTitle} numberOfLines={1}>{chain.parentEvent.title}</Text>
                    {parentSessionId && (
                        <Ionicons name="open-outline" size={11} color={theme.colors.accentBlue} style={{ marginLeft: 2 }} />
                    )}
                </TouchableOpacity>
                <Text style={styles.cardCount}>{chain.completed}/{chain.total}</Text>
                <Ionicons
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={theme.colors.textSecondary}
                />
            </View>

            <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as any }]} />
                {chain.failed > 0 && (
                    <View style={[styles.progressFailed, { width: `${Math.round((chain.failed / chain.total) * 100)}%` as any }]} />
                )}
            </View>

            {!expanded && (
                <View style={styles.steps}>
                    {chain.steps.slice(-8).map((step) => (
                        <StepDot key={step.id} event={step} />
                    ))}
                    {chain.total > 8 && (
                        <Text style={styles.moreText}>+{chain.total - 8}</Text>
                    )}
                </View>
            )}

            {expanded && (
                <View style={styles.taskList}>
                    {chain.steps.map((step, idx) => (
                        <TaskRow key={step.id} event={step} stepIndex={idx + 1} />
                    ))}
                </View>
            )}
        </TouchableOpacity>
    );
});

// ─── ProjectChainCard ─────────────────────────────────────────────────────────

const ChainCard = React.memo(function ChainCard({ chain }: { chain: ProjectChain }) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const [expanded, setExpanded] = React.useState(false);
    const progress = chain.total > 0 ? (chain.completed / chain.total) : 0;
    const hasFailures = chain.failed > 0;
    const isActive = chain.running > 0;

    const handlePress = React.useCallback(() => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((v) => !v);
    }, []);

    return (
        <TouchableOpacity style={styles.card} onPress={handlePress} activeOpacity={0.7}>
            <View style={styles.cardHeader}>
                <Ionicons
                    name={isActive ? "flash" : hasFailures ? "alert-circle" : "checkmark-circle"}
                    size={16}
                    color={isActive ? theme.colors.success : hasFailures ? theme.colors.warningCritical : theme.colors.textSecondary}
                />
                <Text style={styles.cardTitle}>{chain.projectLabel}</Text>
                <Text style={styles.cardCount}>{chain.completed}/{chain.total}</Text>
                <Ionicons
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={theme.colors.textSecondary}
                />
            </View>

            <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as any }]} />
                {chain.failed > 0 && (
                    <View style={[styles.progressFailed, { width: `${Math.round((chain.failed / chain.total) * 100)}%` as any }]} />
                )}
            </View>

            {!expanded && (
                <View style={styles.steps}>
                    {chain.tasks.slice(-8).map((task) => (
                        <StepDot key={task.id} event={task} />
                    ))}
                    {chain.total > 8 && (
                        <Text style={styles.moreText}>+{chain.total - 8}</Text>
                    )}
                </View>
            )}

            {expanded && (
                <View style={styles.taskList}>
                    {chain.tasks.map((task) => (
                        <TaskRow key={task.id} event={task} />
                    ))}
                </View>
            )}
        </TouchableOpacity>
    );
});

// ─── Shared sub-components ────────────────────────────────────────────────────

function StepDot({ event }: { event: WorldEvent }) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const sessionId = event.source.sessionId;
    const status = extractStatus(event.eventType);
    const color = status === "completed"
        ? theme.colors.success
        : status === "failed"
            ? theme.colors.warningCritical
            : status === "running"
                ? theme.colors.accentBlue
                : theme.colors.textSecondary;

    const dot = (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    );

    if (sessionId) {
        return (
            <TouchableOpacity
                onPress={() => router.push(`/(app)/session/${sessionId}`)}
                activeOpacity={0.6}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
                {dot}
            </TouchableOpacity>
        );
    }

    return dot;
}

function TaskRow({ event, stepIndex }: { event: WorldEvent; stepIndex?: number }) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const router = useRouter();
    const status = extractStatus(event.eventType);
    const sessionId = event.source.sessionId;
    const tappable = !!sessionId;
    const statusColor = status === "completed"
        ? theme.colors.success
        : status === "failed"
            ? theme.colors.warningCritical
            : status === "running"
                ? theme.colors.accentBlue
                : theme.colors.textSecondary;

    const time = new Date(event.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const inner = (
        <View style={[styles.taskRow, tappable && styles.taskRowTappable]}>
            {stepIndex !== undefined ? (
                <Text style={[styles.stepIndex, { color: statusColor }]}>{stepIndex}.</Text>
            ) : (
                <View style={[styles.taskDot, { backgroundColor: statusColor }]} />
            )}
            <Text style={styles.taskTitle} numberOfLines={1}>{event.title}</Text>
            <Text style={[styles.taskStatus, { color: statusColor }]}>{status}</Text>
            {tappable && (
                <Ionicons name="chevron-forward" size={12} color={theme.colors.textSecondary} />
            )}
            <Text style={styles.taskTime}>{time}</Text>
        </View>
    );

    if (tappable) {
        return (
            <TouchableOpacity
                onPress={() => router.push(`/(app)/session/${sessionId}`)}
                activeOpacity={0.6}
            >
                {inner}
            </TouchableOpacity>
        );
    }

    return inner;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const useStyles = () => {
    const { theme } = useUnistyles();
    const styles = StyleSheet.create({
        list: {
            padding: 16,
            gap: 12,
        },
        empty: {
            alignItems: "center",
            paddingTop: 80,
            gap: 12,
        },
        emptyText: {
            fontSize: 14,
            color: theme.colors.textSecondary,
        },
        card: {
            backgroundColor: theme.colors.surfaceHigh,
            borderRadius: 12,
            padding: 14,
            gap: 10,
        },
        intentCard: {
            borderLeftWidth: 3,
            borderLeftColor: theme.colors.accentBlue,
        },
        cardHeader: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
        },
        intentTitleArea: {
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
        },
        intentBadge: {
            backgroundColor: theme.colors.accentBlue + "22",
            borderRadius: 4,
            paddingHorizontal: 5,
            paddingVertical: 1,
        },
        intentBadgeText: {
            fontSize: 10,
            color: theme.colors.accentBlue,
            fontWeight: "600",
        },
        cardTitle: {
            flex: 1,
            flexShrink: 1,
            fontSize: 15,
            fontWeight: "600",
            color: theme.colors.text,
        },
        cardCount: {
            fontSize: 13,
            color: theme.colors.textSecondary,
        },
        progressBar: {
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.colors.divider,
            flexDirection: "row",
            overflow: "hidden",
        },
        progressFill: {
            height: 4,
            backgroundColor: theme.colors.success,
        },
        progressFailed: {
            height: 4,
            backgroundColor: theme.colors.warningCritical,
        },
        steps: {
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
        },
        moreText: {
            fontSize: 11,
            color: theme.colors.textSecondary,
        },
        taskList: {
            gap: 6,
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
            paddingTop: 8,
        },
        taskRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 2,
        },
        taskRowTappable: {
            paddingVertical: 4,
        },
        stepIndex: {
            fontSize: 12,
            fontWeight: "600",
            width: 18,
        },
        taskDot: {
            width: 6,
            height: 6,
            borderRadius: 3,
        },
        taskTitle: {
            flex: 1,
            fontSize: 13,
            color: theme.colors.text,
        },
        taskStatus: {
            fontSize: 11,
            color: theme.colors.textSecondary,
        },
        taskTime: {
            fontSize: 11,
            color: theme.colors.textSecondary,
            width: 42,
            textAlign: "right",
        },
    });
    return { styles };
};
