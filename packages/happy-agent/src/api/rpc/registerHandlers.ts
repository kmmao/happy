/**
 * Agent-specific RPC handlers — trimmed from CLI's registerCommonHandlers.
 *
 * Only registers: bash, readFile, writeFile, listDirectory.
 * Omits CLI-only tools: ripgrep, difftastic, getDirectoryTree, plugins, MCP.
 *
 * Security:
 * - Bash commands are blocked if they try to leak env vars or read credentials
 * - File operations are restricted to workingDirectory via path validation
 */

import { exec, execFile, type ExecOptions, type ExecFileOptions } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import { createHash } from "crypto";
import { join, resolve } from "path";
import { realpathSync } from "fs";
import { tmpdir } from "os";
import { logger } from "../../logger";
import type { RpcHandlerManager } from "./RpcHandlerManager";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const UPLOAD_TEMP_DIR = join(tmpdir(), "happy", "uploads");
const MAX_WRITE_SIZE = 10 * 1024 * 1024; // 10 MB

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BashRequest {
  command: string;
  cwd?: string;
  timeout?: number;
}

interface BashResponse {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}

interface ReadFileRequest {
  path: string;
}

interface ReadFileResponse {
  success: boolean;
  content?: string;
  error?: string;
}

interface WriteFileRequest {
  path: string;
  content: string;
  expectedHash?: string | null;
}

interface WriteFileResponse {
  success: boolean;
  hash?: string;
  error?: string;
}

interface ListDirectoryRequest {
  path: string;
}

interface DirectoryEntry {
  name: string;
  type: "file" | "directory" | "other";
  size?: number;
  modified?: number;
}

interface ListDirectoryResponse {
  success: boolean;
  entries?: DirectoryEntry[];
  error?: string;
}

interface GetDirectoryTreeRequest {
  path: string;
  maxDepth: number;
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: number;
  children?: TreeNode[];
}

interface GetDirectoryTreeResponse {
  success: boolean;
  tree?: TreeNode;
  error?: string;
}

interface RipgrepRequest {
  args: string[];
  cwd?: string;
}

interface RipgrepResponse {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
}

interface DifftasticRequest {
  args: string[];
  cwd?: string;
}

