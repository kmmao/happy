/**
 * Ephemeral trigger handlers — process webhook, supervisor, and task triggers
 * by enqueueing jobs into the AutomationScheduler, which manages priority,
 * deduplication, concurrency limits, and retry.
 */

import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { logger } from "../logger";
import { spawnSession } from "./spawnSession";
import type { MachineClient } from "../api/machineClient";
import type { AutomationScheduler } from "./scheduler";

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

function mapTaskPriority(priority: string): "urgent" | "user" | "background" {
  if (priority === "urgent" || priority === "high") return "urgent";
  if (priority === "background" || priority === "low") return "background";
  return "user";
}

export function handleWebhookTrigger(
  data: WebhookTriggerData,
  client: MachineClient,
  serverUrl: string,
  authToken: string,
  scheduler: AutomationScheduler,
): void {
  logger.debug(`[TRIGGER] Webhook: issue #${data.issueNumber} in ${data.repoPath}`);

  const { deduped } = scheduler.enqueue({
    kind: "webhook",
    dedupeKey: `webhook:${data.webhookEventId}`,
    priority: "background",
    run: async (jobId) => {
      client.emitWebhookStatus({ webhookEventId: data.webhookEventId, status: "dispatched" });

      const promptFile = await writePromptFile("webhook", buildWebhookPrompt(data));
      const result = await spawnSession({
        directory: data.repoPath,
        approvedNewDirectoryCreation: false,
        automationContext: { kind: "webhook", trigger: `issue#${data.issueNumber}` },
        environmentVariables: {
          HAPPY_INITIAL_PROMPT_FILE: promptFile,
          HAPPY_WEBHOOK_EVENT_ID: data.webhookEventId,
          HAPPY_WEBHOOK_ISSUE_URL: data.issueUrl,
          HAPPY_SERVER_URL: serverUrl,
          HAPPY_AUTH_TOKEN: authToken,
        },
      });

      if (result.type !== "success") {
        const msg = result.type === "error" ? result.errorMessage : "Directory creation not approved";
        client.emitWebhookStatus({ webhookEventId: data.webhookEventId, status: "failed", errorMessage: msg });
        throw new Error(msg);
      }

      // Register exit handler for scheduler lifecycle
      const tracked = (await import("./trackedSessions")).getTrackedSession(result.pid);
      if (tracked?.childProcess) {
        tracked.childProcess.on("exit", (code) => {
          if (code === 0) scheduler.markCompleted(jobId);
          else scheduler.markFailed(jobId, `exit code ${code}`);
          client.emitWebhookStatus({ webhookEventId: data.webhookEventId, status: code === 0 ? "completed" : "failed" });
        });
      }

      return { pid: result.pid };
    },
  });

  if (deduped) {
    logger.debug(`[TRIGGER] Webhook deduped: ${data.webhookEventId}`);
  }
}

export function handleSupervisorTrigger(
  data: SupervisorTriggerData,
  client: MachineClient,
  serverUrl: string,
  authToken: string,
  scheduler: AutomationScheduler,
): void {
  logger.debug(`[TRIGGER] Supervisor: run ${data.runId} in ${data.repoPath}`);

  const { deduped } = scheduler.enqueue({
    kind: "supervisor",
    dedupeKey: `supervisor:${data.runId}`,
    priority: "background",
    run: async (jobId) => {
      client.emitSupervisorRunStatus({ runId: data.runId, projectId: data.projectId, status: "running" });

      const promptFile = await writePromptFile("supervisor", buildSupervisorPrompt(data));
      const result = await spawnSession({
        directory: data.repoPath,
        approvedNewDirectoryCreation: false,
        automationContext: { kind: "supervisor", trigger: data.trigger, projectId: data.projectId, runId: data.runId },
        environmentVariables: {
          HAPPY_INITIAL_PROMPT_FILE: promptFile,
          HAPPY_SUPERVISOR_RUN_ID: data.runId,
          HAPPY_SUPERVISOR_PROJECT_ID: data.projectId,
          HAPPY_SUPERVISOR_SERVER_URL: serverUrl,
          HAPPY_SUPERVISOR_AUTH_TOKEN: authToken,
        },
      });

      if (result.type !== "success") {
        const msg = result.type === "error" ? result.errorMessage : "Directory creation not approved";
        client.emitSupervisorRunStatus({ runId: data.runId, projectId: data.projectId, status: "failed", errorMessage: msg });
        throw new Error(msg);
      }

      const tracked = (await import("./trackedSessions")).getTrackedSession(result.pid);
      if (tracked?.childProcess) {
        tracked.childProcess.on("exit", (code) => {
          const status = code === 0 ? "completed" : "failed";
          if (code === 0) scheduler.markCompleted(jobId);
          else scheduler.markFailed(jobId, `exit code ${code}`);
          client.emitSupervisorRunStatus({ runId: data.runId, projectId: data.projectId, status });
        });
      }

      return { pid: result.pid };
    },
  });

  if (deduped) {
    logger.debug(`[TRIGGER] Supervisor deduped: ${data.runId}`);
  }
}

export function handleTaskTrigger(
  data: TaskTriggerData,
  serverUrl: string,
  _authToken: string,
  scheduler: AutomationScheduler,
): void {
  logger.debug(`[TRIGGER] Task: ${data.taskId} in ${data.directory}`);

  const { deduped } = scheduler.enqueue({
    kind: "task",
    dedupeKey: `task:${data.taskId}`,
    priority: mapTaskPriority(data.priority),
    run: async (jobId) => {
      const promptFile = await writePromptFile("task", data.prompt);

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
        approvedNewDirectoryCreation: true,
        automationContext: { kind: "task", trigger: "task-dispatch", projectId: data.projectId },
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
        throw new Error(result.type === "error" ? result.errorMessage : "Directory creation not approved");
      }

      const tracked = (await import("./trackedSessions")).getTrackedSession(result.pid);
      if (tracked?.childProcess) {
        tracked.childProcess.on("exit", (code) => {
          if (code === 0) scheduler.markCompleted(jobId);
          else scheduler.markFailed(jobId, `exit code ${code}`);
        });
      }

      return { pid: result.pid };
    },
  });

  if (deduped) {
    logger.debug(`[TRIGGER] Task deduped: ${data.taskId}`);
  }
}
