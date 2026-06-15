/**
 * Session spawner — starts a Happy CLI session on the agent's machine.
 *
 * Delegates to the locally-installed `happy` CLI binary (via PATH).
 * The spawned process connects to the server independently and registers itself.
 *
 * Flow:
 * 1. Server sends spawn-happy-session RPC to agent
 * 2. Agent validates directory and builds env
 * 3. Agent spawns `happy <agent> --happy-starting-mode remote --started-by daemon`
 * 4. Spawned process registers with server autonomously
 * 5. Agent tracks PID for lifecycle management
 */

import { spawn, type ChildProcess, execFile } from "child_process";
import { promisify } from "util";
import { stat, mkdir } from "fs/promises";
import { logger } from "../logger";
import { trackSession, untrackSession, type TrackedSession } from "./trackedSessions";

const execFileAsync = promisify(execFile);

/**
 * Claude session-id format: UUID v4 8-4-4-4-12 hex digits.
 * Mirrors `UUID_RE` in happy-cli's sessionStoreRpc — kept in sync because
 * happy-cli and happy-agent cannot import each other (see CLAUDE.md
 * "Package Dependency & Sync Rules"). Stricter than the previous
 * `/^[0-9a-f-]+$/i`, which accepted "-", "--", "deadbeef", etc.
 */
const CLAUDE_SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnSessionOptions {
  directory: string;
  machineId?: string;
  sessionId?: string;
  agent?: "claude" | "codex" | "gemini";
  approvedNewDirectoryCreation?: boolean;
  happySessionId?: string;
  automationContext?: {
    kind: "supervisor" | "webhook" | "agent_loop" | "task";
    trigger?: string;
    projectId?: string;
    runId?: string;
  };
  environmentVariables?: Record<string, string | undefined>;
}

export type SpawnSessionResult =
  | { type: "success"; pid: number; directory: string }
  | { type: "requestToApproveDirectoryCreation"; directory: string }
  | { type: "error"; errorMessage: string };

// ---------------------------------------------------------------------------
// Environment filtering
// ---------------------------------------------------------------------------

/** Env vars that should never leak to spawned children. */
const SERVER_INTERNAL_SECRETS = new Set([
  "DATABASE_URL", "REDIS_URL", "JWT_SECRET", "ENCRYPTION_KEY",
  "GITHUB_CLIENT_SECRET", "AWS_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID",
  "AWS_SESSION_TOKEN", "STRIPE_SECRET_KEY", "SENDGRID_API_KEY",
  "S3_ACCESS_KEY", "S3_SECRET_KEY",
]);

function buildSpawnEnv(
  extra: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
  // Start from current process env, strip secrets and CLAUDECODE
  const base: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!SERVER_INTERNAL_SECRETS.has(key) && key !== "CLAUDECODE") {
      base[key] = value;
    }
  }
  // Merge caller-provided env (auth tokens, task vars, etc.)
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) {
        base[key] = value;
      }
    }
  }
  return base;
}

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

let happyBinaryPath: string | null | undefined; // undefined = not checked yet

async function findHappyBinary(): Promise<string | null> {
  if (happyBinaryPath !== undefined) return happyBinaryPath;
  try {
    const { stdout } = await execFileAsync("which", ["happy"]);
    happyBinaryPath = stdout.trim() || null;
  } catch {
    happyBinaryPath = null;
  }
  return happyBinaryPath;
}

