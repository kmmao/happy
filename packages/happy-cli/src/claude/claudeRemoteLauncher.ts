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
} from "@anthropic-ai/claude-agent-sdk";
import { formatClaudeMessageForInk } from "@/ui/messageFormatterInk";
import { logger } from "@/ui/logger";
import { SDKToLogConverter } from "./utils/sdkToLogConverter";
import { PLAN_FAKE_REJECT } from "./sdk/prompts";
import { EnhancedMode } from "./loop";
import { RawJSONLines } from "@/claude/types";
import { OutgoingMessageQueue } from "./utils/OutgoingMessageQueue";
import { getToolName } from "./utils/getToolName";
import { createEnvelope } from "@kmmao/happy-wire";
import { hashObject } from "@/utils/deterministicJson";
import type { Query as OfficialQuery } from "@anthropic-ai/claude-agent-sdk";
import { getProjectPath } from "./utils/path";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { executeShellCommand } from "@/utils/shellCommand";
import { TurnCollector } from "@/knowledge";

interface PermissionsField {
  date: number;
  result: "approved" | "denied";
  mode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk";
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

  async function abort() {
    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
    }
    await abortFuture?.promise;
  }

  async function doAbort() {
    logger.debug("[remote]: doAbort");
    await abort();
  }

  async function doSwitch() {
    logger.debug("[remote]: doSwitch");
    if (!exitReason) {
      exitReason = "switch";
    }
    await abort();
  }

  // Track current SDK Query for runtime control (interrupt, stopTask)
  let currentQuery: OfficialQuery | null = null;

  // Knowledge base: turn-level data collection + injection
  // Enabled via env var HAPPY_KNOWLEDGE_BASE=true
  const knowledgeEnabled = process.env.HAPPY_KNOWLEDGE_BASE !== "false"; // Default ON for testing, will be controlled by App setting later
  const turnCollector = knowledgeEnabled ? new TurnCollector() : null;
  let knowledgeInjected = false; // Track whether knowledge was already injected
  let knowledgeContext: string | null = null; // Cached knowledge for system prompt

  // Pre-fetch knowledge context for injection (non-blocking)
  if (knowledgeEnabled) {
    const mode = (process.env.HAPPY_KNOWLEDGE_MODE as "auto" | "full" | "minimal") || "auto";
    session.client.fetchKnowledge(mode).then((result) => {
      if (result && (result.profile || result.entries.length > 0)) {
        knowledgeContext = formatKnowledgeForInjection(result);
        logger.debug(`[knowledge] Pre-fetched context: ${knowledgeContext!.length} chars, ${result.entries.length} entries`);
      }
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
    if (currentQuery && args.taskId) {
      try {
        await currentQuery.stopTask(args.taskId);
      } catch (e) {
        logger.debug("[remote]: stopTask() failed", e);
      }
    }
  }

  // When to abort
  session.client.rpcHandlerManager.registerHandler("abort", doAbort); // When abort clicked
  session.client.rpcHandlerManager.registerHandler("switch", doSwitch); // When switch clicked
  session.client.rpcHandlerManager.registerHandler("interrupt", doInterrupt); // Graceful interrupt
  session.client.rpcHandlerManager.registerHandler("stopTask", doStopTask); // Stop background task
  // Removed catch-all stdin handler - now handled by RemoteModeDisplay keyboard handlers

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
      if (!currentQuery) {
        return { canRewind: false, error: "No active query" };
      }
      if (!args.userMessageId) {
        return { canRewind: false, error: "Missing userMessageId" };
      }
      try {
        const result = await currentQuery.rewindFiles(args.userMessageId, {
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

  function onMessage(message: SDKMessage) {
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
    if (turnCollector) {
      if (message.type === "user") {
        const uMsg = message as SDKUserMessage;
        const text = typeof uMsg.message === "string" ? uMsg.message : "";
        turnCollector.collectUserMessage(text);
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
                }
              }
            }
          }
        }
      }
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
            // so ExitPlanMode goes through the normal approval flow instead of auto-approving
            if (c.name === "enter_plan_mode" || c.name === "EnterPlanMode") {
              logger.debug(
                "[remote]: detected EnterPlanMode — syncing permissionHandler to plan mode",
              );
              permissionHandler.handleModeChange("plan");
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

    // Forward status events to App (compacting, compact_boundary, etc.)
    if (message.type === "system") {
      const statusMsg = message as SDKStatusMsg;
      if (statusMsg.subtype === "status") {
        if (statusMsg.status === "compacting") {
          session.client.sendSessionEvent({
            type: "message",
            message: "Compacting context...",
          });
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
              await doInterrupt();
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
            session_id: "",
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

      try {
        const remoteResult = await claudeRemote({
          sessionId: session.sessionId,
          path: session.path,
          allowedTools: session.allowedTools ?? [],
          mcpServers: session.mcpServers,
          hookSettingsPath: session.hookSettingsPath,
          jsRuntime: session.jsRuntime,
          canCallTool: permissionHandler.handleToolCall,
          onElicitation: handleElicitation,
          isAborted: (toolCallId: string) => {
            return permissionHandler.isAborted(toolCallId);
          },
          onTurnComplete: () => {},
          nextMessage: async () => {
            // Stop any running mid-turn drain from the previous turn
            stopMidTurnDrain();

            if (pending) {
              let p = pending;
              pending = null;
              permissionHandler.handleModeChange(p.mode.permissionMode);
              startMidTurnDrain();
              return p;
            }

            let msg = await session.queue.waitForMessagesAndGetAsString(
              controller.signal,
            );

            if (msg) {
              // Check if mode has changed
              if (msg.isolate) {
                logger.debug("[remote]: isolate requested, pending message");
                pending = msg;
                return null;
              }

              // continue requires a fresh query with sdkOptions.continue=true
              if (msg.mode.continue) {
                logger.debug(
                  "[remote]: continue flag detected, forcing restart for new query",
                );
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
                  modeHash = msg.hash;
                  mode = msg.mode;
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
                pending = msg;
                return null;
              }

              modeHash = msg.hash;
              mode = msg.mode;
              currentColdHash = coldModeHash(mode);
              permissionHandler.handleModeChange(mode.permissionMode);
              startMidTurnDrain();

              // Knowledge injection: append to first message's system prompt
              const returnMode = !knowledgeInjected && knowledgeContext
                ? {
                  ...msg.mode,
                  appendSystemPrompt: msg.mode.appendSystemPrompt
                    ? msg.mode.appendSystemPrompt + "\n\n" + knowledgeContext
                    : knowledgeContext,
                }
                : msg.mode;
              if (!knowledgeInjected && knowledgeContext) {
                knowledgeInjected = true;
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
            if (turnCollector) {
              const outputTokens = lastResultData?.modelUsage
                ? Object.values(lastResultData.modelUsage).reduce((sum, m) => sum + m.outputTokens, 0)
                : 0;
              const readyTurns = turnCollector.onTurnEnd(outputTokens);
              if (readyTurns) {
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

  return parts.join("\n");
}
