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
  const fullPrompt = buildTaskPrompt(data, deps);
  const promptFilePath = await writePromptFile(resolvedDirectory, data.taskId, fullPrompt);

  logger.debug(
    `[TASK] Running task ${data.taskId} at ${resolvedDirectory}`,
  );

  await deps.onTaskStatusChange?.(data.taskId, "running");

  const agentType = (data.agentType ?? "claude") as "claude" | "codex";
  const spawnResult = await deps.spawnSession({
    directory: resolvedDirectory,
    approvedNewDirectoryCreation: false,
    agent: agentType,
    automationContext: {
      kind: "task",
      trigger: "task",
      projectId: data.projectId,
      dedupeKey: `task:${data.taskId}`,
    },
    environmentVariables: {
      HAPPY_INITIAL_PROMPT_FILE: promptFilePath,
      HAPPY_TASK_ID: data.taskId,
      HAPPY_TASK_PRIORITY: data.priority,
      ...(deps.serverUrl ? { HAPPY_TASK_SERVER_URL: deps.serverUrl } : {}),
      ...(data.resultToken ? { HAPPY_TASK_RESULT_TOKEN: data.resultToken } : {}),
      ...(deps.serverUrl ? { HAPPY_TASK_REPORT_URL: `${deps.serverUrl.replace(/\/$/, "")}/v1/tasks/result` } : {}),
      // Per-role model override: inject into the spawned agent's environment
      ...(data.modelOverride && agentType === "claude" ? { ANTHROPIC_MODEL: data.modelOverride } : {}),
      ...(agentType === "codex" ? { OPENAI_MODEL: LOCKED_CODEX_MODEL } : {}),
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
    await deps.onTaskStatusChange?.(data.taskId, "failed", undefined, errorMessage);
    return { success: false, errorMessage };
  }

  await deps.onTaskStatusChange?.(data.taskId, "running", spawnResult.sessionId);
  return { success: true, sessionId: spawnResult.sessionId };
}
