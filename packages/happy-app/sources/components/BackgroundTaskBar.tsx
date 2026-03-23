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
    extractPort,
} from "@/utils/commandAnalysis";

type Props = {
    readonly tasks: readonly BackgroundTask[];
    readonly onViewLog: (task: BackgroundTask) => void;
    readonly onClose: (task: BackgroundTask) => void;
    readonly onPreview?: (url: string) => void;
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

function statusInfo(
    status: BackgroundTask["status"],
    colors: { success: string; accentBlue: string; deleteAction: string },
): { color: string; label: string } {
    switch (status) {
        case "running":
            return { color: colors.success, label: t("backgroundTasks.running") };
        case "completed":
            return { color: colors.accentBlue, label: t("backgroundTasks.completed") };
        case "failed":
            return { color: colors.deleteAction, label: t("backgroundTasks.failed") };
    }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function TaskItem({
    task,
    onPress,
    onClose,
    onPreview,
}: {
    readonly task: BackgroundTask;
    readonly onPress: () => void;
    readonly onClose: () => void;
    readonly onPreview?: () => void;
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
    const status = statusInfo(task.status, theme.colors);

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [styles.taskItem, { backgroundColor: `${iconColor}15`, opacity: pressed ? 0.7 : 1 }]}
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
            {onPreview && (
                <Pressable
                    onPress={(e) => {
                        e.stopPropagation();
                        onPreview();
                    }}
                    hitSlop={8}
                    style={({ pressed }) => [styles.previewButton, pressed && { opacity: 0.7 }]}
                >
                    <Ionicons name="eye-outline" size={14} color={theme.colors.textLink} />
                </Pressable>
            )}
            <Pressable
                onPress={(e) => {
                    e.stopPropagation();
                    onClose();
                }}
                hitSlop={8}
                style={({ pressed }) => [styles.dismissButton, pressed && { opacity: 0.7 }]}
            >
                <Ionicons name="close" size={12} color={theme.colors.textSecondary} />
            </Pressable>
        </Pressable>
    );
}

function BackgroundTaskBarInner({ tasks, onViewLog, onClose, onPreview }: Props) {
    if (tasks.length === 0) return null;

    return (
        <View style={styles.container}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
            >
                {tasks.map((task) => {
                    const port = extractPort(task.command);
                    const isServer = detectCategory(task.command) === "server";
                    return (
                        <TaskItem
                            key={task.taskId}
                            task={task}
                            onPress={() => onViewLog(task)}
                            onClose={() => onClose(task)}
                            onPreview={
                                onPreview && isServer && port && task.status === "running"
                                    ? () => onPreview(`http://localhost:${port}`)
                                    : undefined
                            }
                        />
                    );
                })}
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
    previewButton: {
        marginLeft: 2,
        padding: 2,
    },
    dismissButton: {
        marginLeft: 2,
        padding: 2,
    },
}));
