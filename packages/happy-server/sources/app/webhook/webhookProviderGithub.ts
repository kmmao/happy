/**
 * GitHub webhook & issue provider implementation.
 */

import { log } from "@/utils/log";
import type { RepoCoordinates, ProviderWebhookResult, WebhookProvider, CreateIssueResult } from "./webhookProviderTypes";
import { readErrorBody } from "./webhookProviderTypes";

const GITHUB_EVENTS = ["issues", "pull_request"] as const;

function authHeaders(apiToken: string): Record<string, string> {
    return {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
    };
}

async function create(
    coords: RepoCoordinates,
    apiToken: string,
    callbackUrl: string,
    webhookSecret: string,
): Promise<ProviderWebhookResult> {
    const response = await fetch(
        `${coords.apiBase}/repos/${coords.owner}/${coords.repo}/hooks`,
        {
            method: "POST",
            headers: authHeaders(apiToken),
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
        const text = await readErrorBody(response);
        throw new Error(`GitHub create webhook failed: ${response.status} ${text}`);
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
        `${coords.apiBase}/repos/${coords.owner}/${coords.repo}/hooks/${remoteWebhookId}`,
        {
            method: "PATCH",
            headers: authHeaders(apiToken),
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
        const text = await readErrorBody(response);
        throw new Error(`GitHub update webhook failed: ${response.status} ${text}`);
    }
}

async function del(
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

export const githubProvider: WebhookProvider = { create, update, del };

// ── Issue Creation ────────────────────────────────────────

export async function createGitHubIssue(
    coords: RepoCoordinates,
    apiToken: string,
    title: string,
    body: string,
    labels?: readonly string[],
): Promise<CreateIssueResult> {
    const response = await fetch(
        `${coords.apiBase}/repos/${coords.owner}/${coords.repo}/issues`,
        {
            method: "POST",
            headers: authHeaders(apiToken),
            body: JSON.stringify({
                title,
                body,
                labels: labels ? [...labels] : undefined,
            }),
        },
    );

    if (!response.ok) {
        const text = await readErrorBody(response);
        throw new Error(`GitHub create issue failed: ${response.status} ${text}`);
    }

    const data = await response.json() as { number: number; html_url: string };
    return { issueNumber: data.number, issueUrl: data.html_url };
}
