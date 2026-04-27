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
import { withTimeout } from "@/utils/withTimeout";
import { readSettings } from "@/persistence";
import { buildSupervisorPrompt } from "./buildSupervisorPrompt";
import { buildFixPrompt } from "./buildFixPrompt";
import { buildResearchPrompt } from "./buildResearchPrompt";
import { runPreflightSync } from "./preflightSync";
import {
  acquireSlot,
  releaseSlot,
  setMaxConcurrency,
  getPoolStatus,
  ConcurrencyAbortedError,
  type SlotType,
} from "./concurrencyLimiter";
import {
  createWorktreeLocal,
  removeWorktreeForced,
  resolveParentBranch,
  fetchOriginBranch,
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
import {
  normalizeResolvedRuntimeProfile,
  type ResolvedRuntimeProfile,
} from "@kmmao/happy-wire";

export interface SupervisorHandlerDeps {
  readonly spawnSession: (
    options: SpawnSessionOptions,
  ) => Promise<SpawnSessionResult>;
  readonly emitSupervisorRunStatus: (data: SupervisorRunStatusData) => void;
  readonly emitSupervisorFixStatus: (data: SupervisorFixStatusData) => void;
  readonly serverUrl: string;
  readonly resolveGuardianSessionId?: (data: SupervisorTriggerData) => string | undefined;
  readonly rememberGuardianSession?: (data: SupervisorTriggerData, sessionId: string) => Promise<void> | void;
}

async function resolveAgentForSupervisor(
  data: SupervisorTriggerData,
  runtimeProfile: ResolvedRuntimeProfile | undefined,
): Promise<"claude" | "codex"> {
  if (data.agent === "codex") return "codex";
  if (data.agent === "claude") return "claude";

  const env = runtimeProfile?.environmentVariables ?? {};
  if (env.HAPPY_CODEX_BACKEND || env.HAPPY_CODEX_CONFIG_MODE || env.HAPPY_CODEX_MODEL) {
    return "codex";
  }

  const profileId = runtimeProfile?.profileId;
  if (profileId) {
    try {
      const settings = await readSettings();
      const profile = settings.profiles.find((p) => p.id === profileId);
      if (profile?.codexConfig) {
        return "codex";
      }
    } catch {
      // fallback to claude
    }
  }

  return "claude";
}

// Track in-flight supervisor runs to prevent duplicate processing
// Uses Map<runId, addedAt> so stale entries can be auto-cleaned after 30 minutes
const processingRuns = new Map<string, number>();
const PROCESSING_RUN_STALE_MS = 30 * 60_000; // 30 minutes

// Track fix session worktrees for cleanup on session exit
const fixWorktrees = new Map<
  string,
  {
    readonly repoPath: string;
    readonly branchName: string;
    readonly parentBranch: string;
    readonly actionId: string;
    readonly projectId: string;
    readonly fixMode: "fix" | "analyze-first";
  }
>();

// Track in-flight research/analysis sessions for fallback failure reporting on exit.
// If the session exits without sending the HTTP callback, the daemon uses this to
// emit a "failed" status and prevent the run from being stuck as "running" forever.
const researchRuns = new Map<string, { readonly runId: string; readonly projectId: string }>();

/**
 * Look up fix worktree info for a given session.
 * Used by the daemon to detect orphaned fix sessions on exit.
 */
export function getFixWorktreeInfo(sessionId: string) {
  return fixWorktrees.get(sessionId) ?? null;
}

/**
 * Look up research/analysis run info for a given session.
 * Used by the daemon to emit a fallback "failed" status if the session exits
 * without the Claude-side curl callback completing successfully.
 */
export function getResearchRunInfo(sessionId: string) {
  return researchRuns.get(sessionId) ?? null;
}

export function forgetResearchRun(sessionId: string): void {
  researchRuns.delete(sessionId);
}

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

  // Release the concurrency slot held since spawn
  releaseSlot("fix");
  const pool = getPoolStatus("fix");
  logger.info(
    `[SUPERVISOR-CONCURRENCY] RELEASED (session exit): type=fix sessionId=${sessionId} active=${pool.active}/${pool.max} queued=${pool.queued}`,
  );
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
): Promise<{ success: boolean; errorMessage?: string; sessionId?: string }> {
  const runtimeProfile = normalizeResolvedRuntimeProfile(data.runtimeProfile);
  const {
    runId,
    projectId,
    repoPath,
    trigger,
    mode,
    dimensions,
    changedFiles,
    customRules,
    customDimensions,
    fixAction,
    researchParams,
    fixStrategy,
    fixMode,
    analyzeAutoFix,
    existingActions,
    maxConcurrentAnalysis,
    maxConcurrentFix,
    maxFindings,
    loopId,
    loopIteration,
  } = data;

  if (loopId) {
    logger.debug(
      `[SUPERVISOR] Loop ${loopId} iteration ${loopIteration ?? "?"}: trigger=${trigger} run=${runId}`,
    );
  }

  if (data.runtimeProfile && !runtimeProfile) {
    const errorMessage = "Supervisor runtime profile payload is invalid or unsupported";
    logger.warn(`[SUPERVISOR] ${errorMessage}`);
    return { success: false, errorMessage };
  }

  // Apply concurrency limits from server config (if provided)
  if (maxConcurrentAnalysis != null) {
    setMaxConcurrency("analysis", maxConcurrentAnalysis);
  }
  if (maxConcurrentFix != null) {
    setMaxConcurrency("fix", maxConcurrentFix);
  }

  // Auto-clean stale entries (e.g. crash left runId stuck in map)
  const staleThreshold = Date.now() - PROCESSING_RUN_STALE_MS;
  for (const [id, addedAt] of processingRuns) {
    if (addedAt < staleThreshold) {
      processingRuns.delete(id);
      logger.debug(`[SUPERVISOR] Cleared stale processingRun: ${id}`);
    }
  }

  // Guard against duplicate processing
  if (processingRuns.has(runId)) {
    logger.debug(
      `[SUPERVISOR] Run ${runId} already being processed, skipping`,
    );
    return { success: false, errorMessage: "Run already processing" };
  }
  processingRuns.set(runId, Date.now());

  // Validate profileId if specified — fail fast with a clear error rather than silently ignoring
  // Built-in profile IDs (hardcoded in App's profileUtils) are always valid
  const BUILT_IN_PROFILE_IDS = new Set(["anthropic", "deepseek", "zai", "openai", "azure-openai", "minimax", "kimi"]);
  if (
    runtimeProfile?.profileId &&
    runtimeProfile.source === "local-profile" &&
    !BUILT_IN_PROFILE_IDS.has(runtimeProfile.profileId)
  ) {
    const settings = await readSettings();
    const profileExists = settings.profiles.some((p) => p.id === runtimeProfile.profileId);
    if (!profileExists) {
      const errorMessage = `Profile "${runtimeProfile.profileId}" is not configured on this machine. Please check the supervisor settings and ensure the selected profile exists.`;
      logger.info(`[SUPERVISOR] ${errorMessage}`);
      processingRuns.delete(runId);
      if (trigger === "fix") {
        deps.emitSupervisorFixStatus({ actionId: runId, projectId, fixStatus: "failed" });
      } else {
        deps.emitSupervisorRunStatus({ runId, projectId, status: "failed", errorMessage });
      }
      return { success: false, errorMessage };
    }
  }

  // Determine which pool to use
  const slotType: SlotType = trigger === "fix" ? "fix" : "analysis";

  // Report queued status while waiting for a slot
  if (trigger === "fix") {
    deps.emitSupervisorFixStatus({
      actionId: runId,
      projectId,
      fixStatus: "queued",
    });
  } else {
    deps.emitSupervisorRunStatus({
      runId,
      projectId,
      status: "queued",
    });
  }

  try {
    // Wait for a concurrency slot (queues if pool is full)
    const poolBefore = getPoolStatus(slotType);
    logger.info(
      `[SUPERVISOR-CONCURRENCY] BEFORE acquireSlot: type=${slotType} runId=${runId} active=${poolBefore.active}/${poolBefore.max} queued=${poolBefore.queued}`,
    );
    await acquireSlot(slotType);
    const poolAfter = getPoolStatus(slotType);
    logger.info(
      `[SUPERVISOR-CONCURRENCY] AFTER acquireSlot: type=${slotType} runId=${runId} active=${poolAfter.active}/${poolAfter.max} queued=${poolAfter.queued}`,
    );
  } catch (error) {
    processingRuns.delete(runId);
    if (error instanceof ConcurrencyAbortedError) {
      logger.debug(
        `[SUPERVISOR] Run ${runId} cancelled while queued`,
      );
      if (trigger === "fix") {
        deps.emitSupervisorFixStatus({
          actionId: runId,
          projectId,
          fixStatus: "cancelled",
        });
      } else {
        deps.emitSupervisorRunStatus({
          runId,
          projectId,
          status: "cancelled",
        });
      }
    }
    return { success: false, errorMessage: error instanceof ConcurrencyAbortedError ? "Concurrency acquisition cancelled" : "Slot acquisition failed" };
  }

  let dispatchedSessionId: string | undefined;
  let fixSpawnedSuccessfully = false;
  let executionSucceeded = false;
  let executionErrorMessage: string | undefined;
  try {
    if (trigger === "fix" && fixAction) {
      // Fix trigger uses worktree — no preflight needed
      dispatchedSessionId = await handleFixTrigger(
        data,
        runtimeProfile,
        fixAction,
        fixStrategy ?? "direct",
        fixMode ?? "fix",
        analyzeAutoFix ?? false,
        deps,
      );
      fixSpawnedSuccessfully = Boolean(dispatchedSessionId);
      executionSucceeded = fixSpawnedSuccessfully;
      if (!fixSpawnedSuccessfully) {
        executionErrorMessage = "Fix session failed to dispatch";
      }
    } else {
      // Analysis and research: run preflight sync first
      const preflightStepMap: Record<string, { dimension: string; index: number; total: number }> = {
        checking: { dimension: "preflight_check", index: 1, total: 5 },
        stashing: { dimension: "preflight_stash", index: 1, total: 5 },
        fetching: { dimension: "preflight_fetch", index: 2, total: 5 },
        pulling: { dimension: "preflight_pull", index: 3, total: 5 },
        "resolving-conflicts": { dimension: "preflight_resolve", index: 3, total: 5 },
        deploying: { dimension: "preflight_deploy", index: 4, total: 5 },
        "deploying-happy-cli": { dimension: "preflight_deploy_cli", index: 4, total: 5 },
        "deploying-happy-server": { dimension: "preflight_deploy_server", index: 4, total: 5 },
      };

      deps.emitSupervisorRunStatus({
        runId,
        projectId,
        status: "running",
        currentDimension: "preflight_start",
        dimensionIndex: 1,
        totalDimensions: 5,
      });

      const preflightResult = await withTimeout(runPreflightSync(repoPath, (step) => {
        const mapped = preflightStepMap[step];
        if (mapped) {
          deps.emitSupervisorRunStatus({
            runId,
            projectId,
            status: "running",
            currentDimension: mapped.dimension,
            dimensionIndex: mapped.index,
            totalDimensions: mapped.total,
          });
        }
      }), 180_000, "runPreflightSync");

      if (!preflightResult.success) {
        logger.debug(
          `[SUPERVISOR] Preflight failed for run ${runId}: ${preflightResult.error}`,
        );
        deps.emitSupervisorRunStatus({
          runId,
          projectId,
          status: "failed",
          errorMessage: preflightResult.error ?? "Preflight sync failed",
        });
        executionErrorMessage = preflightResult.error ?? "Preflight sync failed";
        return { success: false, errorMessage: executionErrorMessage };
      }

      if (preflightResult.pulled) {
        logger.debug(
          `[SUPERVISOR] Preflight pulled ${preflightResult.changedFiles.length} changed file(s), deployed: [${preflightResult.deployedPackages.join(", ")}]`,
        );
      }

      // Dispatch to analysis or research
      if (trigger === "research") {
        dispatchedSessionId = await handleResearchTrigger(
          data,
          runtimeProfile,
          researchParams,
          deps,
        );
      } else {
        dispatchedSessionId = await handleAnalysisTrigger(
          data,
          runtimeProfile,
          mode,
          dimensions,
          changedFiles,
          customRules,
          customDimensions,
          existingActions,
          maxFindings,
          deps,
        );
      }
      executionSucceeded = true;
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
    executionErrorMessage = errorMessage;
  } finally {
    // Fix sessions that spawned successfully hold the slot until the session exits
    // (released in cleanupFixWorktree). All other cases release immediately.
    if (trigger === "fix" && fixSpawnedSuccessfully) {
      const poolHeld = getPoolStatus(slotType);
      logger.info(
        `[SUPERVISOR-CONCURRENCY] HOLDING slot until session exit: type=${slotType} runId=${runId} active=${poolHeld.active}/${poolHeld.max} queued=${poolHeld.queued}`,
      );
      executionSucceeded = fixSpawnedSuccessfully;
      if (!fixSpawnedSuccessfully) {
        executionErrorMessage = "Fix session failed to dispatch";
      }
    } else {
      releaseSlot(slotType);
      const poolFinal = getPoolStatus(slotType);
      logger.info(
        `[SUPERVISOR-CONCURRENCY] RELEASED: type=${slotType} runId=${runId} active=${poolFinal.active}/${poolFinal.max} queued=${poolFinal.queued}`,
      );
    }
    processingRuns.delete(runId);
  }

  return executionSucceeded
    ? { success: true, sessionId: dispatchedSessionId }
    : { success: false, errorMessage: executionErrorMessage ?? "Supervisor job failed" };
}

async function handleAnalysisTrigger(
  data: SupervisorTriggerData,
  runtimeProfile: ResolvedRuntimeProfile | undefined,
  mode: string | undefined,
  dimensions: readonly string[] | undefined,
  changedFiles: readonly string[] | undefined,
  customRules: string | undefined,
  customDimensions: SupervisorTriggerData["customDimensions"],
  existingActions: SupervisorTriggerData["existingActions"],
  maxFindings: number | undefined,
  deps: SupervisorHandlerDeps,
): Promise<string | undefined> {
  const { runId, projectId, repoPath, trigger } = data;
  const guardianSessionId = deps.resolveGuardianSessionId?.(data);

  logger.debug(
    `[SUPERVISOR] Processing analysis ${runId} for project ${projectId} at ${repoPath} (mode: ${mode ?? "suggest"})${guardianSessionId ? ` reusing=${guardianSessionId}` : ""}`,
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
    customDimensions,
    existingActions,
    serverUrl: deps.serverUrl,
    maxFindings,
  });

  // 3. Write prompt to temp file in the project
  const promptFilePath = await writePromptFile(repoPath, runId, prompt);

  const agent = await resolveAgentForSupervisor(data, runtimeProfile);

  // 4. Spawn session in the project directory (read-only analysis)
  const spawnResult = await spawnSessionWithRetry(deps.spawnSession, {
    directory: repoPath,
    approvedNewDirectoryCreation: false,
    agent,
    happySessionId: guardianSessionId,
    profileId: runtimeProfile?.profileId,
    runtimeProfile,
    automationContext: {
      kind: "supervisor",
      trigger,
      projectId,
      runId,
      loopId: data.loopId,
      dedupeKey: `supervisor:${runId}`,
    },
    environmentVariables: {
      ...runtimeProfile?.environmentVariables,
      HAPPY_INITIAL_PROMPT_FILE: promptFilePath,
      HAPPY_SUPERVISOR_GUARDIAN_SESSION: guardianSessionId ?? "",
      HAPPY_SUPERVISOR_RUN_ID: runId,
      HAPPY_SUPERVISOR_PROJECT_ID: projectId,
      HAPPY_SUPERVISOR_SERVER_URL: deps.serverUrl,
      HAPPY_SUPERVISOR_CALLBACK_TOKEN: data.callbackToken ?? "",
      HAPPY_SUPERVISOR_MACHINE_ID: data.machineId,
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
  researchRuns.set(spawnResult.sessionId, { runId, projectId });
  await deps.rememberGuardianSession?.(data, spawnResult.sessionId);
  return spawnResult.sessionId;
}

async function handleResearchTrigger(
  data: SupervisorTriggerData,
  runtimeProfile: ResolvedRuntimeProfile | undefined,
  researchParams: string | undefined,
  deps: SupervisorHandlerDeps,
): Promise<string | undefined> {
  const { runId, projectId, repoPath, trigger } = data;
  const guardianSessionId = deps.resolveGuardianSessionId?.(data);

  logger.debug(
    `[SUPERVISOR] Processing research ${runId} for project ${projectId} at ${repoPath}${guardianSessionId ? ` reusing=${guardianSessionId}` : ""}`,
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

  const agent = await resolveAgentForSupervisor(data, runtimeProfile);

  // 4. Spawn session in the project directory (read-only research)
  const spawnResult = await spawnSessionWithRetry(deps.spawnSession, {
    directory: repoPath,
    approvedNewDirectoryCreation: false,
    agent,
    happySessionId: guardianSessionId,
    profileId: runtimeProfile?.profileId,
    runtimeProfile,
    automationContext: {
      kind: "supervisor",
      trigger,
      projectId,
      runId,
      loopId: data.loopId,
      dedupeKey: `supervisor:${runId}`,
    },
    environmentVariables: {
      ...runtimeProfile?.environmentVariables,
      HAPPY_INITIAL_PROMPT_FILE: promptFilePath,
      HAPPY_SUPERVISOR_GUARDIAN_SESSION: guardianSessionId ?? "",
      HAPPY_SUPERVISOR_RUN_ID: runId,
      HAPPY_SUPERVISOR_PROJECT_ID: projectId,
      HAPPY_SUPERVISOR_SERVER_URL: deps.serverUrl,
      HAPPY_SUPERVISOR_CALLBACK_TOKEN: data.callbackToken ?? "",
      HAPPY_SUPERVISOR_MACHINE_ID: data.machineId,
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
  researchRuns.set(spawnResult.sessionId, { runId, projectId });
  await deps.rememberGuardianSession?.(data, spawnResult.sessionId);
  return spawnResult.sessionId;
}

async function handleFixTrigger(
  data: SupervisorTriggerData,
  runtimeProfile: ResolvedRuntimeProfile | undefined,
  fixAction: NonNullable<SupervisorTriggerData["fixAction"]>,
  fixStrategy: "direct" | "pr",
  fixMode: "fix" | "analyze-first",
  analyzeAutoFix: boolean,
  deps: SupervisorHandlerDeps,
): Promise<string | undefined> {
  const { runId: actionId, projectId, repoPath, trigger, loopId } = data;
  logger.debug(
    `[SUPERVISOR] Processing fix ${actionId} for project ${projectId}: "${fixAction.title}"`,
  );

  const parentBranch = await resolveParentBranch(repoPath);
  const fetchOk = await fetchOriginBranch(repoPath, parentBranch);
  const startPoint = fetchOk ? `origin/${parentBranch}` : undefined;
  if (fetchOk) {
    logger.debug(
      `[SUPERVISOR] Fetched origin/${parentBranch} for fix worktree`,
    );
  } else {
    logger.debug(
      `[SUPERVISOR] Pre-worktree fetch failed (will use local HEAD)`,
    );
  }
  const worktreeResult = await withTimeout(
    createWorktreeLocal(repoPath, { prefix: "fix", startPoint }),
    120_000,
    "createWorktreeLocal",
  );
  if (!worktreeResult.success) {
    const errorMessage = worktreeResult.error ?? "Failed to create worktree";
    logger.debug(`[SUPERVISOR] Worktree creation failed: ${errorMessage}`);
    deps.emitSupervisorFixStatus({
      actionId,
      projectId,
      fixStatus: "failed",
    });
    return undefined;
  }

  logger.debug(
    `[SUPERVISOR] Worktree created: ${worktreeResult.worktreePath} (branch: ${worktreeResult.branchName})`,
  );

  deps.emitSupervisorFixStatus({
    actionId,
    projectId,
    fixStatus: "running",
  });

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
    fixMode,
    analyzeAutoFix,
  });

  const promptDir = join(worktreeResult.worktreePath, ".claude");
  await mkdir(promptDir, { recursive: true });
  const promptFilePath = join(promptDir, `supervisor-prompt-fix-${actionId}.txt`);
  await writeFile(promptFilePath, prompt, "utf-8");
  logger.debug(`[SUPERVISOR] Wrote fix prompt to ${promptFilePath}`);

  const spawnResult = await spawnSessionWithRetry(deps.spawnSession, {
    directory: worktreeResult.worktreePath,
    approvedNewDirectoryCreation: true,
    agent: "claude",
    profileId: runtimeProfile?.profileId,
    runtimeProfile,
    automationContext: {
      kind: "supervisor",
      trigger,
      projectId,
      runId: actionId,
      loopId,
      dedupeKey: `supervisor:${actionId}`,
    },
    environmentVariables: {
      ...runtimeProfile?.environmentVariables,
      HAPPY_INITIAL_PROMPT_FILE: promptFilePath,
      HAPPY_SUPERVISOR_ACTION_ID: actionId,
      HAPPY_SUPERVISOR_PROJECT_ID: projectId,
      HAPPY_SUPERVISOR_SERVER_URL: deps.serverUrl,
      HAPPY_SUPERVISOR_CALLBACK_TOKEN: data.callbackToken ?? "",
      HAPPY_SUPERVISOR_MACHINE_ID: data.machineId,
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
    try { await unlink(promptFilePath); } catch { /* best-effort */ }
    try { await removeWorktreeForced(repoPath, worktreeResult.branchName); } catch { /* best-effort */ }
    return undefined;
  }

  fixWorktrees.set(spawnResult.sessionId, {
    repoPath,
    branchName: worktreeResult.branchName,
    parentBranch: worktreeResult.parentBranch,
    actionId,
    projectId,
    fixMode,
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
  return spawnResult.sessionId;
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

/**
 * Spawn a session with retry logic to handle the case where dist/ is
 * temporarily missing during a CLI build (mv dist dist_prev → pkgroll).
 * Retries up to 10 times with 2s delay (~20s total).
 */
async function spawnSessionWithRetry(
  spawnSession: SupervisorHandlerDeps["spawnSession"],
  options: SpawnSessionOptions,
): Promise<SpawnSessionResult> {
  const maxAttempts = 10;
  const retryDelayMs = 2_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await spawnSession(options);

    if (result.type === "success") {
      return result;
    }

    // Check if the error is related to missing entrypoint (build in progress)
    const errorMsg =
      result.type === "error" ? result.errorMessage : "";
    const isBuildRelated =
      errorMsg.includes("does not exist") ||
      errorMsg.includes("ENOENT") ||
      errorMsg.includes("Cannot find module");

    if (!isBuildRelated || attempt === maxAttempts) {
      return result;
    }

    logger.debug(
      `[SUPERVISOR] Spawn attempt ${attempt}/${maxAttempts} failed (dist may be rebuilding), retrying in ${retryDelayMs}ms...`,
    );
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  // Should never reach here, but satisfy TypeScript
  return { type: "error" as const, errorMessage: "Max spawn attempts exceeded" };
}
