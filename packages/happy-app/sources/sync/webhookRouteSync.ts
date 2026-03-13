/**
 * Sync webhook routes between App settings and Server.
 *
 * When the user saves gitHosts with webhook repos, this module:
 * 1. Upserts each enabled WebhookRoute on the Server via REST API
 * 2. Stores the returned route ID back in the repo config
 * 3. Deletes routes that are disabled or removed
 */

import { getServerUrl } from "./serverConfig";
import type { AuthCredentials } from "@/auth/tokenStorage";
import type { GitHostMapping, WebhookRepoConfig } from "./issueTypes";

interface WebhookRouteResponse {
  readonly id: string;
  readonly repoUrl: string;
  readonly remoteWebhookId: string | null;
}

/**
 * Upsert a single webhook route on the Server.
 */
async function upsertWebhookRoute(
  credentials: AuthCredentials,
  provider: string,
  repo: WebhookRepoConfig,
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
      provider,
      repoUrl: repo.repoUrl,
      webhookSecret: repo.secret,
      apiToken: host.apiToken || undefined,
      labels: host.autoIssueLabel
        ? host.autoIssueLabel.split(",").map((l) => l.trim().toLowerCase()).filter(Boolean)
        : [],
      authors: host.autoIssueAllowedAuthors ?? [],
      machineId: repo.machineId,
      repoPath: repo.repoPath,
      enabled: repo.enabled,
      callbackUrl: getWebhookUrl(provider),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to upsert webhook route: ${response.status} ${text}`,
    );
  }

  return response.json();
}

/**
 * Delete a webhook route from the Server.
 */
async function deleteWebhookRoute(
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
 * Sync all webhook repos for a single gitHost to the Server.
 * Returns the updated gitHost with routeIds populated.
 */
export async function syncWebhookRoutes(
  credentials: AuthCredentials,
  host: GitHostMapping,
): Promise<GitHostMapping> {
  const repos = host.webhookRepos ?? [];
  if (repos.length === 0) return host;

  const updatedRepos = await Promise.all(
    repos.map(async (repo): Promise<WebhookRepoConfig> => {
      if (repo.enabled && repo.secret && repo.machineId && repo.repoUrl) {
        const result = await upsertWebhookRoute(
          credentials,
          host.provider,
          repo,
          host,
        );
        return { ...repo, routeId: result.id };
      } else if (!repo.enabled && repo.routeId) {
        await deleteWebhookRoute(credentials, repo.routeId);
        return { ...repo, routeId: undefined };
      }
      return repo;
    }),
  );

  return { ...host, webhookRepos: updatedRepos };
}
