import type { WebhookRepoConfig } from "@/sync/issueTypes";

export type Provider = "github" | "gitea";

export interface GitHost {
    readonly host: string;
    readonly provider: Provider;
    readonly apiToken?: string;
    readonly autoIssueEnabled?: boolean;
    readonly autoIssueLabel?: string;
    readonly autoIssueAllowedAuthors?: string[];
    readonly webhookRepos?: WebhookRepoConfig[];
}

export type GitHostTab = "basic" | "autoIssue" | "webhooks";
