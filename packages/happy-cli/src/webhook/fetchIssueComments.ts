/**
 * Fetch issue comments directly via HTTP/CLI (no RPC, runs locally).
 * Supports GitHub (via `gh api`) and Gitea (via curl).
 * Returns empty array on any failure — non-critical, must not block launch.
 */

import { execFile } from "child_process";
import { logger } from "@/ui/logger";

export interface IssueComment {
  readonly author: string;
  readonly body: string;
  readonly createdAt: number;
}

/** Only allow safe characters in owner/repo to prevent injection */
const SAFE_NAME = /^[a-zA-Z0-9._-]+$/;

function execFileAsync(
  file: string,
  args: readonly string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { cwd, timeout: 30_000 },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error
            ? typeof error.code === "number"
              ? error.code
              : 1
            : 0,
        });
      },
    );
  });
}

/**
 * Parse owner/repo from a repo URL like "https://github.com/owner/repo".
 * Validates owner/repo names to prevent command injection.
 */
function parseRepoFromUrl(
  repoUrl: string,
): { owner: string; repo: string } | null {
  try {
    const url = new URL(repoUrl);
    const parts = url.pathname
      .replace(/^\//, "")
      .replace(/\.git$/, "")
      .split("/");
    if (parts.length >= 2) {
      const owner = parts[0];
      const repo = parts[1];
      if (!SAFE_NAME.test(owner) || !SAFE_NAME.test(repo)) {
        return null;
      }
      return { owner, repo };
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
  apiToken?: string,
): Promise<readonly IssueComment[]> {
  const parsed = parseRepoFromUrl(repoUrl);
  if (!parsed) {
    logger.debug(`[WEBHOOK] Cannot parse repo URL: ${repoUrl}`);
    return [];
  }

  if (provider === "github") {
    const result = await execFileAsync(
      "gh",
      [
        "api",
        `repos/${parsed.owner}/${parsed.repo}/issues/${issueNumber}/comments?per_page=${maxComments}`,
      ],
      cwd,
    );
    if (result.exitCode !== 0) return [];
    try {
      const raw: readonly any[] = JSON.parse(result.stdout.trim());
      return raw.map(parseGitHubComment);
    } catch {
      return [];
    }
  }

  if (provider === "gitea") {
    try {
      const url = new URL(repoUrl);
      const apiBase = `${url.protocol}//${url.host}/api/v1`;
      const apiUrl = `${apiBase}/repos/${parsed.owner}/${parsed.repo}/issues/${issueNumber}/comments?limit=${maxComments}`;
      const curlArgs = ["-s", "-w", "\n%{http_code}"];
      if (apiToken) {
        curlArgs.push("-H", `Authorization: token ${apiToken}`);
      }
      curlArgs.push(apiUrl);
      const result = await execFileAsync("curl", curlArgs, cwd);
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
