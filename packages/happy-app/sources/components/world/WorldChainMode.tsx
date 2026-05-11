import * as React from "react";
import { View, ScrollView, RefreshControl, TouchableOpacity, LayoutAnimation } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from "react-native-draggable-flatlist";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import type { WorldEvent } from "./worldTypes";
import {
    type Chain,
    type IntentChain,
    type ProjectChain,
    extractStatus,
    groupIntoChains,
    isBlocked,
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

    // Ordered chains: synced from computed chains, user drag changes local order
    const [orderedChains, setOrderedChains] = React.useState<Chain[]>(chains);
    React.useEffect(() => { setOrderedChains(chains); }, [chains]);

    const keyExtractor = React.useCallback(
        (chain: Chain) => chain.kind === "intent" ? chain.parentEvent.id : `project-${chain.projectLabel}`,
        [],
    );

    const renderItem = React.useCallback(({ item: chain, drag, isActive }: RenderItemParams<Chain>) => (
        <ScaleDecorator activeScale={0.97}>
            {chain.kind === "intent"
                ? <IntentCard chain={chain} drag={drag} isActive={isActive} />
                : <ChainCard chain={chain} drag={drag} isActive={isActive} />
            }
        </ScaleDecorator>
    ), []);

    if (chains.length === 0 && !loading) {
        const isFiltered = !!searchQuery.trim();
        return (
            <ScrollView
                style={styles.flex1}
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
        <DraggableFlatList
            style={styles.flex1}
            data={orderedChains}
            onDragEnd={({ data }) => setOrderedChains(data)}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
            activationDistance={12}
        />
    );
});

// ─── IntentCard ───────────────────────────────────────────────────────────────

const IntentCard = React.memo(function IntentCard({
    chain,
    drag,
    isActive: isDragging,
}: {
    chain: IntentChain;
    drag: () => void;
    isActive: boolean;
}) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const router = useRouter();
    const [expanded, setExpanded] = React.useState(false);
    const [localSteps, setLocalSteps] = React.useState<WorldEvent[]>(chain.steps);

    React.useEffect(() => { setLocalSteps(chain.steps); }, [chain.steps]);

    const moveStep = React.useCallback((idx: number, dir: -1 | 1) => {
        const swap = idx + dir;
        if (swap < 0 || swap >= localSteps.length) return;
        const next = [...localSteps];
        [next[idx], next[swap]] = [next[swap], next[idx]];
        setLocalSteps(next);
    }, [localSteps]);

    const progress = chain.total > 0 ? chain.completed / chain.total : 0;
    const pct = Math.round(progress * 100);
    const hasFailures = chain.failed > 0;
    const hasBlocked = chain.blocked > 0;
    const isActive = chain.running > 0;
    const parentSessionId = chain.parentEvent.source.sessionId;

    const handlePress = React.useCallback(() => {
        if (isDragging) return;
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded((v) => !v);
    }, [isDragging]);

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
                {/* Drag handle — long press to start dragging the whole card */}
                <TouchableOpacity onLongPress={drag} hitSlop={8} style={styles.dragHandle} activeOpacity={0.6}>
                    <Ionicons name="reorder-three" size={18} color={theme.colors.textSecondary} />
                </TouchableOpacity>
            </View>

            {/* Progress bar + percentage */}
            <View style={styles.progressRow}>
                <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
                    {chain.failed > 0 && (
                        <View style={[styles.progressFailed, { width: `${Math.round((chain.failed / chain.total) * 100)}%` as any }]} />
                    )}
                </View>
                <Text style={[styles.progressPct, hasFailures && { color: theme.colors.warningCritical }]}>
                    {pct}%
                </Text>
            </View>

            {/* Status chips */}
            {(isActive || hasFailures || hasBlocked) && (
                <View style={styles.chipRow}>
                    {isActive && (
                        <View style={[styles.chip, { backgroundColor: theme.colors.success + "22" }]}>
                            <Ionicons name="flash" size={10} color={theme.colors.success} />
                            <Text style={[styles.chipText, { color: theme.colors.success }]}>{chain.running}</Text>
                        </View>
                    )}
                    {hasBlocked && (
                        <View style={[styles.chip, { backgroundColor: theme.colors.warning + "22" }]}>
                            <Ionicons name="pause-circle" size={10} color={theme.colors.warning} />
                            <Text style={[styles.chipText, { color: theme.colors.warning }]}>{chain.blocked} blocked</Text>
                        </View>
                    )}
                    {hasFailures && (
                        <View style={[styles.chip, { backgroundColor: theme.colors.warningCritical + "22" }]}>
                            <Ionicons name="alert-circle" size={10} color={theme.colors.warningCritical} />
                            <Text style={[styles.chipText, { color: theme.colors.warningCritical }]}>{chain.failed} failed</Text>
                        </View>
                    )}
                </View>
            )}

            {!expanded && (
                <View style={styles.miniList}>
                    {chain.steps.slice(-4).map((step) => (
                        <MiniStepRow key={step.id} event={step} />
                    ))}
                    {chain.total > 4 && (
                        <Text style={styles.moreText}>+{chain.total - 4} more</Text>
                    )}
                </View>
            )}

            {expanded && (
                <View style={styles.taskList}>
                    {localSteps.map((step, idx) => (
                        <TaskRow
                            key={step.id}
                            event={step}
                            stepIndex={idx + 1}
                            priorEvents={localSteps.slice(0, idx)}
                            isLast={idx === localSteps.length - 1}
                            onMoveUp={idx > 0 ? () => moveStep(idx, -1) : undefined}
                            onMoveDown={idx < localSteps.length - 1 ? () => moveStep(idx, 1) : undefined}
                        />
                    ))}
                </View>
            )}
        </TouchableOpacity>
    );
});

