/**
 * Fetch real issue labels from Git provider APIs.
 *
 * Used when the webhook payload doesn't include label data
 * (e.g. Gitea label_updated events on older versions).
 */

import { log } from "@/utils/log";
import { decryptString } from "@/modules/encrypt";

interface FetchLabelsParams {
    readonly provider: string;
    readonly repoUrl: string;
    readonly issueNumber: number;
    readonly encryptedApiToken: Uint8Array<ArrayBuffer>;
    readonly accountId: string;
}

/**
 * Build the API URL for fetching issue labels based on provider.
 *
 * - GitHub: https://api.github.com/repos/{owner}/{repo}/issues/{number}/labels
 * - Gitea:  {origin}/api/v1/repos/{owner}/{repo}/issues/{number}/labels
 * - GitLab: {origin}/api/v4/projects/{encoded_path}/issues/{iid}/labels (not yet needed)
 */
function buildLabelsApiUrl(
    provider: string,
    repoUrl: string,
    issueNumber: number,
): string | null {
    try {
        const url = new URL(repoUrl);
        // path = "/owner/repo" → ["", "owner", "repo"]
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length < 2) return null;
        const owner = parts[0];
        const repo = parts[1];

        switch (provider) {
            case "github":
                return `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`;
            case "gitea":
                return `${url.origin}/api/v1/repos/${owner}/${repo}/issues/${issueNumber}/labels`;
            case "gitlab": {
                const projectPath = encodeURIComponent(`${owner}/${repo}`);
                return `${url.origin}/api/v4/projects/${projectPath}/issues/${issueNumber}/labels`;
            }
            default:
                return null;
        }
    } catch {
        return null;
    }
}

/**
 * Fetch issue labels from the provider's API using the stored API token.
 * Returns lowercase label names, or null if the fetch fails.
 */
export async function fetchIssueLabelsFromProvider(
    params: FetchLabelsParams,
): Promise<string[] | null> {
    const { provider, repoUrl, issueNumber, encryptedApiToken, accountId } =
        params;

    const normalizedUrl = repoUrl
        .replace(/\.git$/, "")
        .replace(/\/+$/, "")
        .toLowerCase();

    let apiToken: string;
    try {
        apiToken = decryptString(
            ["webhook-route-token", `${accountId}:${normalizedUrl}`],
            encryptedApiToken,
        );
    } catch (error) {
        log(
            { module: "webhook", level: "error" },
            `Failed to decrypt API token for label fetch: ${error}`,
        );
        return null;
    }

    const apiUrl = buildLabelsApiUrl(provider, repoUrl, issueNumber);
    if (!apiUrl) {
        log(
            { module: "webhook", level: "warn" },
            `Cannot build labels API URL for provider=${provider}, repoUrl=${repoUrl}`,
        );
        return null;
    }

    const headers: Record<string, string> = {
        Accept: "application/json",
    };

    switch (provider) {
        case "github":
            headers["Authorization"] = `Bearer ${apiToken}`;
            break;
        case "gitea":
            headers["Authorization"] = `token ${apiToken}`;
            break;
        case "gitlab":
            headers["PRIVATE-TOKEN"] = apiToken;
            break;
    }

    try {
        const response = await fetch(apiUrl, {
            headers,
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            log(
                { module: "webhook", level: "warn" },
                `Labels API returned ${response.status} for ${apiUrl}`,
            );
            return null;
        }

        const data = await response.json();

        // GitHub/Gitea: array of { name: "label-name", ... }
        // GitLab: array of strings (label names)
        if (Array.isArray(data)) {
            return data.map((item: unknown) => {
                if (typeof item === "string") return item.toLowerCase();
                const record = item as Record<string, unknown>;
                return (typeof record.name === "string" ? record.name : "").toLowerCase();
            });
        }

        return null;
    } catch (error) {
        log(
            { module: "webhook", level: "error" },
            `Failed to fetch labels from ${apiUrl}: ${error}`,
        );
        return null;
    }
}
