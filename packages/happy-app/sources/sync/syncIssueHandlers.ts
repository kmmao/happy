import { storage } from "./storage";
import { issueSessionStore } from "./issueSessionStore";
import type { IssueSessionLink } from "./issueSessionTypes";
import { isIssueSessionKey, buildIssueKey } from "./issueSessionTypes";
import { issueStore } from "./issueStore";
import {
    addIssueCommentViaMachine,
    updateIssueStateViaMachine,
} from "./issueFetch";
import { machineBash } from "./ops";
import { log } from "@/log";

/**
 * Extract "owner/repo" from a normalized repo URL.
 * Handles HTTPS URLs like "https://github.com/owner/repo" or
 * "https://gitea.example.com/owner/repo".
 */
export function extractRepoLabel(repoUrl: string): string {
    try {
        const url = new URL(repoUrl);
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length >= 2) {
            return `${parts[0]}/${parts[1]}`;
        }
    } catch {
        // Not a valid URL — fall through
    }
    return repoUrl;
}

/**
 * Ensure repoInfo is populated for a given issue session link.
 * Falls back to deriving repoUrl from the link's issueUrl if the
 * in-memory repoInfoByProject cache is empty (e.g. after app restart).
 */
export function ensureRepoInfo(link: IssueSessionLink) {
    const existing = issueStore.getState().repoInfoByProject[link.projectKey];
    if (existing && existing.provider !== "unknown") return existing;

    const { gitHosts } = storage.getState().settings;

    // Strategy 1: Derive repoUrl from issueUrl
    if (link.issueUrl) {
        const repoUrl = link.issueUrl
            .replace(/\?.*$/, "")
            .replace(/\/+$/, "")
            .replace(/\/issues\/\d+$/, "");
        if (repoUrl !== link.issueUrl && repoUrl.startsWith("http")) {
            issueStore.getState().detectRepoInfo(link.projectKey, repoUrl, gitHosts);
            const result = issueStore.getState().repoInfoByProject[link.projectKey];
            if (result) return result;
        }
    }

    // Strategy 2: Match machineId + repoPath against gitHosts webhookRepos config
    if (gitHosts) {
        for (const host of gitHosts) {
            for (const repo of host.webhookRepos ?? []) {
                if (repo.machineId === link.machineId && repo.repoPath === link.repoPath && repo.repoUrl) {
                    issueStore.getState().detectRepoInfo(link.projectKey, repo.repoUrl, gitHosts);
                    const result = issueStore.getState().repoInfoByProject[link.projectKey];
                    if (result) return result;
                }
            }
        }
    }

    return null;
}

/**
 * Query Gitea API for PRs matching a branch name.
 * Tries owner:branch format first, then falls back to branch-only.
 */
export async function queryGiteaPRs(
    machineId: string,
    repoInfo: { readonly apiBase?: string; readonly apiToken?: string; readonly owner: string; readonly repo: string },
    branchName: string,
): Promise<readonly { readonly html_url?: string; readonly merged?: boolean; readonly head?: { readonly ref?: string } }[]> {
    // Validate inputs to prevent shell injection
    const SAFE_SLUG = /^[a-zA-Z0-9._\-/]+$/;
    if (!SAFE_SLUG.test(branchName) || !SAFE_SLUG.test(repoInfo.owner) || !SAFE_SLUG.test(repoInfo.repo)) {
        return [];
    }
    if (!repoInfo.apiBase) return [];

    const authHeader = repoInfo.apiToken
        ? ` -H "Authorization: token ${repoInfo.apiToken}"`
        : "";
    const baseUrl = `${repoInfo.apiBase}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls?state=all`;
    // Use "/" as cwd to bypass path security (curl doesn't need a specific working directory)
    const safeCwd = "/";

    // Try owner:branch format first
    const result1 = await machineBash(
        machineId,
        `curl -s${authHeader} "${baseUrl}&head=${repoInfo.owner}:${branchName}" 2>&1`,
        safeCwd,
    );
    if (result1.success && result1.exitCode === 0) {
        try {
            const prs = JSON.parse((result1.stdout ?? "").trim());
            if (Array.isArray(prs) && prs.length > 0) return prs;
        } catch {
            // Malformed response, try fallback
        }
    }

    // Fallback: branch-only (some Gitea versions don't need owner prefix)
    const result2 = await machineBash(
        machineId,
        `curl -s${authHeader} "${baseUrl}&head=${branchName}" 2>&1`,
        safeCwd,
    );
    if (result2.success && result2.exitCode === 0) {
        try {
            const prs = JSON.parse((result2.stdout ?? "").trim());
            if (Array.isArray(prs) && prs.length > 0) return prs;
        } catch {
            // Malformed response
        }
    }

    return [];
}

