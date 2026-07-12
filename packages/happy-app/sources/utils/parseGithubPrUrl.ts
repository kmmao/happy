/**
 * Extract a GitHub pull-request reference from arbitrary text (agent messages,
 * tool output). Powers the in-conversation "Review PR diff" card (Phase 2B):
 * when the agent runs `gh pr create` its output contains the PR URL, and we
 * surface a tappable card that opens the diff on-device.
 */
export interface GithubPrRef {
    owner: string;
    repo: string;
    number: number;
}

// github.com/<owner>/<repo>/pull/<n>  — owner/repo allow letters, digits, ., _, -
const PR_URL = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/i;

/** Return the first GitHub PR reference found in `text`, or null. */
export function parseGithubPrUrl(text: string | null | undefined): GithubPrRef | null {
    if (!text) return null;
    const m = text.match(PR_URL);
    if (!m) return null;
    const number = Number.parseInt(m[3], 10);
    if (!Number.isFinite(number) || number <= 0) return null;
    return { owner: m[1], repo: m[2], number };
}
