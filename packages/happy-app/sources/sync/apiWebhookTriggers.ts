import { AuthCredentials } from "@/auth/tokenStorage";
import { apiRequest, apiRequestVoid } from "./apiRequest";

export interface ServerWebhookTrigger {
    id: string;
    projectId: string | null;
    machineId: string;
    name: string | null;
    slug: string;
    prompt: string;
    priority: string;
    enabled: boolean;
    skillIds: string[];
    lastTriggeredAt: number | null;
    triggerCount: number;
    profileId: string | null;
    modelMode: string | null;
    effort: string | null;
    createdAt: number;
    updatedAt: number;
}

interface WebhookTriggerListResponse {
    webhookTriggers: ServerWebhookTrigger[];
    total: number;
}

interface WebhookTriggerResponse {
    webhookTrigger: ServerWebhookTrigger;
}

interface CreateWebhookTriggerResponse {
    webhookTrigger: ServerWebhookTrigger;
    secret: string;
}

export async function fetchWebhookTriggers(
    credentials: AuthCredentials,
    opts?: {
        machineId?: string;
        projectId?: string;
        enabled?: boolean;
        limit?: number;
        offset?: number;
    },
): Promise<{ webhookTriggers: ServerWebhookTrigger[]; total: number }> {
    return await apiRequest<WebhookTriggerListResponse>(credentials, "/v1/webhook-triggers", {
        query: {
            machineId: opts?.machineId || undefined,
            projectId: opts?.projectId || undefined,
            enabled: opts?.enabled,
            limit: opts?.limit || undefined,
            offset: opts?.offset || undefined,
        },
        errorMessage: "Failed to fetch webhook triggers",
    });
}

export async function createWebhookTrigger(
    credentials: AuthCredentials,
    body: {
        machineId: string;
        slug: string;
        prompt: string;
        name?: string;
        priority?: string;
        projectId?: string;
        skillIds?: string[];
        profileId?: string;
        modelMode?: string | null;
        effort?: string | null;
    },
): Promise<{ webhookTrigger: ServerWebhookTrigger; secret: string }> {
    return await apiRequest<CreateWebhookTriggerResponse>(credentials, "/v1/webhook-triggers", {
        method: "POST",
        body,
        errorMessage: "Failed to create webhook trigger",
    });
}

export async function updateWebhookTrigger(
    credentials: AuthCredentials,
    id: string,
    body: {
        name?: string | null;
        prompt?: string;
        priority?: string;
        enabled?: boolean;
        skillIds?: string[];
        profileId?: string | null;
        modelMode?: string | null;
        effort?: string | null;
    },
): Promise<ServerWebhookTrigger> {
    const data = await apiRequest<WebhookTriggerResponse>(credentials, `/v1/webhook-triggers/${id}`, {
        method: "PATCH",
        body,
        errorMessage: "Failed to update webhook trigger",
    });
    return data.webhookTrigger;
}

export async function regenerateWebhookSecret(
    credentials: AuthCredentials,
    id: string,
): Promise<string> {
    const data = await apiRequest<{ secret: string }>(credentials, `/v1/webhook-triggers/${id}/regenerate-secret`, {
        method: "POST",
        errorMessage: "Failed to regenerate secret",
    });
    return data.secret;
}

export async function deleteWebhookTrigger(
    credentials: AuthCredentials,
    id: string,
): Promise<void> {
    await apiRequestVoid(credentials, `/v1/webhook-triggers/${id}`, {
        method: "DELETE",
        errorMessage: "Failed to delete webhook trigger",
    });
}
