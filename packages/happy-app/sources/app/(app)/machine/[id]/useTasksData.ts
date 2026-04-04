import * as React from "react";
import { AuthCredentials, TokenStorage } from "@/auth/tokenStorage";
import { fetchTasks, cancelTask, retryTask, deleteTask, ServerTask } from "@/sync/apiTasks";
import { sync } from "@/sync/sync";
import { Modal } from "@/modal";
import { t } from "@/text";

/**
 * Data hook for the task list page.
 * Fetches tasks from server REST API and subscribes to real-time status changes.
 */
export function useTasksData(machineId: string | undefined) {
    const [tasks, setTasks] = React.useState<ServerTask[]>([]);
    const [total, setTotal] = React.useState(0);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [statusFilter, setStatusFilter] = React.useState<string | undefined>(undefined);
    const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null);

    const getCredentials = React.useCallback(async (): Promise<AuthCredentials | null> => {
        try {
            return await TokenStorage.getCredentials();
        } catch {
            return null;
        }
    }, []);

    const load = React.useCallback(async (kind: "initial" | "refresh") => {
        if (!machineId) return;
        kind === "initial" ? setLoading(true) : setRefreshing(true);
        try {
            const credentials = await getCredentials();
            if (!credentials) return;

            const statusParam = statusFilter === "active"
                ? undefined // fetch all, filter client-side
                : statusFilter;

            const result = await fetchTasks(credentials, {
                machineId,
                status: statusParam,
                limit: 100,
            });

            if (statusFilter === "active") {
                const activeTasks = result.tasks.filter((t) =>
                    ["queued", "dispatching", "running"].includes(t.status),
                );
                setTasks(activeTasks);
                setTotal(activeTasks.length);
            } else {
                setTasks(result.tasks);
                setTotal(result.total);
            }
        } catch {
            // Silently fail — will retry on next refresh
        } finally {
            kind === "initial" ? setLoading(false) : setRefreshing(false);
        }
    }, [machineId, statusFilter, getCredentials]);

    // Initial load
    React.useEffect(() => {
        void load("initial");
    }, [load]);

    // Real-time task status updates
    React.useEffect(() => {
        return sync.onTaskStatusChanged((event) => {
            setTasks((prev) =>
                prev.map((task) =>
                    task.id === event.taskId
                        ? {
                              ...task,
                              status: event.status,
                              sessionId: event.sessionId ?? task.sessionId,
                              errorMessage: event.errorMessage ?? task.errorMessage,
                              completedAt: event.completedAt ?? task.completedAt,
                          }
                        : task,
                ),
            );
        });
    }, []);

    const doCancel = React.useCallback(async (taskId: string) => {
        setActiveTaskId(taskId);
        try {
            const credentials = await getCredentials();
            if (!credentials) return;
            await cancelTask(credentials, taskId);
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), String(error));
        } finally {
            setActiveTaskId(null);
        }
    }, [getCredentials, load]);

    const doRetry = React.useCallback(async (taskId: string) => {
        setActiveTaskId(taskId);
        try {
            const credentials = await getCredentials();
            if (!credentials) return;
            await retryTask(credentials, taskId);
            await load("refresh");
        } catch (error) {
            Modal.alert(t("common.error"), String(error));
        } finally {
            setActiveTaskId(null);
        }
    }, [getCredentials, load]);

    const doDelete = React.useCallback(async (taskId: string) => {
        setActiveTaskId(taskId);
        try {
            const credentials = await getCredentials();
            if (!credentials) return;
            await deleteTask(credentials, taskId);
            setTasks((prev) => prev.filter((t) => t.id !== taskId));
            setTotal((prev) => prev - 1);
        } catch (error) {
            Modal.alert(t("common.error"), String(error));
        } finally {
            setActiveTaskId(null);
        }
    }, [getCredentials]);

    return {
        tasks,
        total,
        loading,
        refreshing,
        filter: statusFilter,
        setFilter: setStatusFilter,
        activeTaskId,
        load,
        handleCancel: doCancel,
        handleRetry: doRetry,
        handleDelete: doDelete,
    };
}
