import * as React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { Item } from "@/components/Item";
import { ItemGroup } from "@/components/ItemGroup";
import { layout } from "@/components/layout";
import { Modal } from "@/modal";
import { t } from "@/text";
import { useTasksData } from "./useTasksData";
import type { ServerTask } from "@/sync/apiTasks";

const FILTERS = ["all", "active", "completed", "failed"] as const;

function statusBadgeColor(status: string): string {
    if (status === "running" || status === "dispatching") return "#007AFF";
    if (status === "completed") return "#34C759";
    if (status === "failed") return "#FF3B30";
    if (status === "cancelled") return "#8E8E93";
    return "#AEAEB2";
}

function statusLabel(status: string): string {
    const map: Record<string, string> = {
        queued: t("tasks.statusQueued"),
        dispatching: t("tasks.statusDispatching"),
        running: t("tasks.statusRunning"),
        completed: t("tasks.statusCompleted"),
        failed: t("tasks.statusFailed"),
        cancelled: t("tasks.statusCancelled"),
    };
    return map[status] ?? status;
}

function filterLabel(f: string): string {
    if (f === "all") return t("tasks.filterAll");
    if (f === "active") return t("tasks.filterActive");
    if (f === "completed") return t("tasks.statusCompleted");
    if (f === "failed") return t("tasks.statusFailed");
    return f;
}

function StatusBadge({ status }: { status: string }) {
    return (
        <View style={[styles.badge, { backgroundColor: statusBadgeColor(status) }]}>
            <Text style={styles.badgeText}>{statusLabel(status)}</Text>
        </View>
    );
}

function TaskListPage() {
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const data = useTasksData(machineId!);

    const handleTaskPress = React.useCallback((task: ServerTask) => {
        const isActive = task.status === "queued" || task.status === "dispatching" || task.status === "running";
        const isFailed = task.status === "failed";
        const isTerminal = task.status === "completed" || task.status === "failed" || task.status === "cancelled";

        const buttons: Array<{ text: string; style?: "cancel" | "destructive"; onPress?: () => void }> = [];

        if (task.sessionId) {
            buttons.push({
                text: t("tasks.openSession"),
                onPress: () => router.push(`/session/${task.sessionId}`),
            });
        }
        if (isActive) {
            buttons.push({
                text: t("tasks.cancelTask"),
                style: "destructive",
                onPress: () => void data.handleCancel(task.id),
            });
        }
        if (isFailed) {
            buttons.push({
                text: t("tasks.retryTask"),
                onPress: () => void data.handleRetry(task.id),
            });
        }
        if (isTerminal) {
            buttons.push({
                text: t("tasks.deleteTask"),
                style: "destructive",
                onPress: () => {
                    Modal.alert(t("tasks.deleteTask"), t("tasks.confirmDelete"), [
                        { text: t("common.cancel"), style: "cancel" },
                        { text: t("common.delete"), style: "destructive", onPress: () => void data.handleDelete(task.id) },
                    ]);
                },
            });
        }

        buttons.push({ text: t("common.cancel"), style: "cancel" });
        Modal.alert(task.promptPreview || "Task", statusLabel(task.status), buttons);
    }, [data, router]);

    if (data.loading) {
        return (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                <ActivityIndicator />
            </View>
        );
    }

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: theme.colors.surface }}
            contentContainerStyle={{ maxWidth: layout.maxWidth, width: "100%", alignSelf: "center" as const, paddingBottom: 80 }}
            refreshControl={
                <RefreshControl
                    refreshing={data.refreshing}
                    onRefresh={() => void data.load("refresh")}
                />
            }
        >
            {/* Filter chips */}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterRow}
            >
                {FILTERS.map((f) => {
                    const filterValue = f === "all" ? undefined : f;
                    const isActive = data.filter === filterValue;
                    return (
                        <Pressable
                            key={f}
                            style={[
                                styles.filterChip,
                                {
                                    backgroundColor: isActive
                                        ? theme.colors.textLink
                                        : theme.colors.surfaceHigh,
                                    borderColor: theme.colors.divider,
                                    borderWidth: isActive ? 0 : 1,
                                },
                            ]}
                            onPress={() => data.setFilter(filterValue)}
                        >
                            <Text
                                style={[
                                    styles.filterChipText,
                                    { color: isActive ? "#FFF" : theme.colors.text },
                                ]}
                            >
                                {filterLabel(f)}
                            </Text>
                        </Pressable>
                    );
                })}
            </ScrollView>

            {data.tasks.length === 0 ? (
                <ItemGroup>
                    <Item title={t("tasks.noTasks")} />
                </ItemGroup>
            ) : (
                <ItemGroup>
                    {data.tasks.map((task) => (
                        <Item
                            key={task.id}
                            title={task.promptPreview || "\u2014"}
                            subtitle={task.skillNames.length > 0 ? task.skillNames.join(", ") : undefined}
                            onPress={() => handleTaskPress(task)}
                            rightElement={<StatusBadge status={task.status} />}
                            showChevron
                        />
                    ))}
                </ItemGroup>
            )}

            {/* FAB */}
            <Pressable
                style={[styles.fab, { backgroundColor: theme.colors.textLink }]}
                onPress={() => router.push(`/machine/${machineId}/task/new`)}
            >
                <Ionicons name="add" size={28} color="#FFF" />
            </Pressable>
        </ScrollView>
    );
}

export default React.memo(TaskListPage);

const styles = StyleSheet.create({
    filterRow: {
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    filterChip: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 16,
    },
    filterChipText: {
        fontSize: 13,
        fontWeight: "600",
    },
    badge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    badgeText: {
        color: "#FFF",
        fontSize: 11,
        fontWeight: "600",
    },
    fab: {
        position: "absolute",
        right: 20,
        bottom: 24,
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
