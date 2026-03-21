import { logger } from "@/ui/logger";
import { exec, ExecOptions } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import { createHash } from "crypto";
import { dirname, join, resolve, basename } from "path";
import { tmpdir, homedir } from "os";
import { run as runRipgrep } from "@/modules/ripgrep/index";
import { run as runDifftastic } from "@/modules/difftastic/index";
import { RpcHandlerManager } from "../../api/rpc/RpcHandlerManager";
import { validatePath } from "./pathSecurity";

const execAsync = promisify(exec);

/** Scoped temp directory for uploads from the mobile app. Allowed in addition to workingDirectory. */
const UPLOAD_TEMP_DIR = join(tmpdir(), "happy", "uploads");

/** Maximum file size for writeFile RPC (10 MB base64 ≈ 7.5 MB decoded). */
const MAX_WRITE_SIZE = 10 * 1024 * 1024;

interface BashRequest {
  command: string;
  cwd?: string;
  timeout?: number; // timeout in milliseconds
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
  content?: string; // base64 encoded
  error?: string;
}

interface WriteFileRequest {
  path: string;
  content: string; // base64 encoded
  expectedHash?: string | null; // null for new files, hash for existing files
}

interface WriteFileResponse {
  success: boolean;
  hash?: string; // hash of written file
  error?: string;
}

interface ListDirectoryRequest {
  path: string;
}

interface DirectoryEntry {
  name: string;
  type: "file" | "directory" | "other";
  size?: number;
  modified?: number; // timestamp
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
  children?: TreeNode[]; // Only present for directories
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
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

interface DifftasticRequest {
  args: string[];
  cwd?: string;
}

interface DifftasticResponse {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

interface GetUploadDirResponse {
  success: boolean;
  path?: string;
  error?: string;
}

/*
 * Spawn Session Options and Result
 * This rpc type is used by the daemon, all other RPCs here are for sessions
 */

export interface SpawnSessionOptions {
  machineId?: string;
  directory: string;
  sessionId?: string;
  approvedNewDirectoryCreation?: boolean;
  agent?: "claude" | "codex" | "gemini";
  token?: string;
  /** Happy session ID for reconnecting to an existing session */
  happySessionId?: string;
  environmentVariables?: {
    // Anthropic Claude API configuration
    ANTHROPIC_BASE_URL?: string; // Custom API endpoint (overrides default)
    ANTHROPIC_AUTH_TOKEN?: string; // API authentication token
    ANTHROPIC_MODEL?: string; // Model to use (e.g., claude-3-5-sonnet-20241022)

    // Tmux session management environment variables
    // Based on tmux(1) manual and common tmux usage patterns
    TMUX_SESSION_NAME?: string; // Name for tmux session (creates/attaches to named session)
    TMUX_TMPDIR?: string; // Temporary directory for tmux server socket files
    // Note: TMUX_TMPDIR is used by tmux to store socket files when default /tmp is not suitable
    // Common use case: When /tmp has limited space or different permissions

    // Webhook-triggered session: path to a file containing the initial prompt
    HAPPY_INITIAL_PROMPT_FILE?: string;

    // Allow arbitrary env vars for supervisor and other use cases
    [key: string]: string | undefined;
  };
}

export type SpawnSessionResult =
  | { type: "success"; sessionId: string }
  | { type: "requestToApproveDirectoryCreation"; directory: string }
  | { type: "error"; errorMessage: string };

/**
 * Register all RPC handlers with the session
 */
export function registerCommonHandlers(
  rpcHandlerManager: RpcHandlerManager,
  workingDirectory: string,
  sessionId: string,
) {
  // Sanitize sessionId to prevent path traversal when used in filesystem paths
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9-]/g, "");

