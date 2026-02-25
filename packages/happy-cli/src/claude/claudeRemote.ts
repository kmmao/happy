import { EnhancedMode } from "./loop";
import {
  query,
  type QueryOptions,
  type SDKMessage,
  type SDKSystemMessage,
  type AdaptedQuery,
  AbortError,
  SDKUserMessage,
} from "@/claude/sdk";
import { mapToClaudeMode } from "./utils/permissionMode";
import { claudeCheckSession } from "./utils/claudeCheckSession";
import { join, resolve } from "node:path";
import { projectPath } from "@/projectPath";
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { executeShellCommand } from "@/utils/shellCommand";
import { logger } from "@/lib";
import { PushableAsyncIterable } from "@/utils/PushableAsyncIterable";
import { getProjectPath } from "./utils/path";
import { awaitFileExist } from "@/modules/watcher/awaitFileExist";
import { systemPrompt } from "./utils/systemPrompt";
import { PermissionResult } from "./sdk/types";
import type { JsRuntime } from "./runClaude";
import { parseAdaptiveKey, isAdaptiveMode } from "./utils/adaptiveRouter";

/**
 * Map App-level virtual model mode keys to real Anthropic model IDs.
 * Returns undefined for "use default" modes so the system default takes effect.
 */
function resolveModelKey(modelKey: string | undefined): string | undefined {
  if (!modelKey) return undefined;

  // Handle adaptive usage keys: "adaptiveUsage", "adaptiveUsage:sonnet", etc.
  if (isAdaptiveMode(modelKey)) {
    const { baseModelId } = parseAdaptiveKey(modelKey);
    return baseModelId;
  }

  switch (modelKey) {
    case "default":
      return undefined;
    case "haiku":
      return "claude-haiku-4-5-20251001";
    case "sonnet":
      return "claude-sonnet-4-6";
    case "sonnet-1m":
      return "claude-sonnet-4-6[1m]";
    case "opus":
      return "claude-opus-4-6";
    case "opus-1m":
      return "claude-opus-4-6[1m]";
    default:
      return modelKey;
  }
}

