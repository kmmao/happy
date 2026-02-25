/**
 * Query adapter — wraps official @anthropic-ai/claude-agent-sdk
 * to match the self-built SDK interface consumed by claudeRemote.ts
 *
 * Drop-in replacement for the self-built query() function.
 * See migration plan: Phase 1 adapter layer.
 */

import {
  query as officialQuery,
  AbortError as OfficialAbortError,
  type Options as OfficialOptions,
  type SDKUserMessage as OfficialSDKUserMessage,
  type Query as OfficialQuery,
} from "@anthropic-ai/claude-agent-sdk";
import type { QueryOptions, QueryPrompt, SDKMessage } from "./types";
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
 * Map self-built QueryOptions → official SDK Options.
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
  // Self-built: (toolName, input, { signal }) => Promise<PermissionResult>
  // Official:   (toolName, input, { signal, suggestions, blockedPath, decisionReason, toolUseID, agentID }) => Promise<PermissionResult>
  if (opts.canCallTool) {
    result.canUseTool = (toolName, input, options) => {
      return opts.canCallTool!(toolName, input, { signal: options.signal });
    };
  }

  // ── settingsPath → extraArgs ──
  if (opts.settingsPath) {
    result.extraArgs = { ...result.extraArgs, settings: opts.settingsPath };
  }

  // ── System prompt mapping ──
  // customSystemPrompt → replaces entire system prompt (string)
  // appendSystemPrompt → appends to Claude Code's default (preset + append)
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
 * Query function that wraps the official SDK with the self-built interface.
 *
 * Key adaptation: `onMessageReceived` fires synchronously for every message
 * read from the official SDK stream, BEFORE it is enqueued for the for-await
 * consumer. This matches the self-built SDK's semantics exactly.
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
    prompt: config.prompt as string | AsyncIterable<OfficialSDKUserMessage>,
    options: officialOptions,
  });

  // Wrap with onMessageReceived using PushableAsyncIterable as intermediary.
  // Background consumer reads from official stream → fires callback → enqueues.
  const queue = new PushableAsyncIterable<SDKMessage>();

  (async () => {
    try {
      for await (const message of response) {
        const adapted = message as unknown as SDKMessage;
        config.onMessageReceived?.(adapted);
        queue.push(adapted);
      }
      queue.end();
    } catch (e) {
      // Map official AbortError → self-built AbortError for instanceof checks
      const error =
        e instanceof OfficialAbortError
          ? new AbortError(e.message)
          : e instanceof Error
            ? e
            : new Error(String(e));
      queue.setError(error);
    }
  })();

  // Attach _officialQuery for Phase 4 (setModel, setPermissionMode, etc.)
  return Object.assign(queue, {
    _officialQuery: response,
  }) as AdaptedQuery;
}
