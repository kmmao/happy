import os from "node:os";
import { randomUUID } from "node:crypto";
import { readFile, readdir, rm, unlink } from "node:fs/promises";
import { join, basename } from "node:path";

import { ApiClient } from "@/api/api";
import { logger } from "@/ui/logger";
import { loop } from "@/claude/loop";
import { AgentState, Metadata } from "@/api/types";
import packageJson from "../../package.json";
import { Credentials, readSettings, readSessionKey, writeSessionKey } from "@/persistence";
import { EnhancedMode, PermissionMode } from "./loop";
import { MessageQueue2 } from "@/utils/MessageQueue2";
import { hashObject } from "@/utils/deterministicJson";
import { startCaffeinate, stopCaffeinate } from "@/utils/caffeinate";
import { readClaudeMcpServers } from "@/claude/utils/claudeSettings";
import { extractSDKMetadataAsync } from "@/claude/sdk/metadataExtractor";
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { executeShellCommand } from "@/utils/shellCommand";
import { getEnvironmentInfo } from "@/ui/doctor";
import { configuration } from "@/configuration";
import { notifyDaemonSessionStarted } from "@/daemon/controlClient";
import { startSessionHeartbeat } from "@/daemon/sessionHeartbeat";
import { initialMachineMetadata } from "@/daemon/run";
import { startHappyServer } from "@/claude/utils/startHappyServer";
import { startHookServer } from "@/claude/utils/startHookServer";
import {
  generateHookSettingsFile,
  cleanupHookSettingsFile,
} from "@/claude/utils/generateHookSettings";
import { registerKillSessionHandler } from "./registerKillSessionHandler";
import { projectPath } from "../projectPath";
import { resolve } from "node:path";
import { detectWorktreeInfo } from "@/utils/detectWorktreeInfo";
import {
  cleanupWorktreeOnSessionEnd,
  type WorktreeCleanupInput,
} from "@/utils/worktreeCleanup";
import {
  startOfflineReconnection,
  connectionState,
} from "@/utils/serverConnectionErrors";
import { claudeLocal } from "@/claude/claudeLocal";
import { createSessionScanner } from "@/claude/utils/sessionScanner";
import { Session } from "./session";
import {
  applySandboxPermissionPolicy,
  resolveInitialClaudePermissionMode,
} from "./utils/permissionMode";
/** JavaScript runtime to use for spawning Claude Code */
export type JsRuntime = "node" | "bun";

export interface StartOptions {
  model?: string;
  permissionMode?: PermissionMode;
  startingMode?: "local" | "remote";
  shouldStartDaemon?: boolean;
  claudeEnvVars?: Record<string, string>;
  claudeArgs?: string[];
  startedBy?: "daemon" | "terminal";
  noSandbox?: boolean;
  /** JavaScript runtime to use for spawning Claude Code (default: 'node') */
  jsRuntime?: JsRuntime;
  /** Happy session ID for reconnecting to an existing session */
  happySessionId?: string;
}

