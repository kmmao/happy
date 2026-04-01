import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "@/ui/logger";
import type {
  SpawnSessionOptions,
  SpawnSessionResult,
} from "@/modules/common/registerCommonHandlers";
import type { AgentLoopTriggerData } from "./types";
import { prepareAgentLoopPromptArtifacts } from "./AgentLoopMemory";

export interface AgentLoopHandlerDeps {
  readonly spawnSession: (
    options: SpawnSessionOptions,
  ) => Promise<SpawnSessionResult>;
  readonly resolveGuardianSessionId?: (data: AgentLoopTriggerData) => string | undefined;
  readonly rememberGuardianSession?: (data: AgentLoopTriggerData, sessionId: string) => Promise<void> | void;
  readonly onSessionStarted?: (data: AgentLoopTriggerData, sessionId: string) => Promise<void> | void;
}

async function writePromptFile(directory: string, loopId: string, prompt: string): Promise<string> {
  const path = join(directory, `agent-loop-${loopId}-${randomUUID()}.md`);
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

export async function runAgentLoopJob(
  data: AgentLoopTriggerData,
  deps: AgentLoopHandlerDeps,
): Promise<{ success: boolean; errorMessage?: string; sessionId?: string }> {
  const guardianSessionId = deps.resolveGuardianSessionId?.(data);
  const artifacts = await prepareAgentLoopPromptArtifacts(data);
  const promptFilePath = await writePromptFile(artifacts.supportDir, data.loopId, artifacts.prompt);

  logger.debug(
    `[AGENT LOOP] Running loop ${data.loopId} iteration ${data.iteration} at ${data.directory}${guardianSessionId ? ` reusing=${guardianSessionId}` : ""}`,
  );

  const spawnResult = await deps.spawnSession({
    directory: data.directory,
    approvedNewDirectoryCreation: false,
    agent: data.agent ?? "claude",
    happySessionId: guardianSessionId,
    profileId: data.profileId,
    automationContext: {
      kind: "agent_loop",
      trigger: data.trigger,
      projectId: data.projectId,
      loopId: data.loopId,
      dedupeKey: `agent-loop:${data.loopId}:${data.iteration}`,
    },
    environmentVariables: {
      HAPPY_INITIAL_PROMPT_FILE: promptFilePath,
      HAPPY_AGENT_LOOP_ID: data.loopId,
      HAPPY_AGENT_LOOP_NAME: data.loopName ?? "",
      HAPPY_AGENT_LOOP_TRIGGER: data.trigger,
      HAPPY_AGENT_LOOP_ITERATION: String(data.iteration),
      HAPPY_AGENT_LOOP_GOAL: data.goal ?? "",
      HAPPY_AGENT_LOOP_CURRENT_FOCUS: data.currentFocus ?? "",
      HAPPY_AGENT_LOOP_WORKING_MEMORY: data.workingMemory ?? "",
      HAPPY_AGENT_LOOP_REFLECTION_SUMMARY: data.lastReflectionSummary ?? "",
      HAPPY_AGENT_LOOP_MEMORY_UPDATED_AT: data.memoryUpdatedAt ? String(data.memoryUpdatedAt) : "",
      HAPPY_AGENT_LOOP_CONSECUTIVE_FAILURES: data.consecutiveFailures !== undefined ? String(data.consecutiveFailures) : "0",
      HAPPY_AGENT_LOOP_MAX_CONSECUTIVE_FAILURES: data.maxConsecutiveFailures !== undefined ? String(data.maxConsecutiveFailures) : "1",
      HAPPY_AGENT_LOOP_RETRY_BACKOFF_MS: data.retryBackoffMs !== undefined ? String(data.retryBackoffMs) : "",
      HAPPY_AGENT_LOOP_COOLDOWN_MS: data.cooldownMs !== undefined ? String(data.cooldownMs) : "",
      HAPPY_AGENT_LOOP_QUIET_HOURS_START: data.quietHoursStart ?? "",
      HAPPY_AGENT_LOOP_QUIET_HOURS_END: data.quietHoursEnd ?? "",
      HAPPY_AGENT_LOOP_MAX_AUTO_RUNS_PER_DAY: data.maxAutoRunsPerDay !== undefined ? String(data.maxAutoRunsPerDay) : "",
      HAPPY_AGENT_LOOP_MEMORY_FILE: artifacts.memoryFilePath,
      HAPPY_AGENT_LOOP_CONTEXT_FILE: artifacts.contextFilePath,
      HAPPY_AGENT_LOOP_EVENT_ID: data.eventId ?? "",
      HAPPY_AGENT_LOOP_EVENT_SOURCE: data.eventSource ?? "",
      HAPPY_AGENT_LOOP_EVENT_TITLE: data.eventTitle ?? "",
      HAPPY_AGENT_LOOP_EVENT_DETAILS: data.eventDetails ?? "",
      ...(data.environmentVariables ?? {}),
    },
  });

  if (spawnResult.type !== "success") {
    await cleanupPromptFile(promptFilePath);
    return {
      success: false,
      errorMessage:
        spawnResult.type === "error"
          ? spawnResult.errorMessage
          : "Failed to spawn agent loop session",
    };
  }

  await deps.rememberGuardianSession?.(data, spawnResult.sessionId);
  await deps.onSessionStarted?.(data, spawnResult.sessionId);
  return { success: true, sessionId: spawnResult.sessionId };
}
