/**
 * Handle incoming supervisor-trigger events from the Server.
 *
 * Orchestrates: prompt building → session spawning →
 * initial prompt delivery via temp file → status reporting.
 *
 * Supports two modes:
 * - Analysis (trigger != "fix"): read-only project scanning
 * - Fix (trigger == "fix"): applies a fix for a specific finding
 */

import { writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";
import { logger } from "@/ui/logger";
import { buildSupervisorPrompt } from "./buildSupervisorPrompt";
import { buildFixPrompt } from "./buildFixPrompt";
import { buildResearchPrompt } from "./buildResearchPrompt";
import {
  createWorktreeLocal,
  removeWorktreeForced,
} from "@/webhook/createWorktreeLocal";
import type {
  SupervisorTriggerData,
  SupervisorRunStatusData,
  SupervisorFixStatusData,
} from "@/api/apiMachine";
import type {
  SpawnSessionOptions,
  SpawnSessionResult,
} from "@/modules/common/registerCommonHandlers";

export interface SupervisorHandlerDeps {
  readonly spawnSession: (
    options: SpawnSessionOptions,
  ) => Promise<SpawnSessionResult>;
  readonly emitSupervisorRunStatus: (data: SupervisorRunStatusData) => void;
  readonly emitSupervisorFixStatus: (data: SupervisorFixStatusData) => void;
  readonly serverUrl: string;
  readonly authToken: string;
}

// Track in-flight supervisor runs to prevent duplicate processing
const processingRuns = new Set<string>();

// Track fix session worktrees for cleanup on session exit
const fixWorktrees = new Map<
  string,
  { readonly repoPath: string; readonly branchName: string; readonly parentBranch: string }
>();

/**
 * Clean up a fix session's worktree after the session exits.
 * Best-effort: never throws.
 */
export async function cleanupFixWorktree(
  sessionId: string,
): Promise<void> {
  const info = fixWorktrees.get(sessionId);
  if (!info) return;
  fixWorktrees.delete(sessionId);
  try {
    await removeWorktreeForced(info.repoPath, info.branchName);
    logger.debug(
      `[SUPERVISOR] Cleaned up fix worktree ${info.branchName} for session ${sessionId}`,
    );
  } catch {
    // best-effort
  }

  // Sync local parent branch with remote after direct-push fix
  try {
    const { execFile: execFileCb } = await import("child_process");
    await new Promise<void>((resolve) => {
      execFileCb(
        "git",
        ["pull", "--ff-only", "origin", info.parentBranch],
        { cwd: info.repoPath, timeout: 30_000 },
        (error) => {
          if (error) {
            logger.debug(
              `[SUPERVISOR] Failed to pull ${info.parentBranch} after fix cleanup: ${error.message}`,
            );
          } else {
            logger.debug(
              `[SUPERVISOR] Pulled latest ${info.parentBranch} after fix cleanup`,
            );
          }
          resolve();
        },
      );
    });
  } catch {
    // best-effort
  }
}

export async function handleSupervisorTrigger(
  data: SupervisorTriggerData,
  deps: SupervisorHandlerDeps,
): Promise<void> {
  const {
    runId,
    projectId,
    repoPath,
    trigger,
    mode,
    dimensions,
    changedFiles,
    customRules,
    fixAction,
    researchParams,
    fixStrategy,
    existingActions,
  } = data;

  // Guard against duplicate processing
  if (processingRuns.has(runId)) {
    logger.debug(
      `[SUPERVISOR] Run ${runId} already being processed, skipping`,
    );
    return;
  }
  processingRuns.add(runId);

  try {
    if (trigger === "fix" && fixAction) {
      await handleFixTrigger(
        runId,
        projectId,
        repoPath,
        fixAction,
        fixStrategy ?? "direct",
        deps,
      );
    } else if (trigger === "research") {
      await handleResearchTrigger(
        runId,
        projectId,
        repoPath,
        researchParams,
        deps,
      );
    } else {
      await handleAnalysisTrigger(
        runId,
        projectId,
        repoPath,
        trigger,
        mode,
        dimensions,
        changedFiles,
        customRules,
        existingActions,
        deps,
      );
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logger.debug(
      `[SUPERVISOR] Failed to handle run ${runId}: ${errorMessage}`,
    );
    if (trigger === "fix") {
      deps.emitSupervisorFixStatus({
        actionId: runId,
        projectId,
        fixStatus: "failed",
      });
    } else {
      deps.emitSupervisorRunStatus({
        runId,
        projectId,
        status: "failed",
        errorMessage,
      });
    }
  } finally {
    processingRuns.delete(runId);
  }
}

async function handleAnalysisTrigger(
  runId: string,
  projectId: string,
  repoPath: string,
  trigger: string,
  mode: string | undefined,
  dimensions: readonly string[] | undefined,
  changedFiles: readonly string[] | undefined,
  customRules: string | undefined,
  existingActions: SupervisorTriggerData["existingActions"],
  deps: SupervisorHandlerDeps,
): Promise<void> {
  logger.debug(
    `[SUPERVISOR] Processing analysis ${runId} for project ${projectId} at ${repoPath} (mode: ${mode ?? "suggest"})`,
  );

  // 1. Report running status
  deps.emitSupervisorRunStatus({
    runId,
    projectId,
    status: "running",
  });

  // 2. Build the analysis prompt
  const prompt = buildSupervisorPrompt({
    projectId,
    runId,
    repoPath,
    trigger,
    mode,
    dimensions,
    changedFiles,
    customRules,
    existingActions,
    serverUrl: deps.serverUrl,
  });

  // 3. Write prompt to temp file in the project
  const promptFilePath = await writePromptFile(repoPath, runId, prompt);

  // 4. Spawn session in the project directory (read-only analysis)
  const spawnResult = await deps.spawnSession({
    directory: repoPath,
    approvedNewDirectoryCreation: false,
    agent: "claude",
    environmentVariables: {
      HAPPY_INITIAL_PROMPT_FILE: promptFilePath,
      HAPPY_SUPERVISOR_RUN_ID: runId,
      HAPPY_SUPERVISOR_PROJECT_ID: projectId,
      HAPPY_SUPERVISOR_SERVER_URL: deps.serverUrl,
      HAPPY_SUPERVISOR_AUTH_TOKEN: deps.authToken,
    },
  });

  if (spawnResult.type !== "success") {
    const errorMessage =
      spawnResult.type === "error"
        ? spawnResult.errorMessage
        : "Failed to spawn supervisor session";
    logger.debug(`[SUPERVISOR] Session spawn failed: ${errorMessage}`);
    deps.emitSupervisorRunStatus({
      runId,
      projectId,
      status: "failed",
      errorMessage,
    });
    await cleanupPromptFile(promptFilePath);
    return;
  }

  logger.debug(
    `[SUPERVISOR] Session ${spawnResult.sessionId} spawned for run ${runId}`,
  );
  deps.emitSupervisorRunStatus({
    runId,
    projectId,
    status: "running",
    sessionId: spawnResult.sessionId,
  });
}

async function handleResearchTrigger(
  runId: string,
  projectId: string,
  repoPath: string,
  researchParams: string | undefined,
  deps: SupervisorHandlerDeps,
): Promise<void> {
  logger.debug(
    `[SUPERVISOR] Processing research ${runId} for project ${projectId} at ${repoPath}`,
  );

  // 1. Report running status
  deps.emitSupervisorRunStatus({
    runId,
    projectId,
    status: "running",
  });

  // 2. Build the research prompt
  const prompt = buildResearchPrompt({
    projectId,
    runId,
    repoPath,
    researchParams,
    serverUrl: deps.serverUrl,
  });

  // 3. Write prompt to temp file in the project
  const promptFilePath = await writePromptFile(repoPath, `research-${runId}`, prompt);

  // 4. Spawn session in the project directory (read-only research)
  const spawnResult = await deps.spawnSession({
    directory: repoPath,
    approvedNewDirectoryCreation: false,
    agent: "claude",
    environmentVariables: {
      HAPPY_INITIAL_PROMPT_FILE: promptFilePath,
      HAPPY_SUPERVISOR_RUN_ID: runId,
      HAPPY_SUPERVISOR_PROJECT_ID: projectId,
      HAPPY_SUPERVISOR_SERVER_URL: deps.serverUrl,
      HAPPY_SUPERVISOR_AUTH_TOKEN: deps.authToken,
    },
  });

  if (spawnResult.type !== "success") {
    const errorMessage =
      spawnResult.type === "error"
        ? spawnResult.errorMessage
        : "Failed to spawn research session";
    logger.debug(`[SUPERVISOR] Research session spawn failed: ${errorMessage}`);
    deps.emitSupervisorRunStatus({
      runId,
      projectId,
      status: "failed",
      errorMessage,
    });
    await cleanupPromptFile(promptFilePath);
    return;
  }

  logger.debug(
    `[SUPERVISOR] Research session ${spawnResult.sessionId} spawned for run ${runId}`,
  );
  deps.emitSupervisorRunStatus({
    runId,
    projectId,
    status: "running",
    sessionId: spawnResult.sessionId,
  });
}

async function handleFixTrigger(
  actionId: string,
  projectId: string,
  repoPath: string,
  fixAction: NonNullable<SupervisorTriggerData["fixAction"]>,
  fixStrategy: "direct" | "pr",
  deps: SupervisorHandlerDeps,
): Promise<void> {
  logger.debug(
    `[SUPERVISOR] Processing fix ${actionId} for project ${projectId}: "${fixAction.title}"`,
  );

  // 1. Create worktree for isolated fix
  const worktreeResult = await createWorktreeLocal(repoPath, { prefix: "fix" });
  if (!worktreeResult.success) {
    const errorMessage = worktreeResult.error ?? "Failed to create worktree";
    logger.debug(`[SUPERVISOR] Worktree creation failed: ${errorMessage}`);
    deps.emitSupervisorFixStatus({
      actionId,
      projectId,
      fixStatus: "failed",
    });
    return;
  }

  logger.debug(
    `[SUPERVISOR] Worktree created: ${worktreeResult.worktreePath} (branch: ${worktreeResult.branchName})`,
  );

  // 2. Report running status
  deps.emitSupervisorFixStatus({
    actionId,
    projectId,
    fixStatus: "running",
  });

  // 3. Build the fix prompt with worktree info
  const prompt = buildFixPrompt({
    projectId,
    actionId,
    repoPath,
    title: fixAction.title,
    description: fixAction.description,
    suggestedFix: fixAction.suggestedFix,
    category: fixAction.category,
    severity: fixAction.severity,
    serverUrl: deps.serverUrl,
    branchName: worktreeResult.branchName,
    parentBranch: worktreeResult.parentBranch,
    issueNumber: fixAction.issueNumber,
    fixStrategy,
  });

  // 4. Write prompt to temp file in the worktree
  const promptDir = join(worktreeResult.worktreePath, ".claude");
  await mkdir(promptDir, { recursive: true });
  const promptFilePath = join(promptDir, `supervisor-prompt-fix-${actionId}.txt`);
  await writeFile(promptFilePath, prompt, "utf-8");
  logger.debug(`[SUPERVISOR] Wrote fix prompt to ${promptFilePath}`);

  // 5. Spawn fix session in worktree directory
  const spawnResult = await deps.spawnSession({
    directory: worktreeResult.worktreePath,
    approvedNewDirectoryCreation: true,
    agent: "claude",
    environmentVariables: {
      HAPPY_INITIAL_PROMPT_FILE: promptFilePath,
      HAPPY_SUPERVISOR_ACTION_ID: actionId,
      HAPPY_SUPERVISOR_PROJECT_ID: projectId,
      HAPPY_SUPERVISOR_SERVER_URL: deps.serverUrl,
      HAPPY_SUPERVISOR_AUTH_TOKEN: deps.authToken,
    },
  });

  if (spawnResult.type !== "success") {
    const errorMessage =
      spawnResult.type === "error"
        ? spawnResult.errorMessage
        : "Failed to spawn fix session";
    logger.debug(`[SUPERVISOR] Fix session spawn failed: ${errorMessage}`);
    deps.emitSupervisorFixStatus({
      actionId,
      projectId,
      fixStatus: "failed",
    });
    // Clean up prompt file and worktree on failure
    try { await unlink(promptFilePath); } catch { /* best-effort */ }
    try { await removeWorktreeForced(repoPath, worktreeResult.branchName); } catch { /* best-effort */ }
    return;
  }

  // 6. Track worktree for cleanup on session exit
  fixWorktrees.set(spawnResult.sessionId, {
    repoPath,
    branchName: worktreeResult.branchName,
    parentBranch: worktreeResult.parentBranch,
  });

  logger.debug(
    `[SUPERVISOR] Fix session ${spawnResult.sessionId} spawned for action ${actionId}`,
  );
  deps.emitSupervisorFixStatus({
    actionId,
    projectId,
    fixStatus: "running",
    fixSessionId: spawnResult.sessionId,
  });
}

async function writePromptFile(
  repoPath: string,
  id: string,
  prompt: string,
): Promise<string> {
  const promptDir = join(repoPath, ".claude");
  await mkdir(promptDir, { recursive: true });
  const promptFilePath = join(promptDir, `supervisor-prompt-${id}.txt`);
  await writeFile(promptFilePath, prompt, "utf-8");
  logger.debug(`[SUPERVISOR] Wrote prompt to ${promptFilePath}`);
  return promptFilePath;
}

async function cleanupPromptFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // best-effort
  }
}