export async function runClaude(
  credentials: Credentials,
  options: StartOptions = {},
): Promise<void> {
  logger.debug(`[CLAUDE] ===== CLAUDE MODE STARTING =====`);
  logger.debug(`[CLAUDE] This is the Claude agent, NOT Gemini`);

  // Use ANTHROPIC_MODEL from env when not set (e.g. .env.dev-local-server)
  if (!options.model && process.env.ANTHROPIC_MODEL) {
    options = { ...options, model: process.env.ANTHROPIC_MODEL };
    logger.debug(`[CLAUDE] Using model from ANTHROPIC_MODEL: ${options.model}`);
  }

  const workingDirectory = process.cwd();

  // Log environment info at startup
  logger.debugLargeJson("[START] Happy process started", getEnvironmentInfo());
  logger.debug(
    `[START] Options: startedBy=${options.startedBy}, startingMode=${options.startingMode}`,
  );

  // Validate daemon spawn requirements - fail fast on invalid config
  if (options.startedBy === "daemon" && options.startingMode === "local") {
    throw new Error(
      "Daemon-spawned sessions cannot use local/interactive mode. Use --happy-starting-mode remote or spawn sessions directly from terminal.",
    );
  }

  // Set backend for offline warnings (before any API calls)
  connectionState.setBackend("Claude");

  // Create session service
  const api = await ApiClient.create(credentials);

  // Create a new session
  let state: AgentState = {};

  // Get machine ID from settings (should already be set up)
  const settings = await readSettings();
  let machineId = settings?.machineId;
  const sandboxConfig = options.noSandbox ? undefined : settings?.sandboxConfig;

  // Build SDK plugin configs from enabled plugins in settings
  const sdkPlugins = (settings?.plugins ?? [])
    .filter((p) => p.enabled)
    .map((p) => ({ type: "local" as const, path: p.path }));
  const sandboxEnabled = Boolean(sandboxConfig?.enabled);
  const initialPermissionMode = applySandboxPermissionPolicy(
    resolveInitialClaudePermissionMode(
      options.permissionMode,
      options.claudeArgs,
    ),
    sandboxEnabled,
  );
  const dangerouslySkipPermissions =
    initialPermissionMode === "bypassPermissions" ||
    initialPermissionMode === "yolo" ||
    sandboxEnabled ||
    Boolean(options.claudeArgs?.includes("--dangerously-skip-permissions"));
  if (!machineId) {
    logger.warn(
      `[START] No machine ID found in settings, which is unexpected since authAndSetupMachineIfNeeded should have created it. Please report this issue on https://github.com/slopus/happy-cli/issues`,
    );
    process.exit(1);
  }
  logger.debug(`Using machineId: ${machineId}`);

  // Create machine if it doesn't exist
  await api.getOrCreateMachine({
    machineId,
    metadata: initialMachineMetadata,
  });

  // Read package.json scripts from working directory (including monorepo sub-packages)
  const packageScripts = await readPackageScripts(workingDirectory);

  // Extract --resume session ID from claudeArgs so initial metadata preserves it.
  // Without this, the initial metadata overwrites the server's existing claudeSessionId
  // before the SessionStart hook has a chance to set the new one.
  const resumeIndex = options.claudeArgs?.indexOf("--resume") ?? -1;
  const resumeSessionId =
    resumeIndex >= 0 ? options.claudeArgs?.[resumeIndex + 1] : undefined;
  logger.debug(
    `[START] Resume extraction: claudeArgs=${JSON.stringify(options.claudeArgs)}, resumeIndex=${resumeIndex}, resumeSessionId=${resumeSessionId}`,
  );

  let metadata: Metadata = {
    path: workingDirectory,
    host: os.hostname(),
    version: packageJson.version,
    os: os.platform(),
    machineId: machineId,
    homeDir: os.homedir(),
    happyHomeDir: configuration.happyHomeDir,
    happyLibDir: projectPath(),
    happyToolsDir: resolve(projectPath(), "tools", "unpacked"),
    startedFromDaemon: options.startedBy === "daemon",
    hostPid: process.pid,
    startedBy: options.startedBy || "terminal",
    // Initialize lifecycle state
    lifecycleState: "running",
    lifecycleStateSince: Date.now(),
    flavor: "claude",
    sandbox: sandboxConfig?.enabled ? sandboxConfig : null,
    dangerouslySkipPermissions,
    packageScripts,
    // Preserve claudeSessionId during resume so it's not lost before SessionStart hook fires
    ...(resumeSessionId ? { claudeSessionId: resumeSessionId } : {}),
  };

  // Detect if running inside a Happy-managed worktree
  const worktreeInfo = await detectWorktreeInfo(workingDirectory);
  if (worktreeInfo) {
    metadata = {
      ...metadata,
      worktree: {
        ...worktreeInfo,
        state: "active",
        stateChangedAt: Date.now(),
      },
    };
    logger.debug(
      `[CLAUDE] Detected worktree: ${worktreeInfo.name} (branch: ${worktreeInfo.branchName}, parent: ${worktreeInfo.parentBranch})`,
    );
  }

  // Project path for server-side auto-resolve (worktree → parent repo)
  const projectPath_ = metadata.worktree?.parentRepoPath || metadata.path;

  // Session creation: reconnect to existing or create new
  let response;
  if (options.happySessionId) {
    // Try to read persisted encryption key to avoid key rotation
    const existingKey = await readSessionKey(options.happySessionId);
    logger.debug(
      `[CLAUDE] Reconnecting to existing session: ${options.happySessionId}, metadata.claudeSessionId=${metadata.claudeSessionId}, hasPersistedKey=${!!existingKey}`,
    );
    response = await api.reconnectSession({
      sessionId: options.happySessionId,
      metadata,
      state,
      machineId,
      path: projectPath_,
      existingEncryptionKey: existingKey ?? undefined,
    });
    // Persist the key if it was newly generated (no existing key found)
    if (response && !existingKey) {
      if (response.id !== options.happySessionId) {
        logger.warn(`[CLAUDE] Server returned different session ID: expected=${options.happySessionId}, got=${response.id}`);
      }
      await writeSessionKey(response.id, response.encryptionKey);
    }
  } else {
    const sessionTag = randomUUID();
    response = await api.getOrCreateSession({
      tag: sessionTag,
      metadata,
      state,
      machineId,
      path: projectPath_,
    });
    // Persist encryption key for future reconnects
    if (response) {
      await writeSessionKey(response.id, response.encryptionKey);
    }
  }

  // Handle server unreachable case - run Claude locally with hot reconnection
  // Note: connectionState.notifyOffline() was already called by api.ts with error details
  if (!response) {
    let offlineSessionId: string | null = null;

    const reconnection = startOfflineReconnection({
      serverUrl: configuration.serverUrl,
      onReconnected: async () => {
        let resp;
        if (options.happySessionId) {
          const existingKey = await readSessionKey(options.happySessionId);
          resp = await api.reconnectSession({
            sessionId: options.happySessionId,
            metadata,
            state,
            machineId,
            path: projectPath_,
            existingEncryptionKey: existingKey ?? undefined,
          });
          if (resp && !existingKey) {
            await writeSessionKey(resp.id, resp.encryptionKey);
          }
        } else {
          const sessionTag = randomUUID();
          resp = await api.getOrCreateSession({
            tag: sessionTag,
            metadata,
            state,
            machineId,
            path: projectPath_,
          });
          if (resp) {
            await writeSessionKey(resp.id, resp.encryptionKey);
          }
        }
        if (!resp) throw new Error("Server unavailable");
        const session = api.sessionSyncClient(resp);
        // On reconnect, server preserves the existing metadata blob (agent
        // state like progress / sessionSummary / summary). Merge our fresh
        // startup fields on top so this new CLI process is reflected without
        // wiping accumulated state. Local `metadata` holds only startup
        // fields, so spreading it over `existing` updates those and leaves
        // agent-driven fields untouched.
        if (options.happySessionId) {
          session.updateMetadata((existing) => ({ ...existing, ...metadata }));
        }
        const scanner = await createSessionScanner({
          sessionId: null,
          workingDirectory,
          onMessage: (msg) => session.sendClaudeSessionMessage(msg),
        });
        // In remote mode every user prompt arrives via the SDK or the
        // app channel — both of which already deliver their messages
        // to the server before they hit disk. Anything the scanner
        // finds in the JSONL at the moment it learns the session id
        // is therefore already on the server; treating it as fresh
        // (the previous behavior) replayed the whole history back to
        // the chat on reconnect. The scanner's real job is forwarding
        // *future* JSONL writes from a parallel `claude --resume`
        // terminal, which the file watcher will pick up.
        if (offlineSessionId) scanner.onNewSession(offlineSessionId, { treatExistingAsProcessed: true });
        return { session, scanner };
      },
      onNotify: (msg: string) => logger.debug(`[claude:notify] ${msg}`),
      onCleanup: () => {
        // Scanner cleanup handled automatically when process exits
      },
    });

    try {
      await claudeLocal({
        path: workingDirectory,
        sessionId: null,
        onSessionFound: (id) => {
          offlineSessionId = id;
        },
        abort: new AbortController().signal,
        claudeEnvVars: options.claudeEnvVars,
        claudeArgs: options.claudeArgs,
        mcpServers: { ...readClaudeMcpServers() },
        allowedTools: [],
        sandboxConfig,
      });
    } finally {
      reconnection.cancel();
      stopCaffeinate();
    }
    process.exit(0);
  }

  logger.debug(`Session created: ${response.id}`);

  // Always report to daemon if it exists. HAPPY_SPAWN_ID is injected by the
  // daemon at spawn time; absent when this CLI was started directly by the user.
  const spawnId = process.env.HAPPY_SPAWN_ID;
  // Start periodic heartbeat. Timer is unref'd so it won't keep the event
  // loop alive on shutdown; no explicit stop() call needed in the happy path.
  startSessionHeartbeat({ happySessionId: response.id, spawnId });
  try {
    logger.debug(
      `[START] Reporting session ${response.id} to daemon${spawnId ? ` (spawnId=${spawnId})` : ""}`,
    );
    const result = await notifyDaemonSessionStarted(response.id, metadata, spawnId);
    if (result.error) {
      logger.debug(
        `[START] Failed to report to daemon (may not be running):`,
        result.error,
      );
    } else {
      logger.debug(`[START] Reported session ${response.id} to daemon`);
    }
  } catch (error) {
    logger.debug(
      "[START] Failed to report to daemon (may not be running):",
      error,
    );
  }

  // Create realtime session FIRST (before SDK metadata extraction)
  const session = api.sessionSyncClient(response);

  // Report worktree context for server-side push notification enrichment.
  // Sent once the socket is connected (best-effort: drops silently on disconnect).
  if (worktreeInfo) {
    session.runOnConnect(() => {
      session.sessionEvent(response.id, "session_start", `Worktree: ${worktreeInfo.branchName}`, {
        branch: worktreeInfo.branchName,
        worktreePath: worktreeInfo.worktreePath,
      });
    });
  }

  // On reconnect, server preserves the existing metadata blob (agent state
  // like progress / sessionSummary / summary / tools / slashCommands).
  // Merge our fresh startup fields on top so this new CLI process is
  // reflected without wiping accumulated state across daemon restarts and
  // `npm upgrade`. Local `metadata` holds only startup fields, so spreading
  // it over `existing` updates those and leaves agent-driven fields intact.
  if (options.happySessionId) {
    session.updateMetadata((existing) => ({ ...existing, ...metadata }));
  }

  // Set initial model mode key for usage tracking (e.g., "sonnet-1m")
  session.setModelModeKey(options.model);

  // Extract SDK metadata in background and update session when ready
  extractSDKMetadataAsync(async (sdkMetadata) => {
    logger.debug(
      "[start] SDK metadata extracted, updating session:",
      sdkMetadata,
    );
    try {
      // Update session metadata with tools and slash commands
      session.updateMetadata((currentMetadata) => ({
        ...currentMetadata,
        tools: sdkMetadata.tools,
        slashCommands: sdkMetadata.slashCommands,
        slashCommandDescriptions: sdkMetadata.slashCommandDescriptions,
      }));
      logger.debug("[start] Session metadata updated with SDK capabilities");
    } catch (error) {
      logger.debug("[start] Failed to update session metadata:", error);
    }
  });

  // Start Happy MCP server
  const happyServer = await startHappyServer(session);
  logger.debug(`[START] Happy MCP server started at ${happyServer.url}`);

  // Variable to track current session instance (updated via onSessionReady callback)
  // Used by hook server to notify Session when Claude changes session ID
  let currentSession: Session | null = null;

  // Start Hook server for receiving Claude session notifications
  const hookServer = await startHookServer({
    onSessionHook: (sessionId, data) => {
      logger.debug(`[START] Session hook received: ${sessionId}`, data);

      // Update session ID in the Session instance
      if (currentSession) {
        const previousSessionId = currentSession.sessionId;
        if (previousSessionId !== sessionId) {
          logger.debug(
            `[START] Claude session ID changed: ${previousSessionId} -> ${sessionId}`,
          );
          currentSession.onSessionFound(sessionId);
        }
      }
    },
    onStopFailure: (data) => {
      // SDK always sends error as SDKAssistantMessageError string (e.g. 'billing_error')
      const errorType = data.error !== "unknown" ? (data.error ?? undefined) : undefined;
      const errorMsg = data.error_details
        ?? data.last_assistant_message
        ?? errorType
        ?? "Session stopped unexpectedly";
      logger.debug(`[START] StopFailure hook: ${errorMsg}`);
      if (currentSession) {
        currentSession.client.sendSessionEvent({
          type: "message",
          message: `StopFailure: ${errorMsg}`,
        });
        currentSession.client.updateAgentState((s) => ({
          ...s,
          stopFailure: {
            error: errorMsg,
            errorType: errorType ?? null,
            lastAssistantMessage: data.last_assistant_message ?? null,
          },
        }));
      }
    },
  });
  logger.debug(`[START] Hook server started on port ${hookServer.port}`);

  // Generate hook settings file for Claude
  const hookSettingsPath = generateHookSettingsFile(hookServer.port);
  logger.debug(`[START] Generated hook settings file: ${hookSettingsPath}`);

  // Print log file path
  const logPath = logger.logFilePath;
  logger.infoDeveloper(`Session: ${response.id}`);
  logger.infoDeveloper(`Logs: ${logPath}`);

  // Set initial agent state
  session.updateAgentState((currentState) => ({
    ...currentState,
    controlledByUser: options.startingMode !== "remote",
  }));

  // Start caffeinate to prevent sleep on macOS
  const caffeinateStarted = startCaffeinate();
  if (caffeinateStarted) {
    logger.infoDeveloper("Sleep prevention enabled (macOS)");
  }

  // Import MessageQueue2 and create message queue
  const messageQueue = new MessageQueue2<EnhancedMode>((mode) =>
    hashObject({
      permissionMode: mode.permissionMode,
      model: mode.model,
      fallbackModel: mode.fallbackModel,
      customSystemPrompt: mode.customSystemPrompt,
      appendSystemPrompt: mode.appendSystemPrompt,
      allowedTools: mode.allowedTools,
      disallowedTools: mode.disallowedTools,
      maxBudgetUsd: mode.maxBudgetUsd,
      taskBudget: mode.taskBudget,
      thinking: mode.thinking,
      effort: mode.effort,
    }),
  );

  // Forward messages to the queue
  // Permission modes: Use the unified 7-mode type, mapping happens at SDK boundary in claudeRemote.ts
  let currentPermissionMode: PermissionMode | undefined = initialPermissionMode;

  let currentModel = options.model; // Track current model state
  let currentFallbackModel: string | undefined = undefined; // Track current fallback model
  let currentCustomSystemPrompt: string | undefined = undefined; // Track current custom system prompt
  let currentAppendSystemPrompt: string | undefined = undefined; // Track current append system prompt
  let currentAllowedTools: string[] | undefined = undefined; // Track current allowed tools
  let currentDisallowedTools: string[] | undefined = undefined; // Track current disallowed tools
  let currentMaxBudgetUsd: number | undefined = undefined; // Track current budget

  // Seed per-run budget from agent loop env var so the SDK enforces it from the first query.
  const agentLoopMaxUsdPerRun = process.env.HAPPY_AGENT_LOOP_MAX_USD_PER_RUN;
  if (agentLoopMaxUsdPerRun) {
    const parsed = parseFloat(agentLoopMaxUsdPerRun);
    if (Number.isFinite(parsed) && parsed > 0) {
      currentMaxBudgetUsd = parsed;
      logger.debug(`[START] Agent loop per-run budget: $${parsed}`);
    }
  }

  // Inject initial prompt from file if env var is set (webhook-triggered sessions)
  const initialPromptFile = process.env.HAPPY_INITIAL_PROMPT_FILE;
  if (initialPromptFile) {
    try {
      const promptContent = await readFile(initialPromptFile, "utf-8");
      if (promptContent.trim()) {
        messageQueue.push(
          promptContent,
          {
            permissionMode: "bypassPermissions",
            ...(currentMaxBudgetUsd !== undefined ? { maxBudgetUsd: currentMaxBudgetUsd } : {}),
          } as EnhancedMode,
          undefined,
          { priority: "background", kind: "automation", source: "initial-prompt-file" },
        );
        logger.debug(
          `[START] Injected initial prompt from ${initialPromptFile} (${promptContent.length} chars)`,
        );
      }
      // Clean up the temp file
      await unlink(initialPromptFile);
      // Clear the env var to prevent re-reads
      delete process.env.HAPPY_INITIAL_PROMPT_FILE;
    } catch (error) {
      logger.debug(
        `[START] Failed to read initial prompt file ${initialPromptFile}: ${error}`,
      );
    }
  }
  let currentTaskBudget: { total: number } | undefined = undefined; // Track current task budget
  let currentThinking: EnhancedMode["thinking"] = undefined; // Track current thinking config
  let currentEffort: EnhancedMode["effort"] = undefined; // Track current effort level
  let currentLocale: string | undefined = undefined; // Track current locale
  session.onUserMessage((message) => {
    // Resolve permission mode from meta - pass through as-is, mapping happens at SDK boundary
    let messagePermissionMode: PermissionMode | undefined =
      currentPermissionMode;
    if (message.meta?.permissionMode) {
      messagePermissionMode = applySandboxPermissionPolicy(
        message.meta.permissionMode,
        sandboxEnabled,
      );
      currentPermissionMode = messagePermissionMode;
      logger.debug(
        `[loop] Permission mode updated from user message to: ${currentPermissionMode}`,
      );
    } else {
      logger.debug(
        `[loop] User message received with no permission mode override, using current: ${currentPermissionMode}`,
      );
    }

    // Resolve model - only update currentModel when an explicit non-null model is provided.
    // When model is null/undefined (App sends null for "default"), keep the current model
    // to preserve the initial model from CLI startup (e.g. ANTHROPIC_MODEL env var).
    let messageModel = currentModel;
    if (message.meta?.hasOwnProperty("model")) {
      if (message.meta.model) {
        // Explicit model specified — update current model
        messageModel = message.meta.model;
        currentModel = messageModel;
        session.setModelModeKey(currentModel);
        logger.debug(`[loop] Model updated from user message: ${messageModel}`);
      } else {
        // model is null/undefined — use current model (don't reset)
        logger.debug(
          `[loop] User message has null model, keeping current: ${currentModel || "default"}`,
        );
      }
    } else {
      logger.debug(
        `[loop] User message received with no model override, using current: ${currentModel || "default"}`,
      );
    }

    // Resolve custom system prompt - use message.meta.customSystemPrompt if provided, otherwise use current
    let messageCustomSystemPrompt = currentCustomSystemPrompt;
    if (message.meta?.hasOwnProperty("customSystemPrompt")) {
      messageCustomSystemPrompt = message.meta.customSystemPrompt || undefined; // null becomes undefined
      currentCustomSystemPrompt = messageCustomSystemPrompt;
      logger.debug(
        `[loop] Custom system prompt updated from user message: ${messageCustomSystemPrompt ? "set" : "reset to none"}`,
      );
    } else {
      logger.debug(
        `[loop] User message received with no custom system prompt override, using current: ${currentCustomSystemPrompt ? "set" : "none"}`,
      );
    }

    // Resolve fallback model - use message.meta.fallbackModel if provided, otherwise use current fallback model
    let messageFallbackModel = currentFallbackModel;
    if (message.meta?.hasOwnProperty("fallbackModel")) {
      messageFallbackModel = message.meta.fallbackModel || undefined; // null becomes undefined
      currentFallbackModel = messageFallbackModel;
      logger.debug(
        `[loop] Fallback model updated from user message: ${messageFallbackModel || "reset to none"}`,
      );
    } else {
      logger.debug(
        `[loop] User message received with no fallback model override, using current: ${currentFallbackModel || "none"}`,
      );
    }

    // Resolve append system prompt - use message.meta.appendSystemPrompt if provided, otherwise use current
    let messageAppendSystemPrompt = currentAppendSystemPrompt;
    if (message.meta?.hasOwnProperty("appendSystemPrompt")) {
      messageAppendSystemPrompt = message.meta.appendSystemPrompt || undefined; // null becomes undefined
      currentAppendSystemPrompt = messageAppendSystemPrompt;
      logger.debug(
        `[loop] Append system prompt updated from user message: ${messageAppendSystemPrompt ? "set" : "reset to none"}`,
      );
    } else {
      logger.debug(
        `[loop] User message received with no append system prompt override, using current: ${currentAppendSystemPrompt ? "set" : "none"}`,
      );
    }

    // Resolve allowed tools - use message.meta.allowedTools if provided, otherwise use current
    let messageAllowedTools = currentAllowedTools;
    if (message.meta?.hasOwnProperty("allowedTools")) {
      messageAllowedTools = message.meta.allowedTools || undefined; // null becomes undefined
      currentAllowedTools = messageAllowedTools;
      logger.debug(
        `[loop] Allowed tools updated from user message: ${messageAllowedTools ? messageAllowedTools.join(", ") : "reset to none"}`,
      );
    } else {
      logger.debug(
        `[loop] User message received with no allowed tools override, using current: ${currentAllowedTools ? currentAllowedTools.join(", ") : "none"}`,
      );
    }

    // Resolve disallowed tools - use message.meta.disallowedTools if provided, otherwise use current
    let messageDisallowedTools = currentDisallowedTools;
    if (message.meta?.hasOwnProperty("disallowedTools")) {
      messageDisallowedTools = message.meta.disallowedTools || undefined; // null becomes undefined
      currentDisallowedTools = messageDisallowedTools;
      logger.debug(
        `[loop] Disallowed tools updated from user message: ${messageDisallowedTools ? messageDisallowedTools.join(", ") : "reset to none"}`,
      );
    } else {
      logger.debug(
        `[loop] User message received with no disallowed tools override, using current: ${currentDisallowedTools ? currentDisallowedTools.join(", ") : "none"}`,
      );
    }

    // Resolve maxBudgetUsd
    let messageMaxBudgetUsd = currentMaxBudgetUsd;
    if (message.meta?.hasOwnProperty("maxBudgetUsd")) {
      messageMaxBudgetUsd = message.meta.maxBudgetUsd ?? undefined;
      currentMaxBudgetUsd = messageMaxBudgetUsd;
      logger.debug(
        `[loop] maxBudgetUsd updated: ${messageMaxBudgetUsd ?? "none"}`,
      );
    }

    // Resolve taskBudget
    let messageTaskBudget = currentTaskBudget;
    if (message.meta?.hasOwnProperty("taskBudget")) {
      messageTaskBudget = message.meta.taskBudget ?? undefined;
      currentTaskBudget = messageTaskBudget;
      logger.debug(
        `[loop] taskBudget updated: ${messageTaskBudget ? messageTaskBudget.total : "none"}`,
      );
    }

    // Resolve thinking
    let messageThinking = currentThinking;
    if (message.meta?.hasOwnProperty("thinking")) {
      messageThinking = message.meta.thinking ?? undefined;
      currentThinking = messageThinking;
      logger.debug(
        `[loop] thinking updated: ${messageThinking ? messageThinking.type : "none"}`,
      );
    }

    // Resolve effort (SDK 0.2.112+ natively supports 'xhigh' for Opus 4.7)
    let messageEffort = currentEffort;
    if (message.meta?.hasOwnProperty("effort")) {
      messageEffort = message.meta.effort ?? undefined;
      currentEffort = messageEffort;
      logger.debug(`[loop] effort updated: ${messageEffort ?? "none"}`);
    }

    // Resolve locale
    let messageLocale = currentLocale;
    if (message.meta?.hasOwnProperty("locale")) {
      messageLocale = message.meta.locale ?? undefined;
      currentLocale = messageLocale;
      logger.debug(`[loop] locale updated: ${messageLocale ?? "none"}`);
    }

    // Resolve continue (one-time flag, not persisted across messages)
    const messageContinue = !!message.meta?.continue;
    if (messageContinue) {
      logger.debug("[loop] continue flag detected on message");
    }

    // Resolve shouldQuery (one-time flag, defaults to true).
    // When false, the message is appended without triggering an assistant turn.
    const messageShouldQuery =
      message.meta?.shouldQuery === false ? false : undefined;
    if (messageShouldQuery === false) {
      logger.debug("[loop] shouldQuery=false — message will not trigger a turn");
    }

    // Check for special commands before processing
    const specialCommand = parseSpecialCommand(message.content.text);

    // Handle shell command ($ or ! prefix) - execute directly without going to Claude
    if (specialCommand.type === "shell" && specialCommand.shellCommand) {
      logger.debug(
        "[start] Detected $ shell command:",
        specialCommand.shellCommand,
      );

      const shellCmd = specialCommand.shellCommand;
      (async () => {
        const output = await executeShellCommand(shellCmd, workingDirectory);
        session.sendDirectResult(output);
        logger.debug("[start] Shell command executed and turn closed");
      })();

      return;
    }

    if (specialCommand.type === "compact") {
      logger.debug("[start] Detected /compact command");
      const enhancedMode: EnhancedMode = {
        permissionMode: messagePermissionMode || "default",
        model: messageModel,
        fallbackModel: messageFallbackModel,
        customSystemPrompt: messageCustomSystemPrompt,
        appendSystemPrompt: messageAppendSystemPrompt,
        allowedTools: messageAllowedTools,
        disallowedTools: messageDisallowedTools,
        maxBudgetUsd: messageMaxBudgetUsd,
        taskBudget: messageTaskBudget,
        thinking: messageThinking,
        effort: messageEffort,
        locale: messageLocale,
      };
      messageQueue.pushIsolateAndClear(
        specialCommand.originalMessage || message.content.text,
        enhancedMode,
        { priority: "urgent", kind: "isolated", source: "user" },
      );
      logger.debugLargeJson(
        "[start] /compact command pushed to queue:",
        message,
      );
      return;
    }

    if (specialCommand.type === "clear") {
      logger.debug("[start] Detected /clear command");
      const enhancedMode: EnhancedMode = {
        permissionMode: messagePermissionMode || "default",
        model: messageModel,
        fallbackModel: messageFallbackModel,
        customSystemPrompt: messageCustomSystemPrompt,
        appendSystemPrompt: messageAppendSystemPrompt,
        allowedTools: messageAllowedTools,
        disallowedTools: messageDisallowedTools,
        maxBudgetUsd: messageMaxBudgetUsd,
        taskBudget: messageTaskBudget,
        thinking: messageThinking,
        effort: messageEffort,
        locale: messageLocale,
      };
      messageQueue.pushIsolateAndClear(
        specialCommand.originalMessage || message.content.text,
        enhancedMode,
        { priority: "urgent", kind: "isolated", source: "user" },
      );
      logger.debugLargeJson(
        "[start] /compact command pushed to queue:",
        message,
      );
      return;
    }

    // Perf tracking: capture timing from socket layer (stored by ApiSessionClient before Zod strips it)
    const perfSocketReceivedAt = session.lastPerfSocketReceivedAt;
    const perfQueuedAt = Date.now();
    const socketToQueueMs = perfSocketReceivedAt
      ? perfQueuedAt - perfSocketReceivedAt
      : undefined;
    if (perfSocketReceivedAt) {
      logger.debug(`[perf] socket_received → queued: ${socketToQueueMs}ms (meta processing)`);
    }

    // Push with resolved permission mode, model, system prompts, and tools
    const enhancedMode: EnhancedMode = {
      permissionMode: messagePermissionMode || "default",
      model: messageModel,
      fallbackModel: messageFallbackModel,
      customSystemPrompt: messageCustomSystemPrompt,
      appendSystemPrompt: messageAppendSystemPrompt,
      allowedTools: messageAllowedTools,
      disallowedTools: messageDisallowedTools,
      maxBudgetUsd: messageMaxBudgetUsd,
      taskBudget: messageTaskBudget,
      thinking: messageThinking,
      effort: messageEffort,
      locale: messageLocale,
      ...(messageContinue && { continue: true }),
      ...(messageShouldQuery === false && { shouldQuery: false }),
      ...(sdkPlugins.length > 0 && { plugins: sdkPlugins }),
      ...(perfSocketReceivedAt && { _perfSocketReceivedAt: perfSocketReceivedAt }),
    };
    messageQueue.push(
      message.content.text,
      enhancedMode,
      message.localKey,
      {
        priority: "user",
        kind: messageContinue ? "continue" : "prompt",
        source: "user",
        ...(socketToQueueMs !== undefined ? { socketToQueueMs } : {}),
      },
    );
    logger.debugLargeJson("User message pushed to queue:", message);
  });

  // Register RPC handler for cancelling queued messages by localKey
  session.rpcHandlerManager.registerHandler(
    "cancelQueuedMessage",
    async (args: { localKey: string }) => {
      if (!args.localKey) {
        return { cancelled: false };
      }
      const cancelled = messageQueue.cancelByLocalKey(args.localKey);
      logger.debug(
        `[loop] cancelQueuedMessage RPC: localKey=${args.localKey}, cancelled=${cancelled}`,
      );
      return { cancelled };
    },
  );

  // Guard flag to prevent double worktree cleanup (signal handler vs normal exit)
  let worktreeCleanedUp = false;

  // Setup signal handlers for graceful shutdown
  const cleanup = async () => {
    logger.debug("[START] Received termination signal, cleaning up...");

    try {
      // Update lifecycle state to archived before closing
      if (session) {
        session.updateMetadata((currentMetadata) => ({
          ...currentMetadata,
          lifecycleState: "archived",
          lifecycleStateSince: Date.now(),
          archivedBy: "cli",
          archiveReason: "User terminated",
        }));

        // Cleanup session resources (intervals, callbacks)
        currentSession?.cleanup();

        // Cleanup worktree if applicable
        if (metadata.worktree?.isWorktree && !worktreeCleanedUp) {
          worktreeCleanedUp = true;
          const cleanupResult = await cleanupWorktreeOnSessionEnd(
            metadata.worktree as WorktreeCleanupInput,
          );
          logger.debug(
            `[WORKTREE CLEANUP] ${cleanupResult.action}: ${cleanupResult.message}`,
          );
        }

        // Send session death message
        session.sendSessionDeath();
        await session.flush();
        await session.close();
      }

      // Clean up session upload temp files
      const sid = currentSession?.sessionId;
      if (sid) {
        const safeId = sid.replace(/[^a-zA-Z0-9-]/g, "");
        const uploadDir = join(os.tmpdir(), "happy", "uploads", safeId);
        await rm(uploadDir, { recursive: true, force: true }).catch(() => {});
      }

      // Stop caffeinate
      stopCaffeinate();

      // Stop Happy MCP server
      happyServer.stop();

      // Stop Hook server and cleanup settings file
      hookServer.stop();
      cleanupHookSettingsFile(hookSettingsPath);

      logger.debug("[START] Cleanup complete, exiting");
      process.exit(0);
    } catch (error) {
      logger.debug("[START] Error during cleanup:", error);
      process.exit(1);
    }
  };

  // Handle termination signals
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  // Handle uncaught exceptions and rejections
  process.on("uncaughtException", (error) => {
    logger.debug("[START] Uncaught exception:", error);
    cleanup();
  });

  process.on("unhandledRejection", (reason) => {
    logger.debug("[START] Unhandled rejection:", reason);
    cleanup();
  });

  registerKillSessionHandler(session.rpcHandlerManager, cleanup);

  // Create claude loop
  const exitCode = await loop({
    path: workingDirectory,
    model: options.model,
    permissionMode: initialPermissionMode,
    startingMode: options.startingMode,
    messageQueue,
    api,
    allowedTools: happyServer.toolNames.map(
      (toolName) => `mcp__happy__${toolName}`,
    ),
    onModeChange: (newMode) => {
      session.sendSessionEvent({ type: "switch", mode: newMode });
      session.updateAgentState((currentState) => ({
        ...currentState,
        controlledByUser: newMode === "local",
      }));
    },
    onSessionReady: (sessionInstance) => {
      // Store reference for hook server callback
      currentSession = sessionInstance;
    },
    // Happy MCP tools (change_title, update_progress, update_session_summary) are
    // registered as SDK-native in-process servers in claudeRemoteLauncher.ts.
    // Merge user's ~/.claude/settings.json mcpServers so they are available in the session.
    mcpServers: { ...readClaudeMcpServers() },
    session,
    claudeEnvVars: options.claudeEnvVars,
    claudeArgs: options.claudeArgs,
    sandboxConfig,
    hookSettingsPath,
    jsRuntime: options.jsRuntime,
    onSessionEvent: (sessionId, eventType, summary, detail) => {
      session.sessionEvent(sessionId, eventType, summary, detail);
    },
  });

  // Cleanup session resources (intervals, callbacks) - prevents memory leak
  // Note: currentSession is set by onSessionReady callback during loop()
  (currentSession as Session | null)?.cleanup();

  // Cleanup worktree if applicable
  if (metadata.worktree?.isWorktree && !worktreeCleanedUp) {
    worktreeCleanedUp = true;
    const cleanupResult = await cleanupWorktreeOnSessionEnd(
      metadata.worktree as WorktreeCleanupInput,
    );
    logger.debug(
      `[WORKTREE CLEANUP] ${cleanupResult.action}: ${cleanupResult.message}`,
    );
  }

  // Send session death message
  session.sendSessionDeath();

  // Wait for socket to flush
  logger.debug("Waiting for socket to flush...");
  await session.flush();

  // Close session
  logger.debug("Closing session...");
  await session.close();

  // Stop caffeinate before exiting
  stopCaffeinate();
  logger.debug("Stopped sleep prevention");

  // Stop Happy MCP server
  happyServer.stop();
  logger.debug("Stopped Happy MCP server");

  // Stop Hook server and cleanup settings file
  hookServer.stop();
  cleanupHookSettingsFile(hookSettingsPath);
  logger.debug("Stopped Hook server and cleaned up settings file");

  // Exit with the code from Claude
  process.exit(exitCode);
}

