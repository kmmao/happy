/**
 * GitLab webhook provider implementation.
 *
 * GitLab uses URL-encoded project path instead of separate owner/repo,
 * and events are boolean fields rather than an array.
 */

import type { RepoCoordinates, ProviderWebhookResult, WebhookProvider } from "./webhookProviderTypes";
import { readErrorBody } from "./webhookProviderTypes";

function projectId(coords: RepoCoordinates): string {
    return encodeURIComponent(`${coords.owner}/${coords.repo}`);
}

function authHeaders(apiToken: string): Record<string, string> {
    return {
        "PRIVATE-TOKEN": apiToken,
        "Content-Type": "application/json",
    };
}

async function create(
    coords: RepoCoordinates,
    apiToken: string,
    callbackUrl: string,
    webhookSecret: string,
): Promise<ProviderWebhookResult> {
    const response = await fetch(
        `${coords.apiBase}/projects/${projectId(coords)}/hooks`,
        {
            method: "POST",
            headers: authHeaders(apiToken),
            body: JSON.stringify({
                url: callbackUrl,
                token: webhookSecret,
                issues_events: true,
                merge_requests_events: true,
                push_events: false,
                enable_ssl_verification: true,
            }),
        },
    );

    if (!response.ok) {
        const text = await readErrorBody(response);
        throw new Error(`GitLab create webhook failed: ${response.status} ${text}`);
    }

    const data = await response.json() as { id: number | string };
    return { remoteWebhookId: String(data.id) };
}

async function update(
    coords: RepoCoordinates,
    apiToken: string,
    remoteWebhookId: string,
    callbackUrl: string,
    webhookSecret: string,
): Promise<void> {
    const response = await fetch(
        `${coords.apiBase}/projects/${projectId(coords)}/hooks/${remoteWebhookId}`,
        {
            method: "PUT",
            headers: authHeaders(apiToken),
            body: JSON.stringify({
                url: callbackUrl,
                token: webhookSecret,
                issues_events: true,
                merge_requests_events: true,
                push_events: false,
                enable_ssl_verification: true,
            }),
        },
    );

    if (!response.ok) {
        const text = await readErrorBody(response);
        throw new Error(`GitLab update webhook failed: ${response.status} ${text}`);
    }
}

async function del(
    coords: RepoCoordinates,
    apiToken: string,
    remoteWebhookId: string,
): Promise<void> {
    const response = await fetch(
        `${coords.apiBase}/projects/${projectId(coords)}/hooks/${remoteWebhookId}`,
        {
            method: "DELETE",
            headers: { "PRIVATE-TOKEN": apiToken },
        },
    );

    if (!response.ok && response.status !== 404) {
        throw new Error(`GitLab delete webhook failed: ${response.status}`);
    }
}

export const gitlabProvider: WebhookProvider = { create, update, del };
