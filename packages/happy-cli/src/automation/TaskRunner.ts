import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { LOCKED_CODEX_MODEL } from "@/codex-shared/configResolution";
import { logger } from "@/ui/logger";
import type {
  SpawnSessionOptions,
  SpawnSessionResult,
} from "@/modules/common/registerCommonHandlers";
import type { AutomationAuditEvent, TaskTriggerData } from "./types";
import { createWorktreeLocal, removeWorktreeForced } from "@/webhook/createWorktreeLocal";

export interface TaskHandlerDeps {
  readonly spawnSession: (
    options: SpawnSessionOptions,
  ) => Promise<SpawnSessionResult>;
  readonly onTaskStatusChange?: (taskId: string, status: string, sessionId?: string, errorMessage?: string) => Promise<void> | void;
  /** Optional audit hook for task lifecycle diagnostics (daemon automation audit store). */
  readonly recordTaskAudit?: (
    event: Omit<AutomationAuditEvent, "id" | "occurredAt"> & { occurredAt?: number },
  ) => void;
  /** Server URL for tasks that need to POST results back (e.g., planner tasks). */
  readonly serverUrl?: string;
}

/**
 * Build the full prompt for a task, prepending skill contents if bound.
 */
function buildTaskPrompt(data: TaskTriggerData, deps?: Pick<TaskHandlerDeps, "serverUrl">): string {
  const parts: string[] = [];

  if (data.skillContents && data.skillContents.length > 0) {
    parts.push("## Skills\n");
    for (const skill of data.skillContents) {
      parts.push(`### ${skill.name}\n${skill.content}\n`);
    }
    parts.push("---\n");
  }

  if (deps?.serverUrl && data.resultToken) {
    const reportUrl = `${deps.serverUrl.replace(/\/$/, "")}/v1/tasks/result`;
    const spawnUrl = `${deps.serverUrl.replace(/\/$/, "")}/v1/tasks/spawn-child`;
    parts.push("## Task Result Reporting\n");
    parts.push(
      [
        "When you reach a clear terminal outcome, report it back to Happy before ending the task.",
        `Use the HAPPY_TASK_REPORT_URL environment variable (value: ${reportUrl}).`,
        "Authenticate with Authorization: Bearer $HAPPY_TASK_RESULT_TOKEN.",
        "Send JSON with taskId from HAPPY_TASK_ID, outcome, optional summary, optional sessionId, and optional errorMessage.",
        'Use outcome: "completed" when the task is done successfully.',
        'Use outcome: "failed" when the task cannot be completed due to an execution error.',
        'Use outcome: "blocked" when progress requires human input, a decision, or an external dependency.',
        "Always include summary as a short human-readable sentence explaining the result.",
      ].join("\n"),
    );
    parts.push("---\n");
    parts.push("## Spawning Child Tasks\n");
    parts.push(
      [
        "You can break your work into parallel sub-tasks by spawning child tasks.",
        `POST to HAPPY_TASK_SPAWN_URL (value: ${spawnUrl}).`,
        "Authenticate with Authorization: Bearer $HAPPY_TASK_RESULT_TOKEN.",
        'Send JSON: { "taskId": "$HAPPY_TASK_ID", "prompt": "...", "directory": "$HAPPY_TASK_DIR", "priority": "background" }.',
        "The spawned task runs independently on the same machine and is linked to this task as its parent.",
        "You can spawn multiple child tasks in parallel, then continue or wait for them to complete.",
        "Use child tasks for independently parallelizable steps; keep each child prompt focused and self-contained.",
      ].join("\n"),
    );
    parts.push("---\n");
  }

  parts.push("## Your Task\n");
  parts.push(data.prompt);

  return parts.join("\n");
}

function resolveTaskDirectory(directory: string): string {
  if (directory === "~") {
    return homedir();
  }
  if (directory.startsWith("~/")) {
    return join(homedir(), directory.slice(2));
  }
  return directory;
}

async function writePromptFile(directory: string, taskId: string, prompt: string): Promise<string> {
  const path = join(directory, `task-${taskId}-${randomUUID()}.md`);
  await writeFile(path, prompt, "utf-8");
  return path;
}

async function cleanupPromptFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // best effort
  }
}


function isSessionWebhookTimeout(errorMessage: string): boolean {
  return errorMessage.includes("Session webhook timeout for PID");
}