/**
 * Detect if a PR exists for an issue session's worktree branch.
 * If found, record the prUrl on the link (stays processing).
 * Does NOT mark completed or close the issue — that's handleIssueSessionCompletion's job.
 */
export async function detectPRForIssueSession(
    link: IssueSessionLink,
): Promise<void> {
    try {
        const repoInfo = ensureRepoInfo(link);
        const session = storage.getState().sessions[link.sessionId];
        const branchName = session?.metadata?.worktree?.branchName;

        log.log(
            `🔄 [IssueSession] detectPR: issueKey=${link.issueKey}, branchName=${branchName ?? "NONE"}, repoInfo=${repoInfo?.provider ?? "NONE"}`,
        );

        if (!repoInfo || repoInfo.provider === "unknown" || !branchName) return;

        let prUrl: string | undefined;

        if (repoInfo.provider === "github") {
            try {
                const prResult = await machineBash(
                    link.machineId,
                    `gh pr list --repo "${repoInfo.owner}/${repoInfo.repo}" --head "${branchName}" --state all --json url,state --jq '.[0] | "\\(.url) \\(.state)"' 2>&1`,
                    link.repoPath,
                );
                if (prResult.success && prResult.exitCode === 0) {
                    const output = (prResult.stdout ?? "").trim();
                    const [url] = output.split(" ");
                    if (url?.startsWith("http")) {
                        prUrl = url;
                    }
                }
            } catch {
                // Non-critical
            }
        } else if (repoInfo.provider === "gitea") {
            try {
                const prs = await queryGiteaPRs(
                    link.machineId,
                    repoInfo,
                    branchName,
                );
                if (prs.length > 0 && prs[0].html_url) {
                    prUrl = prs[0].html_url;
                }
            } catch {
                // Non-critical
            }
        }

        log.log(
            `🔄 [IssueSession] detectPR result: prUrl=${prUrl ?? "NONE"}`,
        );

        if (prUrl) {
            // Record PR URL, stay processing
            await issueSessionStore
                .getState()
                .updateStatus(link.issueKey, "processing", { prUrl });
        }
    } catch {
        // Non-critical — best effort PR detection
    }
}

/**
 * After an issue session completes (turn-end), auto-close the linked issue
 * and add a completion comment. Best-effort — failures are silently ignored.
 */
