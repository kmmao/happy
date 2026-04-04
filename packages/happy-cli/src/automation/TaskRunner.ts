import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "@/ui/logger";
import type {
  SpawnSessionOptions,
  SpawnSessionResult,
} from "@/modules/common/registerCommonHandlers";
import type { TaskTriggerData } from "./types";

export interface TaskHandlerDeps {
  readonly spawnSession: (
    options: SpawnSessionOptions,
  ) => Promise<SpawnSessionResult>;
  readonly onTaskStatusChange?: (taskId: string, status: string, sessionId?: string, errorMessage?: string) => Promise<void> | void;
}

/**
 * Build the full prompt for a task, prepending skill contents if bound.
 */
function buildTaskPrompt(data: TaskTriggerData): string {
  const parts: string[] = [];

  if (data.skillContents && data.skillContents.length > 0) {
    parts.push("## Skills\n");
    for (const skill of data.skillContents) {
      parts.push(`### ${skill.name}\n${skill.content}\n`);
    }
    parts.push("---\n");
  }

  parts.push("## Your Task\n");
  parts.push(data.prompt);

  return parts.join("\n");
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

export async function runTaskJob(
  data: TaskTriggerData,
  deps: TaskHandlerDeps,
): Promise<{ success: boolean; errorMessage?: string; sessionId?: string }> {
  const fullPrompt = buildTaskPrompt(data);
  const promptFilePath = await writePromptFile(data.directory, data.taskId, fullPrompt);

  logger.debug(
    `[TASK] Running task ${data.taskId} at ${data.directory}`,
  );

  await deps.onTaskStatusChange?.(data.taskId, "running");

  const spawnResult = await deps.spawnSession({
    directory: data.directory,
    approvedNewDirectoryCreation: false,
    agent: "claude",
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
    },
  });

  if (spawnResult.type !== "success") {
    await cleanupPromptFile(promptFilePath);
    const errorMessage = spawnResult.type === "error"
      ? spawnResult.errorMessage
      : "Failed to spawn task session";
    await deps.onTaskStatusChange?.(data.taskId, "failed", undefined, errorMessage);
    return { success: false, errorMessage };
  }

  await deps.onTaskStatusChange?.(data.taskId, "running", spawnResult.sessionId);
  return { success: true, sessionId: spawnResult.sessionId };
}
