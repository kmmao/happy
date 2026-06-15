/**
 * `happy issue` — minimal outbound write-back to GitHub / Gitea.
 *
 * Intent: let an Agent that ran inside a loop / webhook trigger session
 * close the feedback loop by creating an issue (or commenting / closing
 * one) on the same Git host that triggered it. Tokens come from the
 * environment — webhook triggers already inject GITHUB_TOKEN /
 * GITEA_TOKEN into the spawned session
 * (see `webhook/handleWebhookTrigger.ts:153-154`), and ad-hoc users can
 * `export` the var or pass `--token` explicitly.
 *
 * Subcommands:
 *   happy issue create  --title <T>  [--body <B>]  [--label <L>...]  [--repo <owner/repo>]  [--token <PAT>]
 *   happy issue comment <number>     --body <B>     [--repo <owner/repo>]  [--token <PAT>]
 *   happy issue close   <number>                    [--repo <owner/repo>]  [--token <PAT>]
 *
 * When `--repo` is omitted we auto-detect from cwd's `git remote get-url
 * origin`. Provider auto-detect: hosts whose name matches `github.com`
 * use the github.com API, everything else is assumed to be a Gitea-style
 * REST API at `https://<host>/api/v1`. Override with `--provider`.
 *
 * Output: prints the resulting issue / comment HTML URL on success so
 * the Agent can read it back. Non-zero exit on failure with a single-
 * line error message.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "@/ui/logger";

const execAsync = promisify(exec);

type Provider = "github" | "gitea";

interface RepoCoords {
  host: string;
  owner: string;
  repo: string;
}

interface CliFlags {
  title?: string;
  body?: string;
  labels: string[];
  repo?: string;
  token?: string;
  provider?: Provider;
}

function usage(): string {
  return [
    "Usage:",
    "  happy issue create --title <T> [--body <B>] [--label <L>...] [--repo <owner/repo>] [--token <PAT>] [--provider github|gitea]",
    "  happy issue comment <number> --body <B> [--repo <owner/repo>] [--token <PAT>] [--provider github|gitea]",
    "  happy issue close <number> [--repo <owner/repo>] [--token <PAT>] [--provider github|gitea]",
    "",
    "Token sources (first hit wins):",
    "  --token flag → GITHUB_TOKEN / GITEA_TOKEN env",
    "Webhook-triggered sessions already get these env vars; for ad-hoc use, export them",
    "or pin them in the Git Hosts settings inside the App and copy the value here.",
  ].join("\n");
}

function parseFlags(args: string[]): { flags: CliFlags; positional: string[] } {
  const flags: CliFlags = { labels: [] };
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--title") flags.title = args[++i];
    else if (a === "--body") flags.body = args[++i];
    else if (a === "--label") flags.labels.push(args[++i]);
    else if (a === "--repo") flags.repo = args[++i];
    else if (a === "--token") flags.token = args[++i];
    else if (a === "--provider") {
      const v = args[++i];
      if (v !== "github" && v !== "gitea") {
        throw new Error(`Invalid --provider '${v}'. Expected 'github' or 'gitea'.`);
      }
      flags.provider = v;
    } else if (a === "-h" || a === "--help") {
      logger.print(usage());
      process.exit(0);
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown flag '${a}'. See \`happy issue --help\`.`);
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

/**
 * Pull `host/owner/repo` out of a git remote URL. Handles both SSH
 * (`git@github.com:owner/repo.git`) and HTTPS clones — shamelessly
 * adapted from `registerGitHandlers.ts:128-150` (kept local so this
 * command doesn't yank the whole git-handlers module into its imports).
 */
