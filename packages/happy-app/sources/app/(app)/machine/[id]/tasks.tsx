import * as React from "react";
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    ScrollView,
    Text,
    View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { t } from "@/text";
import { useTasksData } from "./useTasksData";
import type { ServerTask } from "@/sync/apiTasks";
import { getTaskStatusBadgeColor } from "./task/taskDetailViewModel";

// ─── constants ────────────────────────────────────────────────────────────────

const COLUMN_WIDTH = 260;
const COLUMN_GAP = 10;
const BOARD_H_PADDING = 16;

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatCompactTime(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return days === 1 ? "1d ago" : `${days}d ago`;
}

// ─── types ────────────────────────────────────────────────────────────────────

type KanbanColumnDef = {
    key: string;
    label: string;
    statuses: string[];
    color: string;
};

type KanbanColumnWithTasks = KanbanColumnDef & { tasks: ServerTask[] };

// ─── KanbanCard ───────────────────────────────────────────────────────────────

function KanbanCard({ task, onPress }: { task: ServerTask; onPress: () => void }) {
    const { theme } = useUnistyles();
    const statusColor = getTaskStatusBadgeColor(task.status);
    const isActive = ["queued", "dispatching", "running"].includes(task.status);

    return (
        <Pressable
            style={({ pressed }) => ({
                backgroundColor: theme.colors.surface,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: isActive ? statusColor + "44" : theme.colors.divider,
                overflow: "hidden",
                opacity: pressed ? 0.72 : 1,
            })}
            onPress={onPress}
        >
            {/* top status bar */}
            <View style={{ height: 3, backgroundColor: statusColor }} />

            <View style={{ padding: 10, gap: 6 }}>
                {/* time row */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    {isActive && (
                        <View
                            style={{
                                width: 6,
                                height: 6,
                                borderRadius: 3,
                                backgroundColor: statusColor,
                            }}
                        />
                    )}
                    <Text
                        style={{
                            fontSize: 11,
                            color: theme.colors.textSecondary,
                            marginLeft: isActive ? 0 : 11,
                        }}
                    >
                        {formatCompactTime(task.updatedAt)}
                    </Text>
                </View>

                {/* title */}
                <Text
                    style={{
                        fontSize: 13,
                        fontWeight: "500",
                        color: theme.colors.text,
                        lineHeight: 18,
                    }}
                    numberOfLines={3}
                >
                    {task.title || task.promptPreview || "—"}
                </Text>

                {/* skill chips */}
                {task.skillNames.length > 0 && (
                    <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
                        {task.skillNames.slice(0, 3).map((s) => (
                            <View
                                key={s}
                                style={{
                                    backgroundColor: theme.colors.surfaceHigh,
                                    borderRadius: 4,
                                    paddingHorizontal: 5,
                                    paddingVertical: 2,
                                }}
                            >
                                <Text style={{ fontSize: 10, color: theme.colors.textSecondary }}>
                                    {s}
                                </Text>
                            </View>
                        ))}
                    </View>
                )}

                {/* error */}
                {task.errorMessage != null && (
                    <Text style={{ fontSize: 11, color: "#FF3B30" }} numberOfLines={1}>
                        {task.errorMessage}
                    </Text>
                )}
            </View>
        </Pressable>
    );
}

// ─── KanbanColumn ─────────────────────────────────────────────────────────────

function KanbanColumn({
    column,
    onTaskPress,
}: {
    column: KanbanColumnWithTasks;
    onTaskPress: (task: ServerTask) => void;
}) {
    const { theme } = useUnistyles();

    return (
        <View
            style={{
                width: COLUMN_WIDTH,
                marginRight: COLUMN_GAP,
                backgroundColor: theme.colors.surface,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                padding: 12,
                minHeight: 200,
            }}
        >
            {/* column header */}
            <View
                style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 7,
                    marginBottom: 10,
                }}
            >
                <View
                    style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: column.color,
                    }}
                />
                <Text
                    style={{
                        fontSize: 13,
                        fontWeight: "700",
                        color: theme.colors.text,
                        flex: 1,
                    }}
                >
                    {column.label}
                </Text>
                <View
                    style={{
                        backgroundColor: column.color + "26",
                        borderRadius: 10,
                        paddingHorizontal: 8,
                        paddingVertical: 2,
                    }}
                >
                    <Text
                        style={{
                            fontSize: 12,
                            fontWeight: "700",
                            color: column.color,
                        }}
                    >
                        {column.tasks.length}
                    </Text>
                </View>
            </View>

            {/* cards */}
            {column.tasks.length === 0 ? (
                <View style={{ flex: 1, alignItems: "center", paddingTop: 32 }}>
                    <Text
                        style={{
                            fontSize: 22,
                            color: theme.colors.textSecondary,
                            opacity: 0.25,
                        }}
                    >
                        —
                    </Text>
                </View>
            ) : (
                <View style={{ gap: 8 }}>
                    {column.tasks.map((task) => (
                        <KanbanCard
                            key={task.id}
                            task={task}
                            onPress={() => onTaskPress(task)}
                        />
                    ))}
                </View>
            )}
        </View>
    );
}