export async function claudeRemote(opts: {
  // Fixed parameters
  sessionId: string | null;
  path: string;
  mcpServers?: Record<string, any>;
  claudeEnvVars?: Record<string, string>;
  claudeArgs?: string[];
  allowedTools: string[];
  signal?: AbortSignal;
  canCallTool: (
    toolName: string,
    input: unknown,
    mode: EnhancedMode,
    options: { signal: AbortSignal },
  ) => Promise<PermissionResult>;
  /** Path to temporary settings file with SessionStart hook (required for session tracking) */
  hookSettingsPath: string;
  /** JavaScript runtime to use for spawning Claude Code (default: 'node') */
  jsRuntime?: JsRuntime;

  // Dynamic parameters
  nextMessage: () => Promise<{ message: string; mode: EnhancedMode } | null>;
  onReady: () => void | Promise<void>;
  isAborted: (toolCallId: string) => boolean;

  /** Called after each turn to feed usage data back to the adaptive router */
  onTurnComplete?: () => void;

  // Callbacks
  onSessionFound: (id: string) => void;
  onThinkingChange?: (thinking: boolean) => void;
  onMessage: (message: SDKMessage) => void;
  onCompletionEvent?: (message: string) => void;
  onShellResult?: (output: string) => void;
  onSessionReset?: () => void;
  /** Called when the SDK Query object is ready, exposing it for runtime control (interrupt, stopTask, etc.) */
  onQueryReady?: (
    query: import("@anthropic-ai/claude-agent-sdk").Query,
  ) => void;
  /** Called with initialization info (supported models) after system init */
  onInitialized?: (info: {
    models?: Array<{ code: string; value: string; description: string | null }>;
  }) => void;
}) {
  // Check if session is valid
  let startFrom = opts.sessionId;
  if (opts.sessionId && !claudeCheckSession(opts.sessionId, opts.path)) {
    startFrom = null;
  }

  // Extract --resume from claudeArgs if present (for first spawn)
  if (!startFrom && opts.claudeArgs) {
    for (let i = 0; i < opts.claudeArgs.length; i++) {
      if (opts.claudeArgs[i] === "--resume") {
        // Check if next arg exists and looks like a session ID
        if (i + 1 < opts.claudeArgs.length) {
          const nextArg = opts.claudeArgs[i + 1];
          // If next arg doesn't start with dash and contains dashes, it's likely a UUID
          if (!nextArg.startsWith("-") && nextArg.includes("-")) {
            startFrom = nextArg;
            logger.debug(
              `[claudeRemote] Found --resume with session ID: ${startFrom}`,
            );
            break;
          } else {
            // Just --resume without UUID - SDK doesn't support this
            logger.debug(
              "[claudeRemote] Found --resume without session ID - not supported in remote mode",
            );
            break;
          }
        } else {
          // --resume at end of args - SDK doesn't support this
          logger.debug(
            "[claudeRemote] Found --resume without session ID - not supported in remote mode",
          );
          break;
        }
      }
    }
  }

  // Set environment variables for Claude Code SDK
  if (opts.claudeEnvVars) {
    Object.entries(opts.claudeEnvVars).forEach(([key, value]) => {
      process.env[key] = value;
    });
  }

  // Get initial message
  const initial = await opts.nextMessage();
  if (!initial) {
    // No initial message - exit
    return;
  }

  // Handle special commands
  const specialCommand = parseSpecialCommand(initial.message);

  // Handle /clear command
  if (specialCommand.type === "clear") {
    if (opts.onCompletionEvent) {
      opts.onCompletionEvent("Context was reset");
    }
    if (opts.onSessionReset) {
      opts.onSessionReset();
    }
    return;
  }

  // Handle shell command ($ or ! prefix) - execute directly without Claude
  if (specialCommand.type === "shell" && specialCommand.shellCommand) {
    logger.debug(
      "[claudeRemote] Detected $ shell command:",
      specialCommand.shellCommand,
    );
    const output = await executeShellCommand(
      specialCommand.shellCommand,
      opts.path,
    );
    if (opts.onShellResult) {
      opts.onShellResult(output);
    }
    return;
  }

  // Handle /compact command
  let isCompactCommand = false;
  if (specialCommand.type === "compact") {
    logger.debug(
      "[claudeRemote] /compact command detected - will process as normal but with compaction behavior",
    );
    isCompactCommand = true;
    if (opts.onCompletionEvent) {
      opts.onCompletionEvent("Compaction started");
    }
  }

  // Prepare SDK options
  let mode = initial.mode;
  // Translate App-level virtual model keys (e.g. "adaptiveUsage", "sonnet", "opus")
  // to real Anthropic model IDs, then fall back to env-configured model.
  let model =
    resolveModelKey(initial.mode.model) ??
    opts.claudeEnvVars?.ANTHROPIC_MODEL ??
    process.env.ANTHROPIC_MODEL;

  const sdkOptions: QueryOptions = {
    cwd: opts.path,
    resume: startFrom ?? undefined,
    mcpServers: opts.mcpServers,
    permissionMode: mapToClaudeMode(initial.mode.permissionMode),
    model: model || undefined,
    fallbackModel: initial.mode.fallbackModel,
    customSystemPrompt: initial.mode.customSystemPrompt
      ? initial.mode.customSystemPrompt + "\n\n" + systemPrompt
      : undefined,
    appendSystemPrompt: initial.mode.appendSystemPrompt
      ? initial.mode.appendSystemPrompt + "\n\n" + systemPrompt
      : systemPrompt,
    allowedTools: initial.mode.allowedTools
      ? initial.mode.allowedTools.concat(opts.allowedTools)
      : opts.allowedTools,
    disallowedTools:
      mapToClaudeMode(initial.mode.permissionMode) === "bypassPermissions"
        ? [...(initial.mode.disallowedTools || []), "AskUserQuestion"]
        : initial.mode.disallowedTools,
    canCallTool: (
      toolName: string,
      input: unknown,
      options: { signal: AbortSignal },
    ) => opts.canCallTool(toolName, input, mode, options),
    executable: opts.jsRuntime ?? "node",
    abort: opts.signal,
    pathToClaudeCodeExecutable: (() => {
      return resolve(
        join(projectPath(), "scripts", "claude_remote_launcher.js"),
      );
    })(),
    settingsPath: opts.hookSettingsPath,
    maxBudgetUsd: initial.mode.maxBudgetUsd,
    thinking: initial.mode.thinking,
    effort: initial.mode.effort,
    promptSuggestions: true,
  };

  // Track thinking state
  let thinking = false;
  const updateThinking = (newThinking: boolean) => {
    if (thinking !== newThinking) {
      thinking = newThinking;
      logger.debug(`[claudeRemote] Thinking state changed to: ${thinking}`);
      if (opts.onThinkingChange) {
        opts.onThinkingChange(thinking);
      }
    }
  };

  // Push initial message
  let messages = new PushableAsyncIterable<SDKUserMessage>();
  messages.push({
    type: "user",
    message: {
      role: "user",
      content: initial.message,
    },
    parent_tool_use_id: null,
    session_id: "",
  });

  // Start the loop.
  // Forward all messages for sync immediately as they arrive from stdout,
  // regardless of whether the for-await loop is blocked (e.g., at nextMessage).
  // This ensures messages from YOLO-mode auto-continuations are synced even
  // when the loop is waiting for user input after a result message.
  const response = query({
    prompt: messages,
    options: sdkOptions,
    onMessageReceived: (message) => {
      logger.debugLargeJson(
        `[claudeRemote] onMessageReceived ${message.type}`,
        message,
      );
      opts.onMessage(message);
    },
  });

  // Expose the underlying SDK Query for runtime control (interrupt, stopTask, etc.)
  opts.onQueryReady?.((response as AdaptedQuery)._officialQuery);

  updateThinking(true);
  try {
    logger.debug(`[claudeRemote] Starting to iterate over response`);

    for await (const message of response) {
      // NOTE: opts.onMessage is already called via onMessageReceived above.
      // This loop handles only control flow decisions (result, init, abort).

      // Handle special system messages
      if (message.type === "system" && message.subtype === "init") {
        // Start thinking when session initializes
        updateThinking(true);

        const systemInit = message as SDKSystemMessage;

        // Session id is still in memory, wait until session file is written to disk
        // Start a watcher for to detect the session id
        if (systemInit.session_id) {
          logger.debug(
            `[claudeRemote] Waiting for session file to be written to disk: ${systemInit.session_id}`,
          );
          const projectDir = getProjectPath(opts.path);
          const found = await awaitFileExist(
            join(projectDir, `${systemInit.session_id}.jsonl`),
          );
          logger.debug(
            `[claudeRemote] Session file found: ${systemInit.session_id} ${found}`,
          );
          opts.onSessionFound(systemInit.session_id);
        }

        // Fetch initialization result (supported models) asynchronously
        if (opts.onInitialized) {
          const officialQuery = (response as AdaptedQuery)._officialQuery;
          const signal = opts.signal;
          officialQuery
            .initializationResult()
            .then((initResult) => {
              if (signal?.aborted) return; // session already torn down
              opts.onInitialized?.({
                models: initResult.models?.map((m) => ({
                  code: m.value,
                  value: m.displayName ?? m.value,
                  description: m.description ?? null,
                  supportsEffort: (m as any).supportsEffort ?? null,
                  supportedEffortLevels:
                    (m as any).supportedEffortLevels ?? null,
                  supportsAdaptiveThinking:
                    (m as any).supportsAdaptiveThinking ?? null,
                })),
              });
            })
            .catch((e) => {
              logger.debug(
                "[claudeRemote] Failed to get initializationResult:",
                e,
              );
            });
        }
      }

      // Handle result messages
      if (message.type === "result") {
        updateThinking(false);
        logger.debug("[claudeRemote] Result received");

        // Feed turn usage data back to adaptive router BEFORE onReady resets it
        opts.onTurnComplete?.();

        // Send completion messages
        if (isCompactCommand) {
          logger.debug("[claudeRemote] Compaction completed");
          if (opts.onCompletionEvent) {
            opts.onCompletionEvent("Compaction completed");
          }
          isCompactCommand = false;
        }

        // Send ready event (flush queued messages before signaling turn end)
        await opts.onReady();

        // Push next message
        const next = await opts.nextMessage();
        if (!next) {
          messages.end();
          return;
        }

        // Check for shell command in follow-up messages
        const nextSpecialCommand = parseSpecialCommand(next.message);
        if (
          nextSpecialCommand.type === "shell" &&
          nextSpecialCommand.shellCommand
        ) {
          logger.debug(
            "[claudeRemote] Detected $ shell command in follow-up:",
            nextSpecialCommand.shellCommand,
          );
          const output = await executeShellCommand(
            nextSpecialCommand.shellCommand,
            opts.path,
          );
          if (opts.onShellResult) {
            opts.onShellResult(output);
          }
          // Don't push to Claude, wait for next user message
          await opts.onReady();
          continue;
        }

        // Hot-swap model via setModel() if model changed (avoids process restart)
        const newModel =
          resolveModelKey(next.mode.model) ??
          opts.claudeEnvVars?.ANTHROPIC_MODEL ??
          process.env.ANTHROPIC_MODEL;
        if (newModel && newModel !== model) {
          logger.debug(
            `[claudeRemote] Hot-swapping model: ${model} → ${newModel}`,
          );
          await (response as AdaptedQuery)._officialQuery.setModel(newModel);
          model = newModel;
        }

        // Hot-swap permissionMode via setPermissionMode() if changed (non-plan, non-bypass ↔ non-plan, non-bypass)
        // Plan and bypass transitions require cold restart (handled by coldModeHash in launcher).
        const newPermissionMode = mapToClaudeMode(next.mode.permissionMode);
        const currentPermissionMode = mapToClaudeMode(mode.permissionMode);
        if (newPermissionMode !== currentPermissionMode) {
          if (
            newPermissionMode === "plan" ||
            currentPermissionMode === "plan" ||
            newPermissionMode === "bypassPermissions" ||
            currentPermissionMode === "bypassPermissions"
          ) {
            // Should never reach here: plan/bypass transitions are caught by coldModeHash.
            logger.debug(
              `[claudeRemote] BUG: plan/bypass transition reached setPermissionMode — skipping (${currentPermissionMode} → ${newPermissionMode})`,
            );
          } else {
            logger.debug(
              `[claudeRemote] Hot-swapping permissionMode: ${currentPermissionMode} → ${newPermissionMode}`,
            );
            await (response as AdaptedQuery)._officialQuery.setPermissionMode(
              newPermissionMode,
            );
          }
        }

        mode = next.mode;
        messages.push({
          type: "user",
          message: { role: "user", content: next.message },
          parent_tool_use_id: null,
          session_id: "",
        });
      }

      // Handle tool result
      if (message.type === "user") {
        const msg = message as SDKUserMessage;
        if (msg.message.role === "user" && Array.isArray(msg.message.content)) {
          for (let c of msg.message.content) {
            if (
              c.type === "tool_result" &&
              c.tool_use_id &&
              opts.isAborted(c.tool_use_id)
            ) {
              logger.debug("[claudeRemote] Tool aborted, exiting claudeRemote");
              return;
            }
          }
        }
      }
    }
  } catch (e) {
    if (e instanceof AbortError) {
      logger.debug(`[claudeRemote] Aborted`);
      // Ignore
    } else {
      throw e;
    }
  } finally {
    updateThinking(false);
  }
}
