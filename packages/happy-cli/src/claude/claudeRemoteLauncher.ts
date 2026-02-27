import { render } from "ink";
import { Session } from "./session";
import { MessageBuffer } from "@/ui/ink/messageBuffer";
import { RemoteModeDisplay } from "@/ui/ink/RemoteModeDisplay";
import React from "react";
import { claudeRemote } from "./claudeRemote";
import { PermissionHandler } from "./utils/permissionHandler";
import { Future } from "@/utils/future";
import { SDKAssistantMessage, SDKMessage, SDKUserMessage } from "./sdk";
import type {
  SDKStatusMessage as SDKStatusMsg,
  SDKCompactBoundaryMessage as SDKCompactMsg,
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

  async function doInterrupt() {
    logger.debug("[remote]: doInterrupt — graceful interrupt via SDK");
    if (currentQuery) {
      try {
        await currentQuery.interrupt();
      } catch (e) {
        // Do not fall back to abort() — interrupt() may have partially succeeded
        // and already sent a signal to Claude. Hard abort would kill the process.
        // User can press the abort button explicitly if they need a hard stop.
        logger.debug(
          "[remote]: interrupt() threw — not falling back to abort",
          e,
        );
      }
    }
    // If no active query, interrupt is a no-op (nothing to interrupt)
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

  // Handle messages
  let planModeToolCalls = new Set<string>();
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

    // Detect plan mode tool call
    if (message.type === "assistant") {
      let umessage = message as SDKAssistantMessage;
      if (umessage.message.content && Array.isArray(umessage.message.content)) {
        for (let c of umessage.message.content) {
          if (
            c.type === "tool_use" &&
            (c.name === "exit_plan_mode" || c.name === "ExitPlanMode")
          ) {
            logger.debug("[remote]: detected plan mode tool call " + c.id!);
            planModeToolCalls.add(c.id! as string);
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
      }
    }

    // Forward Task messages to session protocol
    if (
      message.type === "system" &&
      (message as any).subtype === "task_started"
    ) {
      const m = message as any; // SDKTaskStartedMessage
      const envelope = createEnvelope("agent", {
        t: "task-start",
        taskId: m.task_id,
        toolUseId: m.tool_use_id,
        description: m.description,
        taskType: m.task_type,
      });
      session.client.sendSessionProtocolMessage(envelope);
    }

    // Forward Task progress to session protocol
    if (
      message.type === "system" &&
      (message as any).subtype === "task_progress"
    ) {
      const m = message as any; // SDKTaskProgressMessage
      const envelope = createEnvelope("agent", {
        t: "task-progress",
        taskId: m.task_id,
        description: m.description,
        usage: {
          totalTokens: m.usage.total_tokens,
          toolUses: m.usage.tool_uses,
          durationMs: m.usage.duration_ms,
        },
        lastToolName: m.last_tool_name,
      });
      session.client.sendSessionProtocolMessage(envelope);
    }

    // Forward Task notification to session protocol
    if (
      message.type === "system" &&
      (message as any).subtype === "task_notification"
    ) {
      const m = message as any; // SDKTaskNotificationMessage
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

    // Forward Tool progress to session protocol
    if (message.type === "tool_progress") {
      const m = message as any; // SDKToolProgressMessage
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
      const suggestion = (message as any).suggestion as string;
      if (suggestion) {
        const envelope = createEnvelope("agent", {
          t: "prompt-suggestion",
          suggestion,
        });
        session.client.sendSessionProtocolMessage(envelope);
      }
    }

    // Convert SDK message to log format and send to client
    let msg = message;

    // Hack plan mode exit
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
            c.name === "Task" &&
            c.input &&
            typeof (c.input as any).prompt === "string"
          ) {
            const logMessage2 = sdkToLogConverter.convertSidechainUserMessage(
              c.id!,
              (c.input as any).prompt,
            );
            if (logMessage2) {
              messageQueue.enqueue(logMessage2);
            }
          }
        }
      }
    }
  }

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
      //   - model: hot-swapped via setModel()
      //   - permissionMode (between non-plan, non-bypass modes): via setPermissionMode()
      // Cold restart is required for:
      //   - plan ↔ non-plan: different tool sets (ExitPlanMode etc.)
      //   - bypassPermissions ↔ other: AskUserQuestion disallowedTools changes
      //   - thinking, effort, maxBudgetUsd: SDK has no runtime set methods
      const coldModeHash = (m: EnhancedMode) =>
        hashObject({
          isPlan: m.permissionMode === "plan",
          isBypass: m.permissionMode === "bypassPermissions",
          fallbackModel: m.fallbackModel,
          customSystemPrompt: m.customSystemPrompt,
          appendSystemPrompt: m.appendSystemPrompt,
          allowedTools: m.allowedTools,
          disallowedTools: m.disallowedTools,
          maxBudgetUsd: m.maxBudgetUsd,
          thinking: m.thinking,
          effort: m.effort,
        });
      let currentColdHash: string | null = null;
      try {
        const remoteResult = await claudeRemote({
          sessionId: session.sessionId,
          path: session.path,
          allowedTools: session.allowedTools ?? [],
          mcpServers: session.mcpServers,
          hookSettingsPath: session.hookSettingsPath,
          jsRuntime: session.jsRuntime,
          canCallTool: permissionHandler.handleToolCall,
          isAborted: (toolCallId: string) => {
            return permissionHandler.isAborted(toolCallId);
          },
          onTurnComplete: () => {},
          nextMessage: async () => {
            if (pending) {
              let p = pending;
              pending = null;
              permissionHandler.handleModeChange(p.mode.permissionMode);
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
              return {
                message: msg.message,
                mode: msg.mode,
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
            const envelope = createEnvelope("agent", {
              t: "text",
              text: output,
            });
            session.client.sendSessionProtocolMessage(envelope);
            session.client.closeClaudeSessionTurn("completed");
          },
          onQueryReady: (query) => {
            currentQuery = query;
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
          onReady: async () => {
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
          session.client.closeClaudeSessionTurn("cancelled");
          session.client.sendSessionEvent({
            type: "message",
            message: "Aborted by user",
          });
        }
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        logger.debug("[remote]: launch error", err.message, err.stack, e);
        if (!exitReason) {
          session.client.closeClaudeSessionTurn("failed");
          session.client.sendSessionEvent({
            type: "message",
            message: `Process exited unexpectedly: ${err.message}`,
          });
          continue;
        }
      } finally {
        logger.debug("[remote]: launch finally");

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
