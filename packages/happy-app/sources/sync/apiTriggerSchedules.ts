import { AuthCredentials } from "@/auth/tokenStorage";
import { apiRequest, apiRequestVoid } from "./apiRequest";

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
    return await apiRequest<TriggerScheduleListResponse>(credentials, "/v1/trigger-schedules", {
        query: {
            machineId: opts?.machineId || undefined,
            projectId: opts?.projectId || undefined,
            enabled: opts?.enabled,
            limit: opts?.limit || undefined,
            offset: opts?.offset || undefined,
        },
        errorMessage: "Failed to fetch trigger schedules",
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
    const data = await apiRequest<TriggerScheduleResponse>(credentials, "/v1/trigger-schedules", {
        method: "POST",
        body,
        errorMessage: "Failed to create trigger schedule",
    });
    return data.triggerSchedule;
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
    const data = await apiRequest<TriggerScheduleResponse>(credentials, `/v1/trigger-schedules/${id}`, {
        method: "PATCH",
        body,
        errorMessage: "Failed to update trigger schedule",
    });
    return data.triggerSchedule;
}

export async function toggleTriggerSchedule(
    credentials: AuthCredentials,
    id: string,
): Promise<ServerTriggerSchedule> {
    const data = await apiRequest<TriggerScheduleResponse>(credentials, `/v1/trigger-schedules/${id}/toggle`, {
        method: "POST",
        errorMessage: "Failed to toggle trigger schedule",
    });
    return data.triggerSchedule;
}

export async function deleteTriggerSchedule(
    credentials: AuthCredentials,
    id: string,
): Promise<void> {
    await apiRequestVoid(credentials, `/v1/trigger-schedules/${id}`, {
        method: "DELETE",
        errorMessage: "Failed to delete trigger schedule",
    });
}