// ─── TaskListPage ─────────────────────────────────────────────────────────────

function TaskListPage() {
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const data = useTasksData(machineId!);

    const KANBAN_COLUMNS = React.useMemo<KanbanColumnDef[]>(
        () => [
            {
                key: "queue",
                label: t("tasks.statusQueued"),
                statuses: ["queued", "dispatching"],
                color: "#AEAEB2",
            },
            {
                key: "running",
                label: t("tasks.statusRunning"),
                statuses: ["running"],
                color: "#007AFF",
            },
            {
                key: "completed",
                label: t("tasks.statusCompleted"),
                statuses: ["completed"],
                color: "#34C759",
            },
            {
                key: "failed",
                label: t("tasks.statusFailed"),
                statuses: ["failed"],
                color: "#FF3B30",
            },
            {
                key: "cancelled",
                label: t("tasks.statusCancelled"),
                statuses: ["cancelled"],
                color: "#8E8E93",
            },
        ],
        [],
    );

    const columnTasks = React.useMemo<KanbanColumnWithTasks[]>(
        () =>
            KANBAN_COLUMNS.map((col) => ({
                ...col,
                tasks: data.tasks.filter((task) => col.statuses.includes(task.status)),
            })),
        [KANBAN_COLUMNS, data.tasks],
    );

    const handleTaskPress = React.useCallback(
        (task: ServerTask) => {
            router.push(`/machine/${machineId}/task/${task.id}` as any);
        },
        [machineId, router],
    );

    if (data.loading) {
        return (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                <ActivityIndicator />
            </View>
        );
    }

    return (
        <View style={{ flex: 1 }}>
            <ScrollView
                style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}
                refreshControl={
                    <RefreshControl
                        refreshing={data.refreshing}
                        onRefresh={() => void data.load("refresh")}
                    />
                }
                // allow bounce so pull-to-refresh works even when board fits on screen
                alwaysBounceVertical
            >
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.boardContent}
                >
                    {columnTasks.map((col) => (
                        <KanbanColumn
                            key={col.key}
                            column={col}
                            onTaskPress={handleTaskPress}
                        />
                    ))}
                </ScrollView>
            </ScrollView>

            {/* FAB — outside ScrollView so it stays fixed */}
            <Pressable
                style={[styles.fab, { backgroundColor: theme.colors.textLink }]}
                onPress={() => router.push(`/machine/${machineId}/task/new`)}
            >
                <Ionicons name="add" size={28} color="#FFF" />
            </Pressable>
        </View>
    );
}

export default React.memo(TaskListPage);

// ─── styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    boardContent: {
        paddingLeft: BOARD_H_PADDING,
        paddingRight: BOARD_H_PADDING - COLUMN_GAP,
        paddingTop: 14,
        paddingBottom: 120,
    },
    fab: {
        position: "absolute",
        right: 20,
        bottom: 28,
        width: 56,
        height: 56,
        borderRadius: 28,
        justifyContent: "center",
        alignItems: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
});
