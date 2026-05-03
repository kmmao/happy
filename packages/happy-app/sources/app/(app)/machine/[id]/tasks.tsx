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
import { dispatchSwarm } from "@/sync/apiTasks";
import { TokenStorage } from "@/auth/tokenStorage";
import { Modal } from "@/modal";
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

function KanbanCard({
    task,
    onPress,
    onLongPress,
    selected,
    swarmMode,
}: {
    task: ServerTask;
    onPress: () => void;
    onLongPress?: () => void;
    selected?: boolean;
    swarmMode?: boolean;
}) {
    const { theme } = useUnistyles();
    const statusColor = getTaskStatusBadgeColor(task.status);
    const isActive = ["queued", "dispatching", "running"].includes(task.status);
    const isSwarmable = ["queued", "failed"].includes(task.status);

    return (
        <Pressable
            style={({ pressed }) => ({
                backgroundColor: theme.colors.surface,
                borderRadius: 10,
                borderWidth: selected ? 2 : 1,
                borderColor: selected
                    ? "#007AFF"
                    : swarmMode && isSwarmable
                      ? "#007AFF44"
                      : isActive
                        ? statusColor + "44"
                        : theme.colors.divider,
                overflow: "hidden",
                opacity: pressed ? 0.72 : swarmMode && !isSwarmable ? 0.45 : 1,
            })}
            onPress={onPress}
            onLongPress={onLongPress}
        >
            {/* top status bar */}
            <View style={{ height: 3, backgroundColor: statusColor }} />

            {/* selection checkmark overlay */}
            {swarmMode && isSwarmable && (
                <View
                    style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        borderWidth: selected ? 0 : 1.5,
                        borderColor: selected ? "transparent" : theme.colors.textSecondary,
                        backgroundColor: selected ? "#007AFF" : "transparent",
                        justifyContent: "center",
                        alignItems: "center",
                        zIndex: 1,
                    }}
                >
                    {selected && (
                        <Ionicons name="checkmark" size={13} color="#FFF" />
                    )}
                </View>
            )}

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
    onTaskLongPress,
    selectedIds,
    swarmMode,
}: {
    column: KanbanColumnWithTasks;
    onTaskPress: (task: ServerTask) => void;
    onTaskLongPress?: (task: ServerTask) => void;
    selectedIds?: Set<string>;
    swarmMode?: boolean;
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
                            onLongPress={onTaskLongPress ? () => onTaskLongPress(task) : undefined}
                            selected={selectedIds?.has(task.id)}
                            swarmMode={swarmMode}
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

    const [swarmMode, setSwarmMode] = React.useState(false);
    const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
    const [swarmLoading, setSwarmLoading] = React.useState(false);

    const enterSwarmMode = React.useCallback((task: ServerTask) => {
        const isSwarmable = ["queued", "failed"].includes(task.status);
        if (!isSwarmable) return;
        setSwarmMode(true);
        setSelectedIds(new Set([task.id]));
    }, []);

    const exitSwarmMode = React.useCallback(() => {
        setSwarmMode(false);
        setSelectedIds(new Set());
    }, []);

    const toggleSelection = React.useCallback((task: ServerTask) => {
        const isSwarmable = ["queued", "failed"].includes(task.status);
        if (!isSwarmable) return;
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(task.id)) {
                next.delete(task.id);
            } else {
                next.add(task.id);
            }
            return next;
        });
    }, []);

    const handleSwarmDispatch = React.useCallback(async () => {
        if (selectedIds.size === 0 || !machineId) return;
        setSwarmLoading(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return;
            const result = await dispatchSwarm(credentials, {
                taskIds: Array.from(selectedIds),
                machineId,
            });
            exitSwarmMode();
            await data.load("refresh");
            Modal.alert(
                t("tasks.swarmDispatched"),
                t("tasks.swarmDispatchedMsg", { count: result.dispatched }),
                [{ text: t("common.ok") }],
            );
        } catch (e) {
            Modal.alert(t("common.error"), e instanceof Error ? e.message : String(e), [
                { text: t("common.ok") },
            ]);
        } finally {
            setSwarmLoading(false);
        }
    }, [selectedIds, machineId, exitSwarmMode, data]);

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
            if (swarmMode) {
                toggleSelection(task);
                return;
            }
            router.push(`/machine/${machineId}/task/${task.id}` as any);
        },
        [machineId, router, swarmMode, toggleSelection],
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
                            onTaskLongPress={!swarmMode ? enterSwarmMode : undefined}
                            selectedIds={selectedIds}
                            swarmMode={swarmMode}
                        />
                    ))}
                </ScrollView>
            </ScrollView>

            {swarmMode ? (
                /* Swarm action bar */
                <View
                    style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        backgroundColor: theme.colors.surface,
                        borderTopWidth: 1,
                        borderTopColor: theme.colors.divider,
                        flexDirection: "row",
                        alignItems: "center",
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        paddingBottom: 28,
                        gap: 10,
                    }}
                >
                    <Pressable
                        style={({ pressed }) => ({
                            flex: 1,
                            height: 44,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: theme.colors.divider,
                            justifyContent: "center",
                            alignItems: "center",
                            opacity: pressed ? 0.7 : 1,
                        })}
                        onPress={exitSwarmMode}
                    >
                        <Text style={{ fontSize: 15, color: theme.colors.textSecondary }}>
                            {t("common.cancel")}
                        </Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => ({
                            flex: 2,
                            height: 44,
                            borderRadius: 12,
                            backgroundColor: selectedIds.size > 0 ? "#007AFF" : theme.colors.divider,
                            flexDirection: "row",
                            justifyContent: "center",
                            alignItems: "center",
                            gap: 6,
                            opacity: pressed ? 0.8 : 1,
                        })}
                        onPress={() => void handleSwarmDispatch()}
                        disabled={selectedIds.size === 0 || swarmLoading}
                    >
                        {swarmLoading ? (
                            <ActivityIndicator size="small" color="#FFF" />
                        ) : (
                            <>
                                <Ionicons name="flash" size={16} color="#FFF" />
                                <Text style={{ fontSize: 15, fontWeight: "600", color: "#FFF" }}>
                                    {t("tasks.swarm")} ({selectedIds.size})
                                </Text>
                            </>
                        )}
                    </Pressable>
                </View>
            ) : (
                /* Normal FAB */
                <Pressable
                    style={[styles.fab, { backgroundColor: theme.colors.textLink }]}
                    onPress={() => router.push(`/machine/${machineId}/task/new`)}
                >
                    <Ionicons name="add" size={28} color="#FFF" />
                </Pressable>
            )}
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
