/**
 * Shared types and helpers for webhook provider implementations.
 */

import { log } from "@/utils/log";

export interface ProviderWebhookResult {
    readonly remoteWebhookId: string;
}

export interface RepoCoordinates {
    readonly owner: string;
    readonly repo: string;
    readonly apiBase: string;
}

export interface CreateIssueResult {
    readonly issueNumber: number;
    readonly issueUrl: string;
}

/**
 * Common interface for all Git platform webhook providers.
 *
 * `update` may return a new webhook ID (e.g. Gitea recreates on update)
 * or void (GitHub/GitLab patch in-place).
 */
export interface WebhookProvider {
    readonly create: (
        coords: RepoCoordinates,
        apiToken: string,
        callbackUrl: string,
        webhookSecret: string,
    ) => Promise<ProviderWebhookResult>;
    readonly update: (
        coords: RepoCoordinates,
        apiToken: string,
        remoteWebhookId: string,
        callbackUrl: string,
        webhookSecret: string,
    ) => Promise<ProviderWebhookResult | void>;
    readonly del: (
        coords: RepoCoordinates,
        apiToken: string,
        remoteWebhookId: string,
    ) => Promise<void>;
}

/**
 * Safely read an error response body for logging.
 * Returns empty string on failure.
 */
export async function readErrorBody(response: Response): Promise<string> {
    return response.text().catch((err) => {
        log({ module: "webhook", level: "warn" }, "Failed to read response body", err);
        return "";
    });
}
