import { render } from "ink";
import React from "react";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ApiClient } from "@/api/api";
import { normalizeHappyMcpToolName } from "@kmmao/happy-wire";
import {
  CodexMcpClient,
  getInstalledCodexVersion,
  supportsCodexAppServer,
} from "./codexMcpClient";
import { CodexAppServerClient } from "@/codex-app/CodexAppServerClient";
import { CodexPermissionHandler } from "./utils/permissionHandler";
import { ReasoningProcessor } from "./utils/reasoningProcessor";
import { DiffProcessor } from "./utils/diffProcessor";
import { logger } from "@/ui/logger";
import {
  Credentials,
  readSessionKey,
  readSettings,
  writeSessionKey,
} from "@/persistence";
import { initialMachineMetadata } from "@/daemon/run";
import { configuration } from "@/configuration";
import packageJson from "../../package.json";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { MessageQueue2 } from "@/utils/MessageQueue2";
import { projectPath } from "@/projectPath";
import { resolve, join } from "node:path";
import {
  createSessionMetadata,
  enrichMetadataWithWorktree,
} from "@/utils/createSessionMetadata";
import {
  cleanupWorktreeOnSessionEnd,
  type WorktreeCleanupInput,
} from "@/utils/worktreeCleanup";
import fs from "node:fs";
import { startHappyServer } from "@/claude/utils/startHappyServer";
import { MessageBuffer } from "@/ui/ink/messageBuffer";
import { CodexDisplay } from "@/ui/ink/CodexDisplay";
import { trimIdent } from "@/utils/trimIdent";
import type { CodexSessionConfig, CodexToolResponse } from "./types";
import { CHANGE_TITLE_INSTRUCTION } from "@/gemini/constants";
import { notifyDaemonSessionStarted } from "@/daemon/controlClient";
import { registerKillSessionHandler } from "@/claude/registerKillSessionHandler";
import { delay } from "@/utils/time";
import { stopCaffeinate } from "@/utils/caffeinate";
import { connectionState } from "@/utils/serverConnectionErrors";
import { setupOfflineReconnection } from "@/utils/setupOfflineReconnection";
import type { ApiSessionClient } from "@/api/apiSession";
import { resolveCodexExecutionPolicy } from "./executionPolicy";
import {
  resolveRequestedCodexBackend,
  shouldFallbackToLegacyCodex,
  type RequestedCodexBackend,
  type ResolvedCodexBackend,
} from "@/codex-shared/backendSelection";
import {
  LOCKED_CODEX_MODEL,
  resolveCodexRuntimeConfigFromEnv,
} from "@/codex-shared/configResolution";
import {
  mapCodexMcpMessageToSessionEnvelopes,
  mapCodexProcessorMessageToSessionEnvelopes,
} from "./utils/sessionProtocolMapper";
import { collectCodexLocalSurface } from "./localSurface";
import { resolveCodexResumeThreadId } from "./utils/resolveCodexResumeThreadId";
import {
  buildCodexContextUsage,
  codexBreakdownToUsage,
  extractCodexTokenUsageSnapshot,
  getCodexTokenUsageSignature,
} from "./utils/tokenUsage";
import { createEnvelope } from "@kmmao/happy-wire";
import { codexBaseInstructions } from "./baseInstructions";
import {
  hashCodexMode,
  resolveCodexMessageMode,
  type CodexMessageMode,
} from "./messageMode";
import {
  buildAutoProgressSyntheticPrompt,
  buildAutoSummarySyntheticPrompt,
  HAPPY_AUTO_PROGRESS_SOURCE,
  HAPPY_AUTO_SUMMARY_SOURCE,
  isHappyAutomationSource,
  isHappyProgressToolName,
  isHappySummaryToolName,
  shouldTriggerCodexAutoProgress,
} from "@/utils/progressAutomation";
import { hasLegacyCodexPlanPreview } from "@/utils/legacyCodexPlanPreview";
import {
  appendCodexToolCallIdToPlanList,
  mirrorCodexPlanToProgress,
} from "./utils/codexPlanProgress";

type ReadyEventOptions = {
  pending: unknown;
  queueSize: () => number;
  shouldExit: boolean;
  sendReady: () => void;
  notify?: () => void;
};

type CodexControlHandlerRegistrar = Pick<
  ApiSessionClient["rpcHandlerManager"],
  "registerHandler"
>;

type CodexTurnAutomationState = {
  sawPlanUpdate: boolean;
  sawFileChanges: boolean;
  sawDiffUpdate: boolean;
  wroteProgress: boolean;
  wroteSummary: boolean;
};

function createCodexTurnAutomationState(): CodexTurnAutomationState {
  return {
    sawPlanUpdate: false,
    sawFileChanges: false,
    sawDiffUpdate: false,
    wroteProgress: false,
    wroteSummary: false,
  };
}

function pickToolNameFromCodexMessage(message: Record<string, unknown>): string | null {
  const topLevelCandidates = [
    message.name,
    message.toolName,
    message.tool,
    message.tool_name,
  ];
  for (const candidate of topLevelCandidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  const nestedArgs = [message.input, message.args, message.arguments];
  for (const candidate of nestedArgs) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const nestedCandidates = [
      record.toolName,
      record.requestedToolName,
      record.tool,
      record.tool_name,
      record.name,
    ];
    for (const nested of nestedCandidates) {
      if (typeof nested === "string" && nested.length > 0) {
        return nested;
      }
    }
  }
  return null;
}

/**
 * Notify connected clients when Codex finishes processing and the queue is idle.
 * Returns true when a ready event was emitted.
 */
export function emitReadyIfIdle({
  pending,
  queueSize,
  shouldExit,
  sendReady,
  notify,
}: ReadyEventOptions): boolean {
  if (shouldExit) {
    return false;
  }
  if (pending) {
    return false;
  }
  if (queueSize() > 0) {
    return false;
  }

  sendReady();
  notify?.();
  return true;
}


