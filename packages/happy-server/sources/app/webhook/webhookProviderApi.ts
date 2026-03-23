/**
 * Auto-create / update / delete webhooks on Git platforms (GitHub, Gitea, GitLab).
 *
 * Called when a WebhookRoute is upserted or deleted, so users don't need to
 * manually configure webhook events on their Git host.
 *
 * Requires an API token with repo admin/webhook permissions.
 *
 * Provider-specific implementations live in:
 *   - webhookProviderGithub.ts
 *   - webhookProviderGitea.ts
 *   - webhookProviderGitlab.ts
 */

import { log } from "@/utils/log";
import type { RepoCoordinates, WebhookProvider } from "./webhookProviderTypes";
import { githubProvider, createGitHubIssue } from "./webhookProviderGithub";
import { giteaProvider, createGiteaIssue } from "./webhookProviderGitea";
import { gitlabProvider } from "./webhookProviderGitlab";

// Re-export types used by consumers
export type { CreateIssueResult } from "./webhookProviderTypes";

// ── Provider registry ────────────────────────────────────

const providers: Record<string, WebhookProvider> = {
    github: githubProvider,
    gitea: giteaProvider,
    gitlab: gitlabProvider,
};

// ── Repo URL → API coordinates ───────────────────────────

/**
 * Parse a normalized repoUrl into owner/repo and the correct API base.
 *
 * Examples:
 *   "https://github.com/owner/repo"          → apiBase: "https://api.github.com"
 *   "http://10.0.0.1:3000/owner/repo" (Gitea) → apiBase: "http://10.0.0.1:3000/api/v1"
 *   "https://gitlab.com/owner/repo"           → apiBase: "https://gitlab.com/api/v4"
 */
export function parseRepoCoordinates(
    provider: string,
    repoUrl: string,
): RepoCoordinates | null {
    try {
        const url = new URL(repoUrl);
        const segments = url.pathname.split("/").filter(Boolean);
        if (segments.length < 2) return null;

        const owner = segments[0]!;
        const repo = segments[1]!;

        // Validate owner/repo to prevent path injection
        const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;
        if (!SAFE_SEGMENT.test(owner) || !SAFE_SEGMENT.test(repo)) return null;

        if (provider === "github") {
            return { owner, repo, apiBase: "https://api.github.com" };
        }

        if (provider === "gitea") {
            return { owner, repo, apiBase: `${url.protocol}//${url.host}/api/v1` };
        }

        if (provider === "gitlab") {
            return { owner, repo, apiBase: `${url.protocol}//${url.host}/api/v4` };
        }

        return null;
    } catch {
        return null;
    }
}

// ── Issue Creation ────────────────────────────────────────

/**
 * Create an issue on the Git platform.
 * Returns null on any error — callers should treat issue creation as best-effort.
 */
export async function createIssueOnProvider(
    provider: string,
    repoUrl: string,
    apiToken: string,
    title: string,
    body: string,
    labels?: readonly string[],
): Promise<import("./webhookProviderTypes").CreateIssueResult | null> {
    const coords = parseRepoCoordinates(provider, repoUrl);
    if (!coords) {
        log(
            { module: "webhook", level: "warn" },
            `Cannot parse repo coordinates for issue creation: ${repoUrl}`,
        );
        return null;
    }

    try {
        if (provider === "github") {
            return await createGitHubIssue(coords, apiToken, title, body, labels);
        }
        if (provider === "gitea") {
            return await createGiteaIssue(coords, apiToken, title, body, labels);
        }
        log(
            { module: "webhook" },
            `Issue creation not supported for provider: ${provider}`,
        );
        return null;
    } catch (error) {
        log(
            { module: "webhook", level: "error" },
            `Failed to create issue on ${provider} for ${repoUrl}: ${error}`,
        );
        return null;
    }
}

// ── Public Webhook API ────────────────────────────────────

/**
 * Ensure a remote webhook exists on the Git platform with correct events.
 * Creates a new webhook or updates an existing one.
 *
 * @returns The remote webhook ID, or null if the provider is unsupported or has no API token.
 */
export async function ensureRemoteWebhook(
    provider: string,
    repoUrl: string,
    apiToken: string | undefined,
    webhookSecret: string,
    callbackUrl: string,
    existingRemoteId: string | null,
): Promise<string | null> {
    if (!apiToken) {
        log(
            { module: "webhook" },
            `Skipping remote webhook creation: no API token for ${repoUrl}`,
        );
        return existingRemoteId;
    }

    const coords = parseRepoCoordinates(provider, repoUrl);
    if (!coords) {
        log(
            { module: "webhook", level: "warn" },
            `Cannot parse repo coordinates from ${repoUrl} for provider ${provider}`,
        );
        return existingRemoteId;
    }

    const webhookProvider = providers[provider];
    if (!webhookProvider) return null;

    try {
        if (existingRemoteId) {
            const result = await webhookProvider.update(
                coords, apiToken, existingRemoteId, callbackUrl, webhookSecret,
            );
            // Gitea update returns a new ID; GitHub/GitLab return void
            const newId = result?.remoteWebhookId ?? existingRemoteId;
            log(
                { module: "webhook" },
                existingRemoteId === newId
                    ? `Updated remote webhook ${existingRemoteId} on ${provider} for ${repoUrl}`
                    : `Recreated remote webhook ${existingRemoteId} → ${newId} on ${provider} for ${repoUrl}`,
            );
            return newId;
        }

        const result = await webhookProvider.create(coords, apiToken, callbackUrl, webhookSecret);
        log(
            { module: "webhook" },
            `Created remote webhook ${result.remoteWebhookId} on ${provider} for ${repoUrl}`,
        );
        return result.remoteWebhookId;
    } catch (error) {
        log(
            { module: "webhook", level: "error" },
            `Failed to ensure remote webhook on ${provider} for ${repoUrl}: ${error}`,
        );
        return existingRemoteId;
    }
}

/**
 * Delete a remote webhook from the Git platform.
 * Best-effort: logs errors but does not throw.
 */
export async function deleteRemoteWebhook(
    provider: string,
    repoUrl: string,
    apiToken: string | undefined,
    remoteWebhookId: string,
): Promise<void> {
    if (!apiToken) return;

    const coords = parseRepoCoordinates(provider, repoUrl);
    if (!coords) return;

    const webhookProvider = providers[provider];
    if (!webhookProvider) return;

    try {
        await webhookProvider.del(coords, apiToken, remoteWebhookId);
        log(
            { module: "webhook" },
            `Deleted remote webhook ${remoteWebhookId} on ${provider} for ${repoUrl}`,
        );
    } catch (error) {
        log(
            { module: "webhook", level: "error" },
            `Failed to delete remote webhook ${remoteWebhookId} on ${provider}: ${error}`,
        );
    }
}
