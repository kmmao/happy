/**
 * Hook to get issue-session link info for a given session.
 *
 * Prefers issue metadata stored directly in the link (from webhook events).
 * Falls back to issueStore if link metadata is unavailable.
 */

import { useIssueSessionBySessionId } from "@/sync/issueSessionStore";
import { issueStore } from "@/sync/issueStore";
import type { IssueSessionLink } from "@/sync/issueSessionTypes";

interface SessionIssueInfo {
    readonly issueLink: IssueSessionLink | null;
    readonly issueBody: string | null;
}

export function useSessionIssueInfo(sessionId: string): SessionIssueInfo {
    const issueLink = useIssueSessionBySessionId(sessionId);

    const issueBody = (() => {
        if (!issueLink) return null;
        // Prefer body stored directly in the link (from webhook-issue-linked)
        if (issueLink.issueBody?.trim()) return issueLink.issueBody.trim();
        // Fallback: try issueStore if already loaded
        const issues =
            issueStore.getState().issuesByProject[issueLink.projectKey];
        if (!issues) return null;
        const issue = issues.find(
            (i) => i.number === issueLink.issueNumber,
        );
        return issue?.body?.trim() || null;
    })();

    return { issueLink, issueBody };
}
