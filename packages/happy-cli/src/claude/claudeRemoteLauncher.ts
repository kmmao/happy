import { render } from "ink";
import { Session } from "./session";
import { MessageBuffer } from "@/ui/ink/messageBuffer";
import { RemoteModeDisplay } from "@/ui/ink/RemoteModeDisplay";
import React from "react";
import { claudeRemote, resolveModelKey } from "./claudeRemote";
import { mapToClaudeMode } from "./utils/permissionMode";
import { PermissionHandler } from "./utils/permissionHandler";
import { Future } from "@/utils/future";
import { SDKAssistantMessage, SDKMessage, SDKUserMessage } from "./sdk";
import { forkSession } from "./sdk/types";
import type { ElicitationRequest, ElicitationResult } from "./sdk/types";
import type {
  SDKStatusMessage as SDKStatusMsg,
  SDKCompactBoundaryMessage as SDKCompactMsg,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskNotificationMessage,
  SDKAPIRetryMessage,
  SDKToolProgressMessage,
  SDKPromptSuggestionMessage,
  SDKSessionStateChangedMessage,
  SDKMemoryRecallMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { formatClaudeMessageForInk } from "@/ui/messageFormatterInk";
import { logger } from "@/ui/logger";
import { SDKToLogConverter } from "./utils/sdkToLogConverter";
import { PLAN_FAKE_REJECT } from "./sdk/prompts";
import { EnhancedMode } from "./loop";
import { RawJSONLines } from "@/claude/types";
import { OutgoingMessageQueue } from "./utils/OutgoingMessageQueue";
import { createSessionEventReporter } from "./sessionEventReporter";
import { getToolName } from "./utils/getToolName";
import { createEnvelope } from "@kmmao/happy-wire";
import { hashObject } from "@/utils/deterministicJson";
import type { Query as OfficialQuery } from "@anthropic-ai/claude-agent-sdk";
import { getProjectPath } from "./utils/path";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { executeShellCommand } from "@/utils/shellCommand";
import { TurnCollector } from "@/knowledge";
import type { TurnCollectorConfig } from "@/knowledge";
import { ExecutionGuard } from "@/automation/ExecutionGuard";
import {
  buildProgressStateFromLists,
  capProgressLists,
} from "@/utils/progressState";
import {
  registerClaudeControlHandlers,
  SessionCostTracker,
} from "./rpc/claudeControlHandlers";
import packageJson from "../../package.json";

interface PermissionsField {
  date: number;
  result: "approved" | "denied";
  mode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk" | "auto";
  allowedTools?: string[];
}

export async function claudeRemoteLauncher(
  session: Session,
): Promise<"switch" | "exit"> {
  logger.debug("[claudeRemoteLauncher] Starting remote launcher");

  // Check if we have a TTY for UI rendering
  const hasTTY = process.stdout.isTTY && process.stdin.isTTY;
  logger.debug(`[claudeRemoteLauncher] TTY available: ${hasTTY}`);

  // Configure terminal
  let messageBuffer = new MessageBuffer();
  let inkInstance: any = null;

  if (hasTTY) {
    console.clear();
    inkInstance = render(
      React.createElement(RemoteModeDisplay, {
        messageBuffer,
        logPath: process.env.DEBUG ? session.logPath : undefined,
        onExit: async () => {
          // Exit the entire client
          logger.debug("[remote]: Exiting client via Ctrl-C");
          if (!exitReason) {
            exitReason = "exit";
          }
          await abort();
        },
        onSwitchToLocal: () => {
          // Switch to local mode
          logger.debug("[remote]: Switching to local mode via double space");
          doSwitch();
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

  // Handle abort
  let exitReason: "switch" | "exit" | null = null;
  let abortController: AbortController | null = null;
  let abortFuture: Future<void> | null = null;
  const executionGuard = new ExecutionGuard(({ from, to }) => {
    logger.debug(
      `[remote]: execution guard ${from.state} -> ${to.state}${to.activeReason ? ` (${to.activeReason})` : ""} [gen=${to.generation}]`,
    );
  });
  let activeTurnGeneration: number | null = null;

  const dispatchTurn = (reason: "user_message" | "continue" | "isolated_command" | "mode_change") => {
    if (!executionGuard.reserve(reason)) {
      const snapshot = executionGuard.getSnapshot();
      logger.debug(
        `[remote]: execution guard reserve skipped (state=${snapshot.state}, gen=${snapshot.generation})`,
      );
    }
    const generation = executionGuard.start();
    if (generation !== null) {
      activeTurnGeneration = generation;
    }
  };

  const finishTurn = () => {
    if (activeTurnGeneration === null) {
      executionGuard.cancelReservation();
      return;
    }
    if (executionGuard.end(activeTurnGeneration)) {
      activeTurnGeneration = null;
    }
  };

  const reasonForQueuedMessage = (msg: { isolate?: boolean; mode: EnhancedMode }) => {
    if (msg.isolate) return "isolated_command" as const;
    if (msg.mode.continue) return "continue" as const;
    return "user_message" as const;
  };

  async function abort() {
    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
    }
    await abortFuture?.promise;
  }

  async function doAbort() {
    logger.debug("[remote]: doAbort");
    executionGuard.abort("abort");
    await abort();
  }

  async function doSwitch() {
    logger.debug("[remote]: doSwitch");
    executionGuard.abort("switch_transport");
    if (!exitReason) {
      exitReason = "switch";
    }
    await abort();
  }

  // Track current SDK Query for runtime control (interrupt, stopTask)
  let currentQuery: OfficialQuery | null = null;
  // Keep last completed query so rewindFiles can be called after a turn ends
  let lastCompletedQuery: OfficialQuery | null = null;

  // Knowledge base: turn-level data collection + injection
  // Default ON — collection runs silently in background (minimal overhead).
  // App setting `knowledgeBase` controls Tab visibility; env HAPPY_KNOWLEDGE_BASE=false to fully disable.
  const knowledgeEnabled = process.env.HAPPY_KNOWLEDGE_BASE !== "false";
  const turnCollectorConfig: Partial<TurnCollectorConfig> = {};
  const rawSensitivity = process.env.HAPPY_KNOWLEDGE_SENSITIVITY;
  if (rawSensitivity === "conservative" || rawSensitivity === "balanced" || rawSensitivity === "aggressive") {
    turnCollectorConfig.sensitivity = rawSensitivity;
  }
  if (process.env.HAPPY_KNOWLEDGE_TRACK_FILE_EDITS !== undefined) {
    turnCollectorConfig.trackFileEdits = process.env.HAPPY_KNOWLEDGE_TRACK_FILE_EDITS !== "false";
  }
  if (process.env.HAPPY_KNOWLEDGE_TRACK_TOOL_CALLS !== undefined) {
    turnCollectorConfig.trackToolCalls = process.env.HAPPY_KNOWLEDGE_TRACK_TOOL_CALLS !== "false";
  }
  if (process.env.HAPPY_KNOWLEDGE_TRACK_TOKENS !== undefined) {
    turnCollectorConfig.trackTokens = process.env.HAPPY_KNOWLEDGE_TRACK_TOKENS !== "false";
  }
  const turnCollector = knowledgeEnabled ? new TurnCollector(turnCollectorConfig) : null;
  let knowledgeInjected = false; // Track whether knowledge was already injected
  let knowledgeContext: string | null = null; // Cached knowledge for system prompt
  let pendingKnowledgeRefresh = false; // Whether a per-turn refresh is pending
  // Injected knowledge entries (id → metadata). Used both for dedup and for per-turn hit detection.
  let knowledgeEntries = new Map<string, { id: string; title: string; tags: string[] }>();
  let pendingFileHint: string | null = null; // File-based knowledge hint for next message
  let currentTurnFilePaths = new Set<string>(); // Files edited in the current turn

  // Sync server-side knowledgeConfig to TurnCollector at runtime
  function syncKnowledgeConfig(cfg: {
    sensitivity?: string;
    trackFileEdits?: boolean;
    trackToolCalls?: boolean;
    trackTokens?: boolean;
  } | undefined): void {
    if (!cfg || !turnCollector) return;
    const patch: Partial<TurnCollectorConfig> = {};
    if (cfg.sensitivity === "conservative" || cfg.sensitivity === "balanced" || cfg.sensitivity === "aggressive") {
      patch.sensitivity = cfg.sensitivity;
    }
    if (cfg.trackFileEdits !== undefined) patch.trackFileEdits = cfg.trackFileEdits;
    if (cfg.trackToolCalls !== undefined) patch.trackToolCalls = cfg.trackToolCalls;
    if (cfg.trackTokens !== undefined) patch.trackTokens = cfg.trackTokens;
    if (Object.keys(patch).length > 0) {
      turnCollector.updateConfig(patch);
    }
  }

  // Pre-fetch knowledge context for injection (non-blocking)
  if (knowledgeEnabled) {
    const mode = (process.env.HAPPY_KNOWLEDGE_MODE as "auto" | "full" | "minimal") || "auto";
    session.client.fetchKnowledge(mode).then((result) => {
      if (result && (result.profile || result.entries.length > 0)) {
        knowledgeContext = formatKnowledgeForInjection(result);
        for (const e of result.entries) {
          knowledgeEntries.set(e.id, { id: e.id, title: e.title, tags: e.tags });
        }
        logger.debug(`[knowledge] Pre-fetched context: ${knowledgeContext!.length} chars, ${result.entries.length} entries`);
      }
      syncKnowledgeConfig(result?.knowledgeConfig);
    }).catch((err) => {
      logger.debug(`[knowledge] Failed to pre-fetch: ${err}`);
    });
  }

  async function doInterrupt() {
    logger.debug("[remote]: doInterrupt — graceful interrupt via SDK");
    if (currentQuery) {
      try {
        await currentQuery.interrupt();
      } catch (e) {
        logger.debug("[remote]: interrupt() threw — falling back to abort", e);
        await abort();
      }
    } else {
      logger.debug("[remote]: no active query — falling back to abort");
      await abort();
    }
  }

  async function doStopTask(args: { taskId: string }) {
    logger.debug(`[remote]: doStopTask — taskId=${args.taskId}`);
    if (!args.taskId) return;

    if (currentQuery) {
      try {
        await currentQuery.stopTask(args.taskId);
        return; // SDK will emit task_notification(stopped) which gets persisted
      } catch (e) {
        logger.debug("[remote]: stopTask() failed, falling back to manual task-end", e);
      }
    }

    // Fallback: when agent is idle (currentQuery is null) or stopTask failed,
    // manually emit a task-end envelope so the status is persisted to the server.
    const envelope = createEnvelope("agent", {
      t: "task-end",
      taskId: args.taskId,
      status: "stopped" as const,
      summary: "Task stopped by user",
    });
    session.client.sendSessionProtocolMessage(envelope);
  }

  // When to abort
  session.client.rpcHandlerManager.registerHandler("abort", doAbort); // When abort clicked
  session.client.rpcHandlerManager.registerHandler("switch", doSwitch); // When switch clicked
  session.client.rpcHandlerManager.registerHandler("interrupt", doInterrupt); // Graceful interrupt
  session.client.rpcHandlerManager.registerHandler("stopTask", doStopTask); // Stop background task

  // Claude Control sidebar RPCs (SDK 0.2.119+ — see claudeControlRpc.ts wire schemas)
  const sessionCostTracker = new SessionCostTracker();
  registerClaudeControlHandlers({
    rpcHandlerManager: session.client.rpcHandlerManager,
    getCurrentQuery: () => currentQuery,
    cwd: session.path,
    costTracker: sessionCostTracker,
    happyCliVersion: (packageJson as { version?: string }).version,
  });
  // Removed catch-all stdin handler - now handled by RemoteModeDisplay keyboard handlers

  // Task log streaming: subscribe/unsubscribe to real-time output file monitoring
  session.client.rpcHandlerManager.registerHandler(
    "subscribeTaskLog",
    async (args: { taskId: string; outputFile: string }) => {
      const { startWatching, isWatching } = await import("@/modules/taskLog/taskLogWatcher");
      if (isWatching(args.taskId)) {
        return { ok: true, already: true };
      }
      startWatching(args.taskId, args.outputFile, (chunk) => {
        session.client.emitTaskLog(chunk.taskId, chunk.outputFile, chunk.chunk, chunk.offset);
      });
      return { ok: true };
    },
  );
  session.client.rpcHandlerManager.registerHandler(
    "unsubscribeTaskLog",
    async (args: { taskId: string }) => {
      const { stopWatching } = await import("@/modules/taskLog/taskLogWatcher");
      stopWatching(args.taskId);
      return { ok: true };
    },
  );

  // Register RPC handler to allow App to fetch the latest compaction summary
  // In remote mode, read from the JSONL file on demand (no scanner available)
  session.client.rpcHandlerManager.registerHandler(
    "getCompactionSummary",
    async () => {
      const currentSessionId = session.sessionId;
      if (!currentSessionId) {
        return { summary: null };
      }
      try {
        const projectDir = getProjectPath(session.path);
        const filePath = join(projectDir, `${currentSessionId}.jsonl`);
        const content = await readFile(filePath, "utf-8");
        const lines = content.split("\n");
        let latestSummary: string | null = null;
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === "summary" && parsed.summary) {
              latestSummary = parsed.summary;
            }
          } catch {
            continue;
          }
        }
        return { summary: latestSummary };
      } catch {
        return { summary: null };
      }
    },
  );

  // Register RPC handler for App to fetch plan file content
  session.client.rpcHandlerManager.registerHandler(
    "getPlanFileContent",
    async () => {
      if (!latestPlanFilePath) {
        return { content: null, filePath: null };
      }
      try {
        const content = await readFile(latestPlanFilePath, "utf-8");
        return { content, filePath: latestPlanFilePath };
      } catch {
        // File write may still be in progress — fall back to cached content
        return { content: latestPlanContent, filePath: latestPlanFilePath };
      }
    },
  );

  // Register RPC handler for forking a session at a specific message
  session.client.rpcHandlerManager.registerHandler(
    "forkSession",
    async (args: { upToMessageId?: string; title?: string }) => {
      const claudeSessionId = session.sessionId;
      if (!claudeSessionId) {
        return { error: "No active Claude session to fork" };
      }
      // Validate args — only accept strings
      const upToMessageId = typeof args.upToMessageId === "string" ? args.upToMessageId : undefined;
      const title = typeof args.title === "string" ? args.title : undefined;
      try {
        const result = await forkSession(claudeSessionId, {
          upToMessageId,
          title,
          dir: session.path,
        });
        logger.debug(
          `[remote]: forked session ${claudeSessionId} → ${result.sessionId}`,
        );

        // Copy the latest compaction summary from the source session JSONL
        // into the forked JSONL so getCompactionSummary works on the fork.
        try {
          const projectDir = getProjectPath(session.path);
          const sourceFile = join(projectDir, `${claudeSessionId}.jsonl`);
          const sourceContent = await readFile(sourceFile, "utf-8");
          let latestSummary: string | null = null;
          for (const line of sourceContent.split("\n")) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === "summary" && parsed.summary) {
                latestSummary = parsed.summary;
              }
            } catch { continue; }
          }
          if (latestSummary) {
            const forkFile = join(projectDir, `${result.sessionId}.jsonl`);
            const summaryRecord = JSON.stringify({ type: "summary", summary: latestSummary });
            await writeFile(forkFile, "\n" + summaryRecord + "\n", { flag: "a" });
            logger.debug("[remote]: copied compaction summary to fork JSONL");
          }
        } catch (copyErr) {
          logger.debug(`[remote]: failed to copy summary to fork: ${copyErr}`);
        }

        return {
          claudeSessionId: result.sessionId,
          path: session.path,
        };
      } catch (err) {
        logger.debug(`[remote]: forkSession failed: ${err}`);
        return {
          error: err instanceof Error ? err.message : "Fork failed",
        };
      }
    },
  );

  // Register RPC handler for rewinding files to a specific user message state
  session.client.rpcHandlerManager.registerHandler(
    "rewindFiles",
    async (args: { userMessageId: string; dryRun?: boolean }) => {
      const queryForRewind = currentQuery ?? lastCompletedQuery;
      if (!queryForRewind) {
        return { canRewind: false, error: "No active query" };
      }
      if (!args.userMessageId) {
        return { canRewind: false, error: "Missing userMessageId" };
      }
      try {
        const result = await queryForRewind.rewindFiles(args.userMessageId, {
          dryRun: args.dryRun ?? false,
        });
        return result;
      } catch (err) {
        logger.debug(`[remote]: rewindFiles failed: ${err}`);
        return {
          canRewind: false,
          error: err instanceof Error ? err.message : "Rewind failed",
        };
      }
    },
  );

  // Register RPC handler for seeding read state after compact/snip
  session.client.rpcHandlerManager.registerHandler(
    "seedReadState",
    async (args: { path: string; mtime: number }) => {
      if (!currentQuery) {
        return { error: "No active query" };
      }
      if (!args.path || args.mtime == null) {
        return { error: "Missing path or mtime" };
      }
      try {
        await currentQuery.seedReadState(args.path, args.mtime);
        return { success: true };
      } catch (err) {
        logger.debug(`[remote]: seedReadState failed: ${err}`);
        return {
          error: err instanceof Error ? err.message : "seedReadState failed",
        };
      }
    },
  );

  // Create permission handler
  const permissionHandler = new PermissionHandler(session);

  // Create outgoing message queue
  const messageQueue = new OutgoingMessageQueue((logMessage) =>
    session.client.sendClaudeSessionMessage(logMessage),
  );

  // Set up callback to release delayed messages when permission is requested
  permissionHandler.setOnPermissionRequest((toolCallId: string) => {
    messageQueue.releaseToolCall(toolCallId);
  });

  // Create SDK to Log converter (pass responses from permissions)
  const sdkToLogConverter = new SDKToLogConverter(
    {
      sessionId: session.sessionId || "unknown",
      cwd: session.path,
      version: process.env.npm_package_version,
    },
    permissionHandler.getResponses(),
  );

  // Track files that have been Read by the SDK (for seedReadState after compact)
  const readFilePaths = new Set<string>();

  // Session timeline event reporter (fire-and-forget to server).
  // getSessionId is called lazily so new sessions work even before Claude
  // assigns a session ID at launcher startup.
  const reportSessionEvent = session.onSessionEvent
    ? createSessionEventReporter(
        { sessionEvent: session.onSessionEvent },
        () => session.client.sessionId,
      )
    : null;

  // Handle messages
  let planModeToolCalls = new Set<string>();
  let latestPlanFilePath: string | null = null;
  let latestPlanContent: string | null = null;
  let ongoingToolCalls = new Map<string, { parentToolCallId: string | null }>();
  let lastResultData: {
    totalCostUsd: number;
    numTurns: number;
    modelUsage: Record<
      string,
      {
        inputTokens: number;
        outputTokens: number;
        cacheReadInputTokens: number;
        cacheCreationInputTokens: number;
        costUSD: number;
        contextWindow: number;
        maxOutputTokens: number;
      }
    >;
  } | null = null;

  // Perf tracking: end-to-end timing from socket to first assistant response
  let _perfTurnSocketReceivedAt: number | undefined;
  let _perfTurnFirstResponseLogged = false;
  // Throttle the SDK 'requesting' status to one event per user turn.
  // SDK 0.2.108+ emits it before every API call (incl. tool-result follow-ups),
  // which would otherwise spam the App with a "Requesting..." chip on every
  // retry/tool-use iteration. Reset alongside _perfTurnFirstResponseLogged at
  // turn boundaries below.
  let _requestingEventSentThisTurn = false;

  function onMessage(message: SDKMessage) {
    // End-to-end perf: log total latency on first assistant response per turn
    if (!_perfTurnFirstResponseLogged && message.type === "assistant" && _perfTurnSocketReceivedAt) {
      _perfTurnFirstResponseLogged = true;
      const e2e = Date.now() - _perfTurnSocketReceivedAt;
      logger.debug(`[perf] E2E socket_received → first_assistant: ${e2e}ms`);
    }

    // Fold result messages into the session-cost tracker so the claude-control
    // `get_session_cost` RPC returns real values instead of zero. See
    // claudeControlHandlers.ts for the aggregation semantics.
    if (message.type === "result") {
      sessionCostTracker.recordResult(message);
    }

    // Write to message log
    formatClaudeMessageForInk(message, messageBuffer);

    // Write to permission handler for tool id resolving
    permissionHandler.onMessage(message);

    // Track Read tool calls for seedReadState after compact
    if (message.type === "assistant") {
      const aMsg = message as SDKAssistantMessage;
      if (aMsg.message.content && Array.isArray(aMsg.message.content)) {
        for (const c of aMsg.message.content) {
          if (c.type === "tool_use" && c.name === "Read") {
            const filePath = (c.input as Record<string, unknown>)?.file_path;
            if (typeof filePath === "string") {
              readFilePaths.add(filePath);
            }
          }
        }
      }
    }

    // Knowledge base: collect turn data from SDK messages
    // Wrapped in try-catch to never interfere with message processing
    try {
      if (turnCollector) {
        if (message.type === "user") {
          const uMsg = message as SDKUserMessage;
          const content = uMsg.message?.content;
          let text = "";
          if (typeof content === "string") {
            text = content;
          } else if (Array.isArray(content)) {
            text = content
              .filter((c: any) => c.type === "text" && typeof c.text === "string")
              .map((c: any) => c.text)
              .join("\n");
          }
          if (text) {
            turnCollector.collectUserMessage(text);
          }
        }
        if (message.type === "assistant") {
          const aMsg = message as SDKAssistantMessage;
          if (aMsg.message.content && Array.isArray(aMsg.message.content)) {
            for (const c of aMsg.message.content) {
              if (c.type === "text") {
                turnCollector.collectAssistantText(c.text);
              }
              if (c.type === "tool_use") {
                turnCollector.collectToolCall();
                if (c.name === "Write" || c.name === "Edit") {
                  const filePath = (c.input as Record<string, unknown>)?.file_path;
                  if (typeof filePath === "string") {
                    turnCollector.collectFileEdit(filePath, c.name === "Write" ? "create" : "edit");
                    currentTurnFilePaths.add(filePath);
                  }
                }
              }
            }
          }
        }
      }
    } catch (err) {
      logger.debug(`[knowledge] Error collecting turn data: ${err}`);
    }

    // Auto-mirror TodoWrite → metadata.progress. Reads SDK-native
    // `TodoWriteOutput` off `user.tool_use_result` (shape: oldTodos, newTodos,
    // verificationNudgeNeeded). Boundary detection = content-set intersection
    // of oldTodos vs newTodos: zero overlap → start a new list. This survives
    // the case where the prior list still has in_progress/pending items when
    // the agent pivots to a brand-new topic (which the old priorAllDone gate
    // silently overwrote).
    if (message.type === "user") {
      try {
        const uMsg = message as SDKUserMessage;
        const rawResult = uMsg.tool_use_result;
        if (rawResult && typeof rawResult === "object") {
          const r = rawResult as Record<string, unknown>;
          const oldRaw = r.oldTodos;
          const newRaw = r.newTodos;
          if (Array.isArray(oldRaw) && Array.isArray(newRaw)) {
            type MirroredTodo = {
              content: string;
              status: "pending" | "in_progress" | "completed";
              activeForm?: string;
              verificationNudgeNeeded?: boolean;
            };
            const sanitize = (list: readonly unknown[]): MirroredTodo[] => {
              const out: MirroredTodo[] = [];
              for (const item of list) {
                if (!item || typeof item !== "object") continue;
                const rec = item as Record<string, unknown>;
                const content = rec.content;
                const status = rec.status;
                if (typeof content !== "string" || content.length === 0) continue;
                if (
                  status !== "pending" &&
                  status !== "in_progress" &&
                  status !== "completed"
                )
                  continue;
                const activeForm = rec.activeForm;
                out.push({
                  content,
                  status,
                  activeForm:
                    typeof activeForm === "string" && activeForm.length > 0
                      ? activeForm
                      : undefined,
                });
              }
              return out;
            };
            const oldTodos = sanitize(oldRaw);
            const newTodos = sanitize(newRaw);
            if (newTodos.length > 0) {
              const verificationNudgeNeeded = r.verificationNudgeNeeded === true;
              const mirrored: MirroredTodo[] = verificationNudgeNeeded
                ? newTodos.map((t) =>
                    t.status === "completed"
                      ? { ...t, verificationNudgeNeeded: true }
                      : t,
                  )
                : newTodos;

              // Detect the "list fully completed" transition BEFORE calling
              // updateMetadata. The updater handler runs inside an async lock
              // and wouldn't give us a synchronous result — so we snapshot
              // the current metadata via getMetadata() and compute everything
              // we need here. The handler below then consumes the flag via
              // closure to stamp `summaryGeneratedAt`.
              const currentMetadataSnapshot = session.client.getMetadata();
              const priorProgressSnapshot = currentMetadataSnapshot?.progress;
              const priorListsSnapshot = priorProgressSnapshot?.lists ?? [];
              const priorCurrentIdSnapshot = priorProgressSnapshot?.currentListId;
              const priorCurrentListSnapshot = priorCurrentIdSnapshot
                ? priorListsSnapshot.find((l) => l.id === priorCurrentIdSnapshot)
                : undefined;
              const oldKeysSnapshot = new Set(
                oldTodos.map((t) => t.content),
              );
              const newKeysSnapshot = new Set(
                mirrored.map((t) => t.content),
              );
              let intersectionSnapshot = 0;
              for (const k of newKeysSnapshot)
                if (oldKeysSnapshot.has(k)) intersectionSnapshot += 1;
              const isBoundarySnapshot =
                oldKeysSnapshot.size === 0 ||
                intersectionSnapshot === 0 ||
                !priorCurrentListSnapshot;

              let shouldTriggerAutoSummary = false;
              if (!isBoundarySnapshot) {
                const oldHadIncomplete = oldTodos.some(
                  (t) => t.status !== "completed",
                );
                const newAllCompleted =
                  mirrored.length > 0 &&
                  mirrored.every((t) => t.status === "completed");
                const alreadyStamped =
                  priorCurrentListSnapshot?.summaryGeneratedAt !== undefined;
                shouldTriggerAutoSummary =
                  oldHadIncomplete && newAllCompleted && !alreadyStamped;
              }

              session.client.updateMetadata((m) => {
                const now = Date.now();
                const prior = m.progress;
                const lists = prior?.lists ? [...prior.lists] : [];
                const currentId = prior?.currentListId;
                const currentIdx = currentId
                  ? lists.findIndex((l) => l.id === currentId)
                  : -1;
                const currentList = currentIdx >= 0 ? lists[currentIdx] : undefined;

                // Boundary: SDK oldTodos and newTodos share zero content.
                // oldTodos empty (first TodoWrite) also counts as boundary so
                // we always allocate a list on the first mirror.
                const oldKeys = new Set(oldTodos.map((t) => t.content));
                const newKeys = new Set(mirrored.map((t) => t.content));
                let intersection = 0;
                for (const k of newKeys) if (oldKeys.has(k)) intersection += 1;
                const isBoundary = oldKeys.size === 0 || intersection === 0;
                logger.debug(
                  `[progress-mirror] ${mirrored.length} todos (boundary=${isBoundary ? "yes" : "no"}, old=${oldTodos.length}, intersect=${intersection})`,
                );

                const label = mirrored[0]
                  ? mirrored[0].content.length > 32
                    ? mirrored[0].content.slice(0, 31) + "…"
                    : mirrored[0].content
                  : undefined;

                let nextLists = lists;
                let nextCurrentId = currentId;

                if (isBoundary || currentIdx < 0) {
                  // Archive prior list (if any, even with un-completed items
                  // — preserves last-known state in history), start fresh.
                  if (currentIdx >= 0 && currentList) {
                    nextLists = lists.map((l, i) =>
                      i === currentIdx ? { ...l, archivedAt: now } : l,
                    );
                  }
                  const newId = randomUUID();
                  nextLists = [
                    ...nextLists,
                    {
                      id: newId,
                      label,
                      todos: mirrored,
                      startedAt: now,
                      updatedAt: now,
                    },
                  ];
                  nextCurrentId = newId;
                } else {
                  // Update-in-place: replace todos, preserve stage/blockers.
                  // Refresh label when the first todo's content changed, so
                  // a mid-list reorder doesn't leave a stale chip title. The
                  // `shouldTriggerAutoSummary` flag was pre-computed outside
                  // this handler (see snapshot block above); we just consume
                  // it here to stamp `summaryGeneratedAt` once.
                  nextLists = lists.map((l, i) => {
                    if (i !== currentIdx) return l;
                    const firstChanged =
                      !!mirrored[0] &&
                      !!l.todos[0] &&
                      mirrored[0].content !== l.todos[0].content;
                    return {
                      ...l,
                      todos: mirrored,
                      updatedAt: now,
                      label: firstChanged ? label : (l.label ?? label),
                      summaryGeneratedAt: shouldTriggerAutoSummary
                        ? now
                        : l.summaryGeneratedAt,
                    };
                  });
                }

                nextLists = capProgressLists(nextLists);

                return {
                  ...m,
                  progress: buildProgressStateFromLists({
                    lists: nextLists,
                    currentListId: nextCurrentId,
                    updatedAt: now,
                    fallbackTodos: mirrored,
                  }),
                };
              });

              // Auto-summary trigger: inject a synthetic user-role message so
              // the Agent is forced to run a new turn and decide whether to
              // call `mcp__happy__update_session_summary`. `displayText: ""`
              // hides the bubble in the App — the Agent still sees the text
              // since it drives the turn via SDK query().
              if (shouldTriggerAutoSummary) {
                try {
                  session.client.sendSyntheticUserMessage(
                    "[Auto-triggered by checklist completion]\n" +
                      "The session's active checklist just transitioned from having pending/in_progress items to fully completed. " +
                      "If the session summary needs updating to reflect what was accomplished, call mcp__happy__update_session_summary now. " +
                      "If the summary is already accurate, acknowledge briefly without calling.",
                    {
                      displayText: "",
                      sentFrom: "happy-cli-auto-summary",
                    },
                  );
                  logger.debug(
                    "[progress-mirror] auto-summary trigger dispatched",
                  );
                } catch (injectErr) {
                  logger.debug(
                    `[progress-mirror] auto-summary trigger failed: ${injectErr}`,
                  );
                }
              }
            }
          }
        }
      } catch (err) {
        logger.debug(`[progress-mirror] Error mirroring TodoWrite: ${err}`);
      }
    }

    // Attribute file-editing tool calls to the current progress list so the
    // App can render per-list file change summaries. Only stores tool_use id
    // refs; diff content lives in the original message and is resolved on
    // the consumer side.
    if (message.type === "assistant") {
      try {
        const aMsg = message as SDKAssistantMessage;
        const blocks = Array.isArray(aMsg.message.content)
          ? aMsg.message.content
          : [];
        const fileEditIds: string[] = [];
        for (const c of blocks) {
          if (c.type !== "tool_use") continue;
          if (
            c.name !== "Edit" &&
            c.name !== "Write" &&
            c.name !== "MultiEdit" &&
            c.name !== "NotebookEdit"
          )
            continue;
          if (typeof c.id === "string" && c.id.length > 0) {
            fileEditIds.push(c.id);
          }
        }
        if (fileEditIds.length > 0) {
          session.client.updateMetadata((m) => {
            const prior = m.progress;
            const lists = prior?.lists ? [...prior.lists] : [];
            const currentId = prior?.currentListId;
            if (!currentId) return m;
            const currentIdx = lists.findIndex((l) => l.id === currentId);
            if (currentIdx < 0) return m;
            const current = lists[currentIdx]!;
            const existing = current.toolCallIds ?? [];
            const existingSet = new Set(existing);
            const toAppend = fileEditIds.filter((id) => !existingSet.has(id));
            if (toAppend.length === 0) return m;
            const now = Date.now();
            const nextLists = lists.map((l, i) =>
              i === currentIdx
                ? {
                    ...l,
                    toolCallIds: [...existing, ...toAppend],
                    updatedAt: now,
                  }
                : l,
            );
            return {
              ...m,
              progress: buildProgressStateFromLists({
                lists: nextLists,
                currentListId: prior?.currentListId,
                updatedAt: now,
                fallbackTodos: prior?.todos,
                fallbackCurrentStage: prior?.currentStage,
                fallbackBlockers: prior?.blockers,
              }),
            };
          });
        }
      } catch (err) {
        logger.debug(`[progress-mirror] Error attributing file edits: ${err}`);
      }
    }

    // Report session timeline events (fire-and-forget)
    if (reportSessionEvent) {
      reportSessionEvent(message);
    }

    // Detect plan mode tool calls
    if (message.type === "assistant") {
      let umessage = message as SDKAssistantMessage;
      if (umessage.message.content && Array.isArray(umessage.message.content)) {
        for (let c of umessage.message.content) {
          if (c.type === "tool_use") {
            if (c.name === "exit_plan_mode" || c.name === "ExitPlanMode") {
              logger.debug("[remote]: detected plan mode tool call " + c.id!);
              planModeToolCalls.add(c.id! as string);

              // Save plan content to file for persistence and App full-screen viewing
              const planText = (c.input as Record<string, unknown> | undefined)?.plan as string | undefined;
              if (planText && session.sessionId) {
                const plansDir = join(getProjectPath(session.path), "plans");
                const planPath = join(plansDir, `${session.sessionId}.md`);
                // Set path immediately so RPC handler can find it even before write completes
                latestPlanFilePath = planPath;
                latestPlanContent = planText;
                mkdir(plansDir, { recursive: true })
                  .then(() => writeFile(planPath, planText, "utf-8"))
                  .then(() => {
                    logger.debug(`[remote]: plan saved to ${planPath}`);
                  })
                  .catch((err) =>
                    logger.debug(`[remote]: failed to save plan file: ${err}`),
                  );
              }
            }
            // When SDK enters plan mode via EnterPlanMode tool, sync permissionHandler
            // so ExitPlanMode goes through the normal approval flow instead of auto-approving.
            // Skip if already in bypass mode — ExitPlanMode should auto-approve in YOLO/bypass.
            if (c.name === "enter_plan_mode" || c.name === "EnterPlanMode") {
              if (permissionHandler.isInBypassMode()) {
                logger.debug(
                  "[remote]: detected EnterPlanMode in bypass mode — keeping bypass for auto-approve on ExitPlanMode",
                );
              } else {
                logger.debug(
                  "[remote]: detected EnterPlanMode — syncing permissionHandler to plan mode",
                );
                permissionHandler.handleModeChange("plan");
              }
            }
          }
        }
      }
    }

    // Track active tool calls
    if (message.type === "assistant") {
      let umessage = message as SDKAssistantMessage;
      if (umessage.message.content && Array.isArray(umessage.message.content)) {
        for (let c of umessage.message.content) {
          if (c.type === "tool_use") {
            logger.debug(
              "[remote]: detected tool use " +
                c.id! +
                " parent: " +
                umessage.parent_tool_use_id,
            );
            ongoingToolCalls.set(c.id!, {
              parentToolCallId: umessage.parent_tool_use_id ?? null,
            });
          }
        }
      }
    }
    // Collect tool call IDs to release atomically with the next enqueue
    let releaseIds: string[] = [];
    if (message.type === "user") {
      let umessage = message as SDKUserMessage;
      if (umessage.message.content && Array.isArray(umessage.message.content)) {
        for (let c of umessage.message.content) {
          if (c.type === "tool_result" && c.tool_use_id) {
            ongoingToolCalls.delete(c.tool_use_id);
            releaseIds.push(c.tool_use_id);
          }
        }
      }
    }

    // Forward status events to App (compacting, requesting, compact_boundary, etc.)
    if (message.type === "system") {
      const statusMsg = message as SDKStatusMsg;
      if (statusMsg.subtype === "status") {
        if (statusMsg.status === "compacting") {
          session.client.sendSessionEvent({
            type: "message",
            message: "Compacting context...",
          });
        } else if (statusMsg.status === "requesting") {
          // SDK 0.2.108+ fires this before every API call — including each
          // tool-result follow-up and retry. Show only the first occurrence
          // per turn so the App gets a single "Requesting..." signal instead
          // of a flood during long tool-chained turns. Use SDKAPIRetryMessage
          // if you need explicit retry visibility.
          if (!_requestingEventSentThisTurn) {
            _requestingEventSentThisTurn = true;
            session.client.sendSessionEvent({
              type: "message",
              message: "Requesting...",
            });
          }
        }
      } else if ((message as SDKCompactMsg).subtype === "compact_boundary") {
        session.client.sendSessionEvent({
          type: "message",
          message: "Context compacted",
        });
        // After compaction, seed read state for all tracked files so Edit doesn't fail
        if (currentQuery && readFilePaths.size > 0) {
          logger.debug(
            `[remote]: seeding read state for ${readFilePaths.size} files after compact`,
          );
          for (const filePath of readFilePaths) {
            stat(filePath)
              .then((s) =>
                currentQuery!.seedReadState(filePath, Math.floor(s.mtimeMs)),
              )
              .catch((e) =>
                logger.debug(`[remote]: seedReadState skipped for ${filePath}: ${e}`),
              );
          }
        }
      }
    }

    // Forward Task messages to session protocol
    if (
      message.type === "system" &&
      (message as SDKTaskStartedMessage).subtype === "task_started"
    ) {
      const m = message as SDKTaskStartedMessage;
      const envelope = createEnvelope("agent", {
        t: "task-start",
        taskId: m.task_id,
        toolUseId: m.tool_use_id,
        description: m.description,
        taskType: m.task_type,
        workflowName: (m as any).workflow_name,
      });
      session.client.sendSessionProtocolMessage(envelope);
    }

    // Forward Task progress to session protocol
    if (
      message.type === "system" &&
      (message as SDKTaskProgressMessage).subtype === "task_progress"
    ) {
      const m = message as SDKTaskProgressMessage;
      const envelope = createEnvelope("agent", {
        t: "task-progress",
        taskId: m.task_id,
        description: m.description,
        usage: m.usage
          ? {
              totalTokens: m.usage.total_tokens,
              toolUses: m.usage.tool_uses,
              durationMs: m.usage.duration_ms,
            }
          : undefined,
        lastToolName: m.last_tool_name,
        summary: m.summary,
      });
      session.client.sendSessionProtocolMessage(envelope);
    }

    // Forward memory recall to App as a session event (SDK 0.2.105+).
    // The supervisor surfaces relevant memory files into the turn; we only log
    // which memories were recalled so users can see "what I looked up".
    if (
      message.type === "system" &&
      (message as SDKMemoryRecallMessage).subtype === "memory_recall"
    ) {
      const m = message as SDKMemoryRecallMessage;
      const count = m.memories?.length ?? 0;
      if (count > 0) {
        const summary =
          m.mode === "synthesize"
            ? `Recalled ${count} memory ${count === 1 ? "note" : "notes"} (synthesized)`
            : `Recalled ${count} memory ${count === 1 ? "file" : "files"}`;
        session.client.sendSessionEvent({
          type: "message",
          message: summary,
        });
        logger.debug(
          `[remote] memory_recall (${m.mode}): ${m.memories.map((mem) => mem.path).join(", ")}`,
        );
      }
    }

    // Forward Task notification to session protocol
    if (
      message.type === "system" &&
      (message as SDKTaskNotificationMessage).subtype === "task_notification"
    ) {
      const m = message as SDKTaskNotificationMessage;
      const envelope = createEnvelope("agent", {
        t: "task-end",
        taskId: m.task_id,
        status: m.status,
        summary: m.summary,
        usage: m.usage
          ? {
              totalTokens: m.usage.total_tokens,
              toolUses: m.usage.tool_uses,
              durationMs: m.usage.duration_ms,
            }
          : undefined,
      });
      session.client.sendSessionProtocolMessage(envelope);
    }

    // Forward API retry status via keep-alive ephemeral channel
    if (
      message.type === "system" &&
      (message as SDKAPIRetryMessage).subtype === "api_retry"
    ) {
      const m = message as SDKAPIRetryMessage;
      session.client.keepAlive(true, "remote", true, {
        attempt: m.attempt,
        maxRetries: m.max_retries,
        retryDelayMs: m.retry_delay_ms,
        errorStatus: m.error_status ?? null,
      });
    }

    // Forward Tool progress to session protocol
    if (message.type === "tool_progress") {
      const m = message as SDKToolProgressMessage;
      const envelope = createEnvelope("agent", {
        t: "tool-progress",
        toolUseId: m.tool_use_id,
        toolName: m.tool_name,
        elapsedSeconds: m.elapsed_time_seconds,
        taskId: m.task_id,
      });
      session.client.sendSessionProtocolMessage(envelope);
    }

    // Forward prompt suggestion to session protocol
    if (message.type === "prompt_suggestion") {
      const suggestion = (message as SDKPromptSuggestionMessage).suggestion;
      if (suggestion) {
        const envelope = createEnvelope("agent", {
          t: "prompt-suggestion",
          suggestion,
        });
        session.client.sendSessionProtocolMessage(envelope);
      }
    }

    // Forward session state changes (idle/running/requires_action) to App
    if (
      message.type === "system" &&
      (message as SDKSessionStateChangedMessage).subtype === "session_state_changed"
    ) {
      const m = message as SDKSessionStateChangedMessage;
      const envelope = createEnvelope("agent", {
        t: "session-state-changed",
        state: m.state,
      });
      session.client.sendSessionProtocolMessage(envelope);
    }

    // Convert SDK message to log format and send to client
    let msg = message;

    // When the user approves a plan, the SDK lacks a direct "exit plan mode" API,
    // so permissionHandler sends a fake "deny" (PLAN_FAKE_REJECT) to force Claude
    // to stop planning. Here we intercept that fake rejection in the outgoing message
    // stream and rewrite it to "Plan approved" — so the client sees the correct status
    // instead of a confusing denial message.
    if (message.type === "user") {
      let umessage = message as SDKUserMessage;
      if (umessage.message.content && Array.isArray(umessage.message.content)) {
        msg = {
          ...umessage,
          message: {
            ...umessage.message,
            content: umessage.message.content.map((c: any) => {
              if (
                c.type === "tool_result" &&
                c.tool_use_id &&
                planModeToolCalls.has(c.tool_use_id!)
              ) {
                if (c.content === PLAN_FAKE_REJECT) {
                  logger.debug("[remote]: hack plan mode exit");
                  logger.debugLargeJson("[remote]: hack plan mode exit", c);
                  return {
                    ...c,
                    is_error: false,
                    content: "Plan approved",
                    mode: c.mode,
                  };
                } else {
                  return c;
                }
              }
              return c;
            }),
          },
        };
      }
    }

    const logMessage = sdkToLogConverter.convert(msg);
    if (logMessage) {
      // Add permissions field to tool result content
      if (logMessage.type === "user" && logMessage.message?.content) {
        const content = Array.isArray(logMessage.message.content)
          ? logMessage.message.content
          : [];

        // Modify the content array to add permissions to each tool_result
        for (let i = 0; i < content.length; i++) {
          const c = content[i];
          if (c.type === "tool_result" && c.tool_use_id) {
            const responses = permissionHandler.getResponses();
            const response = responses.get(c.tool_use_id);

            if (response) {
              const permissions: PermissionsField = {
                date: response.receivedAt || Date.now(),
                result: response.approved ? "approved" : "denied",
              };

              // Add optional fields if they exist
              if (response.mode) {
                permissions.mode = response.mode;
              }

              if (response.allowTools && response.allowTools.length > 0) {
                permissions.allowedTools = response.allowTools;
              }

              // Add permissions directly to the tool_result content object
              content[i] = {
                ...c,
                permissions,
              };
            }
          }
        }
      }

      // Queue message with optional delay for tool calls
      if (logMessage.type === "assistant" && message.type === "assistant") {
        const assistantMsg = message as SDKAssistantMessage;
        const toolCallIds: string[] = [];

        if (
          assistantMsg.message.content &&
          Array.isArray(assistantMsg.message.content)
        ) {
          for (const block of assistantMsg.message.content) {
            if (block.type === "tool_use" && block.id) {
              toolCallIds.push(block.id);
            }
          }
        }

        if (toolCallIds.length > 0) {
          // Check if this is a sidechain tool call (has parent_tool_use_id)
          const isSidechain = assistantMsg.parent_tool_use_id !== undefined;

          if (!isSidechain) {
            // Top-level tool call - queue with delay
            messageQueue.enqueue(logMessage, {
              delay: 250,
              toolCallIds,
              releaseToolCallIds:
                releaseIds.length > 0 ? releaseIds : undefined,
            });
            return; // Don't queue again below
          }
        }
      }

      // Queue all other messages immediately (no delay), releasing any pending tool calls atomically
      messageQueue.enqueue(
        logMessage,
        releaseIds.length > 0 ? { releaseToolCallIds: releaseIds } : undefined,
      );
    }

    // Insert a fake message to start the sidechain
    if (message.type === "assistant") {
      let umessage = message as SDKAssistantMessage;
      if (umessage.message.content && Array.isArray(umessage.message.content)) {
        for (let c of umessage.message.content) {
          if (
            c.type === "tool_use" &&
            (c.name === "Task" || c.name === "Agent") &&
            c.input &&
            typeof (c.input as Record<string, unknown>).prompt === "string"
          ) {
            const logMessage2 = sdkToLogConverter.convertSidechainUserMessage(
              c.id!,
              (c.input as Record<string, unknown>).prompt as string,
            );
            if (logMessage2) {
              messageQueue.enqueue(logMessage2);
            }
          }
        }
      }
    }
  }

  // ── MCP Elicitation: forward to App, wait for response via RPC ──
  // Hoisted outside the per-turn loop so pending elicitations survive across turns
  const pendingElicitations = new Map<
    string,
    { resolve: (result: ElicitationResult) => void; reject: (err: Error) => void }
  >();
  let elicitationCounter = 0;

  session.client.rpcHandlerManager.registerHandler(
    "elicitationResponse",
    async (response: { id: string; action: string; content?: Record<string, unknown> }) => {
      const pendingItem = pendingElicitations.get(response.id);
      if (!pendingItem) {
        logger.debug(`[remote]: elicitationResponse for unknown id ${response.id}`);
        return;
      }
      const validActions = ["accept", "decline", "cancel"] as const;
      if (!validActions.includes(response.action as typeof validActions[number])) {
        logger.debug(`[remote]: invalid elicitation action: ${response.action}`);
        return;
      }
      pendingElicitations.delete(response.id);
      // Clear the elicitation banner from App
      session.client.updateAgentState((s) => ({ ...s, elicitation: null }));
      pendingItem.resolve({
        action: response.action as "accept" | "decline" | "cancel",
        content: response.content,
      } as ElicitationResult);
    },
  );

  const handleElicitation = async (
    request: ElicitationRequest,
    options: { signal: AbortSignal },
  ): Promise<ElicitationResult> => {
    const id = `elicit-${++elicitationCounter}`;
    logger.debug(`[remote]: MCP elicitation request from ${request.serverName}: ${id}`);

    return new Promise<ElicitationResult>((resolve, reject) => {
      const abortHandler = () => {
        pendingElicitations.delete(id);
        // Clear the elicitation banner on abort
        session.client.updateAgentState((s) => ({ ...s, elicitation: null }));
        reject(new Error("Elicitation aborted"));
      };
      options.signal.addEventListener("abort", abortHandler, { once: true });

      pendingElicitations.set(id, {
        resolve: (result) => {
          options.signal.removeEventListener("abort", abortHandler);
          resolve(result);
        },
        reject: (err) => {
          options.signal.removeEventListener("abort", abortHandler);
          reject(err);
        },
      });

      // Push elicitation request to App via agent state
      session.client.updateAgentState((currentState) => ({
        ...currentState,
        elicitation: {
          id,
          serverName: request.serverName,
          message: request.message,
          mode: request.mode ?? "form",
          url: request.url,
          requestedSchema: request.requestedSchema,
        },
      }));

      // Send push notification
      session.api
        .push()
        .sendToAllDevices(
          "MCP Input Required",
          `${request.serverName}: ${request.message}`,
          {
            sessionId: session.client.sessionId,
            type: "elicitation_request",
          },
        );
    });
  };

  try {
    let pending: {
      message: string;
      mode: EnhancedMode;
      requestIds: string[];
      queueWaitMs?: number;
      socketToQueueMs?: number;
    } | null = null;

    // Track session ID to detect when it actually changes
    // This prevents context loss when mode changes (permission mode, model, etc.)
    // without starting a new session. Only reset parent chain when session ID
    // actually changes (e.g., new session started or /clear command used).
    // See: https://github.com/anthropics/happy-cli/issues/143
    let previousSessionId: string | null = null;
    while (!exitReason) {
      logger.debug("[remote]: launch");
      messageBuffer.addMessage("═".repeat(40), "status");

      // Clear transient agentState from previous turn
      session.client.updateAgentState((s) => ({
        ...s,
        stopFailure: null,
      }));

      // Only reset parent chain and show "new session" message when session ID actually changes
      const isNewSession = session.sessionId !== previousSessionId;
      if (isNewSession) {
        messageBuffer.addMessage("Starting new Claude session...", "status");
        permissionHandler.reset(); // Reset permissions before starting new session
        sdkToLogConverter.resetParentChain(); // Reset parent chain for new conversation
        logger.debug(
          `[remote]: New session detected (previous: ${previousSessionId}, current: ${session.sessionId})`,
        );
        // Reset knowledge injection state for the new session (/clear creates a new session)
        knowledgeInjected = false;
        knowledgeContext = null;
        knowledgeEntries = new Map();
        pendingKnowledgeRefresh = false;
        pendingFileHint = null;
        currentTurnFilePaths = new Set<string>();
        if (knowledgeEnabled) {
          const mode = (process.env.HAPPY_KNOWLEDGE_MODE as "auto" | "full" | "minimal") || "auto";
          session.client.fetchKnowledge(mode).then((result) => {
            if (result && (result.profile || result.entries.length > 0)) {
              knowledgeContext = formatKnowledgeForInjection(result);
              logger.debug(`[knowledge] Re-fetched context after session reset: ${knowledgeContext!.length} chars, ${result.entries.length} entries`);
            }
            syncKnowledgeConfig(result?.knowledgeConfig);
          }).catch((err) => {
            logger.debug(`[knowledge] Failed to re-fetch after session reset: ${err}`);
          });
        }
      } else {
        messageBuffer.addMessage("Continuing Claude session...", "status");
        logger.debug(
          `[remote]: Continuing existing session: ${session.sessionId}`,
        );
      }

      previousSessionId = session.sessionId;
      const controller = new AbortController();
      abortController = controller;
      abortFuture = new Future<void>();
      let modeHash: string | null = null;
      let mode: EnhancedMode | null = null;

      // "Cold hash" detects changes that require a process restart.
      // It intentionally excludes fields that can be hot-swapped:
      //   - model: hot-swapped via setModel() (within same context window tier)
      //   - permissionMode (between non-plan, non-bypass modes): via setPermissionMode()
      // Cold restart is required for:
      //   - plan ↔ non-plan: different tool sets (ExitPlanMode etc.)
      //   - bypassPermissions ↔ other: AskUserQuestion disallowedTools changes
      //   - context window tier change (200K ↔ 1M): SDK bug — setModel() doesn't
      //     update options.mainLoopModel, so auto-compact threshold stays stale
      //   - thinking, effort, maxBudgetUsd: SDK has no runtime set methods
      const coldModeHash = (m: EnhancedMode) => {
        const mapped = mapToClaudeMode(m.permissionMode);
        return hashObject({
          isPlan: mapped === "plan",
          isBypass: mapped === "bypassPermissions",
          isExtendedContext: m.model?.endsWith("-1m") ?? false,
          fallbackModel: m.fallbackModel,
          customSystemPrompt: m.customSystemPrompt,
          appendSystemPrompt: m.appendSystemPrompt,
          allowedTools: m.allowedTools,
          disallowedTools: m.disallowedTools,
          maxBudgetUsd: m.maxBudgetUsd,
          thinking: m.thinking,
          effort: m.effort,
          taskBudget: m.taskBudget,
          locale: m.locale,
          betas: m.betas,
          agent: m.agent,
          agents: m.agents,
          outputFormat: m.outputFormat,
          plugins: m.plugins,
          additionalDirectories: m.additionalDirectories,
        });
      };
      let currentColdHash: string | null = null;
      let midTurnPushFn: ((msg: SDKUserMessage) => void) | null = null;
      let turnDrainController: AbortController | null = null;

      // Drain mid-turn messages from the queue and push them directly to the SDK.
      // This runs concurrently during a turn, allowing user messages sent from
      // the App to be injected into the CLI subprocess stdin immediately rather
      // than waiting for the turn to complete.
      async function drainMidTurnMessages(
        signal: AbortSignal,
        currentHash: string,
        pushFn: (msg: SDKUserMessage) => void,
      ) {
        logger.debug("[remote]: mid-turn drain started");
        while (!signal.aborted) {
          const hasNew = await session.queue.waitForNewMessage(signal);
          if (!hasNew || signal.aborted) break;

          const item = session.queue.tryTakeForMidTurn(
            currentHash,
            coldModeHash,
          );

          if (!item) {
            // Message exists but can't be mid-turn pushed.
            // If it's an isolate (/compact, /clear), interrupt the current turn
            // so nextMessage() can handle it properly.
            if (session.queue.peekIsolate()) {
              logger.debug(
                "[remote]: mid-turn drain — isolate detected, interrupting",
              );
              executionGuard.interrupt("isolated_command");
              await doInterrupt();
            } else {
              executionGuard.requestRestart("mode_change");
            }
            // For other non-mid-turn cases (cold hash change, continue),
            // just stop draining and let nextMessage() handle after turn ends.
            break;
          }

          // Handle shell commands directly without sending to Claude
          const specialCmd = parseSpecialCommand(item.message);
          if (specialCmd.type === "shell" && specialCmd.shellCommand) {
            logger.debug("[remote]: mid-turn drain — executing shell command");
            const output = await executeShellCommand(
              specialCmd.shellCommand,
              session.path,
            );
            session.client.sendDirectResult(output);
            continue;
          }

          // Hot-swap model if changed
          if (mode && item.mode.model !== mode.model && currentQuery) {
            const resolvedModel = resolveModelKey(item.mode.model);
            if (resolvedModel) {
              logger.debug(
                `[remote]: mid-turn hot-swap model: ${mode.model} → ${resolvedModel}`,
              );
              try {
                await currentQuery.setModel(resolvedModel);
              } catch (e) {
                logger.debug("[remote]: mid-turn setModel failed", e);
              }
            }
          }

          // Hot-swap permissionMode if changed (non-plan, non-bypass only)
          // Use mapToClaudeMode to convert Codex modes (yolo/safe-yolo/read-only)
          // to SDK-compatible modes before comparison and SDK call.
          if (mode && currentQuery) {
            const newMapped = mapToClaudeMode(item.mode.permissionMode);
            const currentMapped = mapToClaudeMode(mode.permissionMode);
            if (
              newMapped !== currentMapped &&
              newMapped !== "plan" && currentMapped !== "plan" &&
              newMapped !== "bypassPermissions" && currentMapped !== "bypassPermissions"
            ) {
              logger.debug(
                `[remote]: mid-turn hot-swap permissionMode: ${currentMapped} → ${newMapped}`,
              );
              try {
                await currentQuery.setPermissionMode(newMapped);
              } catch (e) {
                logger.debug("[remote]: mid-turn setPermissionMode failed", e);
              }
              permissionHandler.handleModeChange(item.mode.permissionMode);
            }
          }

          // Update tracked mode state
          modeHash = item.modeHash;
          mode = item.mode;

          // Push the message to the SDK for mid-turn injection
          logger.debug(
            `[remote]: mid-turn push — ${item.message.length} chars`,
          );
          pushFn({
            type: "user",
            message: { role: "user", content: item.message },
            parent_tool_use_id: null,
            session_id: undefined,
          });
        }
        logger.debug("[remote]: mid-turn drain stopped");
      }

      function startMidTurnDrain() {
        if (!midTurnPushFn || !currentColdHash) return;
        // Stop any previous drain
        turnDrainController?.abort();
        turnDrainController = new AbortController();
        drainMidTurnMessages(
          turnDrainController.signal,
          currentColdHash,
          midTurnPushFn,
        );
      }

      function stopMidTurnDrain() {
        turnDrainController?.abort();
        turnDrainController = null;
      }

      const knowledgeMcpServer = knowledgeEnabled ? createSdkMcpServer({
        name: "happy-knowledge",
        tools: [
          {
            name: "query_project_knowledge",
            description: "Search the project knowledge base for relevant context, past decisions, known pitfalls, and conventions. Use this when you need to understand project-specific patterns or recall past work.",
            inputSchema: { query: z.string().describe("Search query describing what you want to know") },
            handler: async (args: { [x: string]: unknown }) => {
              const query = typeof args["query"] === "string" ? args["query"] : "";
              try {
                const result = await session.client.fetchKnowledge("auto", [query]);
                syncKnowledgeConfig(result?.knowledgeConfig);
                if (!result || result.entries.length === 0) {
                  return { content: [{ type: "text" as const, text: "No relevant knowledge found." }] };
                }
                const lines = result.entries.map((e: { entryType: string; title: string; content: string; confidence: string }) =>
                  `[${e.entryType}] ${e.title} (${e.confidence})\n${e.content.slice(0, 500)}`
                );
                return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
              } catch (err) {
                logger.debug(`[knowledge] MCP tool query_project_knowledge failed: ${err}`);
                return { content: [{ type: "text" as const, text: "Knowledge query failed." }] };
              }
            },
          },
        ],
      }) : null;

      try {
        const remoteResult = await claudeRemote({
          sessionId: session.sessionId,
          path: session.path,
          allowedTools: session.allowedTools ?? [],
          mcpServers: {
            ...session.mcpServers,
            ...(knowledgeMcpServer ? { "happy-knowledge": knowledgeMcpServer } : {}),
          },
          hookSettingsPath: session.hookSettingsPath,
          jsRuntime: session.jsRuntime,
          canCallTool: permissionHandler.handleToolCall,
          onElicitation: handleElicitation,
          isAborted: (toolCallId: string) => {
            return permissionHandler.isAborted(toolCallId);
          },
          onTurnComplete: () => {
            finishTurn();
          },
          nextMessage: async () => {
            // Stop any running mid-turn drain from the previous turn
            stopMidTurnDrain();

            if (pending) {
              let p = pending;
              pending = null;
              dispatchTurn(reasonForQueuedMessage(p));
              // Reset E2E perf tracking for new turn
              _perfTurnSocketReceivedAt = p.mode._perfSocketReceivedAt;
              _perfTurnFirstResponseLogged = false;
              _requestingEventSentThisTurn = false;
              permissionHandler.handleModeChange(p.mode.permissionMode);
              startMidTurnDrain();
              return p;
            }

            const dequeueStartAt = Date.now();
            let msg = await session.queue.waitForMessagesAndGetAsString(
              controller.signal,
            );
            const dequeuedAt = Date.now();
            if (msg) {
              logger.debug(`[perf] nextMessage: dequeue took ${dequeuedAt - dequeueStartAt}ms, msg=${msg.message.substring(0, 80)}`);
            }

            if (msg) {
              // Check if mode has changed
              if (msg.isolate) {
                logger.debug("[remote]: isolate requested, pending message");
                executionGuard.requestRestart("isolated_command");
                pending = msg;
                return null;
              }

              // continue requires a fresh query with sdkOptions.continue=true
              if (msg.mode.continue) {
                logger.debug(
                  "[remote]: continue flag detected, forcing restart for new query",
                );
                executionGuard.requestRestart("continue");
                pending = msg;
                return null;
              }

              if (modeHash && msg.hash !== modeHash) {
                // Mode changed. Check if cold-restart fields are unchanged (hot-swappable).
                const newColdHash = coldModeHash(msg.mode);
                if (currentColdHash && newColdHash === currentColdHash) {
                  // Only hot-swappable fields changed (model and/or permissionMode)
                  const changed = [
                    mode?.model !== msg.mode.model && "model",
                    mode?.permissionMode !== msg.mode.permissionMode &&
                      "permissionMode",
                  ]
                    .filter(Boolean)
                    .join(", ");
                  logger.debug(
                    `[remote]: hot-swap detected (${changed || "unknown"}), no restart needed`,
                  );
                  dispatchTurn(reasonForQueuedMessage(msg));
                  modeHash = msg.hash;
                  mode = msg.mode;
                  // Reset E2E perf tracking for hot-swap turn
                  _perfTurnSocketReceivedAt = msg.mode._perfSocketReceivedAt;
                  _perfTurnFirstResponseLogged = false;
                  _requestingEventSentThisTurn = false;
                  permissionHandler.handleModeChange(mode.permissionMode);
                  startMidTurnDrain();
                  return {
                    message: msg.message,
                    mode: msg.mode,
                  };
                }

                // Other fields changed — cold restart required
                logger.debug(
                  "[remote]: non-model mode change detected, pending message for restart",
                );
                executionGuard.requestRestart("mode_change");
                pending = msg;
                return null;
              }

              dispatchTurn(reasonForQueuedMessage(msg));
              modeHash = msg.hash;
              mode = msg.mode;
              currentColdHash = coldModeHash(mode);
              // Reset E2E perf tracking for new turn
              _perfTurnSocketReceivedAt = msg.mode._perfSocketReceivedAt;
              _perfTurnFirstResponseLogged = false;
              _requestingEventSentThisTurn = false;
              permissionHandler.handleModeChange(mode.permissionMode);
              startMidTurnDrain();

              // Knowledge injection: append to first message's system prompt
              let effectiveKnowledgeContext = knowledgeContext;

              if (!knowledgeInjected && knowledgeEnabled) {
                // If pre-fetch hasn't completed yet, do a contextual fetch with hints (max 1500ms)
                if (!effectiveKnowledgeContext) {
                  const hints = extractKnowledgeHints(msg.message, 8);
                  if (hints.length > 0) {
                    try {
                      const fetchMode = (process.env.HAPPY_KNOWLEDGE_MODE as "auto" | "full" | "minimal") || "auto";
                      const contextualResult = await Promise.race([
                        session.client.fetchKnowledge(fetchMode, hints),
                        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
                      ]);
                      if (contextualResult && (contextualResult.profile || contextualResult.entries.length > 0)) {
                        effectiveKnowledgeContext = formatKnowledgeForInjection(contextualResult);
                        knowledgeContext = effectiveKnowledgeContext;
                        logger.debug(`[knowledge] Contextual fetch on first message: ${effectiveKnowledgeContext.length} chars, ${contextualResult.entries.length} entries`);
                      }
                      syncKnowledgeConfig(contextualResult?.knowledgeConfig);
                    } catch (err) {
                      logger.debug(`[knowledge] Contextual fetch failed: ${err}`);
                    }
                  }
                }
              } else if (knowledgeInjected && pendingKnowledgeRefresh && knowledgeEnabled) {
                // Per-turn refresh: check if new knowledge entries exist since last injection.
                // Instead of re-injecting via appendSystemPrompt (which accumulates tokens),
                // prepend a lightweight notification to the user message so Claude can use
                // the query_project_knowledge MCP tool to fetch relevant details on demand.
                pendingKnowledgeRefresh = false;
                const hints = extractKnowledgeHints(msg.message, 8);
                logger.debug(`[knowledge] Per-turn refresh check: ${hints.length} hints from message`);
                try {
                  const refreshResult = await Promise.race([
                    session.client.fetchKnowledge("auto", hints.length > 0 ? hints : undefined),
                    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
                  ]);
                  syncKnowledgeConfig(refreshResult?.knowledgeConfig);
                  if (refreshResult && refreshResult.entries.length > 0) {
                    const newEntries = refreshResult.entries.filter((e) => !knowledgeEntries.has(e.id));
                    logger.debug(`[knowledge] Per-turn refresh: ${refreshResult.entries.length} total, ${newEntries.length} new`);
                    if (newEntries.length > 0) {
                      for (const e of newEntries) {
                        knowledgeEntries.set(e.id, { id: e.id, title: e.title, tags: e.tags });
                      }
                      // Prepend a lightweight hint — Claude uses query_project_knowledge to get details
                      const titles = newEntries.map((e) => `"${e.title}"`).join(", ");
                      const hint = `[Knowledge base update: ${newEntries.length} new ${newEntries.length === 1 ? "entry" : "entries"} added (${titles}). Use query_project_knowledge tool if relevant to this task.]\n\n`;
                      return {
                        message: hint + msg.message,
                        mode: msg.mode,
                      };
                    }
                  } else {
                    logger.debug(`[knowledge] Per-turn refresh: timeout or no entries`);
                  }
                } catch (err) {
                  logger.debug(`[knowledge] Per-turn refresh failed: ${err}`);
                }
              }

              // File-aware hint: prepend if available and no higher-priority injection is pending
              if (knowledgeInjected && pendingFileHint) {
                const hint = pendingFileHint;
                pendingFileHint = null;
                return {
                  message: hint + msg.message,
                  mode: msg.mode,
                };
              }

              const returnMode = !knowledgeInjected && effectiveKnowledgeContext
                ? {
                  ...msg.mode,
                  appendSystemPrompt: msg.mode.appendSystemPrompt
                    ? msg.mode.appendSystemPrompt + "\n\n" + effectiveKnowledgeContext
                    : effectiveKnowledgeContext,
                }
                : msg.mode;
              if (!knowledgeInjected && effectiveKnowledgeContext) {
                knowledgeInjected = true;
                // Track injected entry IDs (parse from context — use knowledgeContext from pre-fetch if available)
                // IDs are tracked separately via knowledgeEntryIds when we have the raw result
                logger.debug("[knowledge] Injected knowledge into first message system prompt");
              }

              return {
                message: msg.message,
                mode: returnMode,
              };
            }

            // Exit
            return null;
          },
          onSessionFound: (sessionId) => {
            // Update converter's session ID when new session is found
            sdkToLogConverter.updateSessionId(sessionId);
            session.onSessionFound(sessionId);
          },
          onThinkingChange: session.onThinkingChange,
          claudeEnvVars: session.claudeEnvVars,
          claudeArgs: session.claudeArgs,
          onMessage,
          onCompletionEvent: (message: string) => {
            logger.debug(`[remote]: Completion event: ${message}`);
            session.client.sendSessionEvent({ type: "message", message });
          },
          onShellResult: (output: string) => {
            logger.debug("[remote]: Shell command result received");
            session.client.sendDirectResult(output);
          },
          onQueryReady: (query) => {
            currentQuery = query;
            // Knowledge base: mark new turn start
            if (turnCollector) {
              const turnId = `turn-${Date.now()}`;
              const model = session.model ?? "unknown";
              turnCollector.startTurn(turnId, model);
            }
          },
          onMessagesReady: (pushFn) => {
            midTurnPushFn = pushFn;
          },
          onInitialized: (info) => {
            logger.debug(
              `[remote]: SDK initialized — ${info.models?.length ?? 0} models`,
            );
            if (info.models && info.models.length > 0) {
              session.client.updateMetadata((m) => ({
                ...m,
                models: info.models,
              }));
            }
          },
          onSessionReset: () => {
            logger.debug("[remote]: Session reset");
            session.clearSessionId();
          },
          onResult: (data) => {
            lastResultData = data;
          },
          onContextUsage: (ctx) => {
            const envelope = createEnvelope("agent", {
              t: "context-usage" as const,
              totalTokens: ctx.totalTokens,
              maxTokens: ctx.maxTokens,
              percentage: ctx.percentage,
              model: ctx.model,
              categories: ctx.categories?.map((c) => ({
                name: c.name,
                tokens: c.tokens,
                ...(c.color ? { color: c.color } : {}),
              })),
              isAutoCompactEnabled: ctx.isAutoCompactEnabled,
              autoCompactThreshold: ctx.autoCompactThreshold,
              messageBreakdown: ctx.messageBreakdown,
            });
            session.client.sendSessionProtocolMessage(envelope);
          },
          onMaxTurnsReached: () => {
            logger.debug(
              "[remote]: Max turns reached — sending needs-continue",
            );
            const envelope = createEnvelope("agent", {
              t: "needs-continue",
            });
            session.client.sendSessionProtocolMessage(envelope);
          },
          onReady: async () => {
            // Stop mid-turn drain before flushing — prevents race with nextMessage()
            stopMidTurnDrain();

            // Knowledge base: process turn end and check if extraction needed
            // Wrapped in try-catch to never block session flow
            try {
              if (turnCollector) {
                const outputTokens = lastResultData?.modelUsage
                  ? Object.values(lastResultData.modelUsage).reduce((sum, m) => sum + m.outputTokens, 0)
                  : 0;
                const readyTurns = turnCollector.onTurnEnd(outputTokens);
                if (readyTurns) {
                  pendingKnowledgeRefresh = true;
                  logger.debug(`[knowledge] Submitting ${readyTurns.length} turns`);
                  for (const turn of readyTurns) {
                    session.client.submitKnowledge({
                      entryType: inferEntryType(turn.userMessage, turn.assistantText),
                      contributorType: "session",
                      action: "create",
                      title: turn.userMessage.split("\n")[0].slice(0, 200) || "Session activity",
                      content: turn.assistantText.slice(0, 2000),
                      request: turn.userMessage.slice(0, 500),
                      outcome: turn.fileEdits.length > 0
                        ? `Modified ${turn.fileEdits.length} file(s): ${turn.fileEdits.map((f) => f.path).join(", ").slice(0, 500)}`
                        : undefined,
                      tags: extractTags(turn.fileEdits),
                      confidence: turn.outputTokens > 1000 ? "high" : "medium",
                      model: turn.model,
                      affectedFiles: turn.fileEdits.map((f) => f.path),
                    });
                  }
                }
              }
            } catch (err) {
              logger.debug(`[knowledge] Error in onReady turn processing: ${err}`);
            }

            // Per-turn hit detection: which injected knowledge entries were referenced
            // by the assistant in this turn? Substring match on full title, title words,
            // and tags catches real usage without an extra LLM pass. Server uses this
            // to tick TTL counters. Emit even when hitIds is empty so the server can
            // decrement misses on every turn.
            try {
              if (turnCollector && knowledgeEntries.size > 0) {
                const assistantText = turnCollector.getAssistantTextSnapshot().toLowerCase();
                if (assistantText.length > 0) {
                  const hitIds: string[] = [];
                  for (const entry of knowledgeEntries.values()) {
                    let matched = false;
                    const lowerTitle = entry.title.toLowerCase();
                    if (lowerTitle.length >= 6 && assistantText.includes(lowerTitle)) {
                      matched = true;
                    }
                    // Match any significant title word (>=4 chars, alphanumeric) so partial
                    // paraphrases still register as a hit without reaching a full-title match.
                    if (!matched) {
                      const titleWords = lowerTitle
                        .split(/[^\p{L}\p{N}]+/u)
                        .filter((w) => w.length >= 4);
                      for (const word of titleWords) {
                        if (assistantText.includes(word)) {
                          matched = true;
                          break;
                        }
                      }
                    }
                    if (!matched) {
                      for (const tag of entry.tags) {
                        const lowerTag = tag.toLowerCase();
                        if (lowerTag.length >= 2 && assistantText.includes(lowerTag)) {
                          matched = true;
                          break;
                        }
                      }
                    }
                    if (matched) hitIds.push(entry.id);
                  }
                  session.client.emitKnowledgeTurnEnd(hitIds);
                  logger.debug(
                    `[knowledge] Turn-end hits: ${hitIds.length}/${knowledgeEntries.size} (injected entries)`,
                  );
                }
              }
            } catch (err) {
              logger.debug(`[knowledge] Error detecting turn hits: ${err}`);
            }

            // File-aware knowledge hint: check edited files against knowledge base
            // Fire-and-forget — result stored for next message prefix
            if (knowledgeEnabled && currentTurnFilePaths.size > 0) {
              const editedPaths = [...currentTurnFilePaths];
              currentTurnFilePaths = new Set<string>();
              const fileHints = extractTags(editedPaths.map((p) => ({ path: p, type: "edit" as const })));
              if (fileHints.length > 0) {
                session.client.fetchKnowledge("auto", fileHints).then((result) => {
                  syncKnowledgeConfig(result?.knowledgeConfig);
                  if (!result || result.entries.length === 0) return;
                  const newEntries = result.entries.filter((e) => !knowledgeEntries.has(e.id));
                  if (newEntries.length === 0) return;
                  for (const e of newEntries) {
                    knowledgeEntries.set(e.id, { id: e.id, title: e.title, tags: e.tags });
                  }
                  const fileNames = editedPaths.map((p) => p.split("/").pop()).filter(Boolean).join(", ");
                  const titles = newEntries.slice(0, 3).map((e) => `"${e.title}"`).join(", ");
                  pendingFileHint = `[File knowledge hint: you edited ${fileNames} — ${newEntries.length} related knowledge ${newEntries.length === 1 ? "entry" : "entries"} found (${titles}). Use query_project_knowledge if relevant.]\n\n`;
                  logger.debug(`[knowledge] File-aware hint queued for ${newEntries.length} entries`);
                }).catch((err) => {
                  logger.debug(`[knowledge] File-aware hint fetch failed: ${err}`);
                });
              }
            } else {
              currentTurnFilePaths = new Set<string>();
            }

            // Flush queued messages before closing the turn to prevent
            // turn-end from arriving at the App before delayed tool call messages
            await messageQueue.flush();
            session.client.closeClaudeSessionTurn(
              "completed",
              lastResultData ?? undefined,
            );
            lastResultData = null;
            if (!pending && session.queue.size() === 0) {
              session.api
                .push()
                .sendToAllDevices(
                  "It's ready!",
                  `Claude is waiting for your command`,
                  { sessionId: session.client.sessionId },
                );
            }
          },
          signal: abortController.signal,
        });

        // Consume one-time Claude flags after spawn
        session.consumeOneTimeFlags();

        if (!exitReason && abortController.signal.aborted) {
          session.client.closeClaudeSessionTurn("cancelled", lastResultData ?? undefined);
          lastResultData = null;
          session.client.sendSessionEvent({
            type: "message",
            message: "Aborted by user",
          });
        }
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.debug("[remote]: launch error", err.message, err.stack, e);
        if (!exitReason) {
          session.client.closeClaudeSessionTurn("failed", lastResultData ?? undefined);
          lastResultData = null;
          session.client.sendSessionEvent({
            type: "message",
            message: `Process exited unexpectedly: ${err.message}`,
          });
          continue;
        }
      } finally {
        logger.debug("[remote]: launch finally");
        lastResultData = null;

        // Stop mid-turn drain and clear push function to prevent stale pushes
        stopMidTurnDrain();
        midTurnPushFn = null;

        // Clear query reference immediately to prevent stale interrupt/stopTask calls
        // But preserve a reference for post-turn rewindFiles operations
        lastCompletedQuery = currentQuery;
        currentQuery = null;

        // Terminate all ongoing tool calls
        for (let [toolCallId, { parentToolCallId }] of ongoingToolCalls) {
          const converted = sdkToLogConverter.generateInterruptedToolResult(
            toolCallId,
            parentToolCallId,
          );
          if (converted) {
            logger.debug(
              "[remote]: terminating tool call " +
                toolCallId +
                " parent: " +
                parentToolCallId,
            );
            session.client.sendClaudeSessionMessage(converted);
          }
        }
        ongoingToolCalls.clear();

        // Knowledge base: flush any pending turns before session teardown
        // Wrapped in try-catch to never block session cleanup
        try {
          if (turnCollector) {
            const finalTurns = turnCollector.flush();
            if (finalTurns) {
              logger.debug(`[knowledge] Flushing ${finalTurns.length} pending turns on exit`);
              for (const turn of finalTurns) {
                session.client.submitKnowledge({
                  entryType: inferEntryType(turn.userMessage, turn.assistantText),
                  contributorType: "session",
                  action: "create",
                  title: turn.userMessage.split("\n")[0].slice(0, 200) || "Session activity",
                  content: turn.assistantText.slice(0, 2000),
                  request: turn.userMessage.slice(0, 500),
                  outcome: turn.fileEdits.length > 0
                    ? `Modified ${turn.fileEdits.length} file(s): ${turn.fileEdits.map((f) => f.path).join(", ").slice(0, 500)}`
                    : undefined,
                  tags: extractTags(turn.fileEdits),
                  confidence: turn.outputTokens > 1000 ? "high" : "medium",
                  model: turn.model,
                  affectedFiles: turn.fileEdits.map((f) => f.path),
                });
              }
            }
          }
        } catch (err) {
          logger.debug(`[knowledge] Error flushing turns on exit: ${err}`);
        }

        // Stop all task-log watchers
        try {
          const { stopAll } = await import("@/modules/taskLog/taskLogWatcher");
          stopAll();
        } catch {
          // ignore — module may not have been loaded
        }

        // Flush any remaining messages in the queue
        logger.debug("[remote]: flushing message queue");
        await messageQueue.flush();
        messageQueue.destroy();
        logger.debug("[remote]: message queue flushed");

        // Abort old controller to terminate the previous Claude child process
        // This is critical for ExitPlanMode: claudeRemote returns via isAborted
        // but without aborting the controller, the old child process keeps running
        // and conflicts with the new one that resumes the same session.
        if (controller && !controller.signal.aborted) {
          logger.debug(
            "[remote]: aborting previous controller to kill old child process",
          );
          controller.abort();
        }

        // Reset abort controller and future
        abortController = null;
        abortFuture?.resolve(undefined);
        abortFuture = null;
        logger.debug("[remote]: launch done");
        permissionHandler.reset();
        modeHash = null;
        mode = null;
        currentColdHash = null;
      }
    }
  } finally {
    // Drain any pending elicitations to prevent Promise/listener leaks
    for (const [id, { reject }] of pendingElicitations) {
      reject(new Error("Session ended"));
    }
    pendingElicitations.clear();

    // Clean up permission handler
    permissionHandler.reset();

    // Reset Terminal
    process.stdin.off("data", abort);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    if (inkInstance) {
      inkInstance.unmount();
    }
    messageBuffer.clear();

    // Resolve abort future
    if (abortFuture) {
      // Just in case of error
      abortFuture.resolve(undefined);
    }

    executionGuard.close();
  }

  return exitReason || "exit";
}

