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

import { exec, type ExecOptions } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import { createHash } from "crypto";
import { join, resolve } from "path";
import { realpathSync } from "fs";
import { tmpdir } from "os";
import { logger } from "../../logger";
import type { RpcHandlerManager } from "./RpcHandlerManager";

const execAsync = promisify(exec);

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
}
