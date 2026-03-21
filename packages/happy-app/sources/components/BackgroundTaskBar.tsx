/**
 * Floating bar above the input area showing active background tasks.
 *
 * Each task shows a type icon, smart label (with port if detected),
 * elapsed time, and a tap target to open the log sheet.
 * Horizontally scrollable when multiple tasks exist.
 * Non-running tasks show a dismiss button. Long press running tasks to stop.
 */

import * as React from "react";
import { Pressable, ScrollView, View, Text } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { BackgroundTask } from "@/hooks/useBackgroundTasks";
import {
    detectCategory,
    categoryIcon,
    categoryColor,
    buildSmartLabel,
} from "@/utils/commandAnalysis";

type Props = {
    readonly tasks: readonly BackgroundTask[];
    readonly onViewLog: (task: BackgroundTask) => void;
    readonly onStopTask?: (task: BackgroundTask) => void;
    readonly onDismiss?: (taskId: string) => void;
};

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

function formatElapsed(startedAt: number): string {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m${remainingSeconds > 0 ? ` ${remainingSeconds}s` : ""}`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function statusInfo(status: BackgroundTask["status"]): { color: string; label: string } {
    switch (status) {
        case "running":
            return { color: "#4CAF50", label: t("backgroundTasks.running") };
        case "completed":
            return { color: "#2196F3", label: t("backgroundTasks.completed") };
        case "failed":
            return { color: "#F44336", label: t("backgroundTasks.failed") };
    }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function TaskItem({
    task,
    onPress,
    onLongPress,
    onDismiss,
}: {
    readonly task: BackgroundTask;
    readonly onPress: () => void;
    readonly onLongPress?: () => void;
    readonly onDismiss?: () => void;
}) {
    const { theme } = useUnistyles();
    const [elapsed, setElapsed] = React.useState(() => formatElapsed(task.startedAt));

    React.useEffect(() => {
        if (task.status !== "running") return;
        const interval = setInterval(() => {
            setElapsed(formatElapsed(task.startedAt));
        }, 1000);
        return () => clearInterval(interval);
    }, [task.startedAt, task.status]);

    const category = detectCategory(task.command);
    const label = buildSmartLabel(task.command);
    const icon = categoryIcon[category];
    const iconColor = categoryColor[category];
    const showDismiss = task.status !== "running" && onDismiss;
    const status = statusInfo(task.status);

    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={500}
            style={[styles.taskItem, { backgroundColor: `${iconColor}15` }]}
        >
            <Ionicons name={icon} size={14} color={iconColor} />
            <Text
                style={[styles.taskLabel, { color: theme.colors.text }]}
                numberOfLines={1}
            >
                {label}
            </Text>
            <Text style={[styles.statusLabel, { color: status.color }]}>
                {status.label}
            </Text>
            <Text style={[styles.taskElapsed, { color: theme.colors.textSecondary }]}>
                {elapsed}
            </Text>
            {showDismiss && (
                <Pressable
                    onPress={(e) => {
                        e.stopPropagation();
                        onDismiss();
                    }}
                    hitSlop={8}
                    style={styles.dismissButton}
                >
                    <Ionicons name="close" size={12} color={theme.colors.textSecondary} />
                </Pressable>
            )}
        </Pressable>
    );
}

function BackgroundTaskBarInner({ tasks, onViewLog, onStopTask, onDismiss }: Props) {
    if (tasks.length === 0) return null;

    return (
        <View style={styles.container}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
            >
                {tasks.map((task) => (
                    <TaskItem
                        key={task.taskId}
                        task={task}
                        onPress={() => onViewLog(task)}
                        onLongPress={
                            onStopTask && task.status === "running"
                                ? () => onStopTask(task)
                                : undefined
                        }
                        onDismiss={
                            onDismiss
                                ? () => onDismiss(task.taskId)
                                : undefined
                        }
                    />
                ))}
            </ScrollView>
        </View>
    );
}

export const BackgroundTaskBar = React.memo(BackgroundTaskBarInner);

const styles = StyleSheet.create(() => ({
    container: {
        paddingVertical: 6,
        paddingHorizontal: 12,
    },
    scrollContent: {
        gap: 8,
        alignItems: "center",
    },
    taskItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: 16,
    },
    statusLabel: {
        fontSize: 11,
        fontWeight: "600",
    },
    taskLabel: {
        fontSize: 13,
        fontWeight: "500",
        maxWidth: 200,
    },
    taskElapsed: {
        fontSize: 11,
        opacity: 0.6,
    },
    dismissButton: {
        marginLeft: 2,
        padding: 2,
    },
}));
