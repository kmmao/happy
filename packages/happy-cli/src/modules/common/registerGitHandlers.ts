import { logger } from "@/ui/logger";
import { exec, execFile, ExecFileOptions } from "child_process";
import { promisify } from "util";
import { stat, mkdir } from "fs/promises";
import { dirname, join, resolve, basename } from "path";
import { homedir } from "os";
import { RpcHandlerManager } from "../../api/rpc/RpcHandlerManager";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

interface CloneGitRepoRequest {
  repoUrl: string;
  targetDirectory: string;
  provider?: "github" | "gitea";
  apiToken?: string;
  host?: string;
}

interface CloneGitRepoResponse {
  success: boolean;
  repoPath?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
}

interface RemoteGitRepoEntry {
  name: string;
  fullName: string;
  cloneUrl: string;
  htmlUrl: string;
  private: boolean;
  updatedAt?: number | null;
}

interface ListRemoteGitReposRequest {
  provider: "github" | "gitea";
  apiToken: string;
  host: string;
  page?: number;
  perPage?: number;
  query?: string;
}

interface ListRemoteGitReposResponse {
  success: boolean;
  repos?: RemoteGitRepoEntry[];
  hasMore?: boolean;
  totalCount?: number;
  error?: string;
}

interface ListGitReposRequest {
  scanPaths?: string[];
}

interface GitRepoEntry {
  repoPath: string;
  remoteUrl: string;
  name: string;
}

interface ListGitReposResponse {
  success: boolean;
  repos?: GitRepoEntry[];
  error?: string;
}

interface CreateRemoteWebhookRequest {
  provider: "github" | "gitea" | "gitlab";
  apiToken: string;
  repoUrl: string;
  webhookUrl: string;
  webhookSecret: string;
  events: string[];
}

interface CreateRemoteWebhookResponse {
  success: boolean;
  created?: boolean;
  webhookId?: number;
  error?: string;
}

interface DeleteRemoteWebhookRequest {
  provider: "github" | "gitea" | "gitlab";
  apiToken: string;
  repoUrl: string;
  webhookUrl: string;
}

interface DeleteRemoteWebhookResponse {
  success: boolean;
  deleted?: boolean;
  error?: string;
}

/** Convert SSH remote URL to HTTPS: git@github.com:owner/repo.git → https://github.com/owner/repo */
function normalizeRemoteUrl(url: string): string {
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }
  return url.replace(/\.git$/, "");
}

/** Derive a short display name from a repo path: last two segments. */
function repoDisplayName(repoPath: string): string {
  const parent = basename(dirname(repoPath));
  const self = basename(repoPath);
  return parent && parent !== "." ? `${parent}/${self}` : self;
}

const CACHE_TTL = 120_000; // 120 seconds

function parseHostEntry(host: string): {
  bare: string;
  protocol: string | null;
} {
  const match = host.match(/^(https?):\/\/(.+)/);
  if (match) {
    return { bare: match[2].replace(/\/$/, ""), protocol: match[1] };
  }
  return { bare: host.replace(/\/$/, ""), protocol: null };
}

function parseCloneCoordinates(repoUrl: string): {
  host: string;
  owner: string;
  repo: string;
} | null {
  const trimmed = repoUrl.trim();
  const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshMatch) {
    return { host: sshMatch[1], owner: sshMatch[2], repo: sshMatch[3] };
  }

  const sshUrlMatch = trimmed.match(/^ssh:\/\/[^@]+@([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshUrlMatch) {
    return { host: sshUrlMatch[1], owner: sshUrlMatch[2], repo: sshUrlMatch[3] };
  }

  const httpsMatch = trimmed.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { host: httpsMatch[1], owner: httpsMatch[2], repo: httpsMatch[3] };
  }

  return null;
}

function resolveCloneUrl(repoUrl: string, configuredHost?: string): string {
  if (/^https?:\/\//.test(repoUrl)) {
    return repoUrl;
  }

  const coords = parseCloneCoordinates(repoUrl);
  if (!coords) return repoUrl;

  const hostEntry = configuredHost ? parseHostEntry(configuredHost) : null;
  const protocol = hostEntry?.protocol ?? "https";
  const bareHost = hostEntry?.bare ?? coords.host;
  return `${protocol}://${bareHost}/${coords.owner}/${coords.repo}.git`;
}

