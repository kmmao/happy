/**
 * Floating bar above the input area showing active tasks.
 *
 * Shows two kinds of tasks:
 * 1. Background tasks (run_in_background) — with log polling, preview, and close button
 * 2. Foreground commands (regular Bash, running state only) — lightweight display
 *
 * Each task shows a type icon, tool tag, smart label (with port if detected),
 * elapsed time, and optionally the latest log line.
 * Horizontally scrollable when multiple tasks exist.
 */

import * as React from "react";
import { Animated, Pressable, ScrollView, View, Text, useWindowDimensions } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { layout } from "@/components/layout";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { BackgroundTask } from "@/hooks/useBackgroundTasks";
import { useBackgroundTaskLastLine } from "@/hooks/useBackgroundTaskLastLine";
import {
    detectCategory,
    categoryIcon,
    categoryColor,
    buildSmartLabel,
    extractPort,
    detectToolTag,
} from "@/utils/commandAnalysis";

type Props = {
    readonly sessionId: string;
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
// Marquee text — scrolls horizontally when text overflows container
// ---------------------------------------------------------------------------

function MarqueeText({
    text,
    style,
    maxWidth,
}: {
    readonly text: string;
    readonly style: any;
    readonly maxWidth: number;
}) {
    const translateX = React.useRef(new Animated.Value(0)).current;
    const [textWidth, setTextWidth] = React.useState(0);

    const overflow = textWidth - maxWidth;
    const shouldScroll = overflow > 0 && maxWidth > 0;

    React.useEffect(() => {
        translateX.setValue(0);
        if (!shouldScroll) return;
        const duration = Math.max(3000, overflow * 20);
        const anim = Animated.loop(
            Animated.sequence([
                Animated.delay(1500),
                Animated.timing(translateX, { toValue: -overflow, duration, useNativeDriver: true }),
                Animated.delay(1500),
                Animated.timing(translateX, { toValue: 0, duration, useNativeDriver: true }),
            ]),
        );
        anim.start();
        return () => anim.stop();
    }, [shouldScroll, overflow, translateX]);

    if (maxWidth <= 0) return null;

    return (
        <View style={[styles.marqueeContainer, { width: maxWidth }]}>
            <Animated.Text
                style={[style, { transform: [{ translateX }] }]}
                numberOfLines={1}
                onTextLayout={(e) => {
                    const w = e.nativeEvent.lines[0]?.width ?? 0;
                    if (w > 0 && w !== textWidth) setTextWidth(w);
                }}
            >
                {text}
            </Animated.Text>
        </View>
    );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function TaskItem({
    sessionId,
    task,
    onPress,
    onClose,
    onPreview,
}: {
    readonly sessionId: string;
    readonly task: BackgroundTask;
    readonly onPress?: () => void;
    readonly onClose?: () => void;
    readonly onPreview?: () => void;
}) {
    const { theme } = useUnistyles();
    const [elapsed, setElapsed] = React.useState(() => formatElapsed(task.startedAt));
    const [topRowWidth, setTopRowWidth] = React.useState(0);

    // Only poll logs for background tasks that have an output file
    const lastLine = useBackgroundTaskLastLine(
        sessionId,
        task.outputFile,
        task.isBackground && task.status === "running",
    );

    React.useEffect(() => {
        if (task.status !== "running") return;
        const interval = setInterval(() => {
            setElapsed(formatElapsed(task.startedAt));
        }, 1000);
        return () => clearInterval(interval);
    }, [task.startedAt, task.status]);

    const category = detectCategory(task.command);
    const toolTag = detectToolTag(task.command);
    const label = task.description !== task.command ? task.description : buildSmartLabel(task.command);
    const icon = categoryIcon[category];
    const iconColor = categoryColor[category];
    const status = statusInfo(task.status, theme.colors);

    return (
        <Pressable
            onPress={onPress}
            disabled={!onPress}
            style={({ pressed }) => [
                styles.taskItem,
                { backgroundColor: `${iconColor}15`, opacity: pressed && onPress ? 0.7 : 1 },
            ]}
        >
            <View
                style={styles.taskTopRow}
                onLayout={(e) => setTopRowWidth(e.nativeEvent.layout.width)}
            >
                <Ionicons name={icon} size={14} color={iconColor} />
                <View style={[styles.toolTagBadge, { backgroundColor: `${iconColor}20` }]}>
                    <Text style={[styles.toolTagText, { color: iconColor }]}>
                        {toolTag}
                    </Text>
                </View>
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
                {onClose && (
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
                )}
            </View>
            {lastLine.length > 0 && topRowWidth > 0 && (
                <MarqueeText
                    text={lastLine}
                    style={[styles.logLine, { color: theme.colors.textSecondary }]}
                    maxWidth={topRowWidth}
                />
            )}
        </Pressable>
    );
}

function BackgroundTaskBarInner({ sessionId, tasks, onViewLog, onClose, onPreview }: Props) {
    const { width: windowWidth } = useWindowDimensions();
    const containerWidth = Math.min(windowWidth, layout.maxWidth);

    if (tasks.length === 0) return null;

    return (
        <View style={[styles.container, { maxWidth: containerWidth, alignSelf: "center", width: "100%" }]}>
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
                            sessionId={sessionId}
                            task={task}
                            // Foreground commands: no log sheet, no close button
                            onPress={task.isBackground ? () => onViewLog(task) : undefined}
                            onClose={task.isBackground ? () => onClose(task) : undefined}
                            onPreview={
                                onPreview && task.isBackground && isServer && port && task.status === "running"
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
        alignItems: "flex-start",
    },
    taskItem: {
        gap: 4,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 12,
    },
    taskTopRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexWrap: "nowrap",
    },
    toolTagBadge: {
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 4,
    },
    toolTagText: {
        fontSize: 10,
        fontWeight: "700",
    },
    statusLabel: {
        fontSize: 11,
        fontWeight: "600",
    },
    taskLabel: {
        fontSize: 13,
        fontWeight: "500",
        flexShrink: 1,
    },
    taskElapsed: {
        fontSize: 11,
        opacity: 0.6,
    },
    marqueeContainer: {
        overflow: "hidden",
        alignSelf: "stretch",
    },
    logLine: {
        fontSize: 11,
        fontFamily: "monospace",
        opacity: 0.7,
        paddingLeft: 20,
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
