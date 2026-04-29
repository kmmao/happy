/**
 * Debug page showing raw background task data for a session.
 * Displays: reducer backgroundTasks Map, tool-result messages with backgroundTaskId,
 * and all task lifecycle messages (task-start/progress/end).
 */

import * as React from "react";
import { View, ScrollView, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "@/components/StyledText";
import { useLayout } from "@/components/layout";
import { useSessionMessages, useBackgroundTaskEntries } from "@/sync/storage";
import { loadDismissedTasks } from "@/sync/persistence";
import * as Clipboard from "expo-clipboard";

export default React.memo(function DebugTasksScreen() {
    const layout = useLayout();
    const { id: sessionId } = useLocalSearchParams<{ id: string }>();
    const { theme } = useUnistyles();
    const { messages } = useSessionMessages(sessionId);
    const backgroundTaskEntries = useBackgroundTaskEntries(sessionId);
    const dismissed = loadDismissedTasks(sessionId);

    // Extract task-related messages
    const taskMessages = React.useMemo(() => {
        const result: Array<{
            id: string;
            createdAt: number;
            type: string;
            data: Record<string, unknown>;
        }> = [];

        for (const msg of messages) {
            // tool-call with backgroundTaskId
            if (msg.kind === "tool-call" && msg.tool.backgroundTaskId) {
                result.push({
                    id: msg.id,
                    createdAt: msg.createdAt,
                    type: "tool-call (background)",
                    data: {
                        backgroundTaskId: msg.tool.backgroundTaskId,
                        outputFile: msg.tool.outputFile,
                        name: msg.tool.name,
                        state: msg.tool.state,
                        command: msg.tool.input?.command,
                        description: msg.tool.description,
                        startedAt: msg.tool.startedAt,
                        completedAt: msg.tool.completedAt,
                    },
                });
            }

            // agent-text containing task lifecycle keywords
            if (msg.kind === "agent-text") {
                const text = msg.text ?? "";
                if (
                    text.includes("**Task:") ||
                    text.includes("Task completed") ||
                    text.includes("Task failed") ||
                    text.includes("Task stopped") ||
                    text.startsWith("⏳ ")
                ) {
                    result.push({
                        id: msg.id,
                        createdAt: msg.createdAt,
                        type: text.startsWith("⏳ ") ? "task-progress" :
                              text.includes("**Task:") ? "task-start" :
                              "task-end",
                        data: { text },
                    });
                }
            }
        }

        // Sort by time
        result.sort((a, b) => a.createdAt - b.createdAt);
        return result;
    }, [messages]);

    const copyAll = React.useCallback(() => {
        const entries = Object.fromEntries(backgroundTaskEntries);
        const data = {
            sessionId,
            backgroundTaskEntries: entries,
            dismissedTaskIds: [...dismissed],
            taskMessages,
            totalMessages: messages.length,
        };
        Clipboard.setStringAsync(JSON.stringify(data, null, 2));
    }, [sessionId, backgroundTaskEntries, dismissed, taskMessages, messages.length]);

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.surface }]}>
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={[styles.scrollContent, { maxWidth: layout.maxWidth }]}
            >
                {/* Summary */}
                <View style={[styles.section, { backgroundColor: theme.colors.surfaceHigh }]}>
                    <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                        Summary
                    </Text>
                    <Text style={[styles.mono, { color: theme.colors.textSecondary }]}>
                        {`Total messages: ${messages.length}\n`}
                        {`BackgroundTasks entries: ${backgroundTaskEntries.size}\n`}
                        {`Dismissed (MMKV): ${dismissed.size} [${[...dismissed].join(", ")}]\n`}
                        {`Task-related messages: ${taskMessages.length}`}
                    </Text>
                </View>

                {/* BackgroundTasks Map */}
                <View style={[styles.section, { backgroundColor: theme.colors.surfaceHigh }]}>
                    <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                        backgroundTasks Map ({backgroundTaskEntries.size})
                    </Text>
                    {backgroundTaskEntries.size === 0 ? (
                        <Text style={[styles.mono, { color: theme.colors.textSecondary }]}>
                            (empty)
                        </Text>
                    ) : (
                        [...backgroundTaskEntries.entries()].map(([taskId, entry]) => (
                            <View key={taskId} style={[styles.entry, { borderColor: theme.colors.divider }]}>
                                <Text style={[styles.entryTitle, {
                                    color: entry.status === "running" ? "#4CAF50" :
                                           entry.status === "stopped" ? "#FF9800" :
                                           entry.status === "completed" ? "#2196F3" :
                                           "#F44336"
                                }]}>
                                    [{entry.status.toUpperCase()}] {taskId}
                                    {dismissed.has(taskId) ? " (DISMISSED)" : ""}
                                </Text>
                                <Text style={[styles.mono, { color: theme.colors.textSecondary }]}>
                                    {JSON.stringify(entry, null, 2)}
                                </Text>
                            </View>
                        ))
                    )}
                </View>

                {/* Task-related messages timeline */}
                <View style={[styles.section, { backgroundColor: theme.colors.surfaceHigh }]}>
                    <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>
                        Task Messages Timeline ({taskMessages.length})
                    </Text>
                    {taskMessages.length === 0 ? (
                        <Text style={[styles.mono, { color: theme.colors.textSecondary }]}>
                            (no task-related messages found)
                        </Text>
                    ) : (
                        taskMessages.map((msg, i) => (
                            <View key={`${msg.id}-${i}`} style={[styles.entry, { borderColor: theme.colors.divider }]}>
                                <Text style={[styles.entryTitle, {
                                    color: msg.type === "task-start" ? "#4CAF50" :
                                           msg.type === "task-end" ? "#F44336" :
                                           msg.type === "task-progress" ? "#FF9800" :
                                           theme.colors.textLink
                                }]}>
                                    {new Date(msg.createdAt).toLocaleTimeString()} — {msg.type}
                                </Text>
                                <Text style={[styles.mono, { color: theme.colors.textSecondary }]}>
                                    {JSON.stringify(msg.data, null, 2)}
                                </Text>
                            </View>
                        ))
                    )}
                </View>

                {/* Copy button */}
                <Pressable
                    style={({ pressed }) => [
                        styles.copyButton,
                        { backgroundColor: theme.colors.primary },
                        pressed && { opacity: 0.7 },
                    ]}
                    onPress={copyAll}
                >
                    <Ionicons name="copy-outline" size={16} color="#fff" />
                    <Text style={styles.copyText}>Copy All as JSON</Text>
                </Pressable>
            </ScrollView>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
        gap: 12,
        alignSelf: "center",
        width: "100%",
    },
    section: {
        borderRadius: 12,
        padding: 12,
        gap: 8,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: "700",
    },
    entry: {
        borderTopWidth: 1,
        paddingTop: 8,
        gap: 4,
    },
    entryTitle: {
        fontSize: 12,
        fontWeight: "600",
    },
    mono: {
        fontSize: 11,
        fontFamily: "Menlo",
        lineHeight: 16,
    },
    copyButton: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        paddingVertical: 12,
        borderRadius: 10,
        marginTop: 8,
        marginBottom: 32,
    },
    copyText: {
        color: "#fff",
        fontSize: 14,
        fontWeight: "600",
    },
}));