/** Reset cache (for testing or after install). */
export function resetHappyBinaryCache(): void {
  happyBinaryPath = undefined;
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

export async function spawnSession(
  options: SpawnSessionOptions,
): Promise<SpawnSessionResult> {
  const {
    directory,
    sessionId,
    agent = "claude",
    approvedNewDirectoryCreation = false,
    happySessionId,
    automationContext,
    environmentVariables,
  } = options;

  // 1. Check happy binary
  const happyPath = await findHappyBinary();
  if (!happyPath) {
    return {
      type: "error",
      errorMessage: "happy CLI not found. Install with: npm install -g @kmmao/happy-coder",
    };
  }

  // 2. Validate / create directory
  try {
    const dirStat = await stat(directory);
    if (!dirStat.isDirectory()) {
      return { type: "error", errorMessage: `Path exists but is not a directory: ${directory}` };
    }
  } catch {
    // Directory doesn't exist
    if (!approvedNewDirectoryCreation) {
      return { type: "requestToApproveDirectoryCreation", directory };
    }
    try {
      await mkdir(directory, { recursive: true });
      logger.debug(`[SPAWN] Created directory: ${directory}`);
    } catch (mkdirError) {
      return {
        type: "error",
        errorMessage: `Failed to create directory: ${mkdirError instanceof Error ? mkdirError.message : String(mkdirError)}`,
      };
    }
  }

  // 3. Build args
  const args: string[] = [
    agent,
    "--happy-starting-mode", "remote",
    "--started-by", "daemon",
  ];
  if (agent === "claude" && sessionId && CLAUDE_SESSION_ID_RE.test(sessionId)) {
    args.push("--resume", sessionId);
  }
  if (happySessionId) {
    args.push("--happy-session-id", happySessionId);
  }

  // 4. Build env
  const spawnEnv = buildSpawnEnv(environmentVariables);

  // 5. Spawn detached process
  logger.debug(`[SPAWN] ${happyPath} ${args.join(" ")} in ${directory}`);

  let happyProcess: ChildProcess;
  try {
    happyProcess = spawn(happyPath, args, {
      cwd: directory,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: spawnEnv as NodeJS.ProcessEnv,
    });
  } catch (spawnError) {
    return {
      type: "error",
      errorMessage: `Failed to spawn: ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`,
    };
  }

  const pid = happyProcess.pid;
  if (!pid) {
    return { type: "error", errorMessage: "Spawned process has no PID" };
  }

  // 6. Track session
  const tracked: TrackedSession = {
    pid,
    directory,
    startedAt: Date.now(),
    childProcess: happyProcess,
    lastActivityAt: Date.now(),
    automationContext,
  };
  trackSession(tracked);

  // 7. Wire up lifecycle listeners
  happyProcess.stdout?.on("data", () => {
    tracked.lastActivityAt = Date.now();
  });
  happyProcess.stderr?.on("data", () => {
    tracked.lastActivityAt = Date.now();
  });

  happyProcess.on("exit", (code, signal) => {
    logger.debug(`[SPAWN] Process ${pid} exited: code=${code} signal=${signal}`);
    const session = untrackSession(pid);
    if (session) {
      session.terminationReason = signal
        ? `signal:${signal}`
        : code !== 0 ? `exit:${code}` : "completed";
    }
  });

  // Unref so agent can exit without waiting for spawned sessions
  happyProcess.unref();

  logger.debug(`[SPAWN] Spawned PID ${pid} in ${directory}`);
  return { type: "success", pid, directory };
}

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

export function stopSession(pid: number): { stopped: boolean; error?: string } {
  const tracked = untrackSession(pid);
  if (!tracked) {
    // Try to kill anyway (might be an orphan)
    try {
      process.kill(pid, "SIGTERM");
      return { stopped: true };
    } catch {
      return { stopped: false, error: `No tracked session with PID ${pid}` };
    }
  }

  try {
    if (tracked.childProcess && !tracked.childProcess.killed) {
      tracked.childProcess.kill("SIGTERM");
    } else {
      process.kill(pid, "SIGTERM");
    }
    tracked.terminationReason = "user_stop";
    logger.debug(`[SPAWN] Stopped session PID ${pid}`);
    return { stopped: true };
  } catch (error) {
    return {
      stopped: false,
      error: error instanceof Error ? error.message : "Failed to stop session",
    };
  }
}
