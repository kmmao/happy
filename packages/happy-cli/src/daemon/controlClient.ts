import { logger } from "@/ui/logger";
import {
  clearDaemonState,
  readDaemonState,
  DaemonLocallyPersistedState,
} from "@/persistence";
import { Metadata } from "@/api/types";
import { readFileSync } from "fs";
import { join } from "path";
import { projectPath } from "@/projectPath";
import type {
  AutomationAuditEvent,
  AutomationAuditStats,
  AutomationGuardianUsageSummary,
  AutomationJob,
  AutomationMutationResult,
} from "@/automation/types";

export type DaemonCheckResult =
  | { status: "running"; state: DaemonLocallyPersistedState }
  | { status: "not-running" }
  | { status: "stale-cleaned" };

async function daemonPost(path: string, body?: any): Promise<{ error?: string } | any> {
  const state = await readDaemonState();
  if (!state?.httpPort) {
    const errorMessage = "No daemon running, no state file found";
    logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
    return { error: errorMessage };
  }

  try {
    process.kill(state.pid, 0);
  } catch {
    const errorMessage = "Daemon is not running, file is stale";
    logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
    return { error: errorMessage };
  }

  try {
    const timeout = process.env.HAPPY_DAEMON_HTTP_TIMEOUT
      ? parseInt(process.env.HAPPY_DAEMON_HTTP_TIMEOUT)
      : 10_000;
    const response = await fetch(`http://127.0.0.1:${state.httpPort}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const errorMessage = `Request failed: ${path}, HTTP ${response.status}`;
      logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
      return { error: errorMessage };
    }

    return await response.json();
  } catch (error) {
    const errorMessage = `Request failed: ${path}, ${error instanceof Error ? error.message : "Unknown error"}`;
    logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
    return { error: errorMessage };
  }
}

export async function notifyDaemonSessionStarted(
  sessionId: string,
  metadata: Metadata,
): Promise<{ error?: string } | any> {
  return daemonPost("/session-started", { sessionId, metadata });
}

export async function listDaemonSessions(): Promise<any[]> {
  const result = await daemonPost("/list");
  return result.children || [];
}

export async function stopDaemonSession(sessionId: string): Promise<boolean> {
  const result = await daemonPost("/stop-session", { sessionId });
  return result.success || false;
}

export async function spawnDaemonSession(directory: string, sessionId?: string): Promise<any> {
  return daemonPost("/spawn-session", { directory, sessionId });
}

export async function stopDaemonHttp(): Promise<void> {
  await daemonPost("/stop");
}

export async function getDaemonAutomationStatus(): Promise<{
  counts: Record<string, number>;
  jobs: AutomationJob[];
  guardians?: Array<{
    key: string;
    projectId: string;
    loopId?: string;
    sessionId: string;
    updatedAt: number;
    lastRunId?: string;
    attached?: boolean;
  }>;
  guardianUsage?: AutomationGuardianUsageSummary[];
  auditStats?: AutomationAuditStats;
  recentAuditEvents?: AutomationAuditEvent[];
} | null> {
  const result = await daemonPost("/automation-status");
  if (result.error) {
    return null;
  }
  return result as {
    counts: Record<string, number>;
    jobs: AutomationJob[];
    guardians?: Array<{
      key: string;
      projectId: string;
      loopId?: string;
      sessionId: string;
      updatedAt: number;
      lastRunId?: string;
      attached?: boolean;
    }>;
    guardianUsage?: AutomationGuardianUsageSummary[];
    auditStats?: AutomationAuditStats;
    recentAuditEvents?: AutomationAuditEvent[];
  };
}

export async function cancelDaemonAutomationJob(
  jobId: string,
): Promise<AutomationMutationResult> {
  const result = await daemonPost("/automation-cancel", { jobId });
  if (result.error) {
    return { success: false, errorMessage: result.error };
  }
  return result as AutomationMutationResult;
}

export async function retryDaemonAutomationJob(
  jobId: string,
): Promise<AutomationMutationResult> {
  const result = await daemonPost("/automation-retry", { jobId });
  if (result.error) {
    return { success: false, errorMessage: result.error };
  }
  return result as AutomationMutationResult;
}

export async function clearDaemonAutomationJobs(): Promise<AutomationMutationResult> {
  const result = await daemonPost("/automation-clear");
  if (result.error) {
    return { success: false, errorMessage: result.error };
  }
  return result as AutomationMutationResult;
}

export async function clearDaemonAutomationGuardians(params?: {
  key?: string;
  sessionId?: string;
  clearAll?: boolean;
}): Promise<{ success: boolean; errorMessage?: string }> {
  const result = await daemonPost("/automation-guardian-clear", params ?? {});
  if (result.error) {
    return { success: false, errorMessage: result.error };
  }
  return result as { success: boolean; errorMessage?: string };
}

export async function clearDaemonAutomationAudit(): Promise<{ success: boolean; errorMessage?: string }> {
  const result = await daemonPost("/automation-audit-clear");
  if (result.error) {
    return { success: false, errorMessage: result.error };
  }
  return result as { success: boolean; errorMessage?: string };
}

export async function checkDaemonStatus(): Promise<DaemonCheckResult> {
  const state = await readDaemonState();
  if (!state) {
    return { status: "not-running" };
  }

  try {
    process.kill(state.pid, 0);
    return { status: "running", state };
  } catch {
    logger.debug("[DAEMON RUN] Daemon PID not running, cleaning up state");
    await cleanupDaemonState();
    return { status: "stale-cleaned" };
  }
}

export async function isDaemonRunningCurrentlyInstalledHappyVersion(): Promise<boolean> {
  logger.debug("[DAEMON CONTROL] Checking if daemon is running same version");
  const result = await checkDaemonStatus();
  if (result.status !== "running") {
    logger.debug("[DAEMON CONTROL] No daemon running, returning false");
    return false;
  }

  const state = result.state;

  try {
    const packageJsonPath = join(projectPath(), "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    const currentCliVersion = packageJson.version;

    logger.debug(
      `[DAEMON CONTROL] Current CLI version: ${currentCliVersion}, Daemon started with version: ${state.startedWithCliVersion}`,
    );
    return currentCliVersion === state.startedWithCliVersion;
  } catch (error) {
    logger.debug("[DAEMON CONTROL] Error checking daemon version", error);
    return false;
  }
}

export async function cleanupDaemonState(): Promise<void> {
  try {
    await clearDaemonState();
    logger.debug("[DAEMON RUN] Daemon state file removed");
  } catch (error) {
    logger.debug("[DAEMON RUN] Error cleaning up daemon metadata", error);
  }
}

export async function stopDaemon() {
  try {
    const state = await readDaemonState();
    if (!state) {
      logger.debug("No daemon state found");
      return;
    }

    logger.debug(`Stopping daemon with PID ${state.pid}`);

    try {
      await stopDaemonHttp();
      await waitForProcessDeath(state.pid, 2000);
      logger.debug("Daemon stopped gracefully via HTTP");
      return;
    } catch (error) {
      logger.debug("HTTP stop failed, will force kill", error);
    }

    try {
      process.kill(state.pid, "SIGKILL");
      logger.debug("Force killed daemon");
    } catch {
      logger.debug("Daemon already dead");
    }
  } catch (error) {
    logger.debug("Error stopping daemon", error);
  }
}

async function waitForProcessDeath(pid: number, timeout: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch {
      return;
    }
  }
  throw new Error("Process did not die within timeout");
}
