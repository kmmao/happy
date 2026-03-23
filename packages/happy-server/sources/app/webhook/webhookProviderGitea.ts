/**
 * Gitea webhook & issue provider implementation.
 *
 * Gitea has quirks: PATCH doesn't reliably update events on all versions,
 * so "update" is implemented as delete + create.
 */

import { log } from "@/utils/log";
import type { RepoCoordinates, ProviderWebhookResult, WebhookProvider, CreateIssueResult } from "./webhookProviderTypes";
import { readErrorBody } from "./webhookProviderTypes";

// Gitea requires explicit granular events — unlike GitHub, top-level names
// like "pull_request" do NOT auto-enable sub-events on all Gitea versions.
const GITEA_EVENTS = [
    "issues",
    "issue_assign",
    "issue_label",
    "issue_milestone",
    "issue_comment",
    "pull_request",
    "pull_request_assign",
    "pull_request_label",
    "pull_request_milestone",
    "pull_request_comment",
    "pull_request_review",
    "pull_request_sync",
] as const;

function authHeaders(apiToken: string): Record<string, string> {
    return { Authorization: `token ${apiToken}` };
}

function hooksUrl(coords: RepoCoordinates): string {
    return `${coords.apiBase}/repos/${coords.owner}/${coords.repo}/hooks`;
}

/**
 * List all webhooks on a Gitea repo and delete any that match our callbackUrl.
 * Prevents duplicate webhooks from accumulating.
 */
async function cleanupWebhooks(
    coords: RepoCoordinates,
    apiToken: string,
    callbackUrl: string,
): Promise<void> {
    const response = await fetch(hooksUrl(coords), {
        headers: authHeaders(apiToken),
    });

    if (!response.ok) {
        log(
            { module: "webhook", level: "warn" },
            `Gitea list webhooks failed: ${response.status}`,
        );
        return;
    }

    const hooks = await response.json() as ReadonlyArray<{
        id: number;
        config: { url?: string };
    }>;

    const staleHooks = hooks.filter((h) => h.config.url === callbackUrl);
    if (staleHooks.length > 0) {
        log(
            { module: "webhook" },
            `Gitea cleanup: removing ${staleHooks.length} existing webhook(s) with url=${callbackUrl}`,
        );
    }

    for (const hook of staleHooks) {
        await del(coords, apiToken, String(hook.id));
    }
}

async function create(
    coords: RepoCoordinates,
    apiToken: string,
    callbackUrl: string,
    webhookSecret: string,
): Promise<ProviderWebhookResult> {
    // Remove any existing webhooks with the same callback URL first
    await cleanupWebhooks(coords, apiToken, callbackUrl);

    const url = hooksUrl(coords);
    const headers = authHeaders(apiToken);

    log(
        { module: "webhook" },
        `Gitea create webhook: POST ${url} events=[${GITEA_EVENTS.join(",")}]`,
    );

    const createResponse = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
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
    });

    const createText = await readErrorBody(createResponse);
    if (!createResponse.ok) {
        throw new Error(`Gitea create webhook failed: ${createResponse.status} ${createText}`);
    }

    const created = JSON.parse(createText) as { id: number | string };
    const hookId = String(created.id);

    // Verify: GET the webhook back and check if PR events were actually saved.
    // Some Gitea versions echo back events in POST response without persisting them.
    const getResponse = await fetch(`${url}/${hookId}`, { headers });

    if (getResponse.ok) {
        const stored = await getResponse.json() as { events?: string[] };
        const storedEvents = stored.events ?? [];
        const hasPR = storedEvents.includes("pull_request");

        log(
            { module: "webhook" },
            `Gitea webhook ${hookId} stored events: [${storedEvents.join(",")}] hasPR=${hasPR}`,
        );

        if (!hasPR) {
            // PR events were not persisted — try PATCH as fallback
            log(
                { module: "webhook", level: "warn" },
                `Gitea webhook ${hookId} missing PR events after create, trying PATCH...`,
            );

            const patchResponse = await fetch(`${url}/${hookId}`, {
                method: "PATCH",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({
                    events: [...GITEA_EVENTS],
                    active: true,
                }),
            });

            if (patchResponse.ok) {
                const verifyResponse = await fetch(`${url}/${hookId}`, { headers });
                if (verifyResponse.ok) {
                    const patched = await verifyResponse.json() as { events?: string[] };
                    log(
                        { module: "webhook" },
                        `Gitea webhook ${hookId} events after PATCH: [${(patched.events ?? []).join(",")}]`,
                    );
                }
            } else {
                const patchText = await readErrorBody(patchResponse);
                log(
                    { module: "webhook", level: "warn" },
                    `Gitea PATCH events failed: ${patchResponse.status} ${patchText}`,
                );
            }
        }
    }

    return { remoteWebhookId: hookId };
}