  // ── Security: Block commands that can leak secrets via bash RPC ──────────
  // These patterns prevent remote (mobile/web) users from extracting
  // operator-configured API keys, tokens, or other sensitive environment data.
  // Claude Code's own Bash tool is NOT affected — it runs via SDK, not RPC.
  const BLOCKED_BASH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
    // Direct env var reading
    { pattern: /\bprintenv\b/i, reason: "printenv is blocked for security" },
    { pattern: /\benv\b(?:\s|$|;|\|)/i, reason: "env command is blocked for security" },
    { pattern: /\bset\b\s*(?:$|;|\|)/i, reason: "set (list env) is blocked for security" },
    { pattern: /\bexport\s+-p\b/i, reason: "export -p is blocked for security" },
    { pattern: /\bcompgen\s+-e\b/i, reason: "compgen -e is blocked for security" },
    { pattern: /\bdeclare\s+-x\b/i, reason: "declare -x is blocked for security" },
    // Reading process environment from procfs or equivalent
    { pattern: /\/proc\/[^/]*\/environ/i, reason: "reading /proc/environ is blocked for security" },
    // Echoing specific secret env vars
    { pattern: /\$\{?\s*(ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|ANTHROPIC_BASE_URL|OPENAI_API_KEY|OPENAI_BASE_URL|DATABASE_URL|REDIS_URL|JWT_SECRET|ENCRYPTION_KEY|AWS_SECRET_ACCESS_KEY|GOOGLE_API_KEY|GEMINI_API_KEY|TOGETHER_API_KEY|GITHUB_CLIENT_SECRET|CLAUDE_CODE_OAUTH_TOKEN)\b/i, reason: "accessing sensitive environment variables is blocked" },
    // Reading common credential files
    { pattern: /\.(env|env\.local|env\.prod|env\.production|env\.dev)\b/i, reason: "reading .env files is blocked for security" },
    { pattern: /\.aws\/credentials/i, reason: "reading AWS credentials is blocked for security" },
    { pattern: /\.netrc/i, reason: "reading .netrc is blocked for security" },
  ];

  /**
   * Check if a bash command matches any blocked pattern.
   * Returns the reason string if blocked, or null if allowed.
   */
  function checkBlockedBashCommand(command: string): string | null {
    for (const { pattern, reason } of BLOCKED_BASH_PATTERNS) {
      if (pattern.test(command)) {
        return reason;
      }
    }
    return null;
  }

  // Shell command handler - executes commands in the default shell
  rpcHandlerManager.registerHandler<BashRequest, BashResponse>(
    "bash",
    async (data) => {
      logger.debug("Shell command request:", data.command);

      // Security: Block commands that could leak secrets
      const blockedReason = checkBlockedBashCommand(data.command);
      if (blockedReason) {
        logger.warn(`[SECURITY] Blocked bash RPC command: ${blockedReason}`, { command: data.command });
        return { success: false, error: blockedReason };
      }

      // Validate cwd if provided
      // Special case: "/" means "use shell's default cwd" (used by CLI detection)
      // Security: Still validate all other paths to prevent directory traversal
      if (data.cwd && data.cwd !== "/") {
        const validation = validatePath(data.cwd, workingDirectory);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
      }

      try {
        // Build options with shell enabled by default
        // Note: ExecOptions doesn't support boolean for shell, but exec() uses the default shell when shell is undefined
        // If cwd is "/", use undefined to let shell use its default (respects user's PATH)
        const options: ExecOptions = {
          cwd: data.cwd === "/" ? undefined : data.cwd,
          timeout: data.timeout || 30000, // Default 30 seconds timeout
        };

        logger.debug("Shell command executing...", {
          cwd: options.cwd,
          timeout: options.timeout,
        });
        const { stdout, stderr } = await execAsync(data.command, options);
        logger.debug("Shell command executed, processing result...");

        const result = {
          success: true,
          stdout: stdout ? stdout.toString() : "",
          stderr: stderr ? stderr.toString() : "",
          exitCode: 0,
        };
        logger.debug("Shell command result:", {
          success: true,
          exitCode: 0,
          stdoutLen: result.stdout.length,
          stderrLen: result.stderr.length,
        });
        return result;
      } catch (error) {
        const execError = error as NodeJS.ErrnoException & {
          stdout?: string;
          stderr?: string;
          code?: number | string;
          killed?: boolean;
        };

        // Check if the error was due to timeout
        if (execError.code === "ETIMEDOUT" || execError.killed) {
          const result = {
            success: false,
            stdout: execError.stdout || "",
            stderr: execError.stderr || "",
            exitCode: typeof execError.code === "number" ? execError.code : -1,
            error: "Command timed out",
          };
          logger.debug("Shell command timed out:", {
            success: false,
            exitCode: result.exitCode,
            error: "Command timed out",
          });
          return result;
        }

        // If exec fails, it includes stdout/stderr in the error
        const result = {
          success: false,
          stdout: execError.stdout ? execError.stdout.toString() : "",
          stderr: execError.stderr
            ? execError.stderr.toString()
            : execError.message || "Command failed",
          exitCode: typeof execError.code === "number" ? execError.code : 1,
          error: execError.message || "Command failed",
        };
        logger.debug("Shell command failed:", {
          success: false,
          exitCode: result.exitCode,
          error: result.error,
          stdoutLen: result.stdout.length,
          stderrLen: result.stderr.length,
        });
        return result;
      }
    },
  );

