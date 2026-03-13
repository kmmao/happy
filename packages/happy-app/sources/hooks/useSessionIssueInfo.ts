/**
 * Hook to get issue-session link info for a given session.
 *
 * Combines issueSessionStore (link metadata) with optional issue body
 * from issueStore (if already loaded — no extra fetch).
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

    // Try to get issue body from issueStore if already loaded (no fetch triggered)
    const issueBody = (() => {
        if (!issueLink) return null;
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
