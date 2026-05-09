import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { getServerUrl } from "./serverConfig";

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

function authHeaders(credentials: AuthCredentials) {
    return {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
    };
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
    const API_ENDPOINT = getServerUrl();
    const params = new URLSearchParams();
    if (opts?.machineId) params.set("machineId", opts.machineId);
    if (opts?.projectId) params.set("projectId", opts.projectId);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));

    const qs = params.toString();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/tasks${qs ? `?${qs}` : ""}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch tasks: ${response.status}`);
        }
        return (await response.json()) as TaskListResponse;
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
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/tasks`, {
            method: "POST",
            headers: authHeaders(credentials),
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error((data as Record<string, string>).error ?? `Failed to create task: ${response.status}`);
        }
        const data = (await response.json()) as TaskResponse;
        return data.task;
    });
}

export async function fetchTask(
    credentials: AuthCredentials,
    taskId: string,
): Promise<ServerTask> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/tasks/${taskId}`, {
            headers: authHeaders(credentials),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error((data as Record<string, string>).error ?? `Failed to fetch task: ${response.status}`);
        }
        const data = (await response.json()) as TaskResponse;
        return data.task;
    });
}

export async function cancelTask(
    credentials: AuthCredentials,
    taskId: string,
): Promise<ServerTask> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/tasks/${taskId}/cancel`, {
        method: "POST",
        headers: authHeaders(credentials),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? `Failed to cancel task: ${response.status}`);
    }
    const data = (await response.json()) as TaskResponse;
    return data.task;
}

export async function retryTask(
    credentials: AuthCredentials,
    taskId: string,
): Promise<ServerTask> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/tasks/${taskId}/retry`, {
        method: "POST",
        headers: authHeaders(credentials),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? `Failed to retry task: ${response.status}`);
    }
    const data = (await response.json()) as TaskResponse;
    return data.task;
}

export async function deleteTask(
    credentials: AuthCredentials,
    taskId: string,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/tasks/${taskId}`, {
        method: "DELETE",
        headers: authHeaders(credentials),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? `Failed to delete task: ${response.status}`);
    }
}

export async function updateTask(
    credentials: AuthCredentials,
    taskId: string,
    body: { prompt?: string; priority?: string },
): Promise<ServerTask> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: authHeaders(credentials),
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? `Failed to update task: ${response.status}`);
    }
    const data = (await response.json()) as TaskResponse;
    return data.task;
}

export async function dispatchSwarm(
    credentials: AuthCredentials,
    body: { taskIds: string[]; machineId: string },
): Promise<{ dispatched: number; taskIds: string[] }> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/tasks/swarm`, {
        method: "POST",
        headers: authHeaders(credentials),
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? `Failed to dispatch swarm: ${response.status}`);
    }
    return (await response.json()) as { dispatched: number; taskIds: string[] };
}

export async function restoreTask(
    credentials: AuthCredentials,
    taskId: string,
): Promise<ServerTask> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/tasks/${taskId}/restore`, {
        method: "POST",
        headers: authHeaders(credentials),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error((data as Record<string, string>).error ?? `Failed to restore task: ${response.status}`);
    }
    const data = (await response.json()) as TaskResponse;
    return data.task;
}