export async function handleIssueSessionCompletion(link: IssueSessionLink) {
    try {
        const repoInfo = ensureRepoInfo(link);

        // Detect PR and its real status from the remote
        let prUrl: string | undefined;
        let prMerged = false;
        const session = storage.getState().sessions[link.sessionId];
        const branchName = session?.metadata?.worktree?.branchName;

        log.log(
            `🔄 [IssueSession] handleCompletion: issueKey=${link.issueKey}, branchName=${branchName ?? "NONE"}, repoInfo=${repoInfo?.provider ?? "NONE"}`,
        );

        if (repoInfo && repoInfo.provider !== "unknown" && branchName) {
            if (repoInfo.provider === "github") {
                try {
                    // Query ALL PRs for this branch (including merged/closed)
                    // Must specify --repo to target the correct fork (gh defaults to upstream)
                    const prResult = await machineBash(
                        link.machineId,
                        `gh pr list --repo "${repoInfo.owner}/${repoInfo.repo}" --head "${branchName}" --state all --json url,state --jq '.[0] | "\\(.url) \\(.state)"' 2>&1`,
                        link.repoPath,
                    );
                    if (prResult.success && prResult.exitCode === 0) {
                        const output = (prResult.stdout ?? "").trim();
                        const [url, state] = output.split(" ");
                        if (url?.startsWith("http")) {
                            prUrl = url;
                            prMerged = state === "MERGED";
                        }
                    }
                } catch {
                    // Non-critical — proceed without PR info
                }
            } else if (repoInfo.provider === "gitea") {
                try {
                    const prs = await queryGiteaPRs(
                        link.machineId,
                        repoInfo,
                        branchName,
                    );
                    if (prs.length > 0 && prs[0].html_url) {
                        prUrl = prs[0].html_url;
                        prMerged = prs[0].merged === true;
                    }
                } catch {
                    // Non-critical
                }
            }
        }

        // Decide status based on PR state:
        // - PR merged → completed (close issue)
        // - PR exists but not merged → stay processing (PR still needs review)
        // - No PR found → completed (Claude may have committed directly)
        log.log(
            `🔄 [IssueSession] PR check result: prUrl=${prUrl ?? "NONE"}, prMerged=${prMerged}`,
        );
        if (prUrl && !prMerged) {
            // PR exists but not yet merged — just record URL, stay processing
            await issueSessionStore
                .getState()
                .updateStatus(link.issueKey, "processing", { prUrl });
            return;
        }

        if (!prUrl) {
            // No PR found — mark as completed (Claude may have committed directly
            // or the task didn't require code changes).
            await issueSessionStore
                .getState()
                .updateStatus(link.issueKey, "completed", {
                    completionComment:
                        "Session completed without creating a pull request.",
                });
            return;
        }

        // PR exists and is merged — mark completed and close issue
        const comment =
            "This issue has been processed by an automated Claude Code session.\n" +
            `Pull request: ${prUrl}`;

        await issueSessionStore
            .getState()
            .updateStatus(link.issueKey, "completed", {
                completionComment: comment,
                prUrl,
            });

        // Then try to close the issue (best-effort, won't affect link status)
        if (repoInfo && repoInfo.provider !== "unknown") {
            try {
                await addIssueCommentViaMachine(
                    link.machineId,
                    repoInfo,
                    link.issueNumber,
                    comment,
                    link.repoPath,
                );
                await updateIssueStateViaMachine(
                    link.machineId,
                    repoInfo,
                    link.issueNumber,
                    "closed",
                    link.repoPath,
                );
            } catch {
                // Non-critical — issue close is best-effort
            }
        }
    } catch {
        // If updateStatus failed, try a minimal fallback
        try {
            await issueSessionStore
                .getState()
                .updateStatus(link.issueKey, "completed");
        } catch {
            // Give up — will be caught by markFailedIssueSessionsForEndedSessions
        }
    }
}

/**
 * Handle issue-session links when their session ends (no longer active).
 * - Has prUrl → keep processing (PR may still need review/merge)
 * - No prUrl → try one final PR detection, then mark completed if no PR found
 */
export async function markFailedIssueSessionsForEndedSessions(
    endedSessionIds: string[],
) {
    const endedSet = new Set(endedSessionIds);
    const processingLinks = issueSessionStore.getState().getProcessingLinks();

    for (const link of processingLinks) {
        if (!endedSet.has(link.sessionId)) continue;

        // If a PR URL was recorded, the session created a PR that may still need review.
        // Don't mark as failed — let it stay processing until PR is merged/closed.
        if (link.prUrl) continue;

        // No PR was ever detected — try one final check
        await detectPRForIssueSession(link);

        // Re-read after detectPR may have updated it
        const updatedLink = issueSessionStore.getState().links[link.issueKey];
        if (
            updatedLink &&
            updatedLink.status === "processing" &&
            updatedLink.prUrl
        ) {
            // PR found on final check — keep processing
            continue;
        }

        if (updatedLink && updatedLink.status === "processing") {
            // Session ended, no PR ever found — mark as completed
            // (Claude may have committed directly to the branch without PR)
            await issueSessionStore
                .getState()
                .updateStatus(link.issueKey, "completed", {
                    completionComment:
                        "Session completed without creating a pull request.",
                });
        }
    }
}