function buildCloneAuthEnv(
  provider: "github" | "gitea" | undefined,
  apiToken: string | undefined,
): NodeJS.ProcessEnv | undefined {
  if (!apiToken) return undefined;
  const username = provider === "github" ? "x-access-token" : "oauth2";
  const authValue = Buffer.from(`${username}:${apiToken}`).toString("base64");
  return {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${authValue}`,
  };
}

function buildGitApiBase(
  provider: "github" | "gitea",
  host: string,
): string {
  const { bare, protocol } = parseHostEntry(host);
  const normalizedProtocol = protocol ?? "https";
  const origin = `${normalizedProtocol}://${bare}`;
  const isGitHubCom = bare === "github.com" || bare === "www.github.com";
  if (provider === "github") {
    return isGitHubCom ? "https://api.github.com" : `${origin}/api/v3`;
  }
  return `${origin}/api/v1`;
}

function buildGitApiHeaders(apiToken: string): Record<string, string> {
  return {
    Authorization: `token ${apiToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function normalizeRemoteRepoEntries(
  pageRepos: Array<{
    name?: string;
    full_name?: string;
    clone_url?: string;
    html_url?: string;
    private?: boolean;
    updated_at?: string;
    owner?: { login?: string; username?: string };
  }>,
): RemoteGitRepoEntry[] {
  return pageRepos
    .filter((repo) => !!repo.name)
    .map((repo) => {
      const owner = repo.owner?.login || repo.owner?.username || "";
      const fullName = repo.full_name || (owner ? `${owner}/${repo.name}` : repo.name || "");
      const htmlUrl = repo.html_url || "";
      const cloneUrl = repo.clone_url || (htmlUrl ? `${htmlUrl}.git` : "");
      return {
        name: repo.name || fullName,
        fullName,
        cloneUrl,
        htmlUrl,
        private: !!repo.private,
        updatedAt: repo.updated_at ? Date.parse(repo.updated_at) : null,
      };
    })
    .filter((repo) => !!repo.cloneUrl);
}

function parseRepoOwnerFromUrl(
  repoUrl: string,
): { origin: string; owner: string; repo: string } | null {
  try {
    const url = new URL(repoUrl);
    const parts = url.pathname
      .replace(/^\//, "")
      .replace(/\.git$/, "")
      .split("/");
    if (parts.length >= 2) {
      return { origin: url.origin, owner: parts[0], repo: parts[1] };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Register Git-related RPC handlers: listRemoteGitRepos, cloneGitRepo,
 * listGitRepos, createRemoteWebhook, deleteRemoteWebhook.
 *
 * These scan the user's home directory and talk to remote Git hosts, so unlike
 * the filesystem handlers they are intentionally NOT restricted to
 * workingDirectory. The local-repo scan is memoized in a per-registration cache.
 */
export function registerGitHandlers(rpcHandlerManager: RpcHandlerManager) {
  let gitReposCache: { repos: GitRepoEntry[]; expiry: number } | null = null;

  rpcHandlerManager.registerHandler<
    ListRemoteGitReposRequest,
    ListRemoteGitReposResponse
  >("listRemoteGitRepos", async (data) => {
    const page = data.page ?? 1;
    const perPage = data.perPage ?? 30;
    const query = data.query?.trim() || "";

    logger.debug("listRemoteGitRepos request:", {
      provider: data.provider,
      host: data.host,
      hasToken: !!data.apiToken,
      page,
      perPage,
      query,
    });

    if (!data.apiToken) {
      return { success: false, error: "API token is required" };
    }
    if (!data.host?.trim()) {
      return { success: false, error: "Host is required" };
    }

    try {
      const baseUrl = buildGitApiBase(data.provider, data.host);
      const headers = buildGitApiHeaders(data.apiToken);

      type RawRepo = {
        name?: string;
        full_name?: string;
        clone_url?: string;
        html_url?: string;
        private?: boolean;
        updated_at?: string;
        owner?: { login?: string; username?: string };
      };

      let repos: RemoteGitRepoEntry[];
      let hasMore: boolean;
      let totalCount: number | undefined;

      if (data.provider === "github") {
        // GitHub: always use /user/repos with pagination.
        // GitHub has no API to search "repos I can access", so query is
        // ignored here — search filtering happens client-side in the App.
        const listUrl = `${baseUrl}/user/repos?per_page=${perPage}&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`;
        const response = await fetch(listUrl, { headers });
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        const items = (await response.json()) as RawRepo[];
        repos = normalizeRemoteRepoEntries(items);
        hasMore = items.length >= perPage;
      } else {
        // Gitea: use /repos/search for both list and search mode.
        // This endpoint returns all repos the user can access (own + org)
        // in one unified paginated stream, avoiding separate org fetches.
        const searchParams = new URLSearchParams({
          sort: "updated",
          order: "desc",
          limit: String(perPage),
          page: String(page),
        });
        if (query) {
          searchParams.set("q", query);
        }
        const searchUrl = `${baseUrl}/repos/search?${searchParams.toString()}`;
        const response = await fetch(searchUrl, { headers });
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        const body = (await response.json()) as { data?: RawRepo[]; ok?: boolean };
        const items = Array.isArray(body) ? (body as RawRepo[]) : (body.data || []);
        repos = normalizeRemoteRepoEntries(items);
        hasMore = items.length >= perPage;
      }

      return { success: true, repos, hasMore, totalCount };
    } catch (error) {
      logger.debug("listRemoteGitRepos failed:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load remote repositories",
      };
    }
  });

  rpcHandlerManager.registerHandler<CloneGitRepoRequest, CloneGitRepoResponse>(
    "cloneGitRepo",
    async (data) => {
      logger.debug("cloneGitRepo request:", {
        repoUrl: data.repoUrl,
        targetDirectory: data.targetDirectory,
        provider: data.provider,
        host: data.host,
        hasToken: !!data.apiToken,
      });

      if (!data.repoUrl?.trim()) {
        return { success: false, error: "Repository URL is required" };
      }
      if (!data.targetDirectory?.trim()) {
        return { success: false, error: "Target directory is required" };
      }
      if (!data.targetDirectory.startsWith("/")) {
        return {
          success: false,
          error: "Target directory must be an absolute path",
        };
      }

      const coords = parseCloneCoordinates(data.repoUrl);
      if (!coords) {
        return { success: false, error: "Invalid repository URL" };
      }

      const repoPath = join(resolve(data.targetDirectory), coords.repo);

      try {
        await mkdir(resolve(data.targetDirectory), { recursive: true });

        try {
          const existing = await stat(repoPath);
          if (existing.isDirectory()) {
            return {
              success: false,
              error: `Destination already exists: ${repoPath}`,
            };
          }
        } catch {
          // Destination does not exist yet.
        }

        const cloneUrl = resolveCloneUrl(data.repoUrl, data.host);
        const options: ExecFileOptions = {
          cwd: resolve(data.targetDirectory),
          timeout: 300_000,
          maxBuffer: 4 * 1024 * 1024,
          env: buildCloneAuthEnv(data.provider, data.apiToken),
        };

        const { stdout, stderr } = await execFileAsync(
          "git",
          ["clone", cloneUrl, repoPath],
          options,
        );

        gitReposCache = null;
        return {
          success: true,
          repoPath,
          stdout: stdout ? stdout.toString() : "",
          stderr: stderr ? stderr.toString() : "",
        };
      } catch (error) {
        const execError = error as NodeJS.ErrnoException & {
          stdout?: string;
          stderr?: string;
        };
        logger.debug("cloneGitRepo failed:", {
          message: execError.message,
          stderr: execError.stderr,
        });
        return {
          success: false,
          repoPath,
          stdout: execError.stdout || "",
          stderr: execError.stderr || "",
          error: execError.message || "Failed to clone repository",
        };
      }
    },
  );

  rpcHandlerManager.registerHandler<ListGitReposRequest, ListGitReposResponse>(
    "listGitRepos",
    async (data) => {
      logger.debug("listGitRepos request, scanPaths:", data.scanPaths);

      // Return cache if fresh
      if (gitReposCache && Date.now() < gitReposCache.expiry) {
        logger.debug(
          "listGitRepos returning cached result:",
          gitReposCache.repos.length,
          "repos",
        );
        return { success: true, repos: gitReposCache.repos };
      }

      const home = homedir();
      const scanPaths =
        data.scanPaths && data.scanPaths.length > 0 ? data.scanPaths : [home];

      // Directories to exclude from scanning
      const excludes = [
        "node_modules",
        ".cache",
        "Library",
        ".Trash",
        ".npm",
        ".yarn",
        ".pnpm-store",
        ".local",
        "go/pkg",
        ".cargo",
        ".rustup",
      ];

      const excludeArgs = excludes
        .map((d) => `-not -path '*/${d}/*'`)
        .join(" ");

      try {
        // Find all .git directories (max depth 5)
        const findPaths = scanPaths
          .map((p) => `'${p.replace(/'/g, "'\\''")}'`)
          .join(" ");
        const findCmd = `find ${findPaths} -maxdepth 5 -name .git -type d ${excludeArgs} 2>/dev/null`;

        const { stdout: findStdout } = await execAsync(findCmd, {
          timeout: 20_000,
          maxBuffer: 1024 * 1024,
        });

        const gitDirs = findStdout.trim().split("\n").filter(Boolean);
        logger.debug("Found", gitDirs.length, ".git directories");

        // Deduplicate by resolving to toplevel
        const seen = new Set<string>();
        const repos: GitRepoEntry[] = [];

        for (const gitDir of gitDirs) {
          if (repos.length >= 100) break;

          const parentDir = dirname(gitDir);

          try {
            // Get canonical repo root (handles worktrees)
            const { stdout: toplevel } = await execAsync(
              "git rev-parse --show-toplevel",
              { cwd: parentDir, timeout: 3000 },
            );
            const repoPath = toplevel.trim();

            if (seen.has(repoPath)) continue;
            seen.add(repoPath);

            // Get remote URL
            const { stdout: remoteRaw } = await execAsync(
              "git remote get-url origin",
              { cwd: repoPath, timeout: 3000 },
            ).catch(() => ({ stdout: "" }));

            const rawUrl = remoteRaw.trim();
            if (!rawUrl) continue;

            repos.push({
              repoPath,
              remoteUrl: normalizeRemoteUrl(rawUrl),
              name: repoDisplayName(repoPath),
            });
          } catch {
            // Skip repos that fail (permission, corrupt, etc.)
            logger.debug("Skipping git dir:", gitDir);
          }
        }

        // Sort alphabetically by path
        repos.sort((a, b) => a.repoPath.localeCompare(b.repoPath));

        // Cache result
        gitReposCache = { repos, expiry: Date.now() + CACHE_TTL };

        logger.debug("listGitRepos returning", repos.length, "repos");
        return { success: true, repos };
      } catch (error) {
        logger.debug("listGitRepos failed:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to scan git repos",
        };
      }
    },
  );

  // ── createRemoteWebhook handler ────────────────────────────────────
  // Creates or updates a webhook on a remote Git host (GitHub/Gitea/GitLab).
  // Runs from the daemon, which has local network access to self-hosted instances.

  rpcHandlerManager.registerHandler<
    CreateRemoteWebhookRequest,
    CreateRemoteWebhookResponse
  >("createRemoteWebhook", async (data) => {
    logger.debug("createRemoteWebhook request:", {
      provider: data.provider,
      repoUrl: data.repoUrl,
    });

    try {
      const parsed = parseRepoOwnerFromUrl(data.repoUrl);
      if (!parsed) {
        return { success: false, error: "Invalid repo URL" };
      }
      const { origin, owner, repo } = parsed;

      const isGitHubCom =
        origin === "https://github.com" || origin === "http://github.com";
      const baseUrl =
        data.provider === "github" && isGitHubCom
          ? "https://api.github.com"
          : data.provider === "github"
            ? `${origin}/api/v3`
            : `${origin}/api/v1`;

      const headers: Record<string, string> = {
        Authorization: `token ${data.apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      const hooksEndpoint = `${baseUrl}/repos/${owner}/${repo}/hooks`;
      logger.debug("createRemoteWebhook hooksEndpoint:", hooksEndpoint);

      // Gitea requires specific event names - use our curated list to ensure
      // all issue and PR sub-events are enabled, regardless of what App sends.
      const giteaEvents = [
        "issues", "issue_assign", "issue_label", "issue_milestone", "issue_comment",
        "pull_request", "pull_request_assign", "pull_request_label",
        "pull_request_milestone", "pull_request_comment", "pull_request_review", "pull_request_sync",
      ];
      const events = data.provider === "gitea" ? giteaEvents : data.events;

      // Check if webhook already exists
      const listRes = await fetch(hooksEndpoint, { headers });
      if (listRes.ok) {
        const hooks = (await listRes.json()) as {
          id: number;
          config: { url?: string };
        }[];
        const existing = hooks.find((h) => h.config.url === data.webhookUrl);
        if (existing) {
          const patchRes = await fetch(`${hooksEndpoint}/${existing.id}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({
              config: {
                url: data.webhookUrl,
                content_type: "json",
                secret: data.webhookSecret,
              },
              events,
              active: true,
            }),
          });
          if (!patchRes.ok) {
            const errText = await patchRes.text().catch(() => "");
            return {
              success: false,
              error: `PATCH ${patchRes.status}: ${errText}`,
            };
          }
          return { success: true, created: false, webhookId: existing.id };
        }
      }

      // Create new webhook
      const createBody: Record<string, unknown> = {
        name: "web",
        config: {
          url: data.webhookUrl,
          content_type: "json",
          secret: data.webhookSecret,
        },
        events,
        active: true,
      };
      // Gitea requires a "type" field
      if (data.provider === "gitea") {
        createBody.type = "gitea";
      }
      const createRes = await fetch(hooksEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(createBody),
      });

      if (createRes.ok || createRes.status === 201) {
        const body = await createRes.json().catch(() => ({}));
        return {
          success: true,
          created: true,
          webhookId: (body as { id?: number }).id,
        };
      }

      const errBody = await createRes.text().catch(() => "");
      return {
        success: false,
        error: `HTTP ${createRes.status}: ${errBody}`,
      };
    } catch (error) {
      logger.debug("createRemoteWebhook failed:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to create webhook",
      };
    }
  });

  // ── deleteRemoteWebhook handler ────────────────────────────────────
  // Deletes a webhook on a remote Git host by matching the webhook URL.

  rpcHandlerManager.registerHandler<
    DeleteRemoteWebhookRequest,
    DeleteRemoteWebhookResponse
  >("deleteRemoteWebhook", async (data) => {
    logger.debug("deleteRemoteWebhook request:", {
      provider: data.provider,
      repoUrl: data.repoUrl,
    });

    try {
      const parsed = parseRepoOwnerFromUrl(data.repoUrl);
      if (!parsed) {
        return { success: false, error: "Invalid repo URL" };
      }
      const { origin, owner, repo } = parsed;

      const isGitHubCom =
        origin === "https://github.com" || origin === "http://github.com";
      const baseUrl =
        data.provider === "github" && isGitHubCom
          ? "https://api.github.com"
          : data.provider === "github"
            ? `${origin}/api/v3`
            : `${origin}/api/v1`;

      const headers: Record<string, string> = {
        Authorization: `token ${data.apiToken}`,
        Accept: "application/json",
      };

      const hooksEndpoint = `${baseUrl}/repos/${owner}/${repo}/hooks`;

      // List hooks and find by URL
      const listRes = await fetch(hooksEndpoint, { headers });
      if (!listRes.ok) {
        return {
          success: false,
          error: `List hooks failed: HTTP ${listRes.status}`,
        };
      }

      const hooks = (await listRes.json()) as {
        id: number;
        config: { url?: string };
      }[];
      const existing = hooks.find((h) => h.config.url === data.webhookUrl);
      if (!existing) {
        return { success: true, deleted: false };
      }

      const deleteRes = await fetch(`${hooksEndpoint}/${existing.id}`, {
        method: "DELETE",
        headers,
      });

      if (deleteRes.ok || deleteRes.status === 204) {
        return { success: true, deleted: true };
      }

      const errBody = await deleteRes.text().catch(() => "");
      return {
        success: false,
        error: `DELETE ${deleteRes.status}: ${errBody}`,
      };
    } catch (error) {
      logger.debug("deleteRemoteWebhook failed:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to delete webhook",
      };
    }
  });
}
