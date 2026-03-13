/**
 * Auto-create / update / delete webhooks on Git platforms (GitHub, Gitea, GitLab).
 *
 * Called when a WebhookRoute is upserted or deleted, so users don't need to
 * manually configure webhook events on their Git host.
 *
 * Requires an API token with repo admin/webhook permissions.
 */

import { log } from "@/utils/log";

// ── Types ────────────────────────────────────────────────

interface ProviderWebhookResult {
    readonly remoteWebhookId: string;
}

interface RepoCoordinates {
    readonly owner: string;
    readonly repo: string;
    readonly apiBase: string;
}

// ── Events each provider needs ───────────────────────────

const GITHUB_EVENTS = ["issues", "pull_request"] as const;
const GITEA_EVENTS = ["issues", "issue_label", "pull_request"] as const;

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

// ── GitHub ────────────────────────────────────────────────

async function createGitHubWebhook(
    coords: RepoCoordinates,
    apiToken: string,
    callbackUrl: string,
    webhookSecret: string,
): Promise<ProviderWebhookResult> {
    const response = await fetch(
        `${coords.apiBase}/repos/${coords.owner}/${coords.repo}/hooks`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
                Accept: "application/vnd.github+json",
            },
            body: JSON.stringify({
                name: "web",
                config: {
                    url: callbackUrl,
                    content_type: "json",
                    secret: webhookSecret,
                    insecure_ssl: "0",
                },
                events: [...GITHUB_EVENTS],
                active: true,
            }),
        },
    );

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`GitHub create webhook failed: ${response.status} ${text}`);
    }

    const data = await response.json() as { id: number | string };
    return { remoteWebhookId: String(data.id) };
}

async function updateGitHubWebhook(
    coords: RepoCoordinates,
    apiToken: string,
    remoteWebhookId: string,
    callbackUrl: string,
    webhookSecret: string,
): Promise<void> {
    const response = await fetch(
        `${coords.apiBase}/repos/${coords.owner}/${coords.repo}/hooks/${remoteWebhookId}`,
        {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
                Accept: "application/vnd.github+json",
            },
            body: JSON.stringify({
                config: {
                    url: callbackUrl,
                    content_type: "json",
                    secret: webhookSecret,
                    insecure_ssl: "0",
                },
                events: [...GITHUB_EVENTS],
                active: true,
            }),
        },
    );

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`GitHub update webhook failed: ${response.status} ${text}`);
    }
}

