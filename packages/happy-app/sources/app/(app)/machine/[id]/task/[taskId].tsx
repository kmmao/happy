import * as React from "react";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    Text,
    View,
} from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { layout } from "@/components/layout";
import { TokenStorage } from "@/auth/tokenStorage";
import { Modal } from "@/modal";
import { t } from "@/text";
import {
    cancelTask,
    deleteTask,
    fetchTask,
    retryTask,
    type ServerTask,
} from "@/sync/apiTasks";
import { sync } from "@/sync/sync";
import { Typography } from "@/constants/Typography";

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

function priorityLabel(priority: string): string {
    const map: Record<string, string> = {
        urgent: t("tasks.priorityUrgent"),
        user: t("tasks.priorityUser"),
        background: t("tasks.priorityBackground"),
    };
    return map[priority] ?? priority;
}

function formatDate(value: number | null): string {
    return value ? new Date(value).toLocaleString() : "-";
}

function Row({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.row}>
            <Text style={styles.rowLabel}>{label}</Text>
            <Text style={styles.rowValue}>{value}</Text>
        </View>
    );
}

function TaskDetailScreen() {
    const { id: machineId, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
    const navigation = useNavigation();
    const router = useRouter();
    const { theme } = useUnistyles();
    const [task, setTask] = React.useState<ServerTask | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [acting, setActing] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const loadTask = React.useCallback(async () => {
        if (!taskId) return;
        setLoading(true);
        setError(null);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) {
                setError(t("common.error"));
                return;
            }
            const data = await fetchTask(credentials, taskId);
            setTask(data);
        } catch (e: any) {
            setError(e?.message ?? t("common.error"));
        } finally {
            setLoading(false);
        }
    }, [taskId]);

    React.useEffect(() => {
        void loadTask();
    }, [loadTask]);

    React.useLayoutEffect(() => {
        navigation.setOptions({
            headerTitle: task?.promptPreview || t("tasks.title"),
        });
    }, [navigation, task?.promptPreview]);

    React.useEffect(() => {
        return sync.onTaskStatusChanged((event) => {
            if (event.taskId !== taskId) return;
            setTask((prev) => prev ? {
                ...prev,
                status: event.status,
                sessionId: event.sessionId ?? prev.sessionId,
                errorMessage: event.errorMessage ?? prev.errorMessage,
                completedAt: event.completedAt ?? prev.completedAt,
            } : prev);
        });
    }, [taskId]);

    const runAction = React.useCallback(async (action: () => Promise<void>) => {
        setActing(true);
        try {
            await action();
            await loadTask();
        } catch (e: any) {
            Modal.alert(t("common.error"), e?.message ?? t("common.error"));
        } finally {
            setActing(false);
        }
    }, [loadTask]);

    const handleCancel = React.useCallback(async () => {
        const confirmed = await Modal.confirm(t("tasks.cancelTask"), t("tasks.confirmCancel"));
        if (!confirmed || !taskId) return;
        await runAction(async () => {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) throw new Error(t("common.error"));
            await cancelTask(credentials, taskId);
        });
    }, [runAction, taskId]);

    const handleRetry = React.useCallback(async () => {
        if (!taskId) return;
        await runAction(async () => {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) throw new Error(t("common.error"));
            await retryTask(credentials, taskId);
        });
    }, [runAction, taskId]);

    const handleDelete = React.useCallback(async () => {
        const confirmed = await Modal.confirm(t("tasks.deleteTask"), t("tasks.confirmDelete"));
        if (!confirmed || !taskId) return;
        setActing(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) throw new Error(t("common.error"));
            await deleteTask(credentials, taskId);
            router.replace(`/machine/${machineId}/tasks` as any);
        } catch (e: any) {
            Modal.alert(t("common.error"), e?.message ?? t("common.error"));
        } finally {
            setActing(false);
        }
    }, [machineId, router, taskId]);

    if (loading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator />
            </View>
        );
    }

    if (error || !task) {
        return (
            <View style={styles.centered}>
                <Text style={styles.emptyText}>{error ?? t("tasks.noTasks")}</Text>
            </View>
        );
    }

    const isActive = ["queued", "dispatching", "running"].includes(task.status);
    const isFailed = task.status === "failed";
    const isTerminal = ["completed", "failed", "cancelled"].includes(task.status);

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: theme.colors.surface }}
            contentContainerStyle={styles.content}
        >
            <View style={styles.heroCard}>
                <View style={styles.heroHeader}>
                    <View style={styles.heroTextWrap}>
                        <Text style={styles.title}>{task.promptPreview || task.id}</Text>
                        <Text style={styles.subtitle}>{task.id}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: statusBadgeColor(task.status) }]}>
                        <Text style={styles.badgeText}>{statusLabel(task.status)}</Text>
                    </View>
                </View>

                <View style={styles.chipRow}>
                    <View style={styles.chip}>
                        <Text style={styles.chipText}>{priorityLabel(task.priority)}</Text>
                    </View>
                    <View style={styles.chip}>
                        <Text style={styles.chipText}>{task.triggerType}</Text>
                    </View>
                    <View style={styles.chip}>
                        <Text style={styles.chipText}>{`${task.attempt}/${task.maxAttempts}`}</Text>
                    </View>
                </View>

                {task.sessionId ? (
                    <Pressable style={styles.primaryAction} onPress={() => router.push(`/session/${task.sessionId}` as any)}>
                        <Ionicons name="open-outline" size={16} color="#FFF" />
                        <Text style={styles.primaryActionText}>{t("tasks.openSession")}</Text>
                    </Pressable>
                ) : null}
            </View>

            <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t("profile.details")}</Text>
                <Row label={t("tasks.priority")} value={priorityLabel(task.priority)} />
                <Row label={t("profile.status")} value={statusLabel(task.status)} />
                <Row label={t("machine.machineId")} value={task.machineId} />
                <Row label={t("tasks.project")} value={task.projectId ?? "-"} />
                <Row label="Session" value={task.sessionId ?? "-"} />
                <Row label="Trigger"
                    value={task.triggerRef ? `${task.triggerType} · ${task.triggerRef}` : task.triggerType}
                />
                <Row label="Created" value={formatDate(task.createdAt)} />
                <Row label="Updated" value={formatDate(task.updatedAt)} />
                <Row label={t("tasks.statusDispatching")} value={formatDate(task.dispatchedAt)} />
                <Row label={t("tasks.statusCompleted")} value={formatDate(task.completedAt)} />
            </View>

            {task.skillNames.length > 0 ? (
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>{t("tasks.skillsLabel")}</Text>
                    <Text style={styles.bodyText}>{task.skillNames.join(", ")}</Text>
                </View>
            ) : null}

            {task.errorMessage ? (
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>{t("tasks.statusFailed")}</Text>
                    <Text style={styles.errorText}>{task.errorMessage}</Text>
                </View>
            ) : null}

            <View style={styles.actionRow}>
                {isActive ? (
                    <Pressable style={[styles.secondaryAction, acting && styles.disabledAction]} disabled={acting} onPress={() => void handleCancel()}>
                        <Text style={styles.secondaryActionText}>{t("tasks.cancelTask")}</Text>
                    </Pressable>
                ) : null}
                {isFailed ? (
                    <Pressable style={[styles.primaryAction, acting && styles.disabledAction]} disabled={acting} onPress={() => void handleRetry()}>
                        <Text style={styles.primaryActionText}>{t("tasks.retryTask")}</Text>
                    </Pressable>
                ) : null}
                {isTerminal ? (
                    <Pressable style={[styles.dangerAction, acting && styles.disabledAction]} disabled={acting} onPress={() => void handleDelete()}>
                        <Text style={styles.dangerActionText}>{t("tasks.deleteTask")}</Text>
                    </Pressable>
                ) : null}
            </View>
        </ScrollView>
    );
}