interface DifftasticResponse {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
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

// ---------------------------------------------------------------------------
// Path security (inline from CLI's pathSecurity.ts)
// ---------------------------------------------------------------------------

function validatePath(
  targetPath: string,
  workingDirectory: string,
  additionalAllowedDirs?: string[],
): { valid: boolean; error?: string } {
  const resolvedTarget = resolve(workingDirectory, targetPath);

  let realTarget: string;
  try {
    realTarget = realpathSync(resolvedTarget);
  } catch {
    const parentDir = resolve(resolvedTarget, "..");
    try {
      realTarget =
        realpathSync(parentDir) + "/" + resolvedTarget.split("/").pop();
    } catch {
      realTarget = resolvedTarget;
    }
  }

  const allowedDirs = [
    workingDirectory,
    ...(additionalAllowedDirs ?? []),
  ].map((d) => {
    const resolved = resolve(d);
    try {
      return realpathSync(resolved);
    } catch {
      return resolved;
    }
  });

  for (const dir of allowedDirs) {
    if (realTarget.startsWith(dir + "/") || realTarget === dir) {
      return { valid: true };
    }
  }

  return {
    valid: false,
    error: `Access denied: Path '${targetPath}' is outside the allowed directories`,
  };
}

// ---------------------------------------------------------------------------
// Bash command blocklist
// ---------------------------------------------------------------------------

const BLOCKED_BASH_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [
  { pattern: /\bprintenv\b/i, reason: "printenv is blocked for security" },
  {
    pattern: /\benv\b(?:\s|$|;|\|)/i,
    reason: "env command is blocked for security",
  },
  {
    pattern: /\bset\b\s*(?:$|;|\|)/i,
    reason: "set (list env) is blocked for security",
  },
  {
    pattern: /\bexport\s+-p\b/i,
    reason: "export -p is blocked for security",
  },
  {
    pattern: /\bcompgen\s+-e\b/i,
    reason: "compgen -e is blocked for security",
  },
  {
    pattern: /\bdeclare\s+-x\b/i,
    reason: "declare -x is blocked for security",
  },
  {
    pattern: /\/proc\/[^/]*\/environ/i,
    reason: "reading /proc/environ is blocked for security",
  },
  {
    pattern:
      /\$\{?\s*(ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|ANTHROPIC_BASE_URL|OPENAI_API_KEY|OPENAI_BASE_URL|DATABASE_URL|REDIS_URL|JWT_SECRET|ENCRYPTION_KEY|AWS_SECRET_ACCESS_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|TOGETHER_API_KEY|GITHUB_CLIENT_SECRET|CLAUDE_CODE_OAUTH_TOKEN)\b/i,
    reason: "accessing sensitive environment variables is blocked",
  },
  {
    pattern: /\.(env|env\.local|env\.prod|env\.production|env\.dev)\b/i,
    reason: "reading .env files is blocked for security",
  },
  {
    pattern: /\.aws\/credentials/i,
    reason: "reading AWS credentials is blocked for security",
  },
  {
    pattern: /\.netrc/i,
    reason: "reading .netrc is blocked for security",
  },
];

function checkBlockedBashCommand(command: string): string | null {
  for (const { pattern, reason } of BLOCKED_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return reason;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerAgentHandlers(
  rpcHandlerManager: RpcHandlerManager,
  workingDirectory: string,
  sessionId: string,
): void {
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9-]/g, "");

  // ── bash ──────────────────────────────────────────────────────────────
  rpcHandlerManager.registerHandler<BashRequest, BashResponse>(
    "bash",
    async (data) => {
      logger.debug("Shell command request:", data.command);

      const blockedReason = checkBlockedBashCommand(data.command);
      if (blockedReason) {
        logger.warn(
          `[SECURITY] Blocked bash RPC command: ${blockedReason}`,
          { command: data.command },
        );
        return { success: false, error: blockedReason };
      }

      if (data.cwd && data.cwd !== "/") {
        const validation = validatePath(data.cwd, workingDirectory);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
      }

      try {
        const options: ExecOptions = {
          cwd: data.cwd === "/" ? undefined : data.cwd,
          timeout: data.timeout ?? 30_000,
        };
        const { stdout, stderr } = await execAsync(data.command, options);
        return {
          success: true,
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          exitCode: 0,
        };
      } catch (error) {
        const execError = error as NodeJS.ErrnoException & {
          stdout?: string;
          stderr?: string;
          code?: number | string;
          killed?: boolean;
        };

        if (execError.code === "ETIMEDOUT" || execError.killed) {
          return {
            success: false,
            stdout: execError.stdout ?? "",
            stderr: execError.stderr ?? "",
            exitCode:
              typeof execError.code === "number" ? execError.code : -1,
            error: "Command timed out",
          };
        }

        return {
          success: false,
          stdout: execError.stdout?.toString() ?? "",
          stderr:
            execError.stderr?.toString() ?? execError.message ?? "Command failed",
          exitCode: typeof execError.code === "number" ? execError.code : 1,
          error: execError.message ?? "Command failed",
        };
      }
    },
  );

  // ── readFile ──────────────────────────────────────────────────────────
  rpcHandlerManager.registerHandler<ReadFileRequest, ReadFileResponse>(
    "readFile",
    async (data) => {
      logger.debug("Read file request:", data.path);

      const sessionUploadDir = join(UPLOAD_TEMP_DIR, safeSessionId);
      const validation = validatePath(data.path, workingDirectory, [
        sessionUploadDir,
      ]);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      try {
        const resolvedPath = resolve(workingDirectory, data.path);
        const buffer = await readFile(resolvedPath);
        return { success: true, content: buffer.toString("base64") };
      } catch (error) {
        logger.debug("Failed to read file:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to read file",
        };
      }
    },
  );

  // ── writeFile ─────────────────────────────────────────────────────────
  rpcHandlerManager.registerHandler<WriteFileRequest, WriteFileResponse>(
    "writeFile",
    async (data) => {
      logger.debug("Write file request:", data.path);

      if (data.content && data.content.length > MAX_WRITE_SIZE) {
        return {
          success: false,
          error: `File content exceeds maximum allowed size (${MAX_WRITE_SIZE} bytes)`,
        };
      }

      const sessionUploadDir = join(UPLOAD_TEMP_DIR, safeSessionId);
      const validation = validatePath(data.path, workingDirectory, [
        sessionUploadDir,
      ]);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      try {
        const resolvedPath = resolve(workingDirectory, data.path);

        if (data.expectedHash !== null && data.expectedHash !== undefined) {
          try {
            const existingBuffer = await readFile(resolvedPath);
            const existingHash = createHash("sha256")
              .update(existingBuffer)
              .digest("hex");
            if (existingHash !== data.expectedHash) {
              return {
                success: false,
                error: `File hash mismatch. Expected: ${data.expectedHash}, Actual: ${existingHash}`,
              };
            }
          } catch {
            return {
              success: false,
              error: "File does not exist but expectedHash was provided",
            };
          }
        }

        const dir = resolve(resolvedPath, "..");
        await mkdir(dir, { recursive: true });
        const buffer = Buffer.from(data.content, "base64");
        await writeFile(resolvedPath, buffer);
        const hash = createHash("sha256").update(buffer).digest("hex");
        return { success: true, hash };
      } catch (error) {
        logger.debug("Failed to write file:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to write file",
        };
      }
    },
  );

  // ── listDirectory ─────────────────────────────────────────────────────
  rpcHandlerManager.registerHandler<
    ListDirectoryRequest,
    ListDirectoryResponse
  >("listDirectory", async (data) => {
    logger.debug("List directory request:", data.path);

    const validation = validatePath(data.path, workingDirectory);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    try {
      const entries = await readdir(data.path, { withFileTypes: true });
      const directoryEntries: DirectoryEntry[] = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = join(data.path, entry.name);
          let type: "file" | "directory" | "other" = "other";
          let size: number | undefined;
          let modified: number | undefined;

          if (entry.isDirectory()) type = "directory";
          else if (entry.isFile()) type = "file";

          try {
            const stats = await stat(fullPath);
            size = stats.size;
            modified = stats.mtime.getTime();
          } catch {
            // Ignore stat errors for individual files
          }

          return { name: entry.name, type, size, modified };
        }),
      );

      directoryEntries.sort((a, b) => {
        if (a.type === "directory" && b.type !== "directory") return -1;
        if (a.type !== "directory" && b.type === "directory") return 1;
        return a.name.localeCompare(b.name);
      });

      return { success: true, entries: directoryEntries };
    } catch (error) {
      logger.debug("Failed to list directory:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to list directory",
      };
    }
  });

  // ── getUploadDir ──────────────────────────────────────────────────────
  rpcHandlerManager.registerHandler<
    Record<string, never>,
    { success: boolean; path?: string; error?: string }
  >("getUploadDir", async () => {
    const uploadDir = join(UPLOAD_TEMP_DIR, safeSessionId);
    await mkdir(uploadDir, { recursive: true });
    return { success: true, path: uploadDir };
  });

  // ── getDirectoryTree ─────────────────────────────────────────────────
  rpcHandlerManager.registerHandler<
    GetDirectoryTreeRequest,
    GetDirectoryTreeResponse
  >("getDirectoryTree", async (data) => {
    logger.debug("Get directory tree request:", data.path, "maxDepth:", data.maxDepth);

    const validation = validatePath(data.path, workingDirectory);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    async function buildTree(
      dirPath: string,
      name: string,
      currentDepth: number,
    ): Promise<TreeNode | null> {
      try {
        const stats = await stat(dirPath);
        const node: TreeNode = {
          name,
          path: dirPath,
          type: stats.isDirectory() ? "directory" : "file",
          size: stats.size,
          modified: stats.mtime.getTime(),
        };

        if (stats.isDirectory() && currentDepth < data.maxDepth) {
          const entries = await readdir(dirPath, { withFileTypes: true });
          const children: TreeNode[] = [];
          await Promise.all(
            entries.map(async (entry) => {
              if (entry.isSymbolicLink()) return;
              const childPath = join(dirPath, entry.name);
              const childNode = await buildTree(childPath, entry.name, currentDepth + 1);
              if (childNode) children.push(childNode);
            }),
          );
          children.sort((a, b) => {
            if (a.type === "directory" && b.type !== "directory") return -1;
            if (a.type !== "directory" && b.type === "directory") return 1;
            return a.name.localeCompare(b.name);
          });
          node.children = children;
        }
        return node;
      } catch (error) {
        logger.debug(`Failed to process ${dirPath}:`, error instanceof Error ? error.message : String(error));
        return null;
      }
    }

    try {
      if (data.maxDepth < 0) {
        return { success: false, error: "maxDepth must be non-negative" };
      }
      const baseName = data.path === "/" ? "/" : data.path.split("/").pop() || data.path;
      const tree = await buildTree(data.path, baseName, 0);
      if (!tree) {
        return { success: false, error: "Failed to access the specified path" };
      }
      return { success: true, tree };
    } catch (error) {
      logger.debug("Failed to get directory tree:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get directory tree",
      };
    }
  });

  // ── ripgrep (thin wrapper — shells out to `rg` if available) ─────────
  rpcHandlerManager.registerHandler<RipgrepRequest, RipgrepResponse>(
    "ripgrep",
    async (data) => {
      const cwd = data.cwd || workingDirectory;
      if (data.cwd) {
        const validation = validatePath(data.cwd, workingDirectory);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
      }
      try {
        const { stdout, stderr } = await execFileAsync("rg", data.args, {
          cwd,
          timeout: 30_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        return { success: true, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", exitCode: 0 };
      } catch (error) {
        const e = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
        if (e.code === "ENOENT") {
          return { success: false, error: "ripgrep (rg) is not installed on this machine" };
        }
        // rg exits with code 1 when no matches found — that's not an error
        if (e.code === "1" || (e as any).status === 1) {
          return { success: true, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "", exitCode: 1 };
        }
        return {
          success: false,
          stdout: e.stdout?.toString() ?? "",
          stderr: e.stderr?.toString() ?? "",
          exitCode: typeof e.code === "number" ? e.code : 1,
          error: e.message ?? "ripgrep failed",
        };
      }
    },
  );

  // ── difftastic (thin wrapper — shells out to `difft` if available) ───
  rpcHandlerManager.registerHandler<DifftasticRequest, DifftasticResponse>(
    "difftastic",
    async (data) => {
      const cwd = data.cwd || workingDirectory;
      if (data.cwd) {
        const validation = validatePath(data.cwd, workingDirectory);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
      }
      try {
        const { stdout, stderr } = await execFileAsync("difft", data.args, {
          cwd,
          timeout: 30_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        return { success: true, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "", exitCode: 0 };
      } catch (error) {
        const e = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
        if (e.code === "ENOENT") {
          return { success: false, error: "difftastic (difft) is not installed on this machine" };
        }
        return {
          success: false,
          stdout: e.stdout?.toString() ?? "",
          stderr: e.stderr?.toString() ?? "",
          exitCode: typeof e.code === "number" ? e.code : 1,
          error: e.message ?? "difftastic failed",
        };
      }
    },
  );

  // ── listRemoteGitRepos ───────────────────────────────────────────────
  rpcHandlerManager.registerHandler<
    ListRemoteGitReposRequest,
    ListRemoteGitReposResponse
  >("listRemoteGitRepos", async (data) => {
    const page = data.page ?? 1;
    const perPage = data.perPage ?? 30;
    const query = data.query?.trim() || "";

    logger.debug("listRemoteGitRepos request:", { provider: data.provider, host: data.host, page, perPage, query });

    if (!data.apiToken) return { success: false, error: "API token is required" };
    if (!data.host?.trim()) return { success: false, error: "Host is required" };

    try {
      const baseUrl = buildGitApiBase(data.provider, data.host);
      const headers = buildGitApiHeaders(data.apiToken);

      type RawRepo = {
        name?: string; full_name?: string; clone_url?: string; html_url?: string;
        private?: boolean; updated_at?: string; owner?: { login?: string; username?: string };
      };

      let repos: RemoteGitRepoEntry[];
      let hasMore: boolean;

      if (data.provider === "github") {
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
        const searchParams = new URLSearchParams({ sort: "updated", order: "desc", limit: String(perPage), page: String(page) });
        if (query) searchParams.set("q", query);
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

      return { success: true, repos, hasMore };
    } catch (error) {
      logger.debug("listRemoteGitRepos failed:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to load remote repositories" };
    }
  });

  // ── cloneGitRepo ─────────────────────────────────────────────────────
  rpcHandlerManager.registerHandler<CloneGitRepoRequest, CloneGitRepoResponse>(
    "cloneGitRepo",
    async (data) => {
      logger.debug("cloneGitRepo request:", { repoUrl: data.repoUrl, targetDirectory: data.targetDirectory });

      if (!data.repoUrl?.trim()) return { success: false, error: "Repository URL is required" };
      if (!data.targetDirectory?.trim()) return { success: false, error: "Target directory is required" };
      if (!data.targetDirectory.startsWith("/")) return { success: false, error: "Target directory must be an absolute path" };

      const coords = parseCloneCoordinates(data.repoUrl);
      if (!coords) return { success: false, error: "Invalid repository URL" };

      const repoPath = join(resolve(data.targetDirectory), coords.repo);

      try {
        await mkdir(resolve(data.targetDirectory), { recursive: true });
        try {
          const existing = await stat(repoPath);
          if (existing.isDirectory()) {
            return { success: false, error: `Destination already exists: ${repoPath}` };
          }
        } catch { /* does not exist yet */ }

        const cloneUrl = resolveCloneUrl(data.repoUrl, data.host);
        const options: ExecFileOptions = {
          cwd: resolve(data.targetDirectory),
          timeout: 300_000,
          maxBuffer: 4 * 1024 * 1024,
          env: buildCloneAuthEnv(data.provider, data.apiToken),
        };

        const { stdout, stderr } = await execFileAsync("git", ["clone", cloneUrl, repoPath], options);
        return { success: true, repoPath, stdout: stdout?.toString() ?? "", stderr: stderr?.toString() ?? "" };
      } catch (error) {
        const e = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        logger.debug("cloneGitRepo failed:", { message: e.message, stderr: e.stderr });
        return { success: false, repoPath, stdout: e.stdout || "", stderr: e.stderr || "", error: e.message || "Failed to clone repository" };
      }
    },
  );

  // ── createRemoteWebhook ──────────────────────────────────────────────
  rpcHandlerManager.registerHandler<
    CreateRemoteWebhookRequest,
    CreateRemoteWebhookResponse
  >("createRemoteWebhook", async (data) => {
    logger.debug("createRemoteWebhook request:", { provider: data.provider, repoUrl: data.repoUrl });

    try {
      const parsed = parseRepoOwnerFromUrl(data.repoUrl);
      if (!parsed) return { success: false, error: "Invalid repo URL" };
      const { origin, owner, repo } = parsed;

      const isGitHubCom = origin === "https://github.com" || origin === "http://github.com";
      const baseUrl = data.provider === "github" && isGitHubCom
        ? "https://api.github.com"
        : data.provider === "github" ? `${origin}/api/v3` : `${origin}/api/v1`;

      const headers: Record<string, string> = {
        Authorization: `token ${data.apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      const hooksEndpoint = `${baseUrl}/repos/${owner}/${repo}/hooks`;

      const giteaEvents = [
        "issues", "issue_assign", "issue_label", "issue_milestone", "issue_comment",
        "pull_request", "pull_request_assign", "pull_request_label",
        "pull_request_milestone", "pull_request_comment", "pull_request_review", "pull_request_sync",
      ];
      const events = data.provider === "gitea" ? giteaEvents : data.events;

      // Check existing
      const listRes = await fetch(hooksEndpoint, { headers });
      if (listRes.ok) {
        const hooks = (await listRes.json()) as { id: number; config: { url?: string } }[];
        const existing = hooks.find((h) => h.config.url === data.webhookUrl);
        if (existing) {
          const patchRes = await fetch(`${hooksEndpoint}/${existing.id}`, {
            method: "PATCH", headers,
            body: JSON.stringify({ config: { url: data.webhookUrl, content_type: "json", secret: data.webhookSecret }, events, active: true }),
          });
          if (!patchRes.ok) {
            const errText = await patchRes.text().catch(() => "");
            return { success: false, error: `PATCH ${patchRes.status}: ${errText}` };
          }
          return { success: true, created: false, webhookId: existing.id };
        }
      }

      // Create new
      const createBody: Record<string, unknown> = {
        name: "web",
        config: { url: data.webhookUrl, content_type: "json", secret: data.webhookSecret },
        events, active: true,
      };
      if (data.provider === "gitea") createBody.type = "gitea";

      const createRes = await fetch(hooksEndpoint, { method: "POST", headers, body: JSON.stringify(createBody) });
      if (createRes.ok || createRes.status === 201) {
        const body = await createRes.json().catch(() => ({}));
        return { success: true, created: true, webhookId: (body as { id?: number }).id };
      }
      const errBody = await createRes.text().catch(() => "");
      return { success: false, error: `HTTP ${createRes.status}: ${errBody}` };
    } catch (error) {
      logger.debug("createRemoteWebhook failed:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to create webhook" };
    }
  });

  // ── deleteRemoteWebhook ──────────────────────────────────────────────
  rpcHandlerManager.registerHandler<
    DeleteRemoteWebhookRequest,
    DeleteRemoteWebhookResponse
  >("deleteRemoteWebhook", async (data) => {
    logger.debug("deleteRemoteWebhook request:", { provider: data.provider, repoUrl: data.repoUrl });

    try {
      const parsed = parseRepoOwnerFromUrl(data.repoUrl);
      if (!parsed) return { success: false, error: "Invalid repo URL" };
      const { origin, owner, repo } = parsed;

      const isGitHubCom = origin === "https://github.com" || origin === "http://github.com";
      const baseUrl = data.provider === "github" && isGitHubCom
        ? "https://api.github.com"
        : data.provider === "github" ? `${origin}/api/v3` : `${origin}/api/v1`;

      const headers: Record<string, string> = { Authorization: `token ${data.apiToken}`, Accept: "application/json" };
      const hooksEndpoint = `${baseUrl}/repos/${owner}/${repo}/hooks`;

      const listRes = await fetch(hooksEndpoint, { headers });
      if (!listRes.ok) return { success: false, error: `List hooks failed: HTTP ${listRes.status}` };

      const hooks = (await listRes.json()) as { id: number; config: { url?: string } }[];
      const existing = hooks.find((h) => h.config.url === data.webhookUrl);
      if (!existing) return { success: true, deleted: false };

      const deleteRes = await fetch(`${hooksEndpoint}/${existing.id}`, { method: "DELETE", headers });
      if (deleteRes.ok || deleteRes.status === 204) return { success: true, deleted: true };

      const errBody = await deleteRes.text().catch(() => "");
      return { success: false, error: `DELETE ${deleteRes.status}: ${errBody}` };
    } catch (error) {
      logger.debug("deleteRemoteWebhook failed:", error);
      return { success: false, error: error instanceof Error ? error.message : "Failed to delete webhook" };
    }
  });
}

// ---------------------------------------------------------------------------
// Git helper functions (ported from CLI)
// ---------------------------------------------------------------------------

function parseHostEntry(host: string): { bare: string; protocol: string | null } {
  const match = host.match(/^(https?):\/\/(.+)/);
  if (match) return { bare: match[2].replace(/\/$/, ""), protocol: match[1] };
  return { bare: host.replace(/\/$/, ""), protocol: null };
}

function buildGitApiBase(provider: "github" | "gitea", host: string): string {
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
    name?: string; full_name?: string; clone_url?: string; html_url?: string;
    private?: boolean; updated_at?: string; owner?: { login?: string; username?: string };
  }>,
): RemoteGitRepoEntry[] {
  return pageRepos
    .filter((repo) => !!repo.name)
    .map((repo) => {
      const owner = repo.owner?.login || repo.owner?.username || "";
      const fullName = repo.full_name || (owner ? `${owner}/${repo.name}` : repo.name || "");
      const htmlUrl = repo.html_url || "";
      const cloneUrl = repo.clone_url || (htmlUrl ? `${htmlUrl}.git` : "");
      return { name: repo.name || fullName, fullName, cloneUrl, htmlUrl, private: !!repo.private, updatedAt: repo.updated_at ? Date.parse(repo.updated_at) : null };
    })
    .filter((repo) => !!repo.cloneUrl);
}

function parseCloneCoordinates(repoUrl: string): { host: string; owner: string; repo: string } | null {
  const trimmed = repoUrl.trim();
  const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshMatch) return { host: sshMatch[1], owner: sshMatch[2], repo: sshMatch[3] };
  const sshUrlMatch = trimmed.match(/^ssh:\/\/[^@]+@([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (sshUrlMatch) return { host: sshUrlMatch[1], owner: sshUrlMatch[2], repo: sshUrlMatch[3] };
  const httpsMatch = trimmed.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (httpsMatch) return { host: httpsMatch[1], owner: httpsMatch[2], repo: httpsMatch[3] };
  return null;
}

function resolveCloneUrl(repoUrl: string, configuredHost?: string): string {
  if (/^https?:\/\//.test(repoUrl)) return repoUrl;
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

function parseRepoOwnerFromUrl(repoUrl: string): { origin: string; owner: string; repo: string } | null {
  try {
    const url = new URL(repoUrl);
    const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (parts.length >= 2) return { origin: url.origin, owner: parts[0], repo: parts[1] };
  } catch { /* ignore */ }
  return null;
}
