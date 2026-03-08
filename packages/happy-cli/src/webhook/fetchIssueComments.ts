/**
 * Fetch issue comments directly via HTTP/CLI (no RPC, runs locally).
 * Supports GitHub (via `gh api`) and Gitea (via curl).
 * Returns empty array on any failure — non-critical, must not block launch.
 */

import { exec } from "child_process";
import { logger } from "@/ui/logger";

export interface IssueComment {
  readonly author: string;
  readonly body: string;
  readonly createdAt: number;
}

function execAsync(
  command: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        exitCode: error?.code ?? (error ? 1 : 0),
      });
    });
  });
}

/**
 * Parse owner/repo from a repo URL like "https://github.com/owner/repo"
 */
function parseRepoFromUrl(
  repoUrl: string,
): { owner: string; repo: string } | null {
  try {
    const url = new URL(repoUrl);
    const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }
  } catch {
    // not a valid URL
  }
  return null;
}

function parseGitHubComment(raw: any): IssueComment {
  return {
    author: raw.user?.login ?? "",
    body: raw.body ?? "",
    createdAt: raw.created_at ? new Date(raw.created_at).getTime() : 0,
  };
}

function parseGiteaComment(raw: any): IssueComment {
  return {
    author: raw.user?.login ?? "",
    body: raw.body ?? "",
    createdAt: raw.created_at ? new Date(raw.created_at).getTime() : 0,
  };
}

export async function fetchIssueComments(
  provider: string,
  repoUrl: string,
  issueNumber: number,
  cwd: string,
  maxComments: number = 20,
): Promise<readonly IssueComment[]> {
  const parsed = parseRepoFromUrl(repoUrl);
  if (!parsed) {
    logger.debug(`[WEBHOOK] Cannot parse repo URL: ${repoUrl}`);
    return [];
  }

  if (provider === "github") {
    const command = `gh api "repos/${parsed.owner}/${parsed.repo}/issues/${issueNumber}/comments?per_page=${maxComments}" 2>&1`;
    const result = await execAsync(command, cwd);
    if (result.exitCode !== 0) return [];
    try {
      const raw: readonly any[] = JSON.parse(result.stdout.trim());
      return raw.map(parseGitHubComment);
    } catch {
      return [];
    }
  }

  if (provider === "gitea") {
    // Extract API base from repoUrl (e.g., "https://gitea.example.com")
    try {
      const url = new URL(repoUrl);
      const apiBase = `${url.protocol}//${url.host}/api/v1`;
      const apiUrl = `${apiBase}/repos/${parsed.owner}/${parsed.repo}/issues/${issueNumber}/comments?limit=${maxComments}`;
      const command = `curl -s -w "\\n%{http_code}" "${apiUrl}" 2>&1`;
      const result = await execAsync(command, cwd);
      if (result.exitCode !== 0) return [];
      const lines = result.stdout.trim().split("\n");
      const httpStatus = lines.pop()?.trim() ?? "";
      const body = lines.join("\n").trim();
      if (!httpStatus.startsWith("2")) return [];
      const raw: readonly any[] = JSON.parse(body);
      return raw.map(parseGiteaComment);
    } catch {
      return [];
    }
  }

  // GitLab or unsupported — return empty
  return [];
}