export async function runTaskJob(
  data: TaskTriggerData,
  deps: TaskHandlerDeps,
): Promise<{ success: boolean; errorMessage?: string; sessionId?: string }> {
  const resolvedDirectory = resolveTaskDirectory(data.directory);

  // When worktreeIsolation is requested, create a dedicated git worktree so
  // parallel tasks cannot clobber each other's working tree.
  let sessionDirectory = resolvedDirectory;
  let isolatedBranchName: string | undefined;
  if (data.worktreeIsolation) {
    const wtResult = await createWorktreeLocal(resolvedDirectory, { prefix: "task" });
    if (!wtResult.success) {
      const errorMessage = wtResult.error ?? "Failed to create worktree for task isolation";
      logger.warn(`[TASK] Worktree isolation requested but failed for ${data.taskId}: ${errorMessage}`);
      await deps.onTaskStatusChange?.(data.taskId, "failed", undefined, errorMessage);
      return { success: false, errorMessage };
    }
    sessionDirectory = wtResult.worktreePath;
    isolatedBranchName = wtResult.branchName;
    logger.debug(`[TASK] Created isolation worktree '${wtResult.branchName}' for task ${data.taskId}`);
  }

  const fullPrompt = buildTaskPrompt(data, deps);
  const promptFilePath = await writePromptFile(sessionDirectory, data.taskId, fullPrompt);

  logger.debug(
    `[TASK] Running task ${data.taskId} at ${sessionDirectory}`,
  );

  await deps.onTaskStatusChange?.(data.taskId, "running");

  const agentType = (data.agentType ?? "claude") as "claude" | "codex";
  const spawnResult = await deps.spawnSession({
    directory: sessionDirectory,
    approvedNewDirectoryCreation: false,
    agent: agentType,
    profileId: data.profileId,
    runtimeProfile: data.runtimeProfile,
    automationContext: {
      kind: "task",
      trigger: "task",
      projectId: data.projectId,
      dedupeKey: `task:${data.taskId}`,
    },
    environmentVariables: {
      // Profile-resolved env (provider base URL / auth / model mappings,
      // plus any HAPPY_* profile-derived vars) is applied first so that
      // task-specific overrides below still win.
      ...(data.runtimeProfile?.environmentVariables ?? {}),
      HAPPY_INITIAL_PROMPT_FILE: promptFilePath,
      HAPPY_TASK_ID: data.taskId,
      HAPPY_TASK_PRIORITY: data.priority,
      ...(deps.serverUrl ? { HAPPY_TASK_SERVER_URL: deps.serverUrl } : {}),
      ...(data.resultToken ? { HAPPY_TASK_RESULT_TOKEN: data.resultToken } : {}),
      ...(deps.serverUrl ? { HAPPY_TASK_REPORT_URL: `${deps.serverUrl.replace(/\/$/, "")}/v1/tasks/result` } : {}),
      ...(deps.serverUrl ? { HAPPY_TASK_SPAWN_URL: `${deps.serverUrl.replace(/\/$/, "")}/v1/tasks/spawn-child` } : {}),
      HAPPY_TASK_DIR: sessionDirectory,
      // Per-role model override: inject into the spawned agent's environment
      ...(data.modelOverride && agentType === "claude" ? { ANTHROPIC_MODEL: data.modelOverride } : {}),
      ...(agentType === "codex" ? { OPENAI_MODEL: LOCKED_CODEX_MODEL } : {}),
      // Per-trigger model-mode KEY + reasoning effort. The model KEY (e.g.
      // "opus-4-8-1m") drives 1M capability via runClaude's first-turn
      // EnhancedMode injection (resolveCliModelForMode/is1MModelKey). Distinct
      // from ANTHROPIC_MODEL above which is a raw model id.
      ...(data.modelMode && data.modelMode !== "default" && agentType === "claude"
        ? { HAPPY_INITIAL_MODEL_MODE: data.modelMode }
        : {}),
      ...(data.effort && agentType === "claude" ? { HAPPY_INITIAL_EFFORT: data.effort } : {}),
      // Expose worktree branch name so the agent can create a PR on completion
      ...(isolatedBranchName ? { HAPPY_TASK_WORKTREE_BRANCH: isolatedBranchName } : {}),
    },
  });

  if (spawnResult.type !== "success") {
    const errorMessage = spawnResult.type === "error"
      ? spawnResult.errorMessage
      : "Failed to spawn task session";
    if (isSessionWebhookTimeout(errorMessage)) {
      logger.warn(
        `[TASK] Session webhook timeout for ${data.taskId}; treat as running and wait for terminal signal`,
      );
      deps.recordTaskAudit?.({
        kind: "task_session_webhook_timeout",
        dedupeKey: `task:${data.taskId}`,
        projectId: data.projectId,
        trigger: "task",
        message: errorMessage,
      });
      return { success: true };
    }
    await cleanupPromptFile(promptFilePath);
    // Clean up isolated worktree on spawn failure so it doesn't litter the repo.
    if (isolatedBranchName) {
      await removeWorktreeForced(resolvedDirectory, isolatedBranchName);
    }
    await deps.onTaskStatusChange?.(data.taskId, "failed", undefined, errorMessage);
    return { success: false, errorMessage };
  }

  await deps.onTaskStatusChange?.(data.taskId, "running", spawnResult.sessionId);
  return { success: true, sessionId: spawnResult.sessionId };
}
