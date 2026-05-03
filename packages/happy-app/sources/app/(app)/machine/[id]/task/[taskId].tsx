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
import { screenLayoutMaxWidth } from "@/components/layout";
import { TokenStorage } from "@/auth/tokenStorage";
import { Modal } from "@/modal";
import { t } from "@/text";
import {
    cancelTask,
    deleteTask,
    fetchTask,
    restoreTask,
    retryTask,
    type ServerTask,
} from "@/sync/apiTasks";
import { sync } from "@/sync/sync";
import { Typography } from "@/constants/Typography";
import {
    buildTaskDetailActions,
    formatTaskDate,
    getTaskPriorityLabel,
    getTaskStatusBadgeColor,
    getTaskStatusLabel,
} from "./taskDetailViewModel";
import { createTaskEventRefreshRetrier } from "../taskEventRefresh";

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
    const loadRequestIdRef = React.useRef(0);
    const taskEventRetrierRef = React.useRef<ReturnType<typeof createTaskEventRefreshRetrier> | null>(null);

    const loadTask = React.useCallback(async (kind: "initial" | "refresh" = "refresh") => {
        if (!taskId) return false;
        const requestId = ++loadRequestIdRef.current;
        if (kind === "initial") setLoading(true);
        try {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) return false;
            const data = await fetchTask(credentials, taskId);
            if (requestId !== loadRequestIdRef.current) return false;
            setTask(data);
            return true;
        } catch {
            // Silently fail — will retry on next status update or refresh.
            return false;
        } finally {
            if (requestId === loadRequestIdRef.current && kind === "initial") {
                setLoading(false);
            }
        }
    }, [taskId]);

    React.useEffect(() => {
        void loadTask("initial");
    }, [loadTask]);

    React.useEffect(() => {
        if (task || !taskId) return;
        let active = true;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let running = false;

        const attempt = async () => {
            if (!active || running || task) return;
            running = true;
            try {
                const ok = await loadTask("initial");
                if (!active || ok) return;
                timer = setTimeout(() => {
                    void attempt();
                }, 3000);
            } finally {
                running = false;
            }
        };

        timer = setTimeout(() => {
            void attempt();
        }, 3000);

        return () => {
            active = false;
            if (timer) clearTimeout(timer);
        };
    }, [loadTask, task, taskId]);

    React.useLayoutEffect(() => {
        navigation.setOptions({
            headerTitle: task?.title ?? task?.promptPreview ?? t("tasks.title"),
        });
    }, [navigation, task?.title, task?.promptPreview]);

    React.useEffect(() => {
        taskEventRetrierRef.current?.dispose();
        taskEventRetrierRef.current = createTaskEventRefreshRetrier(() => loadTask("refresh"));
        return () => {
            taskEventRetrierRef.current?.dispose();
            taskEventRetrierRef.current = null;
        };
    }, [loadTask]);

    React.useEffect(() => {
        return sync.onTaskStatusChanged((event) => {
            if (event.machineId && event.machineId !== machineId) return;
            if (event.taskId !== taskId) return;
            taskEventRetrierRef.current?.trigger();
        });
    }, [machineId, taskId]);

    const runAction = React.useCallback(async (action: () => Promise<void>) => {
        setActing(true);
        try {
            await action();
            await loadTask("refresh");
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

    const handleEdit = React.useCallback(() => {
        if (!taskId || !machineId) return;
        router.push(`/machine/${machineId}/task/edit?taskId=${taskId}` as any);
    }, [machineId, router, taskId]);

    const handleRestore = React.useCallback(async () => {
        const confirmed = await Modal.confirm(t("tasks.restoreTask"), t("tasks.confirmRestore"));
        if (!confirmed || !taskId) return;
        await runAction(async () => {
            const credentials = await TokenStorage.getCredentials();
            if (!credentials) throw new Error(t("common.error"));
            await restoreTask(credentials, taskId);
        });
    }, [runAction, taskId]);

    if (loading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator />
            </View>
        );
    }

    if (!task) {
        return (
            <View style={styles.centered}>
                <Text style={styles.emptyText}>{t("tasks.noTasks")}</Text>
            </View>
        );
    }

    const actions = buildTaskDetailActions(task);

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: theme.colors.surface }}
            contentContainerStyle={styles.content}
        >
            <View style={styles.heroCard}>
                <View style={styles.heroHeader}>
                    <View style={styles.heroTextWrap}>
                        <Text style={styles.title}>{task.title ?? task.promptPreview ?? task.id}</Text>
                        <Text style={styles.subtitle}>{task.id}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: getTaskStatusBadgeColor(task.status) }]}>
                        <Text style={styles.badgeText}>{getTaskStatusLabel(task.status, t as (key: string) => string)}</Text>
                    </View>
                </View>

                <View style={styles.chipRow}>
                    <View style={styles.chip}>
                        <Text style={styles.chipText}>{getTaskPriorityLabel(task.priority, t as (key: string) => string)}</Text>
                    </View>
                    <View style={styles.chip}>
                        <Text style={styles.chipText}>{task.triggerType}</Text>
                    </View>
                    <View style={styles.chip}>
                        <Text style={styles.chipText}>{`${task.attempt}/${task.maxAttempts}`}</Text>
                    </View>
                    {task.worktreeIsolation ? (
                        <View style={styles.chip}>
                            <Text style={styles.chipText}>{t("tasks.worktreeIsolation")}</Text>
                        </View>
                    ) : null}
                </View>

                {actions.sessionHref ? (
                    <Pressable style={styles.primaryAction} onPress={() => router.push(actions.sessionHref as any)}>
                        <Ionicons name="open-outline" size={16} color="#FFF" />
                        <Text style={styles.primaryActionText}>{t("tasks.openSession")}</Text>
                    </Pressable>
                ) : null}
            </View>

            <View style={styles.card}>
                <Text style={styles.sectionTitle}>{t("profile.details")}</Text>
                <Row label={t("tasks.priority")} value={getTaskPriorityLabel(task.priority, t as (key: string) => string)} />
                <Row label={t("profile.status")} value={getTaskStatusLabel(task.status, t as (key: string) => string)} />
                <Row label={t("machine.machineId")} value={task.machineId} />
                <Row label={t("tasks.project")} value={task.projectId ?? "-"} />
                <Row label={t("tasks.session")} value={task.sessionId ?? "-"} />
                <Row label={t("tasks.trigger")}
                    value={task.triggerRef ? `${task.triggerType} · ${task.triggerRef}` : task.triggerType}
                />
                <Row label={t("common.created")} value={formatTaskDate(task.createdAt)} />
                <Row label={t("common.updated")} value={formatTaskDate(task.updatedAt)} />
                <Row label={t("tasks.statusDispatching")} value={formatTaskDate(task.dispatchedAt)} />
                <Row label={t("tasks.statusCompleted")} value={formatTaskDate(task.completedAt)} />
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
                {actions.canEdit ? (
                    <Pressable style={[styles.secondaryAction, acting && styles.disabledAction]} disabled={acting} onPress={handleEdit}>
                        <Text style={styles.secondaryActionText}>{t("tasks.editTask")}</Text>
                    </Pressable>
                ) : null}
                {actions.canRestore ? (
                    <Pressable style={[styles.primaryAction, acting && styles.disabledAction]} disabled={acting} onPress={() => void handleRestore()}>
                        <Text style={styles.primaryActionText}>{t("tasks.restoreTask")}</Text>
                    </Pressable>
                ) : null}
                {actions.canCancel ? (
                    <Pressable style={[styles.secondaryAction, acting && styles.disabledAction]} disabled={acting} onPress={() => void handleCancel()}>
                        <Text style={styles.secondaryActionText}>{t("tasks.cancelTask")}</Text>
                    </Pressable>
                ) : null}
                {actions.canRetry ? (
                    <Pressable style={[styles.primaryAction, acting && styles.disabledAction]} disabled={acting} onPress={() => void handleRetry()}>
                        <Text style={styles.primaryActionText}>{t("tasks.retryTask")}</Text>
                    </Pressable>
                ) : null}
                {actions.canDelete ? (
                    <Pressable style={[styles.dangerAction, acting && styles.disabledAction]} disabled={acting} onPress={() => void handleDelete()}>
                        <Text style={styles.dangerActionText}>{t("tasks.deleteTask")}</Text>
                    </Pressable>
                ) : null}
            </View>
        </ScrollView>
    );
}

export default React.memo(TaskDetailScreen);

const styles = StyleSheet.create((theme, rt) => ({
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
        maxWidth: screenLayoutMaxWidth(rt.screen.width, rt.screen.height),
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