/**
 * Create an IssueSessionLink when a webhook-triggered session completes.
 * Extracts owner/repo from repoUrl for the repoLabel field.
 */
export async function handleWebhookIssueLinked(data: {
    readonly issueNumber: number;
    readonly issueTitle: string;
    readonly issueBody: string;
    readonly issueAuthor: string;
    readonly issueLabels: string[];
    readonly issueUrl: string;
    readonly repoUrl: string;
    readonly repoPath: string;
    readonly machineId: string;
    readonly sessionId: string;
}): Promise<void> {
    try {
        if (!issueSessionStore.getState().isLoaded) {
            await issueSessionStore.getState().loadLinks();
        }

        const projectKey = `${data.machineId}:${data.repoPath}`;
        const issueKey = buildIssueKey(projectKey, data.issueNumber);

        // Ensure repoInfo is populated so that PR detection works later.
        // Without this, handleIssueSessionCompletion skips PR detection
        // because issueStore.repoInfoByProject[projectKey] is undefined.
        const { gitHosts } = storage.getState().settings;
        issueStore.getState().detectRepoInfo(projectKey, data.repoUrl, gitHosts);

        // If link already exists (e.g. from another device), skip creation.
        const existing = issueSessionStore.getState().findByIssueKey(issueKey);
        if (existing) {
            const needsUpdate =
                ((existing.sessionId === "pending" || existing.status === "failed") &&
                    data.sessionId !== "pending") ||
                (!existing.issueUrl && data.issueUrl);

            if (needsUpdate) {
                const newStatus =
                    (existing.sessionId === "pending" || existing.status === "failed") &&
                    data.sessionId !== "pending"
                        ? "processing"
                        : existing.status;
                await issueSessionStore
                    .getState()
                    .updateStatus(issueKey, newStatus, {
                        sessionId: data.sessionId !== "pending" ? data.sessionId : undefined,
                        issueUrl: !existing.issueUrl ? data.issueUrl : undefined,
                    });
            }
            return;
        }

        // Extract "owner/repo" from repoUrl for repoLabel
        const repoLabel = extractRepoLabel(data.repoUrl);

        await issueSessionStore.getState().createLink({
            issueNumber: data.issueNumber,
            issueTitle: data.issueTitle,
            issueBody: data.issueBody,
            issueAuthor: data.issueAuthor,
            issueLabels: data.issueLabels,
            issueUrl: data.issueUrl,
            projectKey,
            repoLabel,
            sessionId: data.sessionId,
            machineId: data.machineId,
            repoPath: data.repoPath,
        });
    } catch (error) {
        // KV optimistic lock conflict means another device created
        // the link concurrently. Only log if the link truly doesn't exist.
        const projectKey = `${data.machineId}:${data.repoPath}`;
        const alreadyExists = issueSessionStore
            .getState()
            .findByIssueKey(buildIssueKey(projectKey, data.issueNumber));
        if (!alreadyExists) {
            log.log(
                `⚠️ handleWebhookIssueLinked: failed to create link for #${data.issueNumber}: ${error}`,
            );
        }
    }
}

/**
 * Update IssueSessionLink to "completed" when a PR is merged.
 * Session archiving is already handled server-side via the activity ephemeral.
 */
export async function handleWebhookPRMerged(data: {
    readonly prNumber: number;
    readonly prUrl: string;
    readonly issueNumber: number;
    readonly sessionId: string;
    readonly machineId: string;
    readonly repoPath: string;
}): Promise<void> {
    await tryHandlePRMerged(data, 0);
}