// ─── ProjectChainCard ─────────────────────────────────────────────────────────

const ChainCard = React.memo(function ChainCard({
    chain,
    drag,
    isActive: _isDragging,
}: {
    chain: ProjectChain;
    drag: () => void;
    isActive: boolean;
}) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const [expanded, setExpanded] = React.useState(false);
    const [localTasks, setLocalTasks] = React.useState<WorldEvent[]>(chain.tasks);

    React.useEffect(() => { setLocalTasks(chain.tasks); }, [chain.tasks]);

    const moveTask = React.useCallback((idx: number, dir: -1 | 1) => {
        const swap = idx + dir;
        if (swap < 0 || swap >= localTasks.length) return;
        const next = [...localTasks];
        [next[idx], next[swap]] = [next[swap], next[idx]];
        setLocalTasks(next);
    }, [localTasks]);

    const progress = chain.total > 0 ? (chain.completed / chain.total) : 0;
    const pct = Math.round(progress * 100);
    const hasFailures = chain.failed > 0;
    const hasBlocked = chain.blocked > 0;
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
                <TouchableOpacity onLongPress={drag} hitSlop={8} style={styles.dragHandle} activeOpacity={0.6}>
                    <Ionicons name="reorder-three" size={18} color={theme.colors.textSecondary} />
                </TouchableOpacity>
            </View>

            <View style={styles.progressRow}>
                <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
                    {chain.failed > 0 && (
                        <View style={[styles.progressFailed, { width: `${Math.round((chain.failed / chain.total) * 100)}%` as any }]} />
                    )}
                </View>
                <Text style={[styles.progressPct, hasFailures && { color: theme.colors.warningCritical }]}>
                    {pct}%
                </Text>
            </View>

            {(isActive || hasFailures || hasBlocked) && (
                <View style={styles.chipRow}>
                    {isActive && (
                        <View style={[styles.chip, { backgroundColor: theme.colors.success + "22" }]}>
                            <Ionicons name="flash" size={10} color={theme.colors.success} />
                            <Text style={[styles.chipText, { color: theme.colors.success }]}>{chain.running}</Text>
                        </View>
                    )}
                    {hasBlocked && (
                        <View style={[styles.chip, { backgroundColor: theme.colors.warning + "22" }]}>
                            <Ionicons name="pause-circle" size={10} color={theme.colors.warning} />
                            <Text style={[styles.chipText, { color: theme.colors.warning }]}>{chain.blocked} blocked</Text>
                        </View>
                    )}
                    {hasFailures && (
                        <View style={[styles.chip, { backgroundColor: theme.colors.warningCritical + "22" }]}>
                            <Ionicons name="alert-circle" size={10} color={theme.colors.warningCritical} />
                            <Text style={[styles.chipText, { color: theme.colors.warningCritical }]}>{chain.failed} failed</Text>
                        </View>
                    )}
                </View>
            )}

            {!expanded && (
                <View style={styles.miniList}>
                    {chain.tasks.slice(-4).map((task) => (
                        <MiniStepRow key={task.id} event={task} />
                    ))}
                    {chain.total > 4 && (
                        <Text style={styles.moreText}>+{chain.total - 4} more</Text>
                    )}
                </View>
            )}

            {expanded && (
                <View style={styles.taskList}>
                    {localTasks.map((task, idx) => (
                        <TaskRow
                            key={task.id}
                            event={task}
                            priorEvents={localTasks.slice(0, idx)}
                            isLast={idx === localTasks.length - 1}
                            onMoveUp={idx > 0 ? () => moveTask(idx, -1) : undefined}
                            onMoveDown={idx < localTasks.length - 1 ? () => moveTask(idx, 1) : undefined}
                        />
                    ))}
                </View>
            )}
        </TouchableOpacity>
    );
});

