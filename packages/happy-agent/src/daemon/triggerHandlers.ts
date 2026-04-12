/**
 * Ephemeral trigger handlers — process webhook, supervisor, and task triggers
 * by spawning Happy CLI sessions with appropriate environment and prompts.
 *
 * Unlike the CLI daemon which uses AutomationScheduler with job queues,
 * the agent spawns sessions directly (no dedup, no queue).
 */

import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { logger } from "../logger";
import { spawnSession } from "./spawnSession";
import type { MachineClient } from "../api/machineClient";

// ---------------------------------------------------------------------------
// Types (from server ephemeral events)
// ---------------------------------------------------------------------------

export interface WebhookTriggerData {
  type: "webhook-trigger";
  webhookEventId: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  issueAuthor: string;
  issueLabels: string[];
  issueUrl: string;
  repoUrl: string;
  repoPath: string;
  provider: string;
}

export interface SupervisorTriggerData {
  type: "supervisor-trigger";
  projectId: string;
  runId: string;
  trigger: string;
  machineId: string;
  repoPath: string;
  mode?: string;
  dimensions?: string[];
  changedFiles?: string[];
  customRules?: string;
}

export interface TaskTriggerData {
  type: "task-trigger";
  taskId: string;
  prompt: string;
  directory: string;
  priority: string;
  projectId?: string;
  resultToken?: string;
  skillContents?: Array<{ name: string; content: string }>;
}

const PROMPT_DIR = join(tmpdir(), "happy", "agent-prompts");

// ---------------------------------------------------------------------------
// Prompt file helpers
// ---------------------------------------------------------------------------

async function writePromptFile(prefix: string, content: string): Promise<string> {
  await mkdir(PROMPT_DIR, { recursive: true });
  const filename = `${prefix}-${Date.now()}.md`;
  const filepath = join(PROMPT_DIR, filename);
  await writeFile(filepath, content, "utf-8");
  return filepath;
}

function buildWebhookPrompt(data: WebhookTriggerData): string {
  return [
    `# Issue #${data.issueNumber}: ${data.issueTitle}`,
    "",
    `Author: ${data.issueAuthor}`,
    `Labels: ${data.issueLabels.join(", ") || "none"}`,
    `URL: ${data.issueUrl}`,
    "",
    data.issueBody,
  ].join("\n");
}

