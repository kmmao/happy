import os from "node:os";
import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join, basename } from "node:path";

import { ApiClient } from "@/api/api";
import { logger } from "@/ui/logger";
import { loop } from "@/claude/loop";
import { AgentState, Metadata } from "@/api/types";
import packageJson from "../../package.json";
import { Credentials, readSettings } from "@/persistence";
import { EnhancedMode, PermissionMode } from "./loop";
import { MessageQueue2 } from "@/utils/MessageQueue2";
import { hashObject } from "@/utils/deterministicJson";
import { startCaffeinate, stopCaffeinate } from "@/utils/caffeinate";
import { extractSDKMetadataAsync } from "@/claude/sdk/metadataExtractor";
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { executeShellCommand } from "@/utils/shellCommand";
import { getEnvironmentInfo } from "@/ui/doctor";
import { configuration } from "@/configuration";
import { notifyDaemonSessionStarted } from "@/daemon/controlClient";
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
import { createEnvelope } from "@kmmao/happy-wire";

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
  const sessionTag = randomUUID();

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
    console.error(
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
  };
  const response = await api.getOrCreateSession({
    tag: sessionTag,
    metadata,
    state,
  });

  // Handle server unreachable case - run Claude locally with hot reconnection
  // Note: connectionState.notifyOffline() was already called by api.ts with error details
  if (!response) {
    let offlineSessionId: string | null = null;

    const reconnection = startOfflineReconnection({
      serverUrl: configuration.serverUrl,
      onReconnected: async () => {
        const resp = await api.getOrCreateSession({
          tag: randomUUID(),
          metadata,
          state,
        });
        if (!resp) throw new Error("Server unavailable");
        const session = api.sessionSyncClient(resp);
        const scanner = await createSessionScanner({
          sessionId: null,
          workingDirectory,
          onMessage: (msg) => session.sendClaudeSessionMessage(msg),
        });
        if (offlineSessionId) scanner.onNewSession(offlineSessionId);
        return { session, scanner };
      },
      onNotify: console.log,
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
        onThinkingChange: () => {},
        abort: new AbortController().signal,
        claudeEnvVars: options.claudeEnvVars,
        claudeArgs: options.claudeArgs,
        mcpServers: {},
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

  // Always report to daemon if it exists
  try {
    logger.debug(`[START] Reporting session ${response.id} to daemon`);
    const result = await notifyDaemonSessionStarted(response.id, metadata);
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
      isPlan: mode.permissionMode === "plan",
      model: mode.model,
      fallbackModel: mode.fallbackModel,
      customSystemPrompt: mode.customSystemPrompt,
      appendSystemPrompt: mode.appendSystemPrompt,
      allowedTools: mode.allowedTools,
      disallowedTools: mode.disallowedTools,
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
  let currentAutoApprovePlan = false; // Track auto-approve plan setting
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

    // Resolve auto-approve plan setting
    let messageAutoApprovePlan = currentAutoApprovePlan;
    if (message.meta?.hasOwnProperty("autoApprovePlan")) {
      messageAutoApprovePlan = !!message.meta.autoApprovePlan;
      currentAutoApprovePlan = messageAutoApprovePlan;
      logger.debug(
        `[loop] Auto-approve plan updated from user message: ${messageAutoApprovePlan}`,
      );
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
        const envelope = createEnvelope("agent", { t: "text", text: output });
        session.sendSessionProtocolMessage(envelope);
        logger.debug("[start] Shell command executed");
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
        autoApprovePlan: messageAutoApprovePlan,
      };
      messageQueue.pushIsolateAndClear(
        specialCommand.originalMessage || message.content.text,
        enhancedMode,
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
        autoApprovePlan: messageAutoApprovePlan,
      };
      messageQueue.pushIsolateAndClear(
        specialCommand.originalMessage || message.content.text,
        enhancedMode,
      );
      logger.debugLargeJson(
        "[start] /compact command pushed to queue:",
        message,
      );
      return;
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
      autoApprovePlan: messageAutoApprovePlan,
    };
    messageQueue.push(message.content.text, enhancedMode);
    logger.debugLargeJson("User message pushed to queue:", message);
  });

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
    mcpServers: {
      happy: {
        type: "http" as const,
        url: happyServer.url,
      },
    },
    session,
    claudeEnvVars: options.claudeEnvVars,
    claudeArgs: options.claudeArgs,
    sandboxConfig,
    hookSettingsPath,
    jsRuntime: options.jsRuntime,
  });

  // Cleanup session resources (intervals, callbacks) - prevents memory leak
  // Note: currentSession is set by onSessionReady callback during loop()
  (currentSession as Session | null)?.cleanup();

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
