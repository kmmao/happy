/**
 * Bottom sheet showing real-time logs from a task.
 *
 * - Background tasks (with outputFile): polls the output file every 3s via useBackgroundTaskLog.
 * - Foreground tasks (no outputFile): monitors the running process via useForegroundTaskLog,
 *   showing PID, CPU, memory, elapsed time, and Docker-specific info when applicable.
 *
 * Auto-scrolls to bottom on new content. Monospace font for log output.
 */

import * as React from "react";
import {
    View,
    Text,
    ScrollView,
    Pressable,
    Modal,
    SafeAreaView,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { t } from "@/text";
import { useBackgroundTaskLog } from "@/hooks/useBackgroundTaskLog";
import { useForegroundTaskLog } from "@/hooks/useForegroundTaskLog";
import { BackgroundTask } from "@/hooks/useBackgroundTasks";
import {
    buildSmartLabel,
    detectCategory,
    categoryIcon,
    categoryColor,
    extractPort,
} from "@/utils/commandAnalysis";

type Props = {
    readonly sessionId: string;
    readonly task: BackgroundTask | null;
    readonly onClose: () => void;
    readonly onStop?: (task: BackgroundTask) => void;
    readonly onPreview?: (url: string) => void;
};

function statusColor(status: BackgroundTask["status"]): string {
    switch (status) {
        case "running":
            return "#4CAF50";
        case "completed":
            return "#2196F3";
        case "failed":
            return "#F44336";
        case "stopped":
            return "#FF9800";
    }
}

function BackgroundTaskLogSheetInner({ sessionId, task, onClose, onStop, onPreview }: Props) {
    const { theme } = useUnistyles();
    const scrollRef = React.useRef<ScrollView>(null);

    const isForeground = task !== null && !task.outputFile;

    // Background task log (real-time streaming with poll fallback)
    const bgLog = useBackgroundTaskLog(
        sessionId,
        task?.outputFile ?? null,
        task !== null && !isForeground,
        task?.taskId,
    );

    // Foreground task monitor (polls process status via ps/grep)
    const fgLog = useForegroundTaskLog(
        sessionId,
        isForeground ? task.command : null,
        isForeground,
    );

    // Unified log/loading/refresh from whichever source is active
    const log = isForeground ? fgLog.log : bgLog.log;
    const isLoading = isForeground ? fgLog.isLoading : bgLog.isLoading;
    const refresh = isForeground ? fgLog.refresh : bgLog.refresh;

    // Auto-scroll to bottom when log updates
    React.useEffect(() => {
        if (log) {
            setTimeout(() => {
                scrollRef.current?.scrollToEnd({ animated: false });
            }, 50);
        }
    }, [log]);

    if (!task) return null;

    const label = task.description && task.description !== task.command
        ? task.description
        : buildSmartLabel(task.command);
    const category = detectCategory(task.command);
    const icon = categoryIcon[category];
    const iconTint = categoryColor[category];
    const port = extractPort(task.command);
    const stColor = statusColor(task.status);

    const statusLabel =
        task.status === "running"
            ? t("backgroundTasks.running")
            : task.status === "completed"
              ? t("backgroundTasks.completed")
              : task.status === "stopped"
                ? t("backgroundTasks.stopped")
                : t("backgroundTasks.failed");

    return (
        <Modal
            visible
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <SafeAreaView
                style={[
                    styles.container,
                    { backgroundColor: theme.colors.surface },
                ]}
            >
                {/* Header */}
                <View
                    style={[
                        styles.header,
                        { borderBottomColor: theme.colors.divider },
                    ]}
                >
                    <View style={styles.headerLeft}>
                        <View style={styles.titleRow}>
                            <Ionicons name={icon} size={18} color={iconTint} />
                            <Text
                                style={[styles.title, { color: theme.colors.text }]}
                                numberOfLines={1}
                            >
                                {label}
                            </Text>
                            {port && (
                                <View style={[styles.portBadge, { backgroundColor: `${iconTint}20` }]}>
                                    <Text style={[styles.portText, { color: iconTint }]}>
                                        :{port}
                                    </Text>
                                </View>
                            )}
                        </View>
                        <View style={styles.subtitleRow}>
                            <View style={[styles.statusDot, { backgroundColor: stColor }]} />
                            <Text
                                style={[styles.subtitle, { color: theme.colors.textSecondary }]}
                            >
                                {statusLabel}
                                {isForeground ? ` · ${t("backgroundTasks.foregroundHint")}` : ""}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.headerActions}>
                        {onPreview && category === "server" && port && task.status === "running" && (
                            <Pressable
                                onPress={() => {
                                    onClose();
                                    onPreview(`http://localhost:${port}`);
                                }}
                                hitSlop={10}
                            >
                                <Ionicons
                                    name="eye-outline"
                                    size={20}
                                    color={theme.colors.textLink}
                                />
                            </Pressable>
                        )}
                        {task.status === "running" && onStop && (
                            <Pressable onPress={() => onStop(task)} hitSlop={10}>
                                <Ionicons
                                    name="stop-circle-outline"
                                    size={22}
                                    color="#F44336"
                                />
                            </Pressable>
                        )}
                        <Pressable onPress={refresh} hitSlop={10}>
                            <Ionicons
                                name="refresh"
                                size={20}
                                color={theme.colors.textSecondary}
                            />
                        </Pressable>
                        <Pressable onPress={onClose} hitSlop={10}>
                            <Ionicons
                                name="close"
                                size={22}
                                color={theme.colors.textSecondary}
                            />
                        </Pressable>
                    </View>
                </View>

                {/* Command line */}
                <View style={[styles.commandBar, { backgroundColor: theme.colors.surfaceHigh }]}>
                    <Text
                        style={[styles.commandText, { color: theme.colors.textSecondary }]}
                        numberOfLines={2}
                        selectable
                    >
                        $ {task.command}
                    </Text>
                </View>

                {/* Log output */}
                <ScrollView
                    ref={scrollRef}
                    style={styles.logContainer}
                    contentContainerStyle={styles.logContent}
                >
                    {log ? (
                        <Text
                            style={[
                                styles.logText,
                                { color: theme.colors.text },
                            ]}
                            selectable
                        >
                            {log}
                        </Text>
                    ) : (
                        <Text
                            style={[
                                styles.emptyText,
                                { color: theme.colors.textSecondary },
                            ]}
                        >
                            {isLoading
                                ? "..."
                                : t("backgroundTasks.noOutput")}
                        </Text>
                    )}
                </ScrollView>
            </SafeAreaView>
        </Modal>
    );
}

export const BackgroundTaskLogSheet = React.memo(BackgroundTaskLogSheetInner);

const styles = StyleSheet.create((_, rt) => ({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerLeft: {
        flex: 1,
        marginRight: 12,
    },
    titleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    title: {
        fontSize: 17,
        fontWeight: "600",
        flexShrink: 1,
    },
    portBadge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    portText: {
        fontSize: 12,
        fontWeight: "600",
        fontFamily: "monospace",
    },
    subtitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginTop: 4,
    },
    statusDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    subtitle: {
        fontSize: 12,
    },
    headerActions: {
        flexDirection: "row",
        gap: 16,
        alignItems: "center",
    },
    commandBar: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    commandText: {
        fontFamily: "monospace",
        fontSize: 11,
        lineHeight: 16,
    },
    logContainer: {
        flex: 1,
    },
    logContent: {
        padding: 12,
    },
    logText: {
        fontFamily: "monospace",
        fontSize: 12,
        lineHeight: 18,
    },
    emptyText: {
        fontSize: 14,
        textAlign: "center",
        marginTop: 40,
    },
}));
