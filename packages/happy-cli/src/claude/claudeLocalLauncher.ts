import { logger } from "@/ui/logger";
import { claudeLocal, ExitCodeError } from "./claudeLocal";
import { Session } from "./session";
import { Future } from "@/utils/future";
import { createSessionScanner } from "./utils/sessionScanner";
import { createThinkingTracker } from "./utils/thinkingTracker";
import type { SessionTurnEndStatus } from "@kmmao/happy-wire";

export type LauncherResult =
  | { type: "switch" }
  | { type: "exit"; code: number };

export async function claudeLocalLauncher(
  session: Session,
): Promise<LauncherResult> {
  // Track the latest compaction summary for on-demand retrieval via RPC
  let latestCompactionSummary: string | null = null;

  // Unified thinking state tracker — fuses fd3 fetch events with JSONL messages
  const thinkingTracker = createThinkingTracker({
    onChange: session.onThinkingChange,
  });

  // Create scanner
  const scanner = await createSessionScanner({
    sessionId: session.sessionId,
    workingDirectory: session.path,
    onMessage: (message) => {
      // Block SDK summary messages - we generate our own
      // But capture the summary text for RPC retrieval
      if (message.type === "summary") {
        latestCompactionSummary = message.summary;
        return;
      }
      // Result message signals turn completion — emit turn-end immediately
      // Without this, turn-end is only emitted when the next user message
      // arrives or the process exits, leaving thinking state stale.
      if (message.type === "result") {
        thinkingTracker.onProcessExit(); // Clear all tracking, thinking=false
        const status: SessionTurnEndStatus =
          message.subtype === "success" ? "completed" : "failed";
        session.client.closeClaudeSessionTurn(status, {
          totalCostUsd: message.total_cost_usd ?? 0,
          numTurns: message.num_turns ?? 0,
          modelUsage: (message as any).modelUsage ?? {},
        });
        return;
      }
      // Assistant messages signal Claude is working (possibly executing tools next)
      if (message.type === "assistant") {
        thinkingTracker.onAssistantMessage();
        // Track tool_use blocks — keeps thinking=true during tool execution
        const blocks = Array.isArray(message.message?.content)
          ? message.message.content
          : [];
        for (const block of blocks) {
          if (
            block.type === "tool_use" &&
            typeof block.id === "string" &&
            block.id.length > 0
          ) {
            thinkingTracker.onToolUseStart(block.id);
          }
        }
      }
      // Track tool_result blocks — mark tool execution complete
      if (message.type === "user") {
        const blocks = Array.isArray(message.message?.content)
          ? message.message.content
          : [];
        for (const block of blocks) {
          if (
            block.type === "tool_result" &&
            typeof block.tool_use_id === "string" &&
            block.tool_use_id.length > 0
          ) {
            thinkingTracker.onToolUseEnd(block.tool_use_id);
          }
        }
      }
      session.client.sendClaudeSessionMessage(message);
    },
  });

  // Register RPC handler to allow App to fetch the latest compaction summary
  session.client.rpcHandlerManager.registerHandler(
    "getCompactionSummary",
    async () => ({ summary: latestCompactionSummary }),
  );

  // Register callback to notify scanner when session ID is found via hook
  // This is important for --continue/--resume where session ID is not known upfront
  const scannerSessionCallback = (sessionId: string) => {
    scanner.onNewSession(sessionId);
  };
  session.addSessionFoundCallback(scannerSessionCallback);

  // Handle abort
  let exitReason: LauncherResult | null = null;
  const processAbortController = new AbortController();
  let exutFuture = new Future<void>();
  try {
    async function abort() {
      // Send abort signal
      if (!processAbortController.signal.aborted) {
        processAbortController.abort();
      }

      // Await full exit
      await exutFuture.promise;
    }

    async function doAbort() {
      logger.debug("[local]: doAbort");

      // Switching to remote mode
      if (!exitReason) {
        exitReason = { type: "switch" };
      }

      session.client.closeClaudeSessionTurn("cancelled");

      // Reset sent messages
      session.queue.reset();

      // Abort
      await abort();
    }

    async function doSwitch() {
      logger.debug("[local]: doSwitch");

      // Switching to remote mode
      if (!exitReason) {
        exitReason = { type: "switch" };
      }

      session.client.closeClaudeSessionTurn("cancelled");

      // Abort
      await abort();
    }

    // When to abort
    session.client.rpcHandlerManager.registerHandler("abort", doAbort); // Abort current process, clean queue and switch to remote mode
    session.client.rpcHandlerManager.registerHandler("switch", doSwitch); // When user wants to switch to remote mode
    session.queue.setOnMessage(() => {
      // Switch to remote mode when message received
      doSwitch();
    }); // When any message is received, abort current process, clean queue and switch to remote mode

    // Exit if there are messages in the queue
    if (session.queue.size() > 0) {
      return { type: "switch" };
    }

    // Handle session start
    const handleSessionStart = (sessionId: string) => {
      session.onSessionFound(sessionId);
      scanner.onNewSession(sessionId);
    };

    // Run local mode
    while (true) {
      // If we already have an exit reason, return it
      if (exitReason) {
        return exitReason;
      }

      // Launch
      logger.debug("[local]: launch");
      try {
        await claudeLocal({
          path: session.path,
          sessionId: session.sessionId,
          onSessionFound: handleSessionStart,
          onFetchEvent: (event) => {
            if (event.type === "fetch-start") {
              thinkingTracker.onFetchStart(event.id);
            } else {
              thinkingTracker.onFetchEnd(event.id);
            }
          },
          onProcessExit: () => thinkingTracker.onProcessExit(),
          abort: processAbortController.signal,
          claudeEnvVars: session.claudeEnvVars,
          claudeArgs: session.claudeArgs,
          mcpServers: session.mcpServers,
          allowedTools: session.allowedTools,
          hookSettingsPath: session.hookSettingsPath,
          sandboxConfig: session.sandboxConfig,
          model: session.model,
        });

        // Consume one-time Claude flags after spawn
        // For example we don't want to pass --resume flag after first spawn
        session.consumeOneTimeFlags();

        // Normal exit
        if (!exitReason) {
          session.client.closeClaudeSessionTurn("completed");
          exitReason = { type: "exit", code: 0 };
          break;
        }
      } catch (e) {
        logger.debug("[local]: launch error", e);
        // If Claude exited with non-zero exit code, propagate it
        if (e instanceof ExitCodeError) {
          session.client.closeClaudeSessionTurn("failed");
          exitReason = { type: "exit", code: e.exitCode };
          break;
        }
        if (!exitReason) {
          session.client.sendSessionEvent({
            type: "message",
            message: "Process exited unexpectedly",
          });
          continue;
        } else {
          break;
        }
      }
      logger.debug("[local]: launch done");
    }
  } finally {
    // Resolve future
    exutFuture.resolve(undefined);

    // Set handlers to no-op
    session.client.rpcHandlerManager.registerHandler("abort", async () => {});
    session.client.rpcHandlerManager.registerHandler("switch", async () => {});
    session.queue.setOnMessage(null);

    // Remove session found callback
    session.removeSessionFoundCallback(scannerSessionCallback);

    // Cleanup
    thinkingTracker.cleanup();
    await scanner.cleanup();
  }

  // Return
  return exitReason || { type: "exit", code: 0 };
}