function buildSupervisorPrompt(data: SupervisorTriggerData): string {
  const parts = [
    `# Supervisor Run: ${data.runId}`,
    "",
    `Trigger: ${data.trigger}`,
    `Project: ${data.projectId}`,
  ];
  if (data.mode) parts.push(`Mode: ${data.mode}`);
  if (data.dimensions?.length) parts.push(`Dimensions: ${data.dimensions.join(", ")}`);
  if (data.changedFiles?.length) {
    parts.push("", "## Changed Files", ...data.changedFiles.map((f) => `- ${f}`));
  }
  if (data.customRules) parts.push("", "## Custom Rules", data.customRules);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleWebhookTrigger(
  data: WebhookTriggerData,
  client: MachineClient,
  serverUrl: string,
  authToken: string,
): Promise<void> {
  logger.debug(`[TRIGGER] Webhook: issue #${data.issueNumber} in ${data.repoPath}`);

  client.emitWebhookStatus({
    webhookEventId: data.webhookEventId,
    status: "dispatched",
  });

  try {
    const promptFile = await writePromptFile("webhook", buildWebhookPrompt(data));

    const result = await spawnSession({
      directory: data.repoPath,
      approvedNewDirectoryCreation: false,
      automationContext: {
        kind: "webhook",
        trigger: `issue#${data.issueNumber}`,
      },
      environmentVariables: {
        HAPPY_INITIAL_PROMPT_FILE: promptFile,
        HAPPY_WEBHOOK_EVENT_ID: data.webhookEventId,
        HAPPY_WEBHOOK_ISSUE_URL: data.issueUrl,
        HAPPY_SERVER_URL: serverUrl,
        HAPPY_AUTH_TOKEN: authToken,
      },
    });

    if (result.type === "success") {
      logger.debug(`[TRIGGER] Webhook session spawned: PID ${result.pid}`);
    } else {
      logger.debug(`[TRIGGER] Webhook spawn failed: ${result.type === "error" ? result.errorMessage : "needs approval"}`);
      client.emitWebhookStatus({
        webhookEventId: data.webhookEventId,
        status: "failed",
        errorMessage: result.type === "error" ? result.errorMessage : "Directory creation not approved",
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.debug(`[TRIGGER] Webhook error: ${msg}`);
    client.emitWebhookStatus({
      webhookEventId: data.webhookEventId,
      status: "failed",
      errorMessage: msg,
    });
  }
}

export async function handleSupervisorTrigger(
  data: SupervisorTriggerData,
  client: MachineClient,
  serverUrl: string,
  authToken: string,
): Promise<void> {
  logger.debug(`[TRIGGER] Supervisor: run ${data.runId} in ${data.repoPath}`);

  client.emitSupervisorRunStatus({
    runId: data.runId,
    projectId: data.projectId,
    status: "running",
  });

  try {
    const promptFile = await writePromptFile("supervisor", buildSupervisorPrompt(data));

    const result = await spawnSession({
      directory: data.repoPath,
      approvedNewDirectoryCreation: false,
      automationContext: {
        kind: "supervisor",
        trigger: data.trigger,
        projectId: data.projectId,
        runId: data.runId,
      },
      environmentVariables: {
        HAPPY_INITIAL_PROMPT_FILE: promptFile,
        HAPPY_SUPERVISOR_RUN_ID: data.runId,
        HAPPY_SUPERVISOR_PROJECT_ID: data.projectId,
        HAPPY_SUPERVISOR_SERVER_URL: serverUrl,
        HAPPY_SUPERVISOR_AUTH_TOKEN: authToken,
      },
    });

    if (result.type !== "success") {
      client.emitSupervisorRunStatus({
        runId: data.runId,
        projectId: data.projectId,
        status: "failed",
        errorMessage: result.type === "error" ? result.errorMessage : "Directory creation not approved",
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.debug(`[TRIGGER] Supervisor error: ${msg}`);
    client.emitSupervisorRunStatus({
      runId: data.runId,
      projectId: data.projectId,
      status: "failed",
      errorMessage: msg,
    });
  }
}

export async function handleTaskTrigger(
  data: TaskTriggerData,
  serverUrl: string,
  _authToken: string,
): Promise<void> {
  logger.debug(`[TRIGGER] Task: ${data.taskId} in ${data.directory}`);

  try {
    const promptFile = await writePromptFile("task", data.prompt);

    // Build skill injection env if present
    const skillEnv: Record<string, string> = {};
    if (data.skillContents?.length) {
      skillEnv.HAPPY_TASK_SKILL_COUNT = String(data.skillContents.length);
      for (let i = 0; i < data.skillContents.length; i++) {
        skillEnv[`HAPPY_TASK_SKILL_${i}_NAME`] = data.skillContents[i].name;
        skillEnv[`HAPPY_TASK_SKILL_${i}_CONTENT`] = data.skillContents[i].content;
      }
    }

    const result = await spawnSession({
      directory: data.directory,
      approvedNewDirectoryCreation: true, // Tasks always auto-approve directory
      automationContext: {
        kind: "task",
        trigger: "task-dispatch",
        projectId: data.projectId,
      },
      environmentVariables: {
        HAPPY_INITIAL_PROMPT_FILE: promptFile,
        HAPPY_TASK_ID: data.taskId,
        HAPPY_TASK_PRIORITY: data.priority,
        HAPPY_TASK_SERVER_URL: serverUrl,
        HAPPY_TASK_RESULT_TOKEN: data.resultToken ?? "",
        HAPPY_TASK_REPORT_URL: `${serverUrl}/v1/tasks/${data.taskId}/result`,
        ...skillEnv,
      },
    });

    if (result.type !== "success") {
      logger.debug(`[TRIGGER] Task spawn failed: ${result.type === "error" ? result.errorMessage : "needs approval"}`);
    }
  } catch (error) {
    logger.debug(`[TRIGGER] Task error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
