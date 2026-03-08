/**
 * Sync webhook routes between App settings and Server.
 *
 * When the user saves gitHosts with webhook enabled, this module:
 * 1. Upserts the WebhookRoute on the Server via REST API
 * 2. Stores the returned route ID back in the gitHost entry
 * 3. Deletes routes that are no longer webhook-enabled
 */

import { getServerUrl } from "./serverConfig";
import type { AuthCredentials } from "@/auth/tokenStorage";
import type { GitHostMapping } from "./issueTypes";

interface WebhookRouteResponse {
    readonly id: string;
    readonly repoUrl: string;
}

/**
 * Upsert a webhook route on the Server.
 * Returns the route ID for storing in the gitHost entry.
 */
export async function upsertWebhookRoute(
    credentials: AuthCredentials,
    host: GitHostMapping,
): Promise<WebhookRouteResponse> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/webhooks/routes`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${credentials.token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            provider: host.provider,
            repoUrl: host.webhookRepoUrl,
            webhookSecret: host.webhookSecret,
            labels: host.autoIssueLabel ? [host.autoIssueLabel] : [],
            authors: host.autoIssueAllowedAuthors ?? [],
            machineId: host.webhookMachineId,
            repoPath: host.webhookRepoPath,
            enabled: host.webhookEnabled ?? false,
        }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Failed to upsert webhook route: ${response.status} ${text}`);
    }

    return response.json();
}

/**
 * Delete a webhook route from the Server.
 */
export async function deleteWebhookRoute(
    credentials: AuthCredentials,
    routeId: string,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(
        `${API_ENDPOINT}/v1/webhooks/routes/${routeId}`,
        {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${credentials.token}`,
            },
        },
    );

    if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete webhook route: ${response.status}`);
    }
}

/**
 * Fetch all webhook routes from the Server.
 */
export async function fetchWebhookRoutes(
    credentials: AuthCredentials,
): Promise<readonly WebhookRouteResponse[]> {
    const API_ENDPOINT = getServerUrl();

    const response = await fetch(`${API_ENDPOINT}/v1/webhooks/routes`, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${credentials.token}`,
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch webhook routes: ${response.status}`);
    }

    return response.json();
}

/**
 * Generate a random webhook secret (32 bytes hex).
 */
export function generateWebhookSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Build the webhook URL that users should configure in their Git host.
 */
export function getWebhookUrl(provider: string): string {
    const serverUrl = getServerUrl();
    return `${serverUrl}/v1/webhooks/${provider}`;
}

/**
 * Sync a single gitHost's webhook config to the Server.
 * Returns the updated gitHost with the routeId populated.
 */
export async function syncWebhookRoute(
    credentials: AuthCredentials,
    host: GitHostMapping,
): Promise<GitHostMapping> {
    if (
        host.webhookEnabled &&
        host.webhookSecret &&
        host.webhookMachineId &&
        host.webhookRepoPath &&
        host.webhookRepoUrl
    ) {
        // Upsert route on server
        const result = await upsertWebhookRoute(credentials, host);
        return { ...host, webhookRouteId: result.id };
    } else if (!host.webhookEnabled && host.webhookRouteId) {
        // Delete route from server
        await deleteWebhookRoute(credentials, host.webhookRouteId);
        return { ...host, webhookRouteId: undefined };
    }

    return host;
}
