/**
 * Query adapter — wraps official @anthropic-ai/claude-agent-sdk
 * to match the adapter interface consumed by claudeRemote.ts
 */

import {
  query as officialQuery,
  AbortError as OfficialAbortError,
  type Options as OfficialOptions,
  type Query as OfficialQuery,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  QueryOptions,
  QueryPrompt,
  SDKMessage,
  SDKUserMessage,
} from "./types";
import { AbortError } from "./types";
import { PushableAsyncIterable } from "@/utils/PushableAsyncIterable";
import { logger } from "@/ui/logger";

/**
 * Adapted query result — AsyncIterableIterator<SDKMessage> plus
 * a reference to the underlying official Query for advanced control.
 */
export interface AdaptedQuery extends AsyncIterableIterator<SDKMessage> {
  /** Underlying official SDK Query object (for setModel, setPermissionMode, etc.) */
  readonly _officialQuery: OfficialQuery;
}

/**
 * Map QueryOptions → official SDK Options.
 * Returns a new Options object; does not mutate the input.
 */
export function mapOptions(opts: QueryOptions): OfficialOptions {
  const result: OfficialOptions = {};

  // ── Direct 1:1 mappings ──
  if (opts.cwd) result.cwd = opts.cwd;
  if (opts.allowedTools) result.allowedTools = opts.allowedTools;
  if (opts.disallowedTools) result.disallowedTools = opts.disallowedTools;
  if (opts.executable)
    result.executable = opts.executable as "node" | "bun" | "deno";
  if (opts.executableArgs) result.executableArgs = opts.executableArgs;
  if (opts.maxTurns) result.maxTurns = opts.maxTurns;
  if (opts.mcpServers)
    result.mcpServers = opts.mcpServers as Record<string, any>;
  if (opts.pathToClaudeCodeExecutable)
    result.pathToClaudeCodeExecutable = opts.pathToClaudeCodeExecutable;
  if (opts.permissionMode) result.permissionMode = opts.permissionMode;
  if (opts.continue) result.continue = opts.continue;
  if (opts.resume) result.resume = opts.resume;
  if (opts.model) result.model = opts.model;
  if (opts.fallbackModel) result.fallbackModel = opts.fallbackModel;
  if (opts.strictMcpConfig) result.strictMcpConfig = opts.strictMcpConfig;

  // ── abort (AbortSignal) → abortController (AbortController) ──
  if (opts.abort) {
    const controller = new AbortController();
    if (opts.abort.aborted) {
      controller.abort();
    } else {
      opts.abort.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
    result.abortController = controller;
  }

  // ── canCallTool → canUseTool (signature adaptation) ──
  if (opts.canCallTool) {
    result.canUseTool = (toolName, input, options) => {
      return opts.canCallTool!(toolName, input, { signal: options.signal });
    };
  }

  // ── settings (path or inline object) ──
  if (opts.settings != null) {
    result.settings = opts.settings;
  } else if (opts.settingsPath) {
    // Legacy: settingsPath kept for backwards compat, maps to the new settings field
    result.settings = opts.settingsPath;
  }

  // ── Budget, thinking, effort, and prompt suggestions ──
  if (opts.maxBudgetUsd != null) result.maxBudgetUsd = opts.maxBudgetUsd;
  if (opts.thinking) result.thinking = opts.thinking;
  if (opts.effort != null) result.effort = opts.effort;
  if (opts.promptSuggestions) result.promptSuggestions = opts.promptSuggestions;

  // ── toolConfig (AskUserQuestion previewFormat etc.) ──
  if (opts.toolConfig) result.toolConfig = opts.toolConfig;

  // ── Load user & project settings so custom skills/commands are discovered ──
  // The SDK defaults settingSources to [] which produces --setting-sources "",
  // causing Claude Code to skip loading ~/.claude/commands/ and project commands.
  result.settingSources = ["user", "project", "local"];

  // ── System prompt mapping ──
  if (opts.customSystemPrompt) {
    result.systemPrompt = opts.customSystemPrompt;
  } else if (opts.appendSystemPrompt) {
    result.systemPrompt = {
      type: "preset",
      preset: "claude_code",
      append: opts.appendSystemPrompt,
    };
  }

  // ── Environment: strip CLAUDECODE to avoid nested session detection ──
  const env = { ...process.env };
  delete env.CLAUDECODE;
  result.env = env;

  return result;
}

/**
 * Query function that wraps the official SDK.
 *
 * Key adaptation: `onMessageReceived` fires synchronously for every message
 * read from the official SDK stream, BEFORE it is enqueued for the for-await
 * consumer.
 */
export function query(config: {
  prompt: QueryPrompt;
  options?: QueryOptions;
  onMessageReceived?: (message: SDKMessage) => void;
}): AdaptedQuery {
  const officialOptions = config.options
    ? mapOptions(config.options)
    : undefined;

  logger.debug("[queryAdapter] Starting query via official SDK");

  const response = officialQuery({
    prompt: config.prompt as string | AsyncIterable<SDKUserMessage>,
    options: officialOptions,
  });

  // Wrap with onMessageReceived using PushableAsyncIterable as intermediary.
  // Background consumer reads from official stream → fires callback → enqueues.
  const queue = new PushableAsyncIterable<SDKMessage>();

  (async () => {
    try {
      for await (const message of response) {
        config.onMessageReceived?.(message);
        queue.push(message);
      }
      queue.end();
    } catch (e) {
      // Map official AbortError → our re-exported AbortError for instanceof checks
      const error =
        e instanceof OfficialAbortError
          ? new AbortError(e.message)
          : e instanceof Error
            ? e
            : new Error(String(e));
      queue.setError(error);
    }
  })();

  return Object.assign(queue, {
    _officialQuery: response,
  }) as AdaptedQuery;
}
