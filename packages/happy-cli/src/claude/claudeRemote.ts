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
import type { OnElicitation } from "@/claude/sdk/types";
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
import { buildLocaleInstruction } from "./utils/localeInstruction";
import { PermissionResult } from "./sdk/types";
import { HAPPY_PLAN_MODE_INSTRUCTIONS } from "./sdk/prompts";
import { createSessionStoreAdapter } from "./sdk/sessionStoreAdapter";
import type { JsRuntime } from "./runClaude";
/**
 * Map App-level virtual model mode keys to real Anthropic model IDs.
 * Returns undefined for "use default" modes so the system default takes effect.
 */
export function resolveModelKey(
  modelKey: string | undefined,
): string | undefined {
  if (!modelKey) return undefined;
  if (modelKey === "default") return undefined;

  switch (modelKey) {
    // Sonnet/Opus now default to 1M context in the App — map the short keys
    // to the explicit [1m] SDK IDs. Old `-1m` keys are preserved for backward
    // compatibility with sessions pinned before the 200K/1M merge.
    case "sonnet":
    case "sonnet-1m":
      return "claude-sonnet-4-6[1m]";
    case "opus":
    case "opus-1m":
      return "claude-opus-4-6[1m]";
    case "opus-4-7":
    case "opus-4-7-1m":
      return "claude-opus-4-7[1m]";
    // Remaining keys (haiku, opusplan, etc.) pass through to the SDK which
    // resolves them via ANTHROPIC_DEFAULT_*_MODEL env vars — enabling
    // third-party provider model mapping.
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
  /** Callback for handling MCP elicitation requests (forwarded to App) */
  onElicitation?: OnElicitation;
  /**
   * Happy session ID — forwarded to the SDK as `Options.title` (0.2.119+) so
   * Claude Code's persisted JSONL metadata carries a stable link back to the
   * originating Happy session. Only used on fresh SDK sessions; resume/continue
   * will keep whatever title the prior session persisted.
   */
  happySessionId?: string;

  // Dynamic parameters
  nextMessage: () => Promise<{ message: string; mode: EnhancedMode } | null>;
  onReady: () => void | Promise<void>;
  isAborted: (toolCallId: string) => boolean;

  /** Called after each turn to feed usage data back to the adaptive router */
  onTurnComplete?: () => void;
  /** Called when SDK returns error_max_turns — triggers "Continue" button in App */
  onMaxTurnsReached?: () => void;

  // Callbacks
  onSessionFound: (id: string) => void;
  onThinkingChange?: (thinking: boolean) => void;
  onMessage: (message: SDKMessage) => void;
  onCompletionEvent?: (message: string) => void;
  onShellResult?: (output: string) => void;
  onSessionReset?: () => void;
  /** Called with SDK result data (cost, usage breakdown) when a query completes */
  onResult?: (result: {
    totalCostUsd: number;
    numTurns: number;
    terminalReason?: string;
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
  }) => void;
  /** Called when the SDK Query object is ready, exposing it for runtime control (interrupt, stopTask, etc.) */
  onQueryReady?: (
    query: import("@anthropic-ai/claude-agent-sdk").Query,
  ) => void;
  /** Called when the messages PushableAsyncIterable is ready, exposing mid-turn push capability */
  onMessagesReady?: (push: (msg: SDKUserMessage) => void) => void;
  /** Called with context window usage breakdown after each turn completes */
  onContextUsage?: (usage: {
    totalTokens: number;
    maxTokens: number;
    percentage: number;
    model: string;
    categories?: Array<{ name: string; tokens: number; color: string }>;
    isAutoCompactEnabled: boolean;
    autoCompactThreshold?: number;
    messageBreakdown?: {
      toolCallTokens: number;
      toolResultTokens: number;
      attachmentTokens: number;
      assistantMessageTokens: number;
      userMessageTokens: number;
    };
  }) => void;
  /** Called with initialization info (supported models) after system init */
  onInitialized?: (info: {
    models?: Array<{
      code: string;
      value: string;
      description: string | null;
      supportsEffort?: boolean | null;
      supportedEffortLevels?: string[] | null;
      supportsAdaptiveThinking?: boolean | null;
    }>;
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

  // Set environment variables for Claude Code SDK (pre-init)
  // NOTE: These may be overridden when SDK reads ~/.claude/settings.json
  // We re-apply them after query() initialization to ensure profile takes priority
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
  // Translate App-level virtual model keys (e.g. "sonnet", "opus")
  // to real Anthropic model IDs, then fall back to env-configured model.
  let model =
    resolveModelKey(initial.mode.model) ??
    opts.claudeEnvVars?.ANTHROPIC_MODEL ??
    process.env.ANTHROPIC_MODEL;

  // Build effective system prompt with optional locale instruction
  const localeInstruction = buildLocaleInstruction(initial.mode.locale);
  const effectiveSystemPrompt = localeInstruction
    ? systemPrompt + "\n\n" + localeInstruction
    : systemPrompt;

  // SDK 0.2.119+ bug: `systemPrompt: { type: "preset", append }` and
  // `--append-system-prompt` CLI flag are silently ignored by the Claude Code
  // native binary. As a workaround, we inject both App and CLI system prompts
  // directly into each user message as <system-reminder> text blocks.
  // This ensures the instructions (options suggestions, skill usage, etc.)
  // reliably reach the model regardless of SDK/binary version.
  const buildSystemReminderPrefix = (mode: EnhancedMode): string => {
    const appPrompt = mode.appendSystemPrompt; // App's <options> + skill instructions
    const parts = [appPrompt, effectiveSystemPrompt].filter(Boolean);
    if (parts.length === 0) return "";
    return `<system-reminder>\n${parts.join("\n\n")}\n</system-reminder>\n\n`;
  };

  const sdkOptions: QueryOptions = {
    cwd: opts.path,
    resume: startFrom ?? undefined,
    continue: initial.mode.continue || undefined,
    mcpServers: opts.mcpServers,
    // Never pass bypassPermissions to SDK — it causes Claude Code to skip
    // permission requests entirely, so canUseTool is never called and
    // AskUserQuestion cannot block. PermissionHandler handles auto-approval
    // for bypass mode via canCallTool instead.
    permissionMode: mapToClaudeMode(initial.mode.permissionMode) === "bypassPermissions"
      ? "default"
      : mapToClaudeMode(initial.mode.permissionMode),
    // Pass through so Claude Code knows bypass is intended (enables
    // --allow-dangerously-skip-permissions flag on the spawned process).
    allowDangerouslySkipPermissions: mapToClaudeMode(initial.mode.permissionMode) === "bypassPermissions",
    model: model || undefined,
    fallbackModel: initial.mode.fallbackModel,
    customSystemPrompt: initial.mode.customSystemPrompt
      ? initial.mode.customSystemPrompt + "\n\n" + effectiveSystemPrompt
      : undefined,
    // SDK 0.2.119+ native binary ignores appendSystemPrompt via IPC — App+CLI
    // prompts are now injected via buildSystemReminderPrefix() into each user
    // message. Keep effectiveSystemPrompt here as a best-effort fallback.
    appendSystemPrompt: effectiveSystemPrompt,
    allowedTools: initial.mode.allowedTools
      ? initial.mode.allowedTools.concat(opts.allowedTools)
      : opts.allowedTools,
    disallowedTools: initial.mode.disallowedTools,
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
    taskBudget: initial.mode.taskBudget,
    promptSuggestions: true,
    onElicitation: opts.onElicitation,
    // ── New SDK capabilities ──
    agentProgressSummaries: true,
    enableFileCheckpointing: true,
    betas: initial.mode.betas,
    agent: initial.mode.agent,
    agents: initial.mode.agents,
    outputFormat: initial.mode.outputFormat,
    plugins: initial.mode.plugins,
    additionalDirectories: initial.mode.additionalDirectories,
    // Happy-flavored plan-mode workflow body (SDK 0.2.119+). SDK only applies
    // this when `permissionMode === 'plan'`; passing it unconditionally is a
    // no-op outside plan mode.
    planModeInstructions: HAPPY_PLAN_MODE_INSTRUCTIONS,
    // Stable link from the Claude Code JSONL back to the Happy session (SDK 0.2.119+).
    // Only applied to new sessions — resume/continue keeps whatever title was persisted.
    title: opts.happySessionId,
    // SessionStore @alpha adapter — undefined unless HAPPY_USE_SESSION_STORE=1.
    // When enabled the SDK dual-writes transcript entries to our observer
    // adapter (in-memory) in addition to the usual on-disk JSONL, so we can
    // study real call cadence before building a production backend.
    sessionStore: createSessionStoreAdapter(),
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

  // Push initial message (skip when continuing — SDK resumes without a prompt)
  let messages = new PushableAsyncIterable<SDKUserMessage>();
  if (!initial.mode.continue) {
    messages.push({
      type: "user",
      message: {
        role: "user",
        content: buildSystemReminderPrefix(initial.mode) + initial.message,
      },
      parent_tool_use_id: null,
      session_id: undefined,
    });
  }

  // Expose mid-turn push capability to caller
  opts.onMessagesReady?.((msg) => messages.push(msg));

  // Start the loop.
  // Forward all messages for sync immediately as they arrive from stdout,
  // regardless of whether the for-await loop is blocked (e.g., at nextMessage).
  // This ensures messages from YOLO-mode auto-continuations are synced even
  // when the loop is waiting for user input after a result message.
  const sdkCallAt = Date.now();
  let firstResponseLogged = false;
  const response = query({
    prompt: messages,
    options: sdkOptions,
    onMessageReceived: (message) => {
      if (!firstResponseLogged) {
        firstResponseLogged = true;
        logger.debug(`[perf] sdk_call → first_response: ${Date.now() - sdkCallAt}ms (type=${message.type})`);
      }
      logger.debugLargeJson(
        `[claudeRemote] onMessageReceived ${message.type}`,
        message,
      );
      opts.onMessage(message);
    },
  });
  logger.debug(`[perf] sdk query() call completed (sync part): ${Date.now() - sdkCallAt}ms`);

  // Expose the underlying SDK Query for runtime control (interrupt, stopTask, etc.)
  opts.onQueryReady?.((response as AdaptedQuery)._officialQuery);

  // Re-apply profile env vars AFTER SDK initialization.
  // The SDK reads ~/.claude/settings.json during query() and may overwrite
  // process.env values set by the daemon profile (e.g., ANTHROPIC_BASE_URL,
  // ANTHROPIC_DEFAULT_*_MODEL). Profile config must take priority.
  if (opts.claudeEnvVars) {
    Object.entries(opts.claudeEnvVars).forEach(([key, value]) => {
      process.env[key] = value;
    });
    logger.debug(
      `[claudeRemote] Re-applied ${Object.keys(opts.claudeEnvVars).length} profile env vars after SDK init`,
    );
  }

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
                  supportsEffort: m.supportsEffort ?? null,
                  supportedEffortLevels: m.supportedEffortLevels ?? null,
                  supportsAdaptiveThinking: m.supportsAdaptiveThinking ?? null,
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

        // Surface local command results (e.g., "Unknown skill: ...") that
        // were handled by the SDK without calling the API (num_turns === 0).
        // These would otherwise be silently dropped since result messages
        // are not converted to log messages by sdkToLogConverter.
        const resultData = message as { result?: string; num_turns?: number };
        if (
          resultData.num_turns === 0 &&
          resultData.result &&
          resultData.result.trim().length > 0
        ) {
          logger.debug(
            "[claudeRemote] Forwarding local command result:",
            resultData.result,
          );
          opts.onCompletionEvent?.(resultData.result);
        }

        // Detect error_max_turns for continue support
        const resultSubtype = (message as any).subtype;
        if (resultSubtype === "error_max_turns") {
          logger.debug(
            "[claudeRemote] Max turns reached — signaling needsContinue",
          );
          opts.onMaxTurnsReached?.();
        }

        // Extract SDK result data (cost, usage breakdown, terminal reason) before signaling ready
        const resultMsg = message as {
          total_cost_usd?: number;
          num_turns?: number;
          terminal_reason?: string;
          modelUsage?: Record<
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
        };
        if (resultMsg.total_cost_usd !== undefined || resultMsg.modelUsage) {
          opts.onResult?.({
            totalCostUsd: resultMsg.total_cost_usd ?? 0,
            numTurns: resultMsg.num_turns ?? 0,
            terminalReason: resultMsg.terminal_reason,
            modelUsage: resultMsg.modelUsage ?? {},
          });
        }

        // Fetch context window usage breakdown (fire-and-forget, never blocks turn flow)
        if (opts.onContextUsage) {
          const officialQuery = (response as AdaptedQuery)._officialQuery;
          officialQuery.getContextUsage?.()
            .then((ctx) => {
              if (ctx && !opts.signal?.aborted) {
                opts.onContextUsage?.(ctx);
              }
            })
            .catch((e) => {
              logger.debug("[claudeRemote] Failed to get context usage:", e);
            });
        }

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
            // onShellResult already closes the turn, so skip onReady()
            // to avoid double-closing the turn which corrupts protocol state
            opts.onShellResult(output);
          }
          // Don't push to Claude, wait for next user message
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
            // Freeze only permissionMode to avoid SDK state desync;
            // other fields (model, thinking, etc.) still update normally.
            logger.debug(
              `[claudeRemote] BUG: plan/bypass transition reached setPermissionMode — preserving SDK state (${currentPermissionMode} → ${newPermissionMode})`,
            );
            mode = { ...next.mode, permissionMode: mode.permissionMode };
          } else {
            logger.debug(
              `[claudeRemote] Hot-swapping permissionMode: ${currentPermissionMode} → ${newPermissionMode}`,
            );
            await (response as AdaptedQuery)._officialQuery.setPermissionMode(
              newPermissionMode,
            );
            mode = next.mode;
          }
        } else {
          mode = next.mode;
        }
        messages.push({
          type: "user",
          message: { role: "user", content: buildSystemReminderPrefix(next.mode) + next.message },
          parent_tool_use_id: null,
          session_id: undefined,
          ...(next.mode.shouldQuery === false && { shouldQuery: false }),
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