export function extractCodexResponseText(response: CodexToolResponse): string {
  return response.content
    .filter(
      (item): item is CodexToolResponse["content"][number] & { text: string } =>
        item.type === "text" && typeof item.text === "string",
    )
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function registerCodexControlHandlers({
  rpcHandlerManager,
  handleAbort,
}: {
  rpcHandlerManager: CodexControlHandlerRegistrar;
  handleAbort: () => Promise<void> | void;
}): void {
  rpcHandlerManager.registerHandler("abort", handleAbort);
  rpcHandlerManager.registerHandler("interrupt", handleAbort);
}

function requireSuccessfulCodexResponse(
  response: CodexToolResponse,
  action: "start" | "continue",
): CodexToolResponse {
  if (!response.isError) {
    return response;
  }

  const message = extractCodexResponseText(response);
  throw new Error(message || `Codex ${action} session failed`);
}

function mergeNamedEntries<T extends { name: string }>(
  current: readonly T[] | undefined,
  next: readonly T[] | undefined,
): T[] | undefined {
  if ((!current || current.length === 0) && (!next || next.length === 0)) {
    return undefined;
  }

  const merged = new Map<string, T>();
  for (const item of current ?? []) {
    merged.set(item.name, item);
  }
  for (const item of next ?? []) {
    merged.set(item.name, item);
  }

  return [...merged.values()];
}

/**
 * Main entry point for the codex command with ink UI
 */
export async function runCodex(opts: {
  credentials: Credentials;
  startedBy?: "daemon" | "terminal";
  noSandbox?: boolean;
  happySessionId?: string;
}): Promise<void> {
  //
  // Define session
  //

  // Set backend for offline warnings (before any API calls)
  connectionState.setBackend("Codex");

  const api = await ApiClient.create(opts.credentials);
  const loadOpenAiAuthTokens = async (): Promise<{
    accessToken: string;
    chatgptAccountId: string;
    chatgptPlanType?: string | null;
  } | null> => {
    const vendorToken = await api.getVendorToken("openai");
    if (
      vendorToken?.oauth?.access_token &&
      vendorToken?.oauth?.account_id
    ) {
      return {
        accessToken: vendorToken.oauth.access_token,
        chatgptAccountId: vendorToken.oauth.account_id,
        chatgptPlanType: null,
      };
    }
    return null;
  };

  // Log startup options
  logger.debug(
    `[codex] Starting with options: startedBy=${opts.startedBy || "terminal"}`,
  );

  //
  // Machine
  //

  const settings = await readSettings();
  let machineId = settings?.machineId;
  const sandboxConfig = opts.noSandbox ? undefined : settings?.sandboxConfig;
  const existingSessionKey = opts.happySessionId
    ? await readSessionKey(opts.happySessionId)
    : null;
  const existingHappySession = opts.happySessionId
    ? await api.getSessionById({
        sessionId: opts.happySessionId,
        existingEncryptionKey: existingSessionKey ?? undefined,
      })
    : null;
  const runtimeConfig = resolveCodexRuntimeConfigFromEnv();
  const requestedBackendBase: RequestedCodexBackend =
    resolveRequestedCodexBackend();
  const requestedBackend: RequestedCodexBackend =
    requestedBackendBase === "auto"
      ? (existingHappySession?.metadata.codex?.resolvedBackend ??
          existingHappySession?.metadata.codex?.requestedBackend ??
          requestedBackendBase)
      : requestedBackendBase;
  if (!machineId) {
    logger.warn(
      `[START] No machine ID found in settings, which is unexpected since authAndSetupMachineIfNeeded should have created it. Please report this issue on https://github.com/slopus/happy-cli/issues`,
    );
    process.exit(1);
  }
  logger.debug(`Using machineId: ${machineId}`);

  const sessionTag = randomUUID();

  await api.getOrCreateMachine({
    machineId,
    metadata: initialMachineMetadata,
  });

  //
  // Create session
  //

  const { state, metadata: rawMetadata } = createSessionMetadata({
    flavor: "codex",
    machineId,
    startedBy: opts.startedBy,
    sandbox: sandboxConfig,
  });
  const localSurface = await collectCodexLocalSurface({
    cwd: process.cwd(),
  });
  rawMetadata.slashCommands = localSurface.slashCommands;
  if (Object.keys(localSurface.slashCommandDescriptions).length > 0) {
    rawMetadata.slashCommandDescriptions =
      localSurface.slashCommandDescriptions;
  }
  rawMetadata.codex = {
    ...rawMetadata.codex,
    requestedBackend,
    ...((requestedBackend === "codex-mcp-legacy" ||
      (requestedBackend === "auto" && !supportsCodexAppServer()))
      ? { resolvedBackend: "codex-mcp-legacy" as const }
      : requestedBackend === "codex-app-server" ||
          (requestedBackend === "auto" && supportsCodexAppServer())
        ? { resolvedBackend: "codex-app-server" as const }
        : {}),
    configMode: runtimeConfig.configMode,
    ...(runtimeConfig.profileName
      ? {
          config: {
            ...(rawMetadata.codex?.config ?? {}),
            profile: runtimeConfig.profileName,
          },
        }
      : {}),
    ...(localSurface.prompts.length > 0
      ? {
          prompts: localSurface.prompts,
        }
      : {}),
    ...(localSurface.skills.length > 0
      ? {
          skills: localSurface.skills,
        }
      : {}),
    ...(localSurface.agents.length > 0
      ? {
          agents: localSurface.agents,
        }
      : {}),
  };
  const installedCodexVersion = getInstalledCodexVersion();
  const metadata = await enrichMetadataWithWorktree({
    ...rawMetadata,
    codex: {
      ...rawMetadata.codex,
      ...(installedCodexVersion
        ? { backendVersion: installedCodexVersion }
        : {}),
    },
  });
  const projectPath_ = metadata.worktree?.parentRepoPath || metadata.path;
  const response = opts.happySessionId
    ? await api.reconnectSession({
        sessionId: opts.happySessionId,
        metadata,
        state,
        machineId,
        path: projectPath_,
        existingEncryptionKey: existingSessionKey ?? undefined,
      })
    : await api.getOrCreateSession({
        tag: sessionTag,
        metadata,
        state,
        machineId,
        path: projectPath_,
      });
  // Persist encryption key for future reconnects
  if (response && (!opts.happySessionId || !existingSessionKey)) {
    await writeSessionKey(response.id, response.encryptionKey);
  }

  // Handle server unreachable case - create offline stub with hot reconnection
  let session: ApiSessionClient;
  // Permission handler declared here so it can be updated in onSessionSwap callback
  // (assigned later at line ~385 after client setup)
  let permissionHandler: CodexPermissionHandler;
  const { session: initialSession, reconnectionHandle } =
    setupOfflineReconnection({
      api,
      sessionTag,
      metadata,
      state,
      response,
      machineId,
      path: projectPath_,
      happySessionId: opts.happySessionId,
      existingEncryptionKey: existingSessionKey ?? undefined,
      onSessionSwap: (newSession) => {
        session = newSession;
        // Update permission handler with new session to avoid stale reference
        if (permissionHandler) {
          permissionHandler.updateSession(newSession);
        }
      },
    });
  session = initialSession;

  // Always report to daemon if it exists (skip if offline)
  if (response) {
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
  }

  const messageQueue = new MessageQueue2<CodexMessageMode>((mode) =>
    hashCodexMode(mode),
  );

  // Track current overrides to apply per message
  // Use shared PermissionMode type from api/types for cross-agent compatibility
  let currentPermissionMode: import("@/api/types").PermissionMode | undefined =
    undefined;
  let currentModel: string | undefined = undefined;
  let currentReasoningEffort:
    | NonNullable<import("@/api/types").MessageMeta["effort"]>
    | undefined = undefined;
  session.onUserMessage((message) => {
    const perfSocketReceivedAt = session.lastPerfSocketReceivedAt;
    const perfQueuedAt = Date.now();
    const socketToQueueMs = perfSocketReceivedAt
      ? perfQueuedAt - perfSocketReceivedAt
      : undefined;
    const sentFrom =
      typeof message.meta?.sentFrom === "string" &&
      message.meta.sentFrom.length > 0
        ? message.meta.sentFrom
        : "user";
    const resolvedMode = resolveCodexMessageMode({
      current: {
        permissionMode: currentPermissionMode,
        model: currentModel,
        reasoningEffort: currentReasoningEffort,
      },
      meta: message.meta,
    });
    currentPermissionMode = resolvedMode.next.permissionMode;
    currentModel = resolvedMode.next.model;
    currentReasoningEffort = resolvedMode.next.reasoningEffort;

    if (message.meta?.permissionMode) {
      if (permissionHandler) {
        permissionHandler.setPermissionMode(resolvedMode.mode.permissionMode);
      }
      logger.debug(
        `[Codex] Permission mode updated from user message to: ${currentPermissionMode}`,
      );
    } else {
      if (permissionHandler) {
        permissionHandler.setPermissionMode(resolvedMode.mode.permissionMode);
      }
      logger.debug(
        `[Codex] User message received with no permission mode override, using current: ${currentPermissionMode ?? "default (effective)"}`,
      );
    }

    if (message.meta?.hasOwnProperty("model")) {
      logger.debug(
        `[Codex] Model updated from user message: ${resolvedMode.mode.model || "reset to default"}`,
      );
    } else {
      logger.debug(
        `[Codex] User message received with no model override, using current: ${currentModel || "default"}`,
      );
    }

    if (message.meta?.hasOwnProperty("effort")) {
      logger.debug(
        `[Codex] Reasoning effort updated from user message: ${resolvedMode.mode.reasoningEffort || "reset to default"}`,
      );
    } else {
      logger.debug(
        `[Codex] User message received with no reasoning effort override, using current: ${currentReasoningEffort || "default"}`,
      );
    }

    messageQueue.push(message.content.text, resolvedMode.mode, message.localKey, {
      priority: isHappyAutomationSource(sentFrom) ? "background" : "user",
      kind: "prompt",
      source: sentFrom,
      ...(socketToQueueMs !== undefined ? { socketToQueueMs } : {}),
    });
  });
  let thinking = false;
  let currentTurnId: string | null = null;
  let currentTurnPromptSource: string | null = null;
  let currentTurnAutomation = createCodexTurnAutomationState();
  let codexStartedSubagents = new Set<string>();
  let codexActiveSubagents = new Set<string>();
  let codexProviderSubagentToSessionSubagent = new Map<string, string>();
  let lastCodexTokenUsageSignature: string | null = null;
  session.keepAlive(thinking, "remote");
  // Periodic keep-alive; store handle so we can clear on exit
  const keepAliveInterval = setInterval(() => {
    session.keepAlive(thinking, "remote");
  }, 2000);

  const sendReady = () => {
    session.sendSessionEvent({ type: "ready" });
    try {
      api
        .push()
        .sendToAllDevices("It's ready!", "Codex is waiting for your command", {
          sessionId: session.sessionId,
        });
    } catch (pushError) {
      logger.debug("[Codex] Failed to send ready push", pushError);
    }
  };

  // Debug helper: log active handles/requests if DEBUG is enabled
  function logActiveHandles(tag: string) {
    if (!process.env.DEBUG) return;
    const anyProc: any = process as any;
    const handles =
      typeof anyProc._getActiveHandles === "function"
        ? anyProc._getActiveHandles()
        : [];
    const requests =
      typeof anyProc._getActiveRequests === "function"
        ? anyProc._getActiveRequests()
        : [];
    logger.debug(
      `[codex][handles] ${tag}: handles=${handles.length} requests=${requests.length}`,
    );
    try {
      const kinds = handles.map((h: any) =>
        h && h.constructor ? h.constructor.name : typeof h,
      );
      logger.debug(`[codex][handles] kinds=${JSON.stringify(kinds)}`);
    } catch {}
  }

  //
  // Abort handling
  // IMPORTANT: There are two different operations:
  // 1. Abort (handleAbort): Stops the current inference/task but keeps the session alive
  //    - Used by the 'abort' RPC from mobile app
  //    - Similar to Claude Code's abort behavior
  //    - Allows continuing with new prompts after aborting
  // 2. Kill (handleKillSession): Terminates the entire process
  //    - Used by the 'killSession' RPC
  //    - Completely exits the CLI process
  //

  let abortController = new AbortController();
  let shouldExit = false;
  let storedSessionIdForResume: string | null = null;

  /**
   * Handles aborting the current task/inference without exiting the process.
   * This is the equivalent of Claude Code's abort - it stops what's currently
   * happening but keeps the session alive for new prompts.
   */
  async function handleAbort() {
    logger.debug("[Codex] Abort requested - stopping current task");
    try {
      // Store the current session ID before aborting for potential resume
      if (client?.hasActiveSession()) {
        storedSessionIdForResume = client.storeSessionForResume();
        logger.debug(
          "[Codex] Stored session for resume:",
          storedSessionIdForResume,
        );
      }

      abortController.abort();
      reasoningProcessor.abort();
      logger.debug("[Codex] Abort completed - session remains active");
    } catch (error) {
      logger.debug("[Codex] Error during abort:", error);
    } finally {
      abortController = new AbortController();
    }
  }

  /**
   * Handles session termination and process exit.
   * This is called when the session needs to be completely killed (not just aborted).
   * Abort stops the current inference but keeps the session alive.
   * Kill terminates the entire process.
   */
  // Guard flag to prevent double worktree cleanup (signal handler vs normal exit)
  let worktreeCleanedUp = false;

  const handleKillSession = async () => {
    logger.debug("[Codex] Kill session requested - terminating process");
    await handleAbort();
    logger.debug("[Codex] Abort completed, proceeding with termination");

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

      // Force close Codex transport (best-effort) so we don't leave stray processes
      try {
        await client?.forceCloseSession();
      } catch (e) {
        logger.debug(
          "[Codex] Error while force closing Codex session during termination",
          e,
        );
      }

      // Stop caffeinate
      stopCaffeinate();

      // Stop Happy MCP server
      happyServer.stop();

      logger.debug("[Codex] Session termination complete, exiting");
      process.exit(0);
    } catch (error) {
      logger.debug("[Codex] Error during session termination:", error);
      process.exit(1);
    }
  };

  registerCodexControlHandlers({
    rpcHandlerManager: session.rpcHandlerManager,
    handleAbort,
  });

  registerKillSessionHandler(session.rpcHandlerManager, handleKillSession);

  //
  // Initialize Ink UI
  //

  const messageBuffer = new MessageBuffer();
  const hasTTY = process.stdout.isTTY && process.stdin.isTTY;
  let inkInstance: any = null;

  if (hasTTY) {
    console.clear();
    inkInstance = render(
      React.createElement(CodexDisplay, {
        messageBuffer,
        logPath: process.env.DEBUG ? logger.getLogPath() : undefined,
        onExit: async () => {
          // Exit the agent
          logger.debug("[codex]: Exiting agent via Ctrl-C");
          shouldExit = true;
          await handleAbort();
        },
      }),
      {
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
  }

  if (hasTTY) {
    process.stdin.resume();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding("utf8");
  }

  //
  // Start Context
  //

  type CodexRuntimeClient = CodexMcpClient | CodexAppServerClient;
  let client: CodexRuntimeClient | null = null;

  // Helper: find Codex session transcript for a given sessionId
  function findCodexResumeFile(sessionId: string | null): string | null {
    if (!sessionId) return null;
    try {
      const codexHomeDir =
        process.env.CODEX_HOME || join(os.homedir(), ".codex");
      const rootDir = join(codexHomeDir, "sessions");

      // Recursively collect all files under the sessions directory
      function collectFilesRecursive(
        dir: string,
        acc: string[] = [],
      ): string[] {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return acc;
        }
        for (const entry of entries) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            collectFilesRecursive(full, acc);
          } else if (entry.isFile()) {
            acc.push(full);
          }
        }
        return acc;
      }

      const candidates = collectFilesRecursive(rootDir)
        .filter((full) => full.endsWith(`-${sessionId}.jsonl`))
        .map((full) => {
          try {
            return { path: full, mtimeMs: fs.statSync(full).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter(
          (entry): entry is { path: string; mtimeMs: number } => entry !== null,
        )
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      return candidates[0]?.path || null;
    } catch {
      return null;
    }
  }
  permissionHandler = new CodexPermissionHandler(session);
  permissionHandler.setPermissionMode(currentPermissionMode ?? "default");
  const pendingElicitations = new Map<
    string,
    {
      resolve: (result: { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> }) => void;
      reject: (error: Error) => void;
    }
  >();
  let elicitationCounter = 0;
  session.rpcHandlerManager.registerHandler(
    "elicitationResponse",
    async (response: { id: string; action: string; content?: Record<string, unknown> }) => {
      const pendingItem = pendingElicitations.get(response.id);
      if (!pendingItem) {
        logger.debug(`[Codex] Elicitation response for unknown id ${response.id}`);
        return;
      }
      const validActions = ["accept", "decline", "cancel"] as const;
      if (!validActions.includes(response.action as (typeof validActions)[number])) {
        logger.debug(`[Codex] Invalid elicitation action: ${response.action}`);
        return;
      }
      pendingElicitations.delete(response.id);
      session.updateAgentState((currentState) => ({ ...currentState, elicitation: null }));
      pendingItem.resolve({
        action: response.action as "accept" | "decline" | "cancel",
        content: response.content,
      });
    },
  );
  const handleElicitation = async (
    request: {
      serverName: string;
      message: string;
      mode: "form" | "url";
      url?: string | null;
      requestedSchema?: Record<string, unknown> | null;
    },
    options: { signal: AbortSignal },
  ): Promise<{ action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> }> => {
    const id = `elicit-${++elicitationCounter}`;

    return new Promise((resolve, reject) => {
      const abortHandler = () => {
        pendingElicitations.delete(id);
        session.updateAgentState((currentState) => ({ ...currentState, elicitation: null }));
        reject(new Error("Elicitation aborted"));
      };
      options.signal.addEventListener("abort", abortHandler, { once: true });

      pendingElicitations.set(id, {
        resolve: (result) => {
          options.signal.removeEventListener("abort", abortHandler);
          resolve(result);
        },
        reject: (error) => {
          options.signal.removeEventListener("abort", abortHandler);
          reject(error);
        },
      });

      session.updateAgentState((currentState) => ({
        ...currentState,
        elicitation: {
          id,
          serverName: request.serverName,
          message: request.message,
          mode: request.mode,
          url: request.url,
          requestedSchema: request.requestedSchema,
        },
      }));

      void api
        .push()
        .sendToAllDevices("Codex Input Required", request.message, {
          sessionId: session.sessionId,
          type: "elicitation_request",
        });
    });
  };
  const reasoningProcessor = new ReasoningProcessor((message) => {
    const envelopes = mapCodexProcessorMessageToSessionEnvelopes(message, {
      currentTurnId,
    });
    for (const envelope of envelopes) {
      session.sendSessionProtocolMessage(envelope);
    }
  });
  const diffProcessor = new DiffProcessor((message) => {
    const envelopes = mapCodexProcessorMessageToSessionEnvelopes(message, {
      currentTurnId,
    });
    for (const envelope of envelopes) {
      session.sendSessionProtocolMessage(envelope);
    }
  });
  const emitCodexTokenUsage = (message: Record<string, unknown>) => {
    const snapshot = extractCodexTokenUsageSnapshot(message);
    if (!snapshot) {
      return false;
    }

    const signature = getCodexTokenUsageSignature(snapshot);
    if (signature === lastCodexTokenUsageSignature) {
      return true;
    }
    lastCodexTokenUsageSignature = signature;

    const usage = codexBreakdownToUsage(snapshot.last);
    const turnId = snapshot.turnId ?? currentTurnId ?? undefined;
    if (usage) {
      session.sendSessionProtocolMessage(
        createEnvelope(
          "agent",
          {
            t: "usage-update",
            usage,
          },
          turnId ? { turn: turnId } : {},
        ),
      );
      session.sendProviderUsageData("codex-session", usage);
    }

    const contextUsage = buildCodexContextUsage(
      snapshot,
      currentModel ?? LOCKED_CODEX_MODEL,
    );
    if (contextUsage) {
      session.sendSessionProtocolMessage(
        createEnvelope(
          "agent",
          {
            t: "context-usage",
            ...contextUsage,
          },
          turnId ? { turn: turnId } : {},
        ),
      );
    }

    return true;
  };
  const onClientMessage = (msg: any) => {
    logger.debug(`[Codex] MCP message: ${JSON.stringify(msg)}`);

    const applyCapabilitiesToMetadata = (
      capabilities: {
        models?: Array<{
          model: string;
          displayName: string;
          description: string;
          supportedReasoningEfforts: Array<{ value: string; label: string }>;
        }>;
        config?: Record<string, unknown> | null;
        account?: Record<string, unknown> | null;
        rateLimits?: Record<string, unknown> | null;
        experimentalFeatures?: Array<Record<string, unknown>>;
        skills?: Array<Record<string, unknown>>;
        mcpServers?: Array<Record<string, unknown>>;
      } | null,
    ) => {
      if (!capabilities) {
        return;
      }
      session.updateMetadata((currentMetadata) => ({
        ...currentMetadata,
        codex: {
          ...currentMetadata.codex,
          ...(capabilities.config ? { config: capabilities.config as any } : {}),
          ...(capabilities.account ? { account: capabilities.account as any } : {}),
          ...(capabilities.rateLimits ? { rateLimits: capabilities.rateLimits as any } : {}),
          ...(capabilities.experimentalFeatures &&
          capabilities.experimentalFeatures.length > 0
            ? { experimentalFeatures: capabilities.experimentalFeatures as any }
            : {}),
          ...(capabilities.skills && capabilities.skills.length > 0
            ? {
                skills: mergeNamedEntries(
                  currentMetadata.codex?.skills as any,
                  capabilities.skills as any,
                ),
              }
            : {}),
          ...(capabilities.mcpServers && capabilities.mcpServers.length > 0
            ? {
                mcpServers: mergeNamedEntries(
                  currentMetadata.codex?.mcpServers as any,
                  capabilities.mcpServers as any,
                ),
              }
            : {}),
        },
        ...(capabilities.models && capabilities.models.length > 0
          ? {
              models: capabilities.models.map((model) => ({
                code: model.model,
                value: model.displayName,
                description: model.description,
                supportsEffort: model.supportedReasoningEfforts.length > 0,
                supportedEffortLevels: model.supportedReasoningEfforts.map(
                  (effort) => effort.value,
                ),
              })),
            }
          : {}),
      }));
    };

    if (msg.type === "metadata_refresh") {
      applyCapabilitiesToMetadata(msg.capabilities ?? null);
      return;
    }

    if (msg.type === "metadata_patch") {
      session.updateMetadata((currentMetadata) => ({
        ...currentMetadata,
        ...(msg.patch ?? {}),
      }));
      return;
    }

    if (msg.type === "token_count") {
      emitCodexTokenUsage(msg as Record<string, unknown>);
      return;
    }

    let shouldSendReady = false;

    // Add messages to the ink UI buffer based on message type
    if (msg.type === "agent_message") {
      messageBuffer.addMessage(msg.message, "assistant");
      if (
        typeof msg.message === "string" &&
        hasLegacyCodexPlanPreview(msg.message)
      ) {
        currentTurnAutomation = {
          ...currentTurnAutomation,
          sawPlanUpdate: true,
        };
      }
    } else if (msg.type === "service_message") {
      messageBuffer.addMessage(msg.text, "system");
    } else if (msg.type === "agent_reasoning_delta") {
      // Skip reasoning deltas in the UI to reduce noise
    } else if (msg.type === "agent_reasoning") {
      messageBuffer.addMessage(
        `[Thinking] ${msg.text.substring(0, 100)}...`,
        "system",
      );
    } else if (msg.type === "exec_command_begin") {
      messageBuffer.addMessage(`Executing: ${msg.command}`, "tool");
    } else if (msg.type === "exec_command_end") {
      const output = msg.output || msg.error || "Command completed";
      const truncatedOutput = output.substring(0, 200);
      messageBuffer.addMessage(
        `Result: ${truncatedOutput}${output.length > 200 ? "..." : ""}`,
        "result",
      );
    } else if (msg.type === "task_started") {
      messageBuffer.addMessage("Starting task...", "status");
    } else if (msg.type === "task_complete") {
      messageBuffer.addMessage("Task completed", "status");
      shouldSendReady = true;
    } else if (msg.type === "turn_aborted") {
      messageBuffer.addMessage("Turn aborted", "status");
      shouldSendReady = true;
    }

    if (msg.type === "task_started") {
      currentTurnAutomation = createCodexTurnAutomationState();
      if (!thinking) {
        logger.debug("thinking started");
        thinking = true;
        session.keepAlive(thinking, "remote");
      }
    }
    if (msg.type === "task_complete" || msg.type === "turn_aborted") {
      if (thinking) {
        logger.debug("thinking completed");
        thinking = false;
        session.keepAlive(thinking, "remote");
      }
      // Reset diff processor on task end or abort
      diffProcessor.reset();
    }
    if (msg.type === "agent_reasoning_section_break") {
      // Reset reasoning processor for new section
      reasoningProcessor.handleSectionBreak();
    }
    if (msg.type === "agent_reasoning_delta") {
      // Process reasoning delta - tool calls are sent automatically via callback
      reasoningProcessor.processDelta(msg.delta);
    }
    if (msg.type === "agent_reasoning") {
      // Complete the reasoning section - tool results or reasoning messages sent via callback
      reasoningProcessor.complete(msg.text);
    }
    if (msg.type === "turn_plan_updated") {
      if (typeof msg.turnId === "string" && msg.turnId.length > 0) {
        let mirroredWroteProgress = false;
        let mirroredShouldTriggerAutoSummary = false;
        session.updateMetadata((currentMetadata) => {
          const mirrored = mirrorCodexPlanToProgress(currentMetadata, {
            turnId: msg.turnId,
            plan: Array.isArray(msg.plan) ? msg.plan : [],
          });
          mirroredWroteProgress = mirrored.wroteProgress;
          mirroredShouldTriggerAutoSummary =
            mirrored.shouldTriggerAutoSummary;
          return mirrored.metadata;
        });
        if (mirroredWroteProgress) {
          currentTurnAutomation = {
            ...currentTurnAutomation,
            wroteProgress: true,
          };
        }
        if (mirroredShouldTriggerAutoSummary) {
          try {
            session.sendSyntheticUserMessage(buildAutoSummarySyntheticPrompt(), {
              displayText: "",
              sentFrom: HAPPY_AUTO_SUMMARY_SOURCE,
            });
            logger.debug("[Codex] auto-summary trigger dispatched");
          } catch (error) {
            logger.debug(`[Codex] auto-summary trigger failed: ${error}`);
          }
        }
      }
      currentTurnAutomation = {
        ...currentTurnAutomation,
        sawPlanUpdate: true,
      };
    }
    if (msg.type === "patch_apply_begin") {
      // Handle the start of a patch operation
      let { changes } = msg;

      const changeCount = Object.keys(changes).length;
      if (changeCount > 0) {
        currentTurnAutomation = {
          ...currentTurnAutomation,
          sawFileChanges: true,
        };
      }

      // Add UI feedback for patch operation
      const filesMsg = changeCount === 1 ? "1 file" : `${changeCount} files`;
      messageBuffer.addMessage(`Modifying ${filesMsg}...`, "tool");

      const toolCallId =
        typeof msg.call_id === "string" && msg.call_id.length > 0
          ? msg.call_id
          : null;
      const activeTurnId = currentTurnId;
      if (toolCallId && activeTurnId) {
        session.updateMetadata((currentMetadata) => {
          return appendCodexToolCallIdToPlanList(currentMetadata, {
            turnId: activeTurnId,
            toolCallId,
          });
        });
      }
    }
    if (msg.type === "patch_apply_end") {
      // Handle the end of a patch operation
      let { stdout, stderr, success } = msg;

      // Add UI feedback for completion
      if (success) {
        const message = stdout || "Files modified successfully";
        messageBuffer.addMessage(message.substring(0, 200), "result");
      } else {
        const errorMsg = stderr || "Failed to modify files";
        messageBuffer.addMessage(
          `Error: ${errorMsg.substring(0, 200)}`,
          "result",
        );
      }
    }
    if (msg.type === "turn_diff") {
      // Handle turn_diff messages and track unified_diff changes
      if (msg.unified_diff) {
        currentTurnAutomation = {
          ...currentTurnAutomation,
          sawDiffUpdate: true,
        };
        diffProcessor.processDiff(msg.unified_diff);
      }
    }

    if (msg.type === "tool-call" || msg.type === "tool-call-result") {
      const toolName = pickToolNameFromCodexMessage(msg as Record<string, unknown>);
      if (
        msg.type === "tool-call-result" &&
        typeof msg.output?.content === "string" &&
        hasLegacyCodexPlanPreview(msg.output.content)
      ) {
        currentTurnAutomation = {
          ...currentTurnAutomation,
          sawPlanUpdate: true,
        };
      }
      if (
        msg.type === "tool-call-result" &&
        msg.output?.status === "completed" &&
        isHappyProgressToolName(toolName)
      ) {
        currentTurnAutomation = {
          ...currentTurnAutomation,
          wroteProgress: true,
        };
      }
      if (
        msg.type === "tool-call-result" &&
        msg.output?.status === "completed" &&
        isHappySummaryToolName(toolName)
      ) {
        currentTurnAutomation = {
          ...currentTurnAutomation,
          wroteSummary: true,
        };
      }
      const envelopes = mapCodexProcessorMessageToSessionEnvelopes(msg as any, {
        currentTurnId,
        startedSubagents: codexStartedSubagents,
        activeSubagents: codexActiveSubagents,
        providerSubagentToSessionSubagent:
          codexProviderSubagentToSessionSubagent,
      });
      for (const envelope of envelopes) {
        session.sendSessionProtocolMessage(envelope);
      }
      return;
    }

    // Convert Codex MCP events into the unified session-protocol envelope stream.
    // Reasoning deltas are handled by ReasoningProcessor to avoid duplicate text output.
    if (
      msg.type !== "agent_reasoning_delta" &&
      msg.type !== "agent_reasoning" &&
      msg.type !== "agent_reasoning_section_break" &&
      msg.type !== "turn_diff" &&
      msg.type !== "turn_plan_updated"
    ) {
      const mapped = mapCodexMcpMessageToSessionEnvelopes(msg, {
        currentTurnId,
        startedSubagents: codexStartedSubagents,
        activeSubagents: codexActiveSubagents,
        providerSubagentToSessionSubagent:
          codexProviderSubagentToSessionSubagent,
      });
      currentTurnId = mapped.currentTurnId;
      codexStartedSubagents = mapped.startedSubagents;
      codexActiveSubagents = mapped.activeSubagents;
      codexProviderSubagentToSessionSubagent =
        mapped.providerSubagentToSessionSubagent;
      for (const envelope of mapped.envelopes) {
        session.sendSessionProtocolMessage(envelope);
      }
    }

    if (
      msg.type === "task_complete" &&
      shouldTriggerCodexAutoProgress({
        source: currentTurnPromptSource,
        sawPlanUpdate: currentTurnAutomation.sawPlanUpdate,
        sawFileChanges: currentTurnAutomation.sawFileChanges,
        sawDiffUpdate: currentTurnAutomation.sawDiffUpdate,
        wroteProgress: currentTurnAutomation.wroteProgress,
      })
    ) {
      try {
        session.sendSyntheticUserMessage(buildAutoProgressSyntheticPrompt(), {
          displayText: "",
          sentFrom: HAPPY_AUTO_PROGRESS_SOURCE,
        });
        logger.debug("[Codex] auto-progress trigger dispatched");
      } catch (error) {
        logger.debug(`[Codex] auto-progress trigger failed: ${error}`);
      }
    }

    if (shouldSendReady) {
      emitReadyIfIdle({
        pending: null,
        queueSize: () => messageQueue.size(),
        shouldExit,
        sendReady,
      });
    }
  };

  // Start Happy MCP server (HTTP) and prepare STDIO bridge config for Codex
  const happyServer = await startHappyServer(session);
  const bridgeCommand = join(projectPath(), "bin", "happy-mcp.mjs");
  const mcpServers = {
    happy: {
      command: bridgeCommand,
      args: ["--url", happyServer.url],
    },
  } as const;
  const callHappyTool = async (
    toolName: string,
    args: unknown,
  ): Promise<{
    contentItems: Array<
      { type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string }
    >;
    success: boolean;
  }> => {
    const normalizedToolName = normalizeHappyMcpToolName(toolName);
    if (!normalizedToolName) {
      return {
        contentItems: [
          {
            type: "inputText" as const,
            text: `Unsupported dynamic tool: ${toolName || "unknown"}`,
          },
        ],
        success: false,
      };
    }

    try {
      const client = new McpClient(
        { name: "happy-codex-app-forwarder", version: "1.0.0" },
        { capabilities: {} },
      );
      const transport = new StreamableHTTPClientTransport(
        new URL(happyServer.url),
      );
      await client.connect(transport);
      const response = await client.callTool({
        name: normalizedToolName,
        arguments:
          args && typeof args === "object"
            ? (args as Record<string, unknown>)
            : {},
      });

      const contentItems: Array<
        { type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string }
      > = [];
      if (Array.isArray(response.content)) {
        for (const item of response.content) {
          if (!item || typeof item !== "object") {
            continue;
          }
          if (
            (item as { type?: unknown }).type === "text" &&
            typeof (item as { text?: unknown }).text === "string"
          ) {
            contentItems.push({
              type: "inputText",
              text: (item as { text: string }).text,
            });
            continue;
          }
          if (
            (item as { type?: unknown }).type === "image" &&
            typeof (item as { url?: unknown }).url === "string"
          ) {
            contentItems.push({
              type: "inputImage",
              imageUrl: (item as { url: string }).url,
            });
          }
        }
      }

      return {
        contentItems:
          contentItems.length > 0
            ? contentItems
            : [
                {
                  type: "inputText" as const,
                  text: response.isError
                    ? `${normalizedToolName} failed.`
                    : `${normalizedToolName} completed.`,
                },
              ],
        success: !response.isError,
      };
    } catch (error) {
      return {
        contentItems: [
          {
            type: "inputText" as const,
            text: `${normalizedToolName} failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        success: false,
      };
    }
  };
  let first = true;

  try {
    const instantiateLegacyClient = () => {
      const legacyClient = new CodexMcpClient(sandboxConfig);
      legacyClient.setPermissionHandler(permissionHandler);
      legacyClient.setHandler(onClientMessage);
      return legacyClient;
    };
    const instantiateAppServerClient = () => {
      const appServerClient = new CodexAppServerClient(sandboxConfig);
      appServerClient.setPermissionHandler(permissionHandler);
      appServerClient.setElicitationHandler(handleElicitation);
      appServerClient.setChatGptAuthTokensProvider(loadOpenAiAuthTokens);
      appServerClient.setDynamicToolHandler((request) =>
        callHappyTool(request.tool, request.arguments),
      );
      appServerClient.setHandler(onClientMessage);
      return appServerClient;
    };

    let resolvedBackend: ResolvedCodexBackend;
    let fallbackReason: string | undefined;
    const resumeThreadId = resolveCodexResumeThreadId(
      existingHappySession?.metadata,
    );
    if (requestedBackend === "codex-mcp-legacy") {
      client = instantiateLegacyClient();
      resolvedBackend = "codex-mcp-legacy";
    } else {
      try {
        if (!supportsCodexAppServer()) {
          throw new Error("Codex CLI does not support app-server");
        }
        client = instantiateAppServerClient();
        logger.debug("[codex]: app-server client.connect begin");
        await client.connect();
        logger.debug("[codex]: app-server client.connect done");
        resolvedBackend = "codex-app-server";
      } catch (error) {
        if (requestedBackend === "codex-app-server") {
          throw error;
        }
        if (!shouldFallbackToLegacyCodex(error)) {
          throw error;
        }
        fallbackReason =
          error instanceof Error ? error.message : "Codex app-server unavailable";
        logger.warn("[Codex] Falling back to legacy MCP backend", error);
        client = instantiateLegacyClient();
        resolvedBackend = "codex-mcp-legacy";
        messageBuffer.addMessage(
          "Codex App Server unavailable, falling back to Legacy MCP",
          "status",
        );
        session.sendSessionEvent({
          type: "message",
          message: "Codex App Server unavailable, fell back to Legacy MCP",
        });
        const mapped = mapCodexMcpMessageToSessionEnvelopes(
          {
            type: "service_message",
            text: "Codex App Server unavailable, fell back to Legacy MCP",
          },
          {
            currentTurnId,
            startedSubagents: codexStartedSubagents,
            activeSubagents: codexActiveSubagents,
            providerSubagentToSessionSubagent:
              codexProviderSubagentToSessionSubagent,
          },
        );
        currentTurnId = mapped.currentTurnId;
        codexStartedSubagents = mapped.startedSubagents;
        codexActiveSubagents = mapped.activeSubagents;
        codexProviderSubagentToSessionSubagent =
          mapped.providerSubagentToSessionSubagent;
        for (const envelope of mapped.envelopes) {
          session.sendSessionProtocolMessage(envelope);
        }
        await client.connect();
      }
    }

    if (resolvedBackend === "codex-app-server") {
      const appServerClient = client as CodexAppServerClient;
      try {
        const authTokens = await loadOpenAiAuthTokens();
        if (authTokens) {
          await appServerClient.loginWithChatGptAuthTokens({
            accessToken: authTokens.accessToken,
            chatgptAccountId: authTokens.chatgptAccountId,
            chatgptPlanType: authTokens.chatgptPlanType ?? null,
          });
        } else if (process.env.OPENAI_API_KEY) {
          await appServerClient.loginWithApiKey(process.env.OPENAI_API_KEY);
        }
      } catch (error) {
        logger.warn("[Codex] Failed to bootstrap app-server auth", error);
      }
      if (resumeThreadId) {
        try {
          await appServerClient.resumeThread({
            threadId: resumeThreadId,
            baseInstructions: codexBaseInstructions,
            profile: runtimeConfig.profileName,
            model: runtimeConfig.overrides.model,
            approvalPolicy:
              (runtimeConfig.overrides.approvalPolicy as
                | "untrusted"
                | "on-failure"
                | "on-request"
                | "never"
                | undefined) ?? undefined,
            sandbox:
              (runtimeConfig.overrides.sandboxMode as
                | "read-only"
                | "workspace-write"
                | "danger-full-access"
                | undefined) ?? undefined,
            serviceTier: runtimeConfig.overrides.serviceTier,
            personality: runtimeConfig.overrides.personality,
            verbosity: runtimeConfig.overrides.verbosity,
            webSearch: runtimeConfig.overrides.webSearch,
          });
          session.sendSessionEvent({
            type: "message",
            message: `Resumed Codex thread ${resumeThreadId}`,
          });
        } catch (error) {
          logger.warn("[Codex] Failed to resume existing app-server thread", error);
          session.sendSessionEvent({
            type: "message",
            message: "Failed to resume previous Codex thread; a new thread will be created on the next prompt",
          });
        }
      }
      const capabilities = appServerClient.getCapabilities() ?? {
        models: [],
        config: null,
        account: null,
        rateLimits: null,
        experimentalFeatures: [],
        skills: [],
        mcpServers: [],
      };
      session.updateMetadata((currentMetadata) => ({
        ...currentMetadata,
        codex: {
          ...currentMetadata.codex,
          requestedBackend,
          resolvedBackend,
          ...(fallbackReason ? { fallbackReason } : {}),
          ...(installedCodexVersion ? { backendVersion: installedCodexVersion } : {}),
          ...(appServerClient.getSessionId()
            ? { threadId: appServerClient.getSessionId() ?? undefined }
            : {}),
          ...(capabilities.config ? { config: capabilities.config } : {}),
          ...(capabilities.account ? { account: capabilities.account } : {}),
          ...(capabilities.rateLimits ? { rateLimits: capabilities.rateLimits } : {}),
          ...(capabilities.experimentalFeatures.length > 0
            ? { experimentalFeatures: capabilities.experimentalFeatures }
            : {}),
          ...(capabilities.skills.length > 0
            ? {
                skills: mergeNamedEntries(
                  currentMetadata.codex?.skills,
                  capabilities.skills,
                ),
              }
            : {}),
          ...(capabilities.mcpServers.length > 0
            ? {
                mcpServers: mergeNamedEntries(
                  currentMetadata.codex?.mcpServers,
                  capabilities.mcpServers,
                ),
              }
            : {}),
        },
        ...(capabilities.models.length > 0
          ? {
              models: capabilities.models.map((model) => ({
                code: model.model,
                value: model.displayName,
                description: model.description,
                supportsEffort: model.supportedReasoningEfforts.length > 0,
                supportedEffortLevels: model.supportedReasoningEfforts.map(
                  (effort) => effort.value,
                ),
              })),
            }
          : {}),
      }));
    } else {
      session.updateMetadata((currentMetadata) => ({
        ...currentMetadata,
        codex: {
          ...currentMetadata.codex,
          requestedBackend,
          resolvedBackend,
          ...(fallbackReason ? { fallbackReason } : {}),
          ...(installedCodexVersion ? { backendVersion: installedCodexVersion } : {}),
        },
      }));
    }
    let wasCreated = false;
    let currentModeHash: string | null = null;
    let pending: {
      message: string;
      mode: CodexMessageMode;
      isolate: boolean;
      hash: string;
      source?: string;
      requestIds: string[];
      queueWaitMs?: number;
      socketToQueueMs?: number;
    } | null = null;
    // If we restart (e.g., mode change), use this to carry a resume file
    let nextExperimentalResume: string | null = null;

    while (!shouldExit) {
      logActiveHandles("loop-top");
      // Get next batch; respect mode boundaries like Claude
      let message: {
        message: string;
        mode: CodexMessageMode;
        isolate: boolean;
        hash: string;
        source?: string;
        requestIds: string[];
        queueWaitMs?: number;
        socketToQueueMs?: number;
      } | null = pending;
      pending = null;
      if (!message) {
        // Capture the current signal to distinguish idle-abort from queue close
        const waitSignal = abortController.signal;
        const batch =
          await messageQueue.waitForMessagesAndGetAsString(waitSignal);
        if (!batch) {
          // If wait was aborted (e.g., remote abort with no active inference), ignore and continue
          if (waitSignal.aborted && !shouldExit) {
            logger.debug(
              "[codex]: Wait aborted while idle; ignoring and continuing",
            );
            continue;
          }
          logger.debug(`[codex]: batch=${!!batch}, shouldExit=${shouldExit}`);
          break;
        }
        message = batch;
      }

      // Defensive check for TS narrowing
      if (!message) {
        break;
      }

      // If a session exists and mode changed, restart on next iteration
      const currentClient = client;
      if (
        wasCreated &&
        currentModeHash &&
        message.hash !== currentModeHash &&
        currentClient &&
        !currentClient.supportsModeHotSwap
      ) {
        logger.debug("[Codex] Mode changed – restarting Codex session");
        messageBuffer.addMessage("═".repeat(40), "status");
        messageBuffer.addMessage(
          "Starting new Codex session (mode changed)...",
          "status",
        );
        // Capture previous sessionId and try to find its transcript to resume
        try {
          const prevSessionId = currentClient.getSessionId();
          nextExperimentalResume = findCodexResumeFile(prevSessionId);
          if (nextExperimentalResume) {
            logger.debug(
              `[Codex] Found resume file for session ${prevSessionId}: ${nextExperimentalResume}`,
            );
            messageBuffer.addMessage("Resuming previous context…", "status");
          } else {
            logger.debug("[Codex] No resume file found for previous session");
          }
        } catch (e) {
          logger.debug("[Codex] Error while searching resume file", e);
        }
        currentClient.clearSession();
        wasCreated = false;
        currentModeHash = null;
        pending = message;
        // Reset processors/permissions like end-of-turn cleanup
        permissionHandler.reset();
        reasoningProcessor.abort();
        diffProcessor.reset();
        thinking = false;
        session.keepAlive(thinking, "remote");
        continue;
      }

      // Display user messages in the UI
      messageBuffer.addMessage(message.message, "user");
      currentModeHash = message.hash;
      currentTurnPromptSource = message.source ?? "user";

      try {
        // Map permission mode to approval policy and sandbox for startSession
        const sandboxManagedByHappy = client.sandboxEnabled;
        const executionPolicy = resolveCodexExecutionPolicy(
          message.mode.permissionMode,
          sandboxManagedByHappy,
        );

        if (!wasCreated) {
          const resolvedReasoningEffort =
            message.mode.reasoningEffort ??
            runtimeConfig.overrides.reasoningEffort;
          const startConfig: CodexSessionConfig = {
            prompt: first
              ? message.message + "\n\n" + CHANGE_TITLE_INSTRUCTION
              : message.message,
            "base-instructions": codexBaseInstructions,
            config: {
              mcp_servers: mcpServers,
              ...(resolvedReasoningEffort
                ? {
                    model_reasoning_effort: resolvedReasoningEffort,
                  }
                : {}),
              ...(runtimeConfig.overrides.reasoningSummary
                ? {
                    model_reasoning_summary:
                      runtimeConfig.overrides.reasoningSummary,
                  }
                : {}),
              ...(runtimeConfig.overrides.verbosity
                ? { model_verbosity: runtimeConfig.overrides.verbosity }
                : {}),
              ...(runtimeConfig.overrides.webSearch
                ? { web_search: runtimeConfig.overrides.webSearch }
                : {}),
            },
          };
          if (executionPolicy.sandbox) {
            startConfig.sandbox = executionPolicy.sandbox;
          }
          if (executionPolicy.approvalPolicy) {
            startConfig["approval-policy"] = executionPolicy.approvalPolicy;
          }
          if (message.mode.model) {
            startConfig.model = message.mode.model;
          } else if (runtimeConfig.overrides.model) {
            startConfig.model = runtimeConfig.overrides.model;
          }
          if (runtimeConfig.profileName) {
            startConfig.profile = runtimeConfig.profileName;
          }
          if (runtimeConfig.overrides.serviceTier) {
            startConfig.serviceTier = runtimeConfig.overrides.serviceTier;
          }
          if (resolvedReasoningEffort) {
            startConfig.reasoningEffort = resolvedReasoningEffort;
          }
          if (runtimeConfig.overrides.reasoningSummary) {
            startConfig.reasoningSummary =
              runtimeConfig.overrides.reasoningSummary;
          }
          if (runtimeConfig.overrides.verbosity) {
            startConfig.verbosity = runtimeConfig.overrides.verbosity;
          }
          if (runtimeConfig.overrides.personality) {
            startConfig.personality = runtimeConfig.overrides.personality;
          }
          if (runtimeConfig.overrides.webSearch) {
            startConfig.webSearch = runtimeConfig.overrides.webSearch;
          }

          // Check for resume file from multiple sources
          let resumeFile: string | null = null;

          // Priority 1: Explicit resume file from mode change
          if (nextExperimentalResume) {
            resumeFile = nextExperimentalResume;
            nextExperimentalResume = null; // consume once
            logger.debug(
              "[Codex] Using resume file from mode change:",
              resumeFile,
            );
          }
          // Priority 2: Resume from stored abort session
          else if (storedSessionIdForResume) {
            const abortResumeFile = findCodexResumeFile(
              storedSessionIdForResume,
            );
            if (abortResumeFile) {
              resumeFile = abortResumeFile;
              logger.debug(
                "[Codex] Using resume file from aborted session:",
                resumeFile,
              );
              messageBuffer.addMessage(
                "Resuming from aborted session...",
                "status",
              );
            }
            storedSessionIdForResume = null; // consume once
          }

          // Apply resume file if found
          if (resumeFile) {
            (startConfig.config as any).experimental_resume = resumeFile;
          }

          const startResponse = requireSuccessfulCodexResponse(
            await client.startSession(startConfig, {
              signal: abortController.signal,
            }),
            "start",
          );
          logger.debug("[Codex] startSession response:", startResponse);
          if (client.backendKind === "codex-app-server") {
            const activeThreadId = client.getSessionId();
            const currentModelCode =
              (client as CodexAppServerClient).getCurrentModel() ??
              message.mode.model ??
              currentModel;
            if (currentModelCode) {
              session.updateMetadata((currentMetadata) => ({
                ...currentMetadata,
                codex: {
                  ...currentMetadata.codex,
                  ...(activeThreadId ? { threadId: activeThreadId } : {}),
                },
                currentModelCode,
              }));
            }
          }
          wasCreated = true;
          first = false;
        } else {
          const response = requireSuccessfulCodexResponse(
            await client.continueSession(message.message, {
              signal: abortController.signal,
              model: message.mode.model ?? runtimeConfig.overrides.model,
              approvalPolicy: executionPolicy.approvalPolicy,
              sandbox: executionPolicy.sandbox,
              serviceTier: runtimeConfig.overrides.serviceTier,
              reasoningEffort:
                message.mode.reasoningEffort ??
                runtimeConfig.overrides.reasoningEffort,
              reasoningSummary: runtimeConfig.overrides.reasoningSummary,
              verbosity: runtimeConfig.overrides.verbosity,
              personality: runtimeConfig.overrides.personality,
              webSearch: runtimeConfig.overrides.webSearch,
            }),
            "continue",
          );
          logger.debug("[Codex] continueSession response:", response);
          if (client.backendKind === "codex-app-server") {
            const activeThreadId = client.getSessionId();
            const currentModelCode =
              (client as CodexAppServerClient).getCurrentModel() ??
              message.mode.model ??
              currentModel;
            if (currentModelCode) {
              session.updateMetadata((currentMetadata) => ({
                ...currentMetadata,
                codex: {
                  ...currentMetadata.codex,
                  ...(activeThreadId ? { threadId: activeThreadId } : {}),
                },
                currentModelCode,
              }));
            }
          }
        }
      } catch (error) {
        logger.warn("Error in codex session:", error);
        const isAbortError =
          error instanceof Error && error.name === "AbortError";

        if (isAbortError) {
          messageBuffer.addMessage("Aborted by user", "status");
          session.sendSessionEvent({
            type: "message",
            message: "Aborted by user",
          });
          // Abort cancels the current task/inference but keeps the Codex session alive.
          // Do not clear session state here; the next user message should continue on the
          // existing session if possible.
        } else {
          const errorMessage =
            error instanceof Error && error.message
              ? trimIdent(error.message)
              : "Process exited unexpectedly";
          messageBuffer.addMessage(errorMessage, "result");
          session.sendSessionEvent({
            type: "message",
            message: errorMessage,
          });
          // Reset the active session after a startup/transport error so the next
          // user message creates a fresh Codex session instead of replying into a
          // broken one.
          if (client?.hasActiveSession()) {
            client.clearSession();
          }
          wasCreated = false;
        }
      } finally {
        // Reset permission handler, reasoning processor, and diff processor
        permissionHandler.reset();
        reasoningProcessor.abort(); // Use abort to properly finish any in-progress tool calls
        diffProcessor.reset();
        thinking = false;
        session.keepAlive(thinking, "remote");
        emitReadyIfIdle({
          pending,
          queueSize: () => messageQueue.size(),
          shouldExit,
          sendReady,
        });
        logActiveHandles("after-turn");
      }
    }
  } finally {
    // Clean up resources when main loop exits
    logger.debug("[codex]: Final cleanup start");
    logActiveHandles("cleanup-start");

    // Cancel offline reconnection if still running
    if (reconnectionHandle) {
      logger.debug("[codex]: Cancelling offline reconnection");
      reconnectionHandle.cancel();
    }

    try {
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

      logger.debug("[codex]: sendSessionDeath");
      session.sendSessionDeath();
      logger.debug("[codex]: flush begin");
      await session.flush();
      logger.debug("[codex]: flush done");
      logger.debug("[codex]: session.close begin");
      await session.close();
      logger.debug("[codex]: session.close done");
    } catch (e) {
      logger.debug("[codex]: Error while closing session", e);
    }
    if (client) {
      logger.debug("[codex]: client.forceCloseSession begin");
      await client.forceCloseSession();
      logger.debug("[codex]: client.forceCloseSession done");
    }
    // Stop Happy MCP server
    logger.debug("[codex]: happyServer.stop");
    happyServer.stop();

    // Clean up ink UI
    if (process.stdin.isTTY) {
      logger.debug("[codex]: setRawMode(false)");
      try {
        process.stdin.setRawMode(false);
      } catch {}
    }
    // Stop reading from stdin so the process can exit
    if (hasTTY) {
      logger.debug("[codex]: stdin.pause()");
      try {
        process.stdin.pause();
      } catch {}
    }
    // Clear periodic keep-alive to avoid keeping event loop alive
    logger.debug("[codex]: clearInterval(keepAlive)");
    clearInterval(keepAliveInterval);
    if (inkInstance) {
      logger.debug("[codex]: inkInstance.unmount()");
      inkInstance.unmount();
    }
    messageBuffer.clear();

    logActiveHandles("cleanup-end");
    logger.debug("[codex]: Final cleanup completed");
  }
}
