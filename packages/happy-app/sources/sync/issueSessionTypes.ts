/**
 * Issue-Session link type definitions
 *
 * Links issues to sessions created to process them.
 * Persisted in UserKVStore with E2E encryption (same pattern as kanbanStore).
 */

//
// Status
//

export type IssueSessionStatus =
  | "processing" // Session is actively working on this issue
  | "completed" // Worktree merged, issue closed
  | "failed" // Session ended without merge or error occurred
  | "cancelled"; // User manually cancelled

//
// Data model
//

/**
 * Data stored encrypted in KV value.
 * Shape that gets JSON.stringify'd → encrypted → stored.
 */
export interface IssueSessionLinkData {
  readonly issueNumber: number;
  readonly issueTitle: string;
  readonly issueBody?: string;
  readonly issueAuthor?: string;
  readonly issueLabels?: readonly string[];
  readonly issueUrl?: string;
  readonly projectKey: string;
  readonly repoLabel: string;
  readonly sessionId: string;
  readonly machineId: string;
  readonly repoPath: string;
  readonly status: IssueSessionStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completionComment?: string;
  readonly errorMessage?: string;
  readonly prUrl?: string;
}

/**
 * In-memory link with issueKey and KV version for optimistic locking.
 */
export interface IssueSessionLink extends IssueSessionLinkData {
  readonly issueKey: string;
  /** KV optimistic lock version (-1 = new, 0+ = existing) */
  readonly kvVersion: number;
}

//
// KV key helpers
//

const ISSUE_SESSION_PREFIX = "issueSession/";

export function issueSessionKey(issueKey: string): string {
  return `${ISSUE_SESSION_PREFIX}${issueKey}`;
}

export function parseIssueSessionKey(key: string): string | null {
  if (!key.startsWith(ISSUE_SESSION_PREFIX)) {
    return null;
  }
  return key.slice(ISSUE_SESSION_PREFIX.length);
}

export function isIssueSessionKey(key: string): boolean {
  return key.startsWith(ISSUE_SESSION_PREFIX);
}

/**
 * Build an issueKey from projectKey and issue number.
 */
export function buildIssueKey(projectKey: string, issueNumber: number): string {
  return `${projectKey}:${issueNumber}`;
}