export default React.memo(TaskDetailScreen);

const styles = StyleSheet.create((theme) => ({
    centered: {
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
    },
    emptyText: {
        ...Typography.default(),
        color: theme.colors.textSecondary,
        textAlign: "center",
    },
    content: {
        maxWidth: layout.maxWidth,
        width: "100%",
        alignSelf: "center",
        padding: 16,
        paddingBottom: 40,
        gap: 12,
    },
    heroCard: {
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        padding: 16,
        gap: 14,
    },
    heroHeader: {
        flexDirection: "row",
        gap: 12,
        alignItems: "flex-start",
    },
    heroTextWrap: {
        flex: 1,
        gap: 6,
    },
    title: {
        ...Typography.default("semiBold"),
        fontSize: 18,
        lineHeight: 24,
        color: theme.colors.text,
    },
    subtitle: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.textSecondary,
    },
    badge: {
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    badgeText: {
        ...Typography.default("semiBold"),
        fontSize: 12,
        color: "#FFF",
    },
    chipRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 8,
    },
    chip: {
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
        backgroundColor: theme.colors.surfaceHigh,
    },
    chipText: {
        ...Typography.default(),
        fontSize: 12,
        color: theme.colors.text,
    },
    card: {
        backgroundColor: theme.colors.surface,
        borderRadius: 16,
        padding: 16,
        gap: 10,
    },
    sectionTitle: {
        ...Typography.default("semiBold"),
        fontSize: 15,
        color: theme.colors.text,
    },
    row: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 16,
    },
    rowLabel: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textSecondary,
        flex: 1,
    },
    rowValue: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
        flex: 1.4,
        textAlign: "right",
    },
    bodyText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.text,
        lineHeight: 18,
    },
    errorText: {
        ...Typography.default(),
        fontSize: 13,
        color: theme.colors.textDestructive,
        lineHeight: 18,
    },
    actionRow: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 10,
    },
    primaryAction: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        backgroundColor: theme.colors.textLink,
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
    },
    primaryActionText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: "#FFF",
    },
    secondaryAction: {
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        backgroundColor: theme.colors.surfaceHigh,
    },
    secondaryActionText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: theme.colors.text,
    },
    dangerAction: {
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        backgroundColor: theme.colors.deleteAction,
    },
    dangerActionText: {
        ...Typography.default("semiBold"),
        fontSize: 13,
        color: "#FFF",
    },
    disabledAction: {
        opacity: 0.5,
    },
}));
