import * as React from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { layout } from "@/components/layout";
import { t } from "@/text";
import { useTasksData } from "./useTasksData";
import type { ServerTask } from "@/sync/apiTasks";
import {
    getTaskFilterLabel,
    getTaskStatusBadgeColor,
    getTaskStatusLabel,
    TASK_FILTERS,
} from "./task/taskDetailViewModel";

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

function TaskCard({ task, onPress }: { task: ServerTask; onPress: () => void }) {
    const { theme } = useUnistyles();
    const statusColor = getTaskStatusBadgeColor(task.status);
    const isActive = ["queued", "dispatching", "running"].includes(task.status);

    return (
        <Pressable
            style={({ pressed }) => ({
                flexDirection: "row",
                backgroundColor: theme.colors.surface,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: isActive ? statusColor + "44" : theme.colors.divider,
                overflow: "hidden",
                opacity: pressed ? 0.75 : 1,
            })}
            onPress={onPress}
        >
            {/* Left status stripe */}
            <View style={{ width: 4, backgroundColor: statusColor }} />

            <View style={{ flex: 1, paddingVertical: 11, paddingLeft: 12, gap: 5 }}>
                {/* Row 1: status label + time */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 12 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        {isActive && (
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
                        )}
                        <Text style={{ fontSize: 11, fontWeight: "700", color: statusColor, letterSpacing: 0.3 }}>
                            {getTaskStatusLabel(task.status, t as (key: string) => string).toUpperCase()}
                        </Text>
                    </View>
                    <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>
                        {formatCompactTime(task.updatedAt)}
                    </Text>
                </View>

                {/* Row 2: title */}
                <Text
                    style={{ fontSize: 14, fontWeight: "500", color: theme.colors.text, lineHeight: 20 }}
                    numberOfLines={2}
                >
                    {task.title || task.promptPreview || "—"}
                </Text>

                {/* Row 3: skill chips */}
                {task.skillNames.length > 0 && (
                    <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
                        {task.skillNames.slice(0, 4).map((s) => (
                            <View
                                key={s}
                                style={{
                                    backgroundColor: theme.colors.surfaceHigh,
                                    borderRadius: 4,
                                    paddingHorizontal: 6,
                                    paddingVertical: 2,
                                }}
                            >
                                <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>{s}</Text>
                            </View>
                        ))}
                    </View>
                )}

                {/* Row 4: error message */}
                {task.errorMessage && (
                    <Text style={{ fontSize: 12, color: "#FF3B30" }} numberOfLines={1}>
                        {task.errorMessage}
                    </Text>
                )}
            </View>

            <View style={{ justifyContent: "center", paddingHorizontal: 12 }}>
                <Ionicons name="chevron-forward" size={15} color={theme.colors.textSecondary} />
            </View>
        </Pressable>
    );
}

function EmptyTaskState() {
    const { theme } = useUnistyles();
    return (
        <View style={{ alignItems: "center", paddingVertical: 56, paddingHorizontal: 32, gap: 10 }}>
            <Ionicons name="list-outline" size={44} color={theme.colors.textSecondary} style={{ opacity: 0.4 }} />
            <Text style={{ fontSize: 16, fontWeight: "600", color: theme.colors.text }}>
                {t("tasks.noTasks")}
            </Text>
        </View>
    );
}

function TaskListPage() {
    const { id: machineId } = useLocalSearchParams<{ id: string }>();
    const router = useRouter();
    const { theme } = useUnistyles();
    const data = useTasksData(machineId!);

    const handleTaskPress = React.useCallback((task: ServerTask) => {
        router.push(`/machine/${machineId}/task/${task.id}` as any);
    }, [machineId, router]);

    if (data.loading) {
        return (
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
                <ActivityIndicator />
            </View>
        );
    }

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}
            contentContainerStyle={{
                maxWidth: layout.maxWidth,
                width: "100%",
                alignSelf: "center" as const,
                paddingBottom: 100,
            }}
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
                {TASK_FILTERS.map((f) => {
                    const filterValue = f === "all" ? undefined : f;
                    const isActive = data.filter === filterValue;
                    return (
                        <Pressable
                            key={f}
                            style={[
                                styles.filterChip,
                                {
                                    backgroundColor: isActive ? theme.colors.textLink : theme.colors.surface,
                                    borderColor: isActive ? theme.colors.textLink : theme.colors.divider,
                                },
                            ]}
                            onPress={() => data.setFilter(filterValue)}
                        >
                            <Text
                                style={[
                                    styles.filterChipText,
                                    { color: isActive ? "#FFF" : theme.colors.textSecondary },
                                ]}
                            >
                                {getTaskFilterLabel(f, t as (key: string) => string)}
                            </Text>
                        </Pressable>
                    );
                })}
            </ScrollView>

            {/* Task cards */}
            {data.tasks.length === 0 ? (
                <EmptyTaskState />
            ) : (
                <View style={styles.cardList}>
                    {data.tasks.map((task) => (
                        <TaskCard
                            key={task.id}
                            task={task}
                            onPress={() => handleTaskPress(task)}
                        />
                    ))}
                </View>
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
        borderWidth: 1,
    },
    filterChipText: {
        fontSize: 13,
        fontWeight: "600",
    },
    cardList: {
        paddingHorizontal: 16,
        gap: 8,
        paddingTop: 4,
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
