import * as React from "react";
import { AuthCredentials, TokenStorage } from "@/auth/tokenStorage";
import { fetchTasks, cancelTask, retryTask, deleteTask, ServerTask } from "@/sync/apiTasks";
import { sync } from "@/sync/sync";
import { Modal } from "@/modal";
import { t } from "@/text";
import { matchesTaskFilter, sortTasksByUpdatedAt } from "./task/taskDetailViewModel";
import { createTaskEventRefreshRetrier } from "./taskEventRefresh";

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
    const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false);
    const hasLoadedOnceRef = React.useRef(false);
    const latestResultRequestIdRef = React.useRef(0);
    const initialRequestIdRef = React.useRef(0);
    const refreshRequestIdRef = React.useRef(0);
    const taskEventRetrierRef = React.useRef<ReturnType<typeof createTaskEventRefreshRetrier> | null>(null);

    const getCredentials = React.useCallback(async (): Promise<AuthCredentials | null> => {
        try {
            return await TokenStorage.getCredentials();
        } catch {
            return null;
        }
    }, []);

    const load = React.useCallback(async (kind: "initial" | "refresh") => {
        if (!machineId) return false;
        const resultRequestId = ++latestResultRequestIdRef.current;
        const activityRequestId = kind === "initial"
            ? ++initialRequestIdRef.current
            : ++refreshRequestIdRef.current;
        kind === "initial" ? setLoading(true) : setRefreshing(true);
        try {
            const credentials = await getCredentials();
            if (!credentials) return false;

            const statusParam = statusFilter === "active" ? undefined : statusFilter;
            const result = await fetchTasks(credentials, {
                machineId,
                status: statusParam,
                limit: 100,
            });
            if (resultRequestId !== latestResultRequestIdRef.current) return false;

            const nextTasks = sortTasksByUpdatedAt(
                result.tasks.filter((task) => matchesTaskFilter(task, statusFilter)),
            );
            setTasks(nextTasks);
            setTotal(nextTasks.length);
            hasLoadedOnceRef.current = true;
            setHasLoadedOnce(true);
            setLoading(false);
            return true;
        } catch {
            // Silently fail — will retry on next refresh
            return false;
        } finally {
            if (kind === "initial" && activityRequestId === initialRequestIdRef.current) {
                setLoading(false);
            }
            if (kind === "refresh" && activityRequestId === refreshRequestIdRef.current) {
                setRefreshing(false);
            }
        }
    }, [machineId, statusFilter, getCredentials]);

    // Initial load
    React.useEffect(() => {
        void load("initial");
    }, [load]);

    React.useEffect(() => {
        if (hasLoadedOnce || !machineId) return;
        let active = true;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let running = false;

        const attempt = async () => {
            if (!active || running || hasLoadedOnceRef.current) return;
            running = true;
            try {
                const ok = await load("initial");
                if (!active || hasLoadedOnceRef.current || ok) return;
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
    }, [hasLoadedOnce, load, machineId]);

    // Real-time task status updates
    React.useEffect(() => {
        taskEventRetrierRef.current?.dispose();
        taskEventRetrierRef.current = createTaskEventRefreshRetrier(() => load("refresh"));
        return () => {
            taskEventRetrierRef.current?.dispose();
            taskEventRetrierRef.current = null;
        };
    }, [load]);

    React.useEffect(() => {
        return sync.onTaskStatusChanged((event) => {
            if (event.machineId !== machineId) return;
            if (!hasLoadedOnceRef.current) return;
            taskEventRetrierRef.current?.trigger();
        });
    }, [machineId]);

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
