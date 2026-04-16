import { logger } from "@/ui/logger";
import { exec, execFile, ExecFileOptions, ExecOptions } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import { createHash } from "crypto";
import { dirname, join, resolve, basename } from "path";
import { tmpdir, homedir } from "os";
import { run as runRipgrep } from "@/modules/ripgrep/index";
import { run as runDifftastic } from "@/modules/difftastic/index";
import { RpcHandlerManager } from "../../api/rpc/RpcHandlerManager";
import { validatePath } from "./pathSecurity";
import type { ResolvedRuntimeProfile } from "@kmmao/happy-wire";
import {
  findSensitiveEnvVarReferences,
  summarizeShellCommandForLog,
} from "@/utils/securityRedaction";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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
  /** Happy session ID for reconnecting to an existing session (or pre-allocating one for fork) */
  happySessionId?: string;
  /** Source session ID when this spawn is a fork — written as --happy-fork-source in the process command */
  forkSourceId?: string;
  /** Profile ID from GUI — if it matches a locally configured profile, operator-only env vars are trusted */
  profileId?: string;
  /** Unified runtime profile contract resolved by App/Server before session spawn. */
  runtimeProfile?: ResolvedRuntimeProfile;
  automationContext?: {
    kind: "supervisor" | "webhook" | "agent_loop" | "task";
    trigger?: string;
    projectId?: string;
    runId?: string;
    loopId?: string;
    dedupeKey?: string;
  };
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
  let gitReposCache: { repos: GitRepoEntry[]; expiry: number } | null = null;

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
    const sensitiveEnvVars = findSensitiveEnvVarReferences(command);
    if (sensitiveEnvVars.length > 0) {
      return `accessing sensitive environment variables is blocked (${sensitiveEnvVars.join(", ")})`;
    }
    return null;
  }

  // Shell command handler - executes commands in the default shell
  rpcHandlerManager.registerHandler<BashRequest, BashResponse>(
    "bash",
    async (data) => {
      const commandSummary = summarizeShellCommandForLog(data.command);
      logger.debug("Shell command request:", commandSummary.preview);

      // Security: Block commands that could leak secrets
      const blockedReason = checkBlockedBashCommand(data.command);
      if (blockedReason) {
        logger.warn(`[SECURITY] Blocked bash RPC command: ${blockedReason}`, {
          command: commandSummary.preview,
        });
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

  // ── Plugin metadata helpers ──

  /** Count directory entries (non-recursive). Returns 0 if dir missing. */
  async function countDirEntries(dirPath: string): Promise<number> {
    try {
      const entries = await readdir(dirPath);
      return entries.filter((e) => !e.startsWith(".")).length;
    } catch {
      return 0;
    }
  }

  /** Read and parse a JSON file. Returns null on any error. */
  async function readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
      const raw = await readFile(filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  interface PluginJson {
    name?: string;
    version?: string;
    description?: string;
    author?: string | { name?: string };
    homepage?: string;
    license?: string;
    keywords?: string[];
  }

  interface MarketplaceJson {
    plugins?: Array<{
      name?: string;
      description?: string;
      category?: string;
    }>;
  }

  interface PluginMeta {
    name: string;
    path: string;
    version?: string;
    description?: string;
    author?: string;
    homepage?: string;
    license?: string;
    keywords?: string[];
    counts: { commands: number; skills: number; agents: number };
    subPlugins?: Array<{ name: string; description?: string; category?: string }>;
  }

  /** Read metadata for a single plugin directory. */
  async function readPluginMeta(pluginName: string, pluginPath: string): Promise<PluginMeta> {
    const meta: PluginMeta = {
      name: pluginName,
      path: pluginPath,
      counts: { commands: 0, skills: 0, agents: 0 },
    };

    // Read .claude-plugin/plugin.json
    const pluginJson = await readJsonFile<PluginJson>(
      join(pluginPath, ".claude-plugin", "plugin.json"),
    );
    if (pluginJson) {
      meta.version = pluginJson.version;
      meta.description = pluginJson.description;
      meta.author =
        typeof pluginJson.author === "string"
          ? pluginJson.author
          : pluginJson.author?.name;
      meta.homepage = pluginJson.homepage;
      meta.license = pluginJson.license;
      meta.keywords = pluginJson.keywords;
    }

    // Read .claude-plugin/marketplace.json for sub-plugins
    const marketplace = await readJsonFile<MarketplaceJson>(
      join(pluginPath, ".claude-plugin", "marketplace.json"),
    );
    if (marketplace?.plugins && marketplace.plugins.length > 0) {
      meta.subPlugins = marketplace.plugins
        .filter((p) => p.name)
        .map((p) => ({
          name: p.name!,
          description: p.description,
          category: p.category,
        }));
      // Use marketplace description as fallback
      if (!meta.description && marketplace.plugins.length === 1) {
        meta.description = marketplace.plugins[0].description;
      }
    }

    // Count contents
    const [commands, skills, agents] = await Promise.all([
      countDirEntries(join(pluginPath, "commands")),
      countDirEntries(join(pluginPath, "skills")),
      countDirEntries(join(pluginPath, "agents")),
    ]);
    meta.counts = { commands, skills, agents };

    return meta;
  }

  // ── Discover installed Claude Code plugins ──
  rpcHandlerManager.registerHandler("discoverPlugins", async () => {
    const dirs: Array<{ name: string; path: string }> = [];

    // Scan ~/.claude/plugins/marketplaces/
    const globalPluginsDir = join(homedir(), ".claude", "plugins", "marketplaces");
    try {
      const entries = await readdir(globalPluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push({ name: entry.name, path: join(globalPluginsDir, entry.name) });
        }
      }
    } catch {
      // ~/.claude/plugins/marketplaces/ may not exist
    }

    // Scan project-level .claude/plugins/
    const projectPluginsDir = join(workingDirectory, ".claude", "plugins");
    try {
      const entries = await readdir(projectPluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push({
            name: `${entry.name} (project)`,
            path: join(projectPluginsDir, entry.name),
          });
        }
      }
    } catch {
      // .claude/plugins/ may not exist in project
    }

    // Read metadata for all discovered plugins in parallel
    const plugins = await Promise.all(
      dirs.map((d) => readPluginMeta(d.name, d.path)),
    );

    return { plugins };
  });

  // ── List truly installed plugins (from installed_plugins.json + enabledPlugins) ──
  rpcHandlerManager.registerHandler("listInstalledPlugins", async () => {
    const claudeDir = join(homedir(), ".claude");
    const pluginsDir = join(claudeDir, "plugins");

    // 1. Read installed_plugins.json
    interface InstalledEntry {
      scope: string;
      installPath: string;
      version: string;
      installedAt: string;
      lastUpdated: string;
      gitCommitSha?: string;
    }
    const installedFile = await readJsonFile<{
      version: number;
      plugins: Record<string, InstalledEntry[]>;
    }>(join(pluginsDir, "installed_plugins.json"));

    // 2. Read enabledPlugins from ~/.claude/settings.json
    const claudeSettings = await readJsonFile<{
      enabledPlugins?: Record<string, boolean>;
    }>(join(claudeDir, "settings.json"));
    const enabledMap = claudeSettings?.enabledPlugins ?? {};

    // 3. Read install-counts-cache.json
    const countsCache = await readJsonFile<{
      counts: Array<{ plugin: string; unique_installs: number }>;
    }>(join(pluginsDir, "install-counts-cache.json"));
    const installCounts = new Map(
      (countsCache?.counts ?? []).map((c) => [c.plugin, c.unique_installs]),
    );

    // 4. Build result
    interface InstalledPlugin {
      key: string; // e.g. "frontend-design@claude-plugins-official"
      name: string; // e.g. "frontend-design"
      marketplace: string; // e.g. "claude-plugins-official"
      version: string;
      enabled: boolean;
      scope: string;
      installPath: string;
      installedAt: string;
      lastUpdated: string;
      installs?: number;
      description?: string;
    }

    const results: InstalledPlugin[] = [];

    if (installedFile?.plugins) {
      // Read all marketplace.json files for descriptions
      const descMap = new Map<string, string>();
      const marketplacesDir = join(pluginsDir, "marketplaces");
      try {
        const mpDirs = await readdir(marketplacesDir, { withFileTypes: true });
        for (const mpDir of mpDirs) {
          if (!mpDir.isDirectory()) continue;
          const mpJson = await readJsonFile<MarketplaceJson>(
            join(marketplacesDir, mpDir.name, ".claude-plugin", "marketplace.json"),
          );
          if (mpJson?.plugins) {
            for (const p of mpJson.plugins) {
              if (p.name) {
                descMap.set(`${p.name}@${mpDir.name}`, p.description ?? "");
              }
            }
          }
        }
      } catch {
        // marketplaces dir may not exist
      }

      for (const [key, entries] of Object.entries(installedFile.plugins)) {
        const entry = entries[0]; // Take first (usually only one)
        if (!entry) continue;

        const atIdx = key.indexOf("@");
        const pluginName = atIdx > 0 ? key.slice(0, atIdx) : key;
        const marketplace = atIdx > 0 ? key.slice(atIdx + 1) : "unknown";

        results.push({
          key,
          name: pluginName,
          marketplace,
          version: entry.version,
          enabled: enabledMap[key] !== false, // default enabled if not in map
          scope: entry.scope,
          installPath: entry.installPath,
          installedAt: entry.installedAt,
          lastUpdated: entry.lastUpdated,
          installs: installCounts.get(key),
          description: descMap.get(key),
        });
      }
    }

    return { plugins: results };
  });

  // ── List marketplace sources ──
  rpcHandlerManager.registerHandler("listMarketplaces", async () => {
    const pluginsDir = join(homedir(), ".claude", "plugins");

    // Read known_marketplaces.json
    interface KnownMarketplace {
      source: { source: string; repo: string };
      installLocation: string;
      lastUpdated: string;
      autoUpdate?: boolean;
    }
    const known = await readJsonFile<Record<string, KnownMarketplace>>(
      join(pluginsDir, "known_marketplaces.json"),
    );

    // Read installed_plugins.json for counting
    const installedFile = await readJsonFile<{
      plugins: Record<string, unknown[]>;
    }>(join(pluginsDir, "installed_plugins.json"));

    interface MarketplaceInfo {
      name: string;
      repo: string;
      installLocation: string;
      lastUpdated: string;
      autoUpdate: boolean;
      availableCount: number;
      installedCount: number;
    }

    const results: MarketplaceInfo[] = [];

    if (known) {
      for (const [name, mp] of Object.entries(known)) {
        // Count available plugins from marketplace.json
        const mpJson = await readJsonFile<MarketplaceJson>(
          join(mp.installLocation, ".claude-plugin", "marketplace.json"),
        );
        const availableCount = mpJson?.plugins?.length ?? 0;

        // Count installed plugins from this marketplace
        let installedCount = 0;
        if (installedFile?.plugins) {
          for (const key of Object.keys(installedFile.plugins)) {
            if (key.endsWith(`@${name}`)) installedCount++;
          }
        }

        results.push({
          name,
          repo: mp.source.repo,
          installLocation: mp.installLocation,
          lastUpdated: mp.lastUpdated,
          autoUpdate: mp.autoUpdate ?? false,
          availableCount,
          installedCount,
        });
      }
    }

    return { marketplaces: results };
  });

  // ── List all available plugins from all marketplaces (for Discover UI) ──
  rpcHandlerManager.registerHandler("listAvailablePlugins", async () => {
    const pluginsDir = join(homedir(), ".claude", "plugins");

    // Read installed_plugins.json
    const installedFile = await readJsonFile<{
      plugins: Record<string, unknown[]>;
    }>(join(pluginsDir, "installed_plugins.json"));
    const installedKeys = new Set(
      Object.keys(installedFile?.plugins ?? {}),
    );

    // Read enabledPlugins
    const claudeSettings = await readJsonFile<{
      enabledPlugins?: Record<string, boolean>;
    }>(join(homedir(), ".claude", "settings.json"));
    const enabledMap = claudeSettings?.enabledPlugins ?? {};

    // Read install-counts-cache.json
    const countsCache = await readJsonFile<{
      counts: Array<{ plugin: string; unique_installs: number }>;
    }>(join(pluginsDir, "install-counts-cache.json"));
    const installCounts = new Map(
      (countsCache?.counts ?? []).map((c) => [c.plugin, c.unique_installs]),
    );

    // Read known_marketplaces.json
    interface KnownMarketplaceEntry {
      source: { source: string; repo: string };
      installLocation: string;
    }
    const known = await readJsonFile<Record<string, KnownMarketplaceEntry>>(
      join(pluginsDir, "known_marketplaces.json"),
    );

    interface AvailablePlugin {
      name: string;
      key: string; // "plugin-name@marketplace"
      marketplace: string;
      description?: string;
      category?: string;
      homepage?: string;
      installed: boolean;
      enabled: boolean;
      installs?: number;
    }

    const results: AvailablePlugin[] = [];

    if (known) {
      for (const [mpName, mp] of Object.entries(known)) {
        const mpJson = await readJsonFile<MarketplaceJson>(
          join(mp.installLocation, ".claude-plugin", "marketplace.json"),
        );
        if (!mpJson?.plugins) continue;

        for (const p of mpJson.plugins) {
          if (!p.name) continue;
          const key = `${p.name}@${mpName}`;
          results.push({
            name: p.name,
            key,
            marketplace: mpName,
            description: p.description,
            category: p.category,
            homepage: (p as Record<string, unknown>).homepage as string | undefined,
            installed: installedKeys.has(key),
            enabled: enabledMap[key] !== false && installedKeys.has(key),
            installs: installCounts.get(key),
          });
        }
      }
    }

    // Sort by install count (descending), then name
    results.sort((a, b) => {
      const ai = a.installs ?? 0;
      const bi = b.installs ?? 0;
      if (bi !== ai) return bi - ai;
      return a.name.localeCompare(b.name);
    });

    return { plugins: results };
  });

  // ── Inspect a single plugin (detailed) ──
  rpcHandlerManager.registerHandler(
    "inspectPlugin",
    async (params: { path: string }) => {
      const pluginPath = params.path;
      const pluginName = basename(pluginPath);

      const meta = await readPluginMeta(pluginName, pluginPath);

      // Read full lists of commands/skills/agents
      async function listDirNames(dirPath: string): Promise<string[]> {
        try {
          const entries = await readdir(dirPath);
          return entries
            .filter((e) => !e.startsWith("."))
            .map((e) => e.replace(/\.(md|json|yaml|yml)$/, ""))
            .sort();
        } catch {
          return [];
        }
      }

      const [commandList, skillList, agentList] = await Promise.all([
        listDirNames(join(pluginPath, "commands")),
        listDirNames(join(pluginPath, "skills")),
        listDirNames(join(pluginPath, "agents")),
      ]);

      return { ...meta, commandList, skillList, agentList };
    },
  );

  // ── List MCP servers ──
  rpcHandlerManager.registerHandler("listMcpServers", async () => {
    try {
      const { stdout } = await execAsync("claude mcp list", {
        timeout: 15000,
        env: { ...process.env, NO_COLOR: "1" },
      });

      // Parse output like:
      //   context7: npx -y @upstash/context7-mcp - ✓ Connected
      //   github: npx -y @modelcontextprotocol/server-github - ✓ Connected
      interface McpServerInfo {
        name: string;
        command: string;
        status: "connected" | "disconnected" | "error";
      }

      const servers: McpServerInfo[] = [];
      const lines = stdout.split("\n");
      for (const line of lines) {
        // Match: name: command - status
        const match = line.match(
          /^\s*(\S+):\s+(.+?)\s+-\s+(?:✓|✔)\s+Connected\s*$/,
        );
        if (match) {
          servers.push({
            name: match[1],
            command: match[2].trim(),
            status: "connected",
          });
          continue;
        }
        // Disconnected or error
        const matchDisc = line.match(
          /^\s*(\S+):\s+(.+?)\s+-\s+(?:✗|✘|⚠)\s+(.+)$/,
        );
        if (matchDisc) {
          servers.push({
            name: matchDisc[1],
            command: matchDisc[2].trim(),
            status: matchDisc[3].toLowerCase().includes("error")
              ? "error"
              : "disconnected",
          });
        }
      }

      return { servers };
    } catch {
      return { servers: [] };
    }
  });

  // ── Curated MCP server catalog ──
  const MCP_CATALOG = [
    // Development tools
    { name: "github", pkg: "@modelcontextprotocol/server-github", description: "GitHub API — issues, PRs, repos, code search", category: "dev" },
    { name: "playwright", pkg: "@playwright/mcp", description: "Browser automation and E2E testing by Microsoft", category: "dev" },
    { name: "filesystem", pkg: "@modelcontextprotocol/server-filesystem", description: "Read/write/search local files securely", category: "dev" },
    { name: "chrome-devtools", pkg: "chrome-devtools-mcp", description: "Control and inspect a live Chrome browser", category: "dev" },
    // Knowledge & search
    { name: "context7", pkg: "@upstash/context7-mcp", description: "Up-to-date library documentation lookup", category: "knowledge" },
    { name: "brave-search", pkg: "@anthropic-ai/mcp-server-brave-search", description: "Web search via Brave Search API", category: "search", envHint: "BRAVE_API_KEY" },
    { name: "fetch", pkg: "@anthropic-ai/mcp-server-fetch", description: "Fetch and extract content from URLs", category: "knowledge" },
    // Database
    { name: "postgres", pkg: "@anthropic-ai/mcp-server-postgres", description: "Query and manage PostgreSQL databases", category: "database", envHint: "DATABASE_URL" },
    { name: "supabase", pkg: "@supabase/mcp-server-supabase", description: "Supabase database, auth, and storage", category: "database", envHint: "SUPABASE_ACCESS_TOKEN" },
    { name: "sqlite", pkg: "@anthropic-ai/mcp-server-sqlite", description: "Query and manage SQLite databases", category: "database" },
    // Memory & thinking
    { name: "memory", pkg: "@anthropic-ai/mcp-server-memory", description: "Persistent memory using knowledge graphs", category: "utility" },
    { name: "sequential-thinking", pkg: "@anthropic-ai/mcp-server-sequential-thinking", description: "Step-by-step reasoning and problem solving", category: "utility" },
    // Platforms
    { name: "notion", pkg: "@notionhq/notion-mcp-server", description: "Official Notion API — pages, databases, blocks", category: "platform", envHint: "NOTION_API_KEY" },
    { name: "slack", pkg: "@anthropic-ai/mcp-server-slack", description: "Slack channels, messages, and threads", category: "platform", envHint: "SLACK_BOT_TOKEN" },
    { name: "sentry", pkg: "@sentry/mcp-server", description: "Sentry error tracking and monitoring", category: "platform" },
    { name: "railway", pkg: "@railway/mcp-server", description: "Railway deployment and infrastructure", category: "platform" },
    { name: "heroku", pkg: "@heroku/mcp-server", description: "Heroku platform management", category: "platform" },
  ];

  rpcHandlerManager.registerHandler("listAvailableMcpServers", async () => {
    // Get currently installed server names
    let installedNames: Set<string>;
    try {
      const { stdout } = await execAsync("claude mcp list", {
        timeout: 15000,
        env: { ...process.env, NO_COLOR: "1" },
      });
      installedNames = new Set(
        stdout
          .split("\n")
          .map((line) => line.match(/^\s*(\S+):/)?.[1])
          .filter((name): name is string => !!name),
      );
    } catch {
      installedNames = new Set();
    }

    return {
      servers: MCP_CATALOG.map((s) => ({
        ...s,
        installed: installedNames.has(s.name),
      })),
    };
  });
}
