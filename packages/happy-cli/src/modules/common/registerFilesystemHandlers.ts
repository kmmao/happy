import { logger } from "@/ui/logger";
import { exec, ExecOptions } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, readdir, stat, mkdir, unlink } from "fs/promises";
import { createHash } from "crypto";
import { dirname, join, resolve } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { WorkflowDefinitionSchema } from "@kmmao/happy-wire";
import { RpcHandlerManager } from "../../api/rpc/RpcHandlerManager";
import { runWorkflowInDir, workflowsDirFor } from "@/workflow/runWorkflowInDir";
import { execFileLocal } from "@/webhook/execFileLocal";
import { removeWorktreeForced } from "@/webhook/createWorktreeLocal";
import { validatePath } from "./pathSecurity";
import { summarizeShellCommandForLog } from "@/utils/securityRedaction";
import { checkBlockedBashCommand } from "@/utils/bashCommandPolicy";

const execAsync = promisify(exec);

/** Scoped temp directory for uploads from the mobile app. Allowed in addition to workingDirectory. */
const UPLOAD_TEMP_DIR = join(tmpdir(), "happy", "uploads");

/** Maximum file size for writeFile RPC (10 MB base64 ≈ 7.5 MB decoded). */
const MAX_WRITE_SIZE = 10 * 1024 * 1024;

interface WorkflowRunRequest {
  spec: {
    id?: string;
    goal: string;
    createdAt?: number;
    steps: Array<{
      id: string;
      role: string;
      prompt: string;
      model?: string;
      order: number;
    }>;
  };
  dryRun?: boolean;
  isolation?: boolean;
}

interface WorkflowRunResponse {
  success: boolean;
  workflowId?: string;
  error?: string;
}

interface WorkflowIdRequest {
  workflowId: string;
}

interface WorkflowBranchActionRequest {
  branch: string;
  action: "merge" | "discard";
}

interface WorkflowBranchDiffRequest {
  branch: string;
}

interface SimpleSuccessResponse {
  success: boolean;
  error?: string;
}

interface WorkflowBranchDiffResponse {
  success: boolean;
  diff?: string;
  error?: string;
}

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

interface GetUploadDirResponse {
  success: boolean;
  path?: string;
  error?: string;
}

// Security: bash RPC commands that could leak secrets are blocked by the
// `checkBlockedBashCommand` policy (see utils/bashCommandPolicy.ts). Claude
// Code's own Bash tool is NOT affected — it runs via SDK, not RPC.

/**
 * Register filesystem + shell RPC handlers: bash, readFile, writeFile,
 * getUploadDir, listDirectory, getDirectoryTree.
 *
 * `safeSessionId` must already be sanitized by the caller — it scopes the
 * per-session upload subdirectory.
 */
export function registerFilesystemHandlers(
  rpcHandlerManager: RpcHandlerManager,
  workingDirectory: string,
  safeSessionId: string,
) {
  // In-flight Dynamic Workflow runs, keyed by workflow id, so `workflowCancel`
  // can abort a run and kill its sub-agent processes (Phase 5).
  const runningWorkflows = new Map<string, AbortController>();

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

  // Dynamic Workflow run handler (Phase 5). The app sends a spec; we run it in
  // the session's working directory. Fire-and-forget: the run can take a while
  // (real sub-agents), so we return the workflowId immediately and let the app
  // poll the <cwd>/.happy/workflows/<id>.json run-state file for live progress.
  rpcHandlerManager.registerHandler<WorkflowRunRequest, WorkflowRunResponse>(
    "workflowRun",
    async (data) => {
      const withDefaults = {
        id: data.spec?.id || `wf_${randomUUID().slice(0, 8)}`,
        createdAt: typeof data.spec?.createdAt === "number" ? data.spec.createdAt : Date.now(),
        ...data.spec,
      };
      const parsed = WorkflowDefinitionSchema.safeParse(withDefaults);
      if (!parsed.success) {
        return { success: false, error: `Invalid workflow spec: ${parsed.error.message}` };
      }
      const definition = parsed.data;
      // Track the run so `workflowCancel` can abort it; clean up on completion.
      const controller = new AbortController();
      runningWorkflows.set(definition.id, controller);
      void runWorkflowInDir(definition, workingDirectory, {
        dryRun: data.dryRun === true,
        isolation: data.isolation === true,
        signal: controller.signal,
      })
        .catch((error) => {
          logger.debug("Workflow run failed:", error);
        })
        .finally(() => {
          runningWorkflows.delete(definition.id);
        });
      logger.debug(`Workflow run started: ${definition.id}`);
      return { success: true, workflowId: definition.id };
    },
  );

  // Cancel a running workflow — aborts remaining waves and kills in-flight
  // sub-agent processes via the shared AbortController.
  rpcHandlerManager.registerHandler<WorkflowIdRequest, SimpleSuccessResponse>(
    "workflowCancel",
    async (data) => {
      const controller = runningWorkflows.get(data.workflowId);
      if (!controller) return { success: false, error: "not_running" };
      controller.abort();
      runningWorkflows.delete(data.workflowId);
      return { success: true };
    },
  );

  // Delete a persisted workflow's run-state + replay files.
  rpcHandlerManager.registerHandler<WorkflowIdRequest, SimpleSuccessResponse>(
    "workflowDelete",
    async (data) => {
      const dir = workflowsDirFor(workingDirectory);
      for (const ext of [".json", ".js"]) {
        await unlink(join(dir, `${data.workflowId}${ext}`)).catch(() => {});
      }
      return { success: true };
    },
  );

  // Merge or discard an isolation branch (post-run review).
  rpcHandlerManager.registerHandler<
    WorkflowBranchActionRequest,
    SimpleSuccessResponse
  >("workflowBranchAction", async (data) => {
    if (!/^[\w./-]+$/.test(data.branch)) {
      return { success: false, error: "invalid_branch" };
    }
    if (data.action === "merge") {
      const res = await execFileLocal(
        "git",
        ["merge", "--no-ff", data.branch],
        workingDirectory,
      );
      if (res.exitCode !== 0) {
        return { success: false, error: res.stderr || "merge_failed" };
      }
      await removeWorktreeForced(workingDirectory, data.branch);
      return { success: true };
    }
    // discard
    await removeWorktreeForced(workingDirectory, data.branch);
    return { success: true };
  });

  // Return the diff of an isolation branch vs the current HEAD (review).
  rpcHandlerManager.registerHandler<
    WorkflowBranchDiffRequest,
    WorkflowBranchDiffResponse
  >("workflowBranchDiff", async (data) => {
    if (!/^[\w./-]+$/.test(data.branch)) {
      return { success: false, error: "invalid_branch" };
    }
    const res = await execFileLocal(
      "git",
      ["diff", `HEAD...${data.branch}`],
      workingDirectory,
    );
    if (res.exitCode !== 0) {
      return { success: false, error: res.stderr || "diff_failed" };
    }
    return { success: true, diff: res.stdout };
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
}