// ─── Shared sub-components ────────────────────────────────────────────────────

function MiniStepRow({ event }: { event: WorldEvent }) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const status = extractStatus(event.eventType);
    const sessionId = event.source.sessionId;

    const color = status === "completed"
        ? theme.colors.success
        : status === "failed"
            ? theme.colors.warningCritical
            : status === "running"
                ? theme.colors.accentBlue
                : theme.colors.textSecondary;

    const icon: keyof typeof Ionicons.glyphMap =
        status === "completed" ? "checkmark-circle" :
        status === "failed" ? "close-circle" :
        status === "running" ? "flash" : "radio-button-off";

    const inner = (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 }}>
            <Ionicons name={icon} size={13} color={color} />
            <Text
                numberOfLines={1}
                style={{ flex: 1, fontSize: 12, color: theme.colors.text }}
            >
                {event.title}
            </Text>
        </View>
    );

    if (sessionId) {
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


function formatDuration(ms: number): string {
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    return `${Math.floor(ms / 3_600_000)}h`;
}

function TaskRow({
    event,
    stepIndex,
    priorEvents = [],
    isLast = true,
    onMoveUp,
    onMoveDown,
}: {
    event: WorldEvent;
    stepIndex?: number;
    priorEvents?: WorldEvent[];
    isLast?: boolean;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
}) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const router = useRouter();
    const now = Date.now();
    const status = extractStatus(event.eventType);
    const blocked = isBlocked(event, priorEvents);
    const sessionId = event.source.sessionId;
    const tappable = !!sessionId;
    const reorderable = !!(onMoveUp || onMoveDown);

    const statusColor = blocked
        ? theme.colors.warning
        : status === "completed"
            ? theme.colors.success
            : status === "failed"
                ? theme.colors.warningCritical
                : status === "running"
                    ? theme.colors.accentBlue
                    : theme.colors.textSecondary;

    const displayStatus = blocked ? "blocked" : status;

    const duration = status === "running"
        ? formatDuration(now - event.occurredAt)
        : new Date(event.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const inner = (
        <View style={styles.taskRowOuter}>
            {/* Dependency connector line */}
            <View style={styles.connectorCol}>
                <View style={[styles.connectorLine, { backgroundColor: theme.colors.divider }]} />
                {isLast && <View style={styles.connectorCapSpacer} />}
            </View>

            <View style={[
                styles.taskRow,
                tappable && styles.taskRowTappable,
                blocked && { backgroundColor: theme.colors.warning + "15", borderRadius: 6 },
            ]}>
                {stepIndex !== undefined ? (
                    <Text style={[styles.stepIndex, { color: statusColor }]}>{stepIndex}.</Text>
                ) : (
                    <View style={[styles.taskDot, { backgroundColor: statusColor }]} />
                )}
                <Text style={styles.taskTitle} numberOfLines={1}>{event.title}</Text>
                {blocked && <Ionicons name="pause-circle" size={11} color={theme.colors.warning} />}
                <Text style={[styles.taskStatus, { color: statusColor }]}>{displayStatus}</Text>
                {tappable && (
                    <Ionicons name="chevron-forward" size={12} color={theme.colors.textSecondary} />
                )}
                <Text style={[styles.taskTime, status === "running" && { color: theme.colors.accentBlue }]}>
                    {duration}
                </Text>
                {/* ↑↓ reorder buttons — shown when parent provides handlers */}
                {reorderable && (
                    <View style={styles.reorderBtns}>
                        <TouchableOpacity
                            onPress={onMoveUp}
                            disabled={!onMoveUp}
                            hitSlop={6}
                            activeOpacity={0.5}
                        >
                            <Ionicons
                                name="chevron-up"
                                size={14}
                                color={onMoveUp ? theme.colors.textLink : theme.colors.divider}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={onMoveDown}
                            disabled={!onMoveDown}
                            hitSlop={6}
                            activeOpacity={0.5}
                        >
                            <Ionicons
                                name="chevron-down"
                                size={14}
                                color={onMoveDown ? theme.colors.textLink : theme.colors.divider}
                            />
                        </TouchableOpacity>
                    </View>
                )}
            </View>
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
        flex1: {
            flex: 1,
        },
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
            backgroundColor: theme.colors.accentBlue,
            borderRadius: 4,
            paddingHorizontal: 5,
            paddingVertical: 2,
        },
        intentBadgeText: {
            fontSize: 10,
            color: "#fff",
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
        progressRow: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
        },
        progressBar: {
            flex: 1,
            height: 5,
            borderRadius: 3,
            backgroundColor: theme.colors.divider,
            flexDirection: "row",
            overflow: "hidden",
        },
        progressPct: {
            fontSize: 12,
            fontWeight: "600",
            color: theme.colors.textSecondary,
            width: 34,
            textAlign: "right",
        },
        progressFill: {
            height: 5,
            backgroundColor: "#3B82F6",
        },
        progressFailed: {
            height: 5,
            backgroundColor: theme.colors.warningCritical,
        },
        chipRow: {
            flexDirection: "row",
            gap: 6,
        },
        chip: {
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 7,
            paddingVertical: 3,
            borderRadius: 10,
        },
        chipText: {
            fontSize: 11,
            fontWeight: "500",
        },
        miniList: {
            gap: 2,
            paddingTop: 2,
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
            paddingTop: 2,
        },
        taskList: {
            gap: 0,
            borderTopWidth: 1,
            borderTopColor: theme.colors.divider,
            paddingTop: 8,
        },
        taskRowOuter: {
            flexDirection: "row",
            alignItems: "stretch",
        },
        connectorCol: {
            width: 14,
            alignItems: "center",
        },
        connectorLine: {
            flex: 1,
            width: 2,
            borderRadius: 1,
            marginTop: 6,
            marginBottom: 0,
        },
        connectorCapSpacer: {
            height: 6,
        },
        taskRow: {
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 5,
            paddingHorizontal: 4,
        },
        taskRowTappable: {
            paddingVertical: 6,
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
        dragHandle: {
            paddingLeft: 8,
            paddingVertical: 2,
        },
        reorderBtns: {
            flexDirection: "column",
            gap: 1,
            marginLeft: 2,
        },
    });
    return { styles };
};
