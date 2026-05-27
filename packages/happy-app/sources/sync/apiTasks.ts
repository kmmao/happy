import { AuthCredentials } from "@/auth/tokenStorage";
import { apiRequest, apiRequestVoid } from "./apiRequest";

export interface ServerTask {
    id: string;
    projectId: string | null;
    machineId: string;
    directory: string | null;
    priority: string;
    status: string;
    triggerType: string;
    triggerRef: string | null;
    attempt: number;
    maxAttempts: number;
    sessionId: string | null;
    errorMessage: string | null;
    dispatchedAt: number | null;
    completedAt: number | null;
    createdAt: number;
    updatedAt: number;
    title: string | null;
    promptPreview: string;
    skillNames: string[];
    worktreeIsolation: boolean;
    parentTaskId: string | null;
}

interface TaskListResponse {
    tasks: ServerTask[];
    total: number;
}

interface TaskResponse {
    task: ServerTask;
}

export async function fetchTasks(
    credentials: AuthCredentials,
    opts?: {
        machineId?: string;
        projectId?: string;
        status?: string;
        limit?: number;
        offset?: number;
    },
): Promise<{ tasks: ServerTask[]; total: number }> {
    return await apiRequest<TaskListResponse>(credentials, "/v1/tasks", {
        query: {
            machineId: opts?.machineId || undefined,
            projectId: opts?.projectId || undefined,
            status: opts?.status || undefined,
            limit: opts?.limit || undefined,
            offset: opts?.offset || undefined,
        },
        errorMessage: "Failed to fetch tasks",
    });
}

export async function createTask(
    credentials: AuthCredentials,
    body: {
        machineId: string;
        prompt: string;
        priority?: string;
        maxAttempts?: number;
        skillIds?: string[];
        projectId?: string;
        /** Absolute path on machine (e.g. Git worktree); server requires projectId and validates prefix. */
        directory?: string;
        /** When true, the CLI creates a dedicated git worktree at execution time. */
        worktreeIsolation?: boolean;
        profileId?: string;
    },
): Promise<ServerTask> {
    const data = await apiRequest<TaskResponse>(credentials, "/v1/tasks", {
        method: "POST",
        body,
        errorMessage: "Failed to create task",
    });
    return data.task;
}

export async function fetchTask(
    credentials: AuthCredentials,
    taskId: string,
): Promise<ServerTask> {
    const data = await apiRequest<TaskResponse>(credentials, `/v1/tasks/${taskId}`, {
        errorMessage: "Failed to fetch task",
    });
    return data.task;
}

export async function cancelTask(
    credentials: AuthCredentials,
    taskId: string,
): Promise<ServerTask> {
    const data = await apiRequest<TaskResponse>(credentials, `/v1/tasks/${taskId}/cancel`, {
        method: "POST",
        retry: false,
        errorMessage: "Failed to cancel task",
    });
    return data.task;
}

export async function retryTask(
    credentials: AuthCredentials,
    taskId: string,
): Promise<ServerTask> {
    const data = await apiRequest<TaskResponse>(credentials, `/v1/tasks/${taskId}/retry`, {
        method: "POST",
        retry: false,
        errorMessage: "Failed to retry task",
    });
    return data.task;
}

export async function deleteTask(
    credentials: AuthCredentials,
    taskId: string,
): Promise<void> {
    await apiRequestVoid(credentials, `/v1/tasks/${taskId}`, {
        method: "DELETE",
        retry: false,
        errorMessage: "Failed to delete task",
    });
}

export async function updateTask(
    credentials: AuthCredentials,
    taskId: string,
    body: { prompt?: string; priority?: string },
): Promise<ServerTask> {
    const data = await apiRequest<TaskResponse>(credentials, `/v1/tasks/${taskId}`, {
        method: "PATCH",
        body,
        retry: false,
        errorMessage: "Failed to update task",
    });
    return data.task;
}

export async function dispatchSwarm(
    credentials: AuthCredentials,
    body: { taskIds: string[]; machineId: string },
): Promise<{ dispatched: number; taskIds: string[] }> {
    return await apiRequest<{ dispatched: number; taskIds: string[] }>(credentials, "/v1/tasks/swarm", {
        method: "POST",
        body,
        retry: false,
        errorMessage: "Failed to dispatch swarm",
    });
}

export async function restoreTask(
    credentials: AuthCredentials,
    taskId: string,
): Promise<ServerTask> {
    const data = await apiRequest<TaskResponse>(credentials, `/v1/tasks/${taskId}/restore`, {
        method: "POST",
        retry: false,
        errorMessage: "Failed to restore task",
    });
    return data.task;
}