async function deleteGitHubWebhook(
    coords: RepoCoordinates,
    apiToken: string,
    remoteWebhookId: string,
): Promise<void> {
    const response = await fetch(
        `${coords.apiBase}/repos/${coords.owner}/${coords.repo}/hooks/${remoteWebhookId}`,
        {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${apiToken}`,
                Accept: "application/vnd.github+json",
            },
        },
    );

    if (!response.ok && response.status !== 404) {
        throw new Error(`GitHub delete webhook failed: ${response.status}`);
    }
}

// ── Gitea ─────────────────────────────────────────────────

async function createGiteaWebhook(
    coords: RepoCoordinates,
    apiToken: string,
    callbackUrl: string,
    webhookSecret: string,
): Promise<ProviderWebhookResult> {
    const response = await fetch(
        `${coords.apiBase}/repos/${coords.owner}/${coords.repo}/hooks`,
        {
            method: "POST",
            headers: {
                Authorization: `token ${apiToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                type: "gitea",
                config: {
                    url: callbackUrl,
                    content_type: "json",
                    secret: webhookSecret,
                },
                events: [...GITEA_EVENTS],
                active: true,
            }),
        },
    );

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Gitea create webhook failed: ${response.status} ${text}`);
    }

    const data = await response.json() as { id: number | string };
    return { remoteWebhookId: String(data.id) };
}

async function updateGiteaWebhook(
    coords: RepoCoordinates,
    apiToken: string,
    remoteWebhookId: string,
    callbackUrl: string,
    webhookSecret: string,
): Promise<void> {
    const response = await fetch(
        `${coords.apiBase}/repos/${coords.owner}/${coords.repo}/hooks/${remoteWebhookId}`,
        {
            method: "PATCH",
            headers: {
                Authorization: `token ${apiToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                config: {
                    url: callbackUrl,
                    content_type: "json",
                    secret: webhookSecret,
                },
                events: [...GITEA_EVENTS],
                active: true,
            }),
        },
    );

    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Gitea update webhook failed: ${response.status} ${text}`);
    }
}

async function deleteGiteaWebhook(
    coords: RepoCoordinates,
    apiToken: string,
    remoteWebhookId: string,
): Promise<void> {
    const response = await fetch(
        `${coords.apiBase}/repos/${coords.owner}/${coords.repo}/hooks/${remoteWebhookId}`,
        {
            method: "DELETE",
            headers: {
                Authorization: `token ${apiToken}`,
            },
        },
    );

    if (!response.ok && response.status !== 404) {
        throw new Error(`Gitea delete webhook failed: ${response.status}`);
    }
}

// ── GitLab ────────────────────────────────────────────────

/**
 * GitLab uses URL-encoded project path instead of separate owner/repo.
 * API: POST /api/v4/projects/:id/hooks
 * Events are boolean fields, not an array.
 */

function gitlabProjectId(coords: RepoCoordinates): string {
    return encodeURIComponent(`${coords.owner}/${coords.repo}`);
}

async function createGitLabWebhook(
    coords: RepoCoordinates,
    apiToken: string,
    callbackUrl: string,
    webhookSecret: string,
): Promise<ProviderWebhookResult> {
    const projectId = gitlabProjectId(coords);
    const response = await fetch(
        `${coords.apiBase}/projects/${projectId}/hooks`,
        {
            method: "POST",
            headers: {
                "PRIVATE-TOKEN": apiToken,
                "Content-Type": "application/json",
            },
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
        const text = await response.text().catch(() => "");
        throw new Error(`GitLab create webhook failed: ${response.status} ${text}`);
    }

    const data = await response.json() as { id: number | string };
    return { remoteWebhookId: String(data.id) };
}

async function updateGitLabWebhook(
    coords: RepoCoordinates,
    apiToken: string,
    remoteWebhookId: string,
    callbackUrl: string,
    webhookSecret: string,
): Promise<void> {
    const projectId = gitlabProjectId(coords);
    const response = await fetch(
        `${coords.apiBase}/projects/${projectId}/hooks/${remoteWebhookId}`,
        {
            method: "PUT",
            headers: {
                "PRIVATE-TOKEN": apiToken,
                "Content-Type": "application/json",
            },
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
        const text = await response.text().catch(() => "");
        throw new Error(`GitLab update webhook failed: ${response.status} ${text}`);
    }
}

async function deleteGitLabWebhook(
    coords: RepoCoordinates,
    apiToken: string,
    remoteWebhookId: string,
): Promise<void> {
    const projectId = gitlabProjectId(coords);
    const response = await fetch(
        `${coords.apiBase}/projects/${projectId}/hooks/${remoteWebhookId}`,
        {
            method: "DELETE",
            headers: {
                "PRIVATE-TOKEN": apiToken,
            },
        },
    );

    if (!response.ok && response.status !== 404) {
        throw new Error(`GitLab delete webhook failed: ${response.status}`);
    }
}

// ── Public API ────────────────────────────────────────────

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

    const createFn = provider === "github" ? createGitHubWebhook
        : provider === "gitea" ? createGiteaWebhook
        : provider === "gitlab" ? createGitLabWebhook
        : null;

    const updateFn = provider === "github" ? updateGitHubWebhook
        : provider === "gitea" ? updateGiteaWebhook
        : provider === "gitlab" ? updateGitLabWebhook
        : null;

    if (!createFn || !updateFn) return null;

    try {
        if (existingRemoteId) {
            await updateFn(coords, apiToken, existingRemoteId, callbackUrl, webhookSecret);
            log(
                { module: "webhook" },
                `Updated remote webhook ${existingRemoteId} on ${provider} for ${repoUrl}`,
            );
            return existingRemoteId;
        }

        const result = await createFn(coords, apiToken, callbackUrl, webhookSecret);
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

    const deleteFn = provider === "github" ? deleteGitHubWebhook
        : provider === "gitea" ? deleteGiteaWebhook
        : provider === "gitlab" ? deleteGitLabWebhook
        : null;

    if (!deleteFn) return;

    try {
        await deleteFn(coords, apiToken, remoteWebhookId);
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
