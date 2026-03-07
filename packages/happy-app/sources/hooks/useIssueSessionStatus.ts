/**
 * Hook to check the issue-session link status for a given issue.
 *
 * Returns the IssueSessionLink if one exists, or null.
 * Designed for use in IssueCard and IssueDetailSheet to show processing status.
 */

import { useIssueSessionLink } from "@/sync/issueSessionStore";
import { buildIssueKey } from "@/sync/issueSessionTypes";
import type { IssueSessionLink } from "@/sync/issueSessionTypes";

/**
 * Check if an issue has an associated session link.
 * Returns the link if found, null otherwise.
 */
export function useIssueSessionStatus(
    projectKey: string,
    issueNumber: number,
): IssueSessionLink | null {
    const issueKey = buildIssueKey(projectKey, issueNumber);
    return useIssueSessionLink(issueKey);
}