/**
 * Gitea's PATCH endpoint does not reliably update events on all versions.
 * Strategy: cleanup all matching webhooks and create a fresh one.
 */
async function update(
    coords: RepoCoordinates,
    apiToken: string,
    _remoteWebhookId: string,
    callbackUrl: string,
    webhookSecret: string,
): Promise<ProviderWebhookResult> {
    // create() already runs cleanupWebhooks internally
    return create(coords, apiToken, callbackUrl, webhookSecret);
}

async function del(
    coords: RepoCoordinates,
    apiToken: string,
    remoteWebhookId: string,
): Promise<void> {
    const response = await fetch(
        `${hooksUrl(coords)}/${remoteWebhookId}`,
        {
            method: "DELETE",
            headers: authHeaders(apiToken),
        },
    );

    if (!response.ok && response.status !== 404) {
        throw new Error(`Gitea delete webhook failed: ${response.status}`);
    }
}

export const giteaProvider: WebhookProvider = { create, update, del };

// ── Issue Creation ────────────────────────────────────────

/**
 * Resolve Gitea label names to IDs. Creates missing labels automatically.
 */
async function resolveGiteaLabelIds(
    coords: RepoCoordinates,
    apiToken: string,
    labels: readonly string[],
): Promise<number[]> {
    const labelsUrl = `${coords.apiBase}/repos/${coords.owner}/${coords.repo}/labels`;
    const listResponse = await fetch(labelsUrl, {
        headers: authHeaders(apiToken),
    });

    if (!listResponse.ok) return [];

    const existingLabels = await listResponse.json() as ReadonlyArray<{
        id: number;
        name: string;
    }>;

    const ids: number[] = [];
    for (const name of labels) {
        const existing = existingLabels.find(
            (l) => l.name.toLowerCase() === name.toLowerCase(),
        );
        if (existing) {
            ids.push(existing.id);
        } else {
            const createResponse = await fetch(labelsUrl, {
                method: "POST",
                headers: {
                    ...authHeaders(apiToken),
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ name, color: "#6366f1" }),
            });
            if (createResponse.ok) {
                const created = await createResponse.json() as { id: number };
                ids.push(created.id);
            }
        }
    }

    return ids;
}

export async function createGiteaIssue(
    coords: RepoCoordinates,
    apiToken: string,
    title: string,
    body: string,
    labels?: readonly string[],
): Promise<CreateIssueResult> {
    let labelIds: number[] | undefined;
    if (labels && labels.length > 0) {
        labelIds = await resolveGiteaLabelIds(coords, apiToken, labels);
    }

    const response = await fetch(
        `${coords.apiBase}/repos/${coords.owner}/${coords.repo}/issues`,
        {
            method: "POST",
            headers: {
                ...authHeaders(apiToken),
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ title, body, labels: labelIds }),
        },
    );

    if (!response.ok) {
        const text = await readErrorBody(response);
        throw new Error(`Gitea create issue failed: ${response.status} ${text}`);
    }

    const data = await response.json() as { number: number; html_url: string };
    return { issueNumber: data.number, issueUrl: data.html_url };
}