/**
 * Read package.json scripts from working directory,
 * including monorepo sub-packages if workspaces are defined.
 *
 * Returns scripts keyed as:
 * - Root scripts: "scriptName" → "description"
 * - Sub-package scripts: "packageName:scriptName" → "description"
 */
async function readPackageScripts(
  workingDirectory: string,
): Promise<Record<string, string> | undefined> {
  const scripts: Record<string, string> = {};

  // Read root package.json
  let rootPkg:
    | {
        scripts?: Record<string, string>;
        workspaces?: string[] | { packages: string[] };
      }
    | undefined;
  try {
    const pkgPath = join(workingDirectory, "package.json");
    const pkgContent = await readFile(pkgPath, "utf-8");
    rootPkg = JSON.parse(pkgContent);
    if (rootPkg?.scripts && typeof rootPkg.scripts === "object") {
      for (const name of Object.keys(rootPkg.scripts)) {
        if (!name.startsWith("//")) {
          // Key = display label, Value = shell command to execute
          scripts[name] = `npm run ${name}`;
        }
      }
    }
  } catch {
    // No package.json or invalid - return undefined
    return undefined;
  }

  // Check for monorepo workspaces
  const workspacePatterns = Array.isArray(rootPkg?.workspaces)
    ? rootPkg.workspaces
    : rootPkg?.workspaces?.packages;

  if (!workspacePatterns || workspacePatterns.length === 0) {
    return Object.keys(scripts).length > 0 ? scripts : undefined;
  }

  // Resolve workspace patterns to actual package directories
  const packageDirs = await resolveWorkspacePatterns(
    workingDirectory,
    workspacePatterns,
  );

  // Read each sub-package's scripts
  const readPromises = packageDirs.map(async (dir) => {
    try {
      const pkgPath = join(dir, "package.json");
      const pkgContent = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(pkgContent);
      const pkgName = pkg.name || basename(dir);
      // Use short name: strip org scope if present (e.g., "@org/foo" → "foo")
      const shortName =
        pkgName.startsWith("@") && pkgName.includes("/")
          ? pkgName.split("/")[1]
          : pkgName;

      if (pkg.scripts && typeof pkg.scripts === "object") {
        for (const name of Object.keys(pkg.scripts)) {
          if (!name.startsWith("//")) {
            // Key = "pkg:script" display label, Value = yarn workspace command
            scripts[`${shortName}:${name}`] =
              `yarn workspace ${pkgName} ${name}`;
          }
        }
      }
    } catch {
      // Skip packages with invalid or missing package.json
    }
  });

  await Promise.all(readPromises);

  return Object.keys(scripts).length > 0 ? scripts : undefined;
}