  // Read file handler - returns base64 encoded content
  rpcHandlerManager.registerHandler<ReadFileRequest, ReadFileResponse>(
    "readFile",
    async (data) => {
      logger.debug("Read file request:", data.path);

      // Validate path — scoped to this session's upload subdirectory (not the global upload dir)
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
        const content = buffer.toString("base64");
        return { success: true, content };
      } catch (error) {
        logger.debug("Failed to read file:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to read file",
        };
      }
    },
  );

  // Write file handler - with hash verification
  rpcHandlerManager.registerHandler<WriteFileRequest, WriteFileResponse>(
    "writeFile",
    async (data) => {
      logger.debug("Write file request:", data.path);

      // Enforce file size limit to prevent abuse
      if (data.content && data.content.length > MAX_WRITE_SIZE) {
        return {
          success: false,
          error: `File content exceeds maximum allowed size (${MAX_WRITE_SIZE} bytes)`,
        };
      }

      // Validate path — scoped to this session's upload subdirectory
      const sessionUploadDir = join(UPLOAD_TEMP_DIR, safeSessionId);
      const validation = validatePath(data.path, workingDirectory, [
        sessionUploadDir,
      ]);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      try {
        // Resolve path relative to working directory
        const resolvedPath = resolve(workingDirectory, data.path);

        // If expectedHash is provided (not null), verify existing file
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
          } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code !== "ENOENT") {
              throw error;
            }
            // File doesn't exist but hash was provided
            return {
              success: false,
              error: "File does not exist but hash was provided",
            };
          }
        } else {
          // expectedHash is null - expecting new file
          try {
            await stat(resolvedPath);
            // File exists but we expected it to be new
            return {
              success: false,
              error: "File already exists but was expected to be new",
            };
          } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code !== "ENOENT") {
              throw error;
            }
            // File doesn't exist - this is expected
          }
        }

        // Create parent directories if needed
        await mkdir(dirname(resolvedPath), { recursive: true });

        // Write the file
        const buffer = Buffer.from(data.content, "base64");
        await writeFile(resolvedPath, buffer);

        // Calculate and return hash of written file
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

  // Returns the OS temp upload directory scoped to this session, creating it if needed
  rpcHandlerManager.registerHandler<
    Record<string, never>,
    GetUploadDirResponse
  >("getUploadDir", async () => {
    const uploadDir = join(UPLOAD_TEMP_DIR, safeSessionId);
    await mkdir(uploadDir, { recursive: true });
    return { success: true, path: uploadDir };
  });

  // List directory handler
  rpcHandlerManager.registerHandler<
    ListDirectoryRequest,
    ListDirectoryResponse
  >("listDirectory", async (data) => {
    logger.debug("List directory request:", data.path);

    // Validate path is within working directory
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

          if (entry.isDirectory()) {
            type = "directory";
          } else if (entry.isFile()) {
            type = "file";
          }

          try {
            const stats = await stat(fullPath);
            size = stats.size;
            modified = stats.mtime.getTime();
          } catch (error) {
            // Ignore stat errors for individual files
            logger.debug(`Failed to stat ${fullPath}:`, error);
          }

          return {
            name: entry.name,
            type,
            size,
            modified,
          };
        }),
      );

      // Sort entries: directories first, then files, alphabetically
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
          error instanceof Error ? error.message : "Failed to list directory",
      };
    }
  });

  // Get directory tree handler - recursive with depth control
  rpcHandlerManager.registerHandler<
    GetDirectoryTreeRequest,
    GetDirectoryTreeResponse
  >("getDirectoryTree", async (data) => {
    logger.debug(
      "Get directory tree request:",
      data.path,
      "maxDepth:",
      data.maxDepth,
    );

    // Validate path is within working directory
    const validation = validatePath(data.path, workingDirectory);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Helper function to build tree recursively
    async function buildTree(
      path: string,
      name: string,
      currentDepth: number,
    ): Promise<TreeNode | null> {
      try {
        const stats = await stat(path);

        // Base node information
        const node: TreeNode = {
          name,
          path,
          type: stats.isDirectory() ? "directory" : "file",
          size: stats.size,
          modified: stats.mtime.getTime(),
        };

        // If it's a directory and we haven't reached max depth, get children
        if (stats.isDirectory() && currentDepth < data.maxDepth) {
          const entries = await readdir(path, { withFileTypes: true });
          const children: TreeNode[] = [];

          // Process entries in parallel, filtering out symlinks
          await Promise.all(
            entries.map(async (entry) => {
              // Skip symbolic links completely
              if (entry.isSymbolicLink()) {
                logger.debug(`Skipping symlink: ${join(path, entry.name)}`);
                return;
              }

              const childPath = join(path, entry.name);
              const childNode = await buildTree(
                childPath,
                entry.name,
                currentDepth + 1,
              );
              if (childNode) {
                children.push(childNode);
              }
            }),
          );

          // Sort children: directories first, then files, alphabetically
          children.sort((a, b) => {
            if (a.type === "directory" && b.type !== "directory") return -1;
            if (a.type !== "directory" && b.type === "directory") return 1;
            return a.name.localeCompare(b.name);
          });

          node.children = children;
        }

        return node;
      } catch (error) {
        // Log error but continue traversal
        logger.debug(
          `Failed to process ${path}:`,
          error instanceof Error ? error.message : String(error),
        );
        return null;
      }
    }

    try {
      // Validate maxDepth
      if (data.maxDepth < 0) {
        return { success: false, error: "maxDepth must be non-negative" };
      }

      // Get the base name for the root node
      const baseName =
        data.path === "/" ? "/" : data.path.split("/").pop() || data.path;

      // Build the tree starting from the requested path
      const tree = await buildTree(data.path, baseName, 0);

      if (!tree) {
        return { success: false, error: "Failed to access the specified path" };
      }

      return { success: true, tree };
    } catch (error) {
      logger.debug("Failed to get directory tree:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get directory tree",
      };
    }
  });

  // Ripgrep handler - raw interface to ripgrep
  rpcHandlerManager.registerHandler<RipgrepRequest, RipgrepResponse>(
    "ripgrep",
    async (data) => {
      logger.debug("Ripgrep request with args:", data.args, "cwd:", data.cwd);

      // Validate cwd if provided
      if (data.cwd) {
        const validation = validatePath(data.cwd, workingDirectory);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
      }

      try {
        const result = await runRipgrep(data.args, { cwd: data.cwd });
        return {
          success: true,
          exitCode: result.exitCode,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
        };
      } catch (error) {
        logger.debug("Failed to run ripgrep:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to run ripgrep",
        };
      }
    },
  );

  // Difftastic handler - raw interface to difftastic
  rpcHandlerManager.registerHandler<DifftasticRequest, DifftasticResponse>(
    "difftastic",
    async (data) => {
      logger.debug(
        "Difftastic request with args:",
        data.args,
        "cwd:",
        data.cwd,
      );

      // Validate cwd if provided
      if (data.cwd) {
        const validation = validatePath(data.cwd, workingDirectory);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
      }

      try {
        const result = await runDifftastic(data.args, { cwd: data.cwd });
        return {
          success: true,
          exitCode: result.exitCode,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
        };
      } catch (error) {
        logger.debug("Failed to run difftastic:", error);
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to run difftastic",
        };
      }
    },
  );

  // ── listGitRepos handler ─────────────────────────────────────────────
  // Scans the user's home directory for git repositories and returns
  // their paths and remote URLs. NOT restricted to workingDirectory.

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

  let gitReposCache: { repos: GitRepoEntry[]; expiry: number } | null = null;
  const CACHE_TTL = 120_000; // 120 seconds

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

  // ── Discover installed Claude Code plugins ──
  rpcHandlerManager.registerHandler("discoverPlugins", async () => {
    const results: Array<{ name: string; path: string }> = [];

    // Scan ~/.claude/plugins/ for marketplace/installed plugins
    const globalPluginsDir = join(homedir(), ".claude", "plugins", "marketplaces");
    try {
      const entries = await readdir(globalPluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          results.push({
            name: entry.name,
            path: join(globalPluginsDir, entry.name),
          });
        }
      }
    } catch {
      // ~/.claude/plugins/marketplaces/ may not exist
    }

    // Also scan project-level .claude/plugins/ if present
    const projectPluginsDir = join(workingDirectory, ".claude", "plugins");
    try {
      const entries = await readdir(projectPluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          results.push({
            name: `${entry.name} (project)`,
            path: join(projectPluginsDir, entry.name),
          });
        }
      }
    } catch {
      // .claude/plugins/ may not exist in project
    }

    return { plugins: results };
  });
}
