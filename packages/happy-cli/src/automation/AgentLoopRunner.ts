import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "@/ui/logger";
import type {
  SpawnSessionOptions,
  SpawnSessionResult,
} from "@/modules/common/registerCommonHandlers";
import type { AgentLoopTriggerData } from "./types";

export interface AgentLoopHandlerDeps {
  readonly spawnSession: (
    options: SpawnSessionOptions,
  ) => Promise<SpawnSessionResult>;
  readonly resolveGuardianSessionId?: (data: AgentLoopTriggerData) => string | undefined;
  readonly rememberGuardianSession?: (data: AgentLoopTriggerData, sessionId: string) => Promise<void> | void;
  readonly onSessionStarted?: (data: AgentLoopTriggerData, sessionId: string) => Promise<void> | void;
}

async function writePromptFile(directory: string, loopId: string, prompt: string): Promise<string> {
  const tempDir = join(directory, ".happy");
  await mkdir(tempDir, { recursive: true });
  const path = join(tempDir, `agent-loop-${loopId}-${randomUUID()}.md`);
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
  const promptFilePath = await writePromptFile(data.directory, data.loopId, data.prompt);

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