async function tryHandlePRMerged(
    data: {
        readonly prNumber: number;
        readonly prUrl: string;
        readonly issueNumber: number;
        readonly sessionId: string;
        readonly machineId: string;
        readonly repoPath: string;
    },
    attempt: number,
): Promise<void> {
    try {
        if (!issueSessionStore.getState().isLoaded) {
            await issueSessionStore.getState().loadLinks();
        }

        const projectKey = `${data.machineId}:${data.repoPath}`;
        const issueKey = buildIssueKey(projectKey, data.issueNumber);

        const existing = issueSessionStore.getState().findByIssueKey(issueKey);
        if (!existing) {
            // Retry once after delay — issue-linked event may arrive shortly
            if (attempt < 1) {
                setTimeout(() => {
                    void tryHandlePRMerged(data, attempt + 1);
                }, 3000);
            }
            return;
        }

        // Only update if currently processing — don't overwrite terminal states
        if (existing.status !== "processing") {
            return;
        }

        await issueSessionStore.getState().updateStatus(issueKey, "completed", {
            prUrl: data.prUrl,
        });
    } catch (error) {
        log.log(
            `⚠️ handleWebhookPRMerged: failed to update link for #${data.issueNumber}: ${error}`,
        );
    }
}

/**
 * Check processing issue-session links that have an open PR.
 * When the PR gets merged, mark the link as completed and close the issue.
 */
export async function checkProcessingPRs(): Promise<void> {
    const processingLinks = issueSessionStore.getState().getProcessingLinks();
    // Only check links that have a PR URL (PR was created but not yet merged)
    const linksWithPR = processingLinks.filter((link: IssueSessionLink) => link.prUrl);
    if (linksWithPR.length === 0) return;

    for (const link of linksWithPR) {
        try {
            await handleIssueSessionCompletion(link);
        } catch {
            // Non-critical
        }
    }
}

/**
 * One-time recovery: find recently-completed links without prUrl and
 * attempt to detect the PR from the remote. Updates prUrl in-place
 * without changing the completed status.
 */
export async function recoverMissingPRUrls(): Promise<void> {
    // Wait for links to load
    await issueSessionStore.getState().loadLinks();

    const allLinks: IssueSessionLink[] = Object.values(issueSessionStore.getState().links);
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - SEVEN_DAYS;

    const candidates = allLinks.filter(
        (link) =>
            link.status === "completed" &&
            !link.prUrl &&
            link.updatedAt > cutoff,
    );

    if (candidates.length === 0) return;

    for (const link of candidates) {
        try {
            const repoInfo = ensureRepoInfo(link);
            const session = storage.getState().sessions[link.sessionId];
            const branchName = session?.metadata?.worktree?.branchName;

            if (!repoInfo || repoInfo.provider === "unknown" || !branchName) continue;

            let prUrl: string | undefined;

            if (repoInfo.provider === "github") {
                try {
                    const prResult = await machineBash(
                        link.machineId,
                        `gh pr list --repo "${repoInfo.owner}/${repoInfo.repo}" --head "${branchName}" --state all --json url --jq '.[0].url' 2>&1`,
                        link.repoPath,
                    );
                    if (prResult.success && prResult.exitCode === 0) {
                        const url = (prResult.stdout ?? "").trim();
                        if (url.startsWith("http")) prUrl = url;
                    }
                } catch {
                    // Non-critical
                }
            } else if (repoInfo.provider === "gitea") {
                try {
                    const prs = await queryGiteaPRs(
                        link.machineId,
                        repoInfo,
                        branchName,
                    );
                    if (prs.length > 0 && prs[0].html_url) {
                        prUrl = prs[0].html_url;
                    }
                } catch {
                    // Non-critical
                }
            }

            if (prUrl) {
                await issueSessionStore
                    .getState()
                    .updateStatus(link.issueKey, "completed", { prUrl });
            }
        } catch {
            // Non-critical — best effort recovery
        }
    }
}
