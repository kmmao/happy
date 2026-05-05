import * as React from "react";
import { View, ScrollView, RefreshControl, TouchableOpacity, LayoutAnimation } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { t } from "@/text";
import type { WorldEvent } from "./worldTypes";

interface WorldChainModeProps {
    events: WorldEvent[];
    loading: boolean;
    onRefresh: () => void;
}

interface TaskChain {
    projectLabel: string;
    projectId: string | null;
    tasks: WorldEvent[];
    running: number;
    completed: number;
    failed: number;
    total: number;
}

function groupIntoChains(events: WorldEvent[]): TaskChain[] {
    const taskEvents = events.filter((e) => e.eventType.startsWith("task."));

    const byProject = new Map<string, WorldEvent[]>();
    for (const event of taskEvents) {
        const key = event.source.projectPath
            ?? event.source.projectId
            ?? "_no_project";
        const list = byProject.get(key) ?? [];
        list.push(event);
        byProject.set(key, list);
    }

    const chains: TaskChain[] = [];
    for (const [key, tasks] of byProject) {
        const label = key === "_no_project"
            ? "Unassigned"
            : key.split("/").filter(Boolean).pop() ?? key;
        chains.push({
            projectLabel: label,
            projectId: tasks[0]?.source.projectId ?? null,
            tasks: tasks.sort((a, b) => a.occurredAt - b.occurredAt),
            running: tasks.filter((ti) => ti.eventType === "task.running").length,
            completed: tasks.filter((ti) => ti.eventType === "task.completed").length,
            failed: tasks.filter((ti) => ti.eventType === "task.failed").length,
            total: tasks.length,
        });
    }

    return chains.sort((a, b) => b.running - a.running || b.total - a.total);
}

export const WorldChainMode = React.memo(function WorldChainMode({
    events,
    loading,
    onRefresh,
}: WorldChainModeProps) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const chains = React.useMemo(() => groupIntoChains(events), [events]);

    if (chains.length === 0 && !loading) {
        return (
            <ScrollView
                contentContainerStyle={styles.empty}
                refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
            >
                <Ionicons name="git-branch-outline" size={40} color={theme.colors.textSecondary} />
                <Text style={styles.emptyText}>{t("world.noEvents")}</Text>
            </ScrollView>
        );
    }

    return (
        <ScrollView
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
        >
            {chains.map((chain) => (
                <ChainCard key={chain.projectLabel} chain={chain} />
            ))}
        </ScrollView>
    );
});

const ChainCard = React.memo(function ChainCard({ chain }: { chain: TaskChain }) {
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

            {/* Progress bar */}
            <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as any }]} />
                {chain.failed > 0 && (
                    <View style={[styles.progressFailed, { width: `${Math.round((chain.failed / chain.total) * 100)}%` as any }]} />
                )}
            </View>

            {/* Collapsed: step dots */}
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

            {/* Expanded: task detail list */}
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

function StepDot({ event }: { event: WorldEvent }) {
    const { theme } = useUnistyles();
    const color = event.eventType === "task.completed"
        ? theme.colors.success
        : event.eventType === "task.failed"
            ? theme.colors.warningCritical
            : event.eventType === "task.running"
                ? theme.colors.accentBlue
                : theme.colors.textSecondary;

    return (
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    );
}

function TaskRow({ event }: { event: WorldEvent }) {
    const { theme } = useUnistyles();
    const { styles } = useStyles();
    const status = event.eventType.replace("task.", "");
    const statusColor = status === "completed"
        ? theme.colors.success
        : status === "failed"
            ? theme.colors.warningCritical
            : status === "running"
                ? theme.colors.accentBlue
                : theme.colors.textSecondary;

    const time = new Date(event.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    return (
        <View style={styles.taskRow}>
            <View style={[styles.taskDot, { backgroundColor: statusColor }]} />
            <Text style={styles.taskTitle} numberOfLines={1}>{event.title}</Text>
            <Text style={styles.taskStatus}>{status}</Text>
            <Text style={styles.taskTime}>{time}</Text>
        </View>
    );
}

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
        cardHeader: {
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
        },
        cardTitle: {
            flex: 1,
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
