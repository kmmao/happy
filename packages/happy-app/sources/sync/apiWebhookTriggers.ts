import { AuthCredentials } from "@/auth/tokenStorage";
import { backoff } from "@/utils/time";
import { getServerUrl } from "./serverConfig";

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

function authHeaders(credentials: AuthCredentials) {
    return {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
    };
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
            `${API_ENDPOINT}/v1/webhook-triggers${qs ? `?${qs}` : ""}`,
            { headers: authHeaders(credentials) },
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch webhook triggers: ${response.status}`);
        }
        return (await response.json()) as WebhookTriggerListResponse;
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
    },
): Promise<{ webhookTrigger: ServerWebhookTrigger; secret: string }> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/webhook-triggers`, {
            method: "POST",
            headers: authHeaders(credentials),
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error((data as Record<string, string>).error ?? `Failed to create webhook trigger: ${response.status}`);
        }
        return (await response.json()) as CreateWebhookTriggerResponse;
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
    },
): Promise<ServerWebhookTrigger> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/webhook-triggers/${id}`, {
            method: "PATCH",
            headers: authHeaders(credentials),
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error((data as Record<string, string>).error ?? `Failed to update webhook trigger: ${response.status}`);
        }
        const data = (await response.json()) as WebhookTriggerResponse;
        return data.webhookTrigger;
    });
}

export async function regenerateWebhookSecret(
    credentials: AuthCredentials,
    id: string,
): Promise<string> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/webhook-triggers/${id}/regenerate-secret`, {
            method: "POST",
            headers: authHeaders(credentials),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error((data as Record<string, string>).error ?? `Failed to regenerate secret: ${response.status}`);
        }
        const data = (await response.json()) as { secret: string };
        return data.secret;
    });
}

export async function deleteWebhookTrigger(
    credentials: AuthCredentials,
    id: string,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/webhook-triggers/${id}`, {
            method: "DELETE",
            headers: authHeaders(credentials),
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error((data as Record<string, string>).error ?? `Failed to delete webhook trigger: ${response.status}`);
        }
    });
}