/**
 * Resolve yarn/npm workspace glob patterns to actual directories.
 * Handles simple patterns like "packages/*" without needing a glob library.
 */
async function resolveWorkspacePatterns(
  rootDir: string,
  patterns: string[],
): Promise<string[]> {
  const dirs: string[] = [];

  for (const pattern of patterns) {
    // Handle "packages/*" style patterns (most common)
    if (pattern.endsWith("/*")) {
      const parentDir = resolve(rootDir, pattern.slice(0, -2));
      try {
        const entries = await readdir(parentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            dirs.push(join(parentDir, entry.name));
          }
        }
      } catch {
        // Directory doesn't exist - skip
      }
    } else if (pattern.includes("*")) {
      // Handle deeper globs like "packages/*/sub/*" - split at first wildcard
      const parts = pattern.split("*");
      const prefix = resolve(rootDir, parts[0]);
      try {
        const entries = await readdir(prefix, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            const subPath = join(prefix, entry.name);
            if (parts.length > 2) {
              // Nested wildcard - recurse one level
              const suffix = parts.slice(1).join("*").replace(/^\//, "");
              const subDirs = await resolveWorkspacePatterns(subPath, [suffix]);
              dirs.push(...subDirs);
            } else {
              dirs.push(subPath);
            }
          }
        }
      } catch {
        // Directory doesn't exist - skip
      }
    } else {
      // Exact path like "apps/web"
      const exactDir = resolve(rootDir, pattern);
      try {
        await readdir(exactDir);
        dirs.push(exactDir);
      } catch {
        // Directory doesn't exist - skip
      }
    }
  }

  return dirs;
}
