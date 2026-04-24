import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { getServerUrl } from "./serverConfig";

export interface ServerTriggerSchedule {
    id: string;
    projectId: string | null;
    machineId: string;
    name: string | null;
    prompt: string;
    cronExpression: string;
    priority: string;
    enabled: boolean;
    skillIds: string[];
    nextRunAt: number | null;
    lastRunAt: number | null;
    lastTaskId: string | null;
    runCount: number;
    profileId: string | null;
    createdAt: number;
    updatedAt: number;
}

interface TriggerScheduleListResponse {
    triggerSchedules: ServerTriggerSchedule[];
    total: number;
}

interface TriggerScheduleResponse {
    triggerSchedule: ServerTriggerSchedule;
}

function authHeaders(credentials: AuthCredentials) {
    return {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
    };
}

export async function fetchTriggerSchedules(
    credentials: AuthCredentials,
    opts?: {
        machineId?: string;
        projectId?: string;
        enabled?: boolean;
        limit?: number;
        offset?: number;
    },
): Promise<{ triggerSchedules: ServerTriggerSchedule[]; total: number }> {
    const API_ENDPOINT = getServerUrl();
    const params = new URLSearchParams();
    if (opts?.machineId) params.set("machineId", opts.machineId);
    if (opts?.projectId) params.set("projectId", opts.projectId);
    if (opts?.enabled !== undefined) params.set("enabled", String(opts.enabled));
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));

    const qs = params.toString();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/trigger-schedules${qs ? `?${qs}` : ""}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch trigger schedules: ${response.status}`);
        }
        return (await response.json()) as TriggerScheduleListResponse;
    });
}

export async function createTriggerSchedule(
    credentials: AuthCredentials,
    body: {
        machineId: string;
        prompt: string;
        cronExpression: string;
        name?: string;
        priority?: string;
        projectId?: string;
        skillIds?: string[];
        profileId?: string;
    },
): Promise<ServerTriggerSchedule> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/trigger-schedules`, {
            method: "POST",
            headers: authHeaders(credentials),
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error((data as Record<string, string>).error ?? `Failed to create trigger schedule: ${response.status}`);
        }
        const data = (await response.json()) as TriggerScheduleResponse;
        return data.triggerSchedule;
    });
}

export async function updateTriggerSchedule(
    credentials: AuthCredentials,
    id: string,
    body: {
        name?: string | null;
        prompt?: string;
        cronExpression?: string;
        priority?: string;
        skillIds?: string[];
        profileId?: string | null;
    },
): Promise<ServerTriggerSchedule> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/trigger-schedules/${id}`, {
            method: "PATCH",
            headers: authHeaders(credentials),
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error((data as Record<string, string>).error ?? `Failed to update trigger schedule: ${response.status}`);
        }
        const data = (await response.json()) as TriggerScheduleResponse;
        return data.triggerSchedule;
    });
}

export async function toggleTriggerSchedule(
    credentials: AuthCredentials,
    id: string,
): Promise<ServerTriggerSchedule> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/trigger-schedules/${id}/toggle`, {
            method: "POST",
            headers: authHeaders(credentials),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error((data as Record<string, string>).error ?? `Failed to toggle trigger schedule: ${response.status}`);
        }
        const data = (await response.json()) as TriggerScheduleResponse;
        return data.triggerSchedule;
    });
}

export async function deleteTriggerSchedule(
    credentials: AuthCredentials,
    id: string,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/trigger-schedules/${id}`, {
            method: "DELETE",
            headers: authHeaders(credentials),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error((data as Record<string, string>).error ?? `Failed to delete trigger schedule: ${response.status}`);
        }
    });
}
