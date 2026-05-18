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
  if (opts.maxTurns) result.maxTurns = opts.maxTurns;
  if (opts.mcpServers)
    result.mcpServers = opts.mcpServers as Record<string, any>;
  if (opts.pathToClaudeCodeExecutable)
    result.pathToClaudeCodeExecutable = opts.pathToClaudeCodeExecutable;
  if (opts.permissionMode) result.permissionMode = opts.permissionMode;
  if (opts.allowDangerouslySkipPermissions) result.allowDangerouslySkipPermissions = opts.allowDangerouslySkipPermissions;
  if (opts.continue) result.continue = opts.continue;
  if (opts.resume) result.resume = opts.resume;
  if (opts.model) result.model = opts.model;
  if (opts.fallbackModel) result.fallbackModel = opts.fallbackModel;

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
  if (opts.taskBudget) result.taskBudget = opts.taskBudget;
  if (opts.promptSuggestions) result.promptSuggestions = opts.promptSuggestions;

  // ── onElicitation (MCP server user input requests) ──
  if (opts.onElicitation) result.onElicitation = opts.onElicitation;

  // ── Load user & project settings so custom skills/commands are discovered ──
  // The SDK defaults settingSources to [] which produces --setting-sources "",
  // causing Claude Code to skip loading ~/.claude/commands/ and project commands.
  // Allow callers to override via opts.settingSources; fall back to full set.
  result.settingSources = opts.settingSources ?? ["user", "project", "local"];

  // ── Beta features (e.g. 1M context window) ──
  if (opts.betas) result.betas = opts.betas;

  // ── Agent progress summaries for subagent monitoring ──
  if (opts.agentProgressSummaries) result.agentProgressSummaries = opts.agentProgressSummaries;

  // ── File checkpointing for rewind support ──
  if (opts.enableFileCheckpointing) result.enableFileCheckpointing = opts.enableFileCheckpointing;

  // ── Agent configuration ──
  if (opts.agent) result.agent = opts.agent;
  if (opts.agents) result.agents = opts.agents;

  // ── Structured output format ──
  if (opts.outputFormat) result.outputFormat = opts.outputFormat;

  // ── Plugins ──
  if (opts.plugins) result.plugins = opts.plugins;

  // ── Additional directories ──
  if (opts.additionalDirectories) result.additionalDirectories = opts.additionalDirectories;

  // ── Custom session title (SDK 0.2.119+) ──
  if (opts.title) result.title = opts.title;

  // ── Custom plan-mode workflow body (SDK 0.2.119+) ──
  if (opts.planModeInstructions) {
    (result as OfficialOptions & { planModeInstructions?: string }).planModeInstructions = opts.planModeInstructions;
  }

  // ── SessionStore @alpha adapter (SDK 0.2.119+) ──
  if (opts.sessionStore) result.sessionStore = opts.sessionStore;

  // ── Per-tool configuration (SDK 0.2.119+) ──
  if (opts.toolConfig) result.toolConfig = opts.toolConfig;

  // ── Forward subagent text/thinking blocks (SDK 0.2.133+) ──
  if (opts.forwardSubagentText) result.forwardSubagentText = opts.forwardSubagentText;

  // ── Partial/streaming messages (SDK 0.3.143+) ──
  if (opts.includePartialMessages) result.includePartialMessages = opts.includePartialMessages;

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

  // ── Environment tweaks ──
  const env = { ...process.env };
  delete env.CLAUDECODE; // avoid nested session detection

  // Force "standard" mode for the SDK's tool-search / deferred-tools machinery
  // so AskUserQuestion (and every other built-in tool) is always pre-loaded.
  // SDK 0.2.81..0.2.118 let us patch cli.js to exempt AskUserQuestion while
  // keeping on-demand tool discovery on (ENABLE_TOOL_SEARCH="1"); SDK
  // 0.2.119+ ships the runtime as a native binary we cannot patch, so we
  // disable deferred behavior via the documented env knob. Trade-off: the
  // ~85% tool-definition token saving is lost, but the step-based Q&A UI
  // stays reliable — see packages/happy-cli/scripts/patch-sdk-deferred-tools.cjs.
  env.ENABLE_TOOL_SEARCH = "auto:100";

  // SDK 0.2.119 native binary: the `systemPrompt: { type:"preset", append }`
  // path does NOT reliably inject the append content. As a fallback, we pass
  // the append text via an env var that claude_remote_launcher.js reads and
  // injects as `--append-system-prompt` CLI flag — this path always works.
  if (opts.appendSystemPrompt) {
    env.HAPPY_APPEND_SYSTEM_PROMPT = opts.appendSystemPrompt;
  }

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