// ─── Knowledge base helpers ───

function inferEntryType(userMessage: string, assistantText: string): string {
  const text = `${userMessage} ${assistantText}`.toLowerCase();
  if (text.includes("fix") || text.includes("bug") || text.includes("error") || text.includes("修复")) return "fix";
  if (text.includes("决策") || text.includes("选型") || text.includes("decision") || text.includes("choose")) return "decision";
  if (text.includes("规范") || text.includes("convention") || text.includes("规则")) return "convention";
  if (text.includes("注意") || text.includes("warning") || text.includes("危险") || text.includes("雷区")) return "warning";
  return "discovery";
}

function extractTags(fileEdits: { path: string; type: string }[]): string[] {
  const tags = new Set<string>();
  for (const edit of fileEdits) {
    const ext = edit.path.split(".").pop();
    if (ext) tags.add(ext);
    const parts = edit.path.split("/");
    if (parts.length > 1) {
      const dir = parts[parts.length - 2];
      if (dir && dir.length < 20) tags.add(dir);
    }
  }
  return [...tags].slice(0, 10);
}

function formatKnowledgeForInjection(result: {
  profile: {
    techStack: string[];
    architectureType?: string;
    knownPitfalls: string[];
    coreConventions: string[];
  } | null;
  entries: {
    entryType: string;
    title: string;
    content: string;
    tags: string[];
    confidence: string;
    createdAt: string;
  }[];
  actionItems?: {
    entryType: string;
    title: string;
    content: string;
    tags: string[];
    confidence: string;
    createdAt: string;
  }[];
}): string {
  const parts: string[] = ["## Project Knowledge Base"];

  if (result.profile) {
    if (result.profile.techStack.length > 0) {
      parts.push(`Tech Stack: ${result.profile.techStack.join(", ")}`);
    }
    if (result.profile.architectureType) {
      parts.push(`Architecture: ${result.profile.architectureType}`);
    }
    if (result.profile.knownPitfalls.length > 0) {
      parts.push("Known Pitfalls:");
      for (const p of result.profile.knownPitfalls) parts.push(`- ⚠️ ${p}`);
    }
    if (result.profile.coreConventions.length > 0) {
      parts.push("Core Conventions:");
      for (const c of result.profile.coreConventions) parts.push(`- ${c}`);
    }
  }

  if (result.entries.length > 0) {
    parts.push("\n### Recent Knowledge");
    const icons: Record<string, string> = { discovery: "💡", decision: "📋", fix: "🔧", convention: "📏", warning: "⚠️" };
    for (const entry of result.entries) {
      parts.push(`${icons[entry.entryType] || "📝"} **${entry.title}** (${entry.confidence}, ${entry.createdAt})`);
      parts.push(`  ${entry.content.slice(0, 300)}`);
      if (entry.tags.length > 0) {
        parts.push(`  Tags: ${entry.tags.map((t) => `#${t}`).join(" ")}`);
      }
    }
  }

  if (result.actionItems && result.actionItems.length > 0) {
    parts.push("\n### 🎯 Pending Action Items");
    parts.push("The following items may need attention in this session:");
    const icons: Record<string, string> = { discovery: "💡", decision: "📋", fix: "🔧", convention: "📏", warning: "⚠️" };
    for (const item of result.actionItems) {
      parts.push(`${icons[item.entryType] || "📝"} **${item.title}** (${item.entryType}, ${item.confidence})`);
      parts.push(`  ${item.content.slice(0, 200)}`);
    }
  }

  parts.push("\n> Use the `query_project_knowledge` tool to search for additional project knowledge, past decisions, and conventions whenever you need them during this session.");

  return parts.join("\n");
}

// Extract meaningful keywords from user message for contextual knowledge hints
function extractKnowledgeHints(message: string, maxHints: number): string[] {
  const stopWords = new Set(["the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "its", "let", "man", "new", "now", "old", "see", "two", "way", "who", "did", "yes", "any", "had", "its", "may"]);
  const text = message.slice(0, 300);
  // Extract CJK phrases (2–6 char chunks) separately, then ASCII tokens
  const cjkHints = (text.match(/[\u4e00-\u9fff\u3040-\u30ff]{2,6}/g) ?? []).slice(0, Math.floor(maxHints / 2));
  const asciiHints = text
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9_\-.]/g, ""))
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !stopWords.has(w.toLowerCase()));
  return [...cjkHints, ...asciiHints].slice(0, maxHints);
}