function parseRemoteUrl(url: string): RepoCoords | null {
  const trimmed = url.trim();
  const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshMatch) return { host: sshMatch[1], owner: sshMatch[2], repo: sshMatch[3] };

  const sshUrlMatch = trimmed.match(/^ssh:\/\/[^@]+@([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshUrlMatch) return { host: sshUrlMatch[1], owner: sshUrlMatch[2], repo: sshUrlMatch[3] };

  const httpsMatch = trimmed.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (httpsMatch) return { host: httpsMatch[1], owner: httpsMatch[2], repo: httpsMatch[3] };

  return null;
}

async function detectRepoFromCwd(): Promise<RepoCoords> {
  let stdout = "";
  try {
    const result = await execAsync("git remote get-url origin", { timeout: 3000 });
    stdout = result.stdout.trim();
  } catch {
    throw new Error(
      "Couldn't read git remote — run from inside a git repo, or pass --repo <owner/repo>.",
    );
  }
  const coords = parseRemoteUrl(stdout);
  if (!coords) {
    throw new Error(
      `Couldn't parse git remote '${stdout}'. Pass --repo <owner/repo> explicitly.`,
    );
  }
  return coords;
}

function resolveRepo(flags: CliFlags, detected: RepoCoords | null): RepoCoords {
  if (flags.repo) {
    const slashIdx = flags.repo.indexOf("/");
    if (slashIdx < 0) {
      throw new Error(`--repo must be 'owner/repo' (got '${flags.repo}').`);
    }
    return {
      // Without --provider + --repo we have no host info. Default to
      // github.com — that's the overwhelmingly common case and matches
      // the auto-provider rule below. Detected host wins when present.
      host: detected?.host ?? "github.com",
      owner: flags.repo.slice(0, slashIdx),
      repo: flags.repo.slice(slashIdx + 1),
    };
  }
  if (!detected) {
    throw new Error("Pass --repo <owner/repo> when running outside a git repo.");
  }
  return detected;
}

function resolveProvider(flags: CliFlags, repo: RepoCoords): Provider {
  if (flags.provider) return flags.provider;
  // github.com → github API. Anything else is assumed Gitea/Forgejo
  // — they share the v1 REST surface this command targets.
  return repo.host === "github.com" ? "github" : "gitea";
}

function resolveToken(flags: CliFlags, provider: Provider): string {
  if (flags.token) return flags.token;
  const envVar = provider === "github" ? "GITHUB_TOKEN" : "GITEA_TOKEN";
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  throw new Error(
    `Missing API token. Set ${envVar} in the environment or pass --token <PAT>. ` +
      `Configure the token once in the App's Settings → Git Hosts, then export it here.`,
  );
}

interface ApiClient {
  baseUrl: string;
  headers: Record<string, string>;
}

function buildClient(provider: Provider, repo: RepoCoords, token: string): ApiClient {
  if (provider === "github") {
    return {
      baseUrl: `https://api.github.com/repos/${repo.owner}/${repo.repo}`,
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
    };
  }
  // Gitea — host is the user's instance, API lives at /api/v1.
  return {
    baseUrl: `https://${repo.host}/api/v1/repos/${repo.owner}/${repo.repo}`,
    headers: {
      Authorization: `token ${token}`,
      "Content-Type": "application/json",
    },
  };
}

async function callJson(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: object,
): Promise<any> {
  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${method} ${url} → HTTP ${response.status}. ${text.slice(0, 400)}`);
  }
  // 204 No Content (Gitea returns this on close) has empty body.
  if (response.status === 204) return null;
  return await response.json().catch(() => null);
}

async function handleCreate(args: string[]): Promise<void> {
  const { flags } = parseFlags(args);
  if (!flags.title || !flags.title.trim()) {
    throw new Error("--title is required for `issue create`.");
  }
  const detected = await detectRepoFromCwd().catch(() => null);
  const repo = resolveRepo(flags, detected);
  const provider = resolveProvider(flags, repo);
  const token = resolveToken(flags, provider);
  const client = buildClient(provider, repo, token);

  const payload: Record<string, any> = {
    title: flags.title.trim(),
  };
  if (flags.body) payload.body = flags.body;
  if (flags.labels.length > 0) payload.labels = flags.labels;

  const result = await callJson(`${client.baseUrl}/issues`, "POST", client.headers, payload);
  const url: string | undefined = result?.html_url ?? result?.url;
  if (!url) {
    throw new Error("Server accepted the issue but returned no URL.");
  }
  logger.print(url);
}

async function handleComment(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const issueNumber = positional[0];
  if (!issueNumber || !/^\d+$/.test(issueNumber)) {
    throw new Error("Usage: happy issue comment <number> --body <B>");
  }
  if (!flags.body || !flags.body.trim()) {
    throw new Error("--body is required for `issue comment`.");
  }
  const detected = await detectRepoFromCwd().catch(() => null);
  const repo = resolveRepo(flags, detected);
  const provider = resolveProvider(flags, repo);
  const token = resolveToken(flags, provider);
  const client = buildClient(provider, repo, token);

  const result = await callJson(
    `${client.baseUrl}/issues/${issueNumber}/comments`,
    "POST",
    client.headers,
    { body: flags.body },
  );
  const url: string | undefined = result?.html_url ?? result?.url;
  if (url) {
    logger.print(url);
  } else {
    logger.print(`comment posted on issue #${issueNumber}`);
  }
}

async function handleClose(args: string[]): Promise<void> {
  const { flags, positional } = parseFlags(args);
  const issueNumber = positional[0];
  if (!issueNumber || !/^\d+$/.test(issueNumber)) {
    throw new Error("Usage: happy issue close <number>");
  }
  const detected = await detectRepoFromCwd().catch(() => null);
  const repo = resolveRepo(flags, detected);
  const provider = resolveProvider(flags, repo);
  const token = resolveToken(flags, provider);
  const client = buildClient(provider, repo, token);

  // GitHub: PATCH /issues/{n} { state: "closed" }
  // Gitea:  PATCH /issues/{n} { state: "closed" } (compatible)
  await callJson(
    `${client.baseUrl}/issues/${issueNumber}`,
    "PATCH",
    client.headers,
    { state: "closed" },
  );
  logger.print(`closed issue #${issueNumber} on ${repo.owner}/${repo.repo}`);
}

export async function handleIssueCommand(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "-h" || sub === "--help") {
    logger.print(usage());
    return;
  }
  if (sub === "create") {
    await handleCreate(args.slice(1));
    return;
  }
  if (sub === "comment") {
    await handleComment(args.slice(1));
    return;
  }
  if (sub === "close") {
    await handleClose(args.slice(1));
    return;
  }
  throw new Error(`Unknown subcommand '${sub}'. See \`happy issue --help\`.`);
}
