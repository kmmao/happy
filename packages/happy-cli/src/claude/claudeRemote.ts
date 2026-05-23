/**
 * claudeRemote — drive a single `claude` TUI process under a PTY for the
 * remote/web client.
 *
 * Phase 5 of the PTY migration (`docs/.../plan`):
 *
 * Pre-migration this module called `@anthropic-ai/claude-agent-sdk`'s
 * `query()` and iterated its async stream. Post-migration it spawns the
 * user's `claude` TUI binary directly under `node-pty`, watches the JSONL
 * session file written by claude under `~/.claude/projects/<…>/`, and
 * converts each record into the same `SDKMessage`-shaped object the rest
 * of the pipeline expects.
 *
 * Lifecycle
 * ---------
 *   1. Build CLI flags from the initial `EnhancedMode` via `buildClaudeCliFlags`.
 *   2. Spawn the PTY (`startClaudePty`) + wrap with a `ClaudePtyController`
 *      stub so existing call sites that called `setModel` / `setPermissionMode`
 *      / `interrupt` keep compiling and degrade gracefully.
 *   3. Install a `sessionScanner` watching the project JSONL — every record
 *      is converted via `rawToSdkMessage` and forwarded to `opts.onMessage`.
 *   4. Write the initial user prompt to PTY stdin.
 *   5. On each `result` record, run the legacy hot-swap dance (now no-op
 *      via Controller) and write the next prompt — until `nextMessage()`
 *      yields null, at which point we kill the PTY and resolve.
 *
 * Visibility losses (logged, never silently swallowed):
 *   • `setModel` / `setPermissionMode` are now no-ops — the SDK exposed
 *     hot-swap; the TUI does not. Cold restart via launcher's coldModeHash
 *     covers the cases that matter (plan/bypass transitions).
 *   • `getContextUsage` returns null — no programmatic introspection.
 *   • `initializationResult` returns `{ models: [] }` — the App renders an
 *     empty model list (it can fall back to a hard-coded list).
 *   • `applyFlagSettings` parses + tracks state but the SDK call itself is
 *     a no-op (settings.json is read at spawn time only).
 */

import { EnhancedMode } from "./loop";
import type {
  SDKMessage,
  SDKUserMessage,
  SdkBeta,
} from "@/claude/sdk";
import { AbortError } from "@/claude/sdk";
import type { OnElicitation } from "@/claude/sdk/types";
import { mapToClaudeMode } from "./utils/permissionMode";
import {
  applyFlagSettingsFromModeDiff,
  createAppliedSettingsState,
} from "./utils/applyFlagSettings";
import { claudeCheckSession } from "./utils/claudeCheckSession";
import { resolve as resolvePath } from "node:path";
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { executeShellCommand } from "@/utils/shellCommand";
import { logger } from "@/lib";
import { systemPrompt } from "./utils/systemPrompt";
import { buildLocaleInstruction } from "./utils/localeInstruction";
import { PermissionResult } from "./sdk/types";
import type { JsRuntime } from "./runClaude";
import { startClaudePty, type ClaudePtyHandle } from "@/claude/pty/claudePtyRuntime";
import {
  createClaudePtyController,
  type ClaudePtyController,
} from "@/claude/pty/claudePtyController";
import { buildClaudeCliFlags } from "@/claude/pty/claudeCliFlags";
import { rawToSdkMessage } from "@/claude/pty/rawToSdkMessage";
import { attachClaudePtyRouter } from "@/claude/pty/claudePtyRouter";
import {
  bridgeAttach,
  bridgeData,
  bridgeDetach,
  bridgeExit,
  bridgeAvailable,
  buildClaudeTerminalId,
} from "@/claude/pty/claudePtyDaemonBridge";
import { createSessionScanner } from "./utils/sessionScanner";

void resolvePath; // path resolution kept available for future flag builders

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
    // Sonnet/Opus default to 1M context — map short keys to explicit model IDs.
    // The [1m] suffix is a Happy-internal tracking convention; actual 1M context
    // is enabled via the `context-1m-2025-08-07` SDK beta (see buildBetasForModel).
    case "sonnet":
    case "sonnet-1m":
      return "claude-sonnet-4-6[1m]";
    case "opus":
    case "opus-1m":
      return "claude-opus-4-6[1m]";
    case "opus-4-7":
    case "opus-4-7-1m":
      return "claude-opus-4-7[1m]";
    // Remaining keys (haiku, opusplan, etc.) pass through unchanged.
    default:
      return modelKey;
  }
}

/** Beta tag required to enable 1M-token context window. */
const BETA_1M: SdkBeta = "context-1m-2025-08-07";

/**
 * Returns true when the given App model key should use the 1M context window.
 */
export function is1MModelKey(modelKey: string | undefined): boolean {
  if (!modelKey) return false;
  switch (modelKey) {
    case "sonnet":
    case "sonnet-1m":
    case "opus":
    case "opus-1m":
    case "opus-4-7":
    case "opus-4-7-1m":
      return true;
    default:
      return false;
  }
}

/**
 * Build the betas array for a session, automatically prepending the 1M context
 * beta when the model key indicates a 1M-capable model. Preserved for callers
 * that build claude CLI `--betas` flags from EnhancedMode.
 */
export function buildBetasForModel(
  modelKey: string | undefined,
  extraBetas?: SdkBeta[],
): SdkBeta[] | undefined {
  const needs1M = is1MModelKey(modelKey);
  const base: SdkBeta[] = needs1M ? [BETA_1M] : [];
  if (!extraBetas?.length) return base.length ? base : undefined;
  const merged = [...base];
  for (const b of extraBetas) {
    if (!merged.includes(b)) merged.push(b);
  }
  return merged.length ? merged : undefined;
}

// ─── User-input helpers ──────────────────────────────────────────────────────

/**
 * Flatten an SDK user-message content blob into a single newline-joined
 * string for PTY stdin. The TUI consumes plain text; structured content
 * (tool_result, image, etc.) cannot be re-injected mid-turn anyway.
 */
function flattenUserContent(msg: SDKUserMessage): string {
  const content = msg.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const text = (block as { text?: string }).text;
    if (typeof text === "string" && text.length > 0) parts.push(text);
  }
  return parts.join("\n");
}

/**
 * Submit a user prompt to the Claude TUI through the PTY.
 *
 * Claude's TUI runs in raw mode (Ink/React under the hood) where the
 * line-discipline does *not* translate `\n` → `\r`. The TUI's keyboard
 * handler only treats CR (`\r`, 0x0D) as "Enter pressed"; an LF would sit
 * unsubmitted in the input buffer and the message would never reach the
 * agent. (Symptom pre-fix: spinner stuck, jsonl file never written.)
 *
 * Multi-line text is wrapped in bracketed-paste markers (`ESC[200~ … ESC[201~`)
 * so embedded newlines are preserved as a single paste rather than each one
 * being interpreted as a submit. Bracketed paste is supported by Claude's
 * TUI input handler. The trailing `\r` is the explicit submit keystroke.
 */
function writePromptToPty(pty: ClaudePtyHandle, message: string): void {
  const preview = message.length > 60 ? `${message.slice(0, 60)}…` : message;
  logger.debug(
    `[claudeRemote] writePromptToPty len=${message.length} multiline=${message.includes("\n")} preview=${JSON.stringify(preview)}`,
  );
  if (message.includes("\n")) {
    pty.write(`\x1b[200~${message}\x1b[201~\r`);
  } else {
    pty.write(`${message}\r`);
  }
}

/**
 * Resolve once the Claude TUI is ready to accept keystrokes.
 *
 * Why this exists: `pty.write` calls issued immediately after `startClaudePty`
 * (T+a few ms) land before Ink switches the terminal to raw mode and registers
 * its keyboard handler. Those bytes are silently dropped — the TUI's stdin
 * reader consumes them but discards them because the input loop isn't wired
 * yet. Symptom: SessionStart hook fires, but no `result` event ever appears
 * because the user prompt was never seen by the TUI.
 *
 * Heuristic: wait for the first PTY data chunk (proves the child is alive
 * and producing output) + a small grace window (gives Ink time to finish
 * initial render and enable raw mode). Bounded by `timeoutMs` so a broken
 * binary that produces no output still unblocks the caller and we degrade
 * to the pre-fix behaviour rather than hanging.
 */
function waitForPtyReady(
  pty: ClaudePtyHandle,
  graceMs = 800,
  timeoutMs = 8000,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let firstChunkSeen = false;
    const startedAt = Date.now();

    const finish = (reason: string) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timeoutTimer);
      logger.debug(
        `[claudeRemote] PTY ready (${reason}) after ${Date.now() - startedAt}ms`,
      );
      resolve();
    };

    const timeoutTimer = setTimeout(() => finish("timeout"), timeoutMs);

    const unsubscribe = pty.onData(() => {
      if (firstChunkSeen) return;
      firstChunkSeen = true;
      setTimeout(() => finish("first-chunk+grace"), graceMs);
    });
  });
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
  /**
   * Canonical permission callback. Retained for API symmetry — the TUI now
   * handles permission prompts itself, so this is never invoked in PTY mode.
   * Kept on the options bag so caller code (claudeRemoteLauncherCore) does
   * not need a conditional cast.
   */
  canCallTool: (
    toolName: string,
    input: unknown,
    mode: EnhancedMode,
    options: { signal: AbortSignal },
  ) => Promise<PermissionResult>;
  /** Path to temporary settings file with SessionStart hook (becomes --settings). */
  hookSettingsPath: string;
  /** JavaScript runtime — accepted for source compatibility, ignored by the TUI. */
  jsRuntime?: JsRuntime;
  /** MCP elicitation callback — TUI surfaces elicitation directly; accepted but unused. */
  onElicitation?: OnElicitation;
  /** Happy session id — forwarded to the launcher's tagging hooks if any. */
  happySessionId?: string;

  // Dynamic parameters
  nextMessage: () => Promise<{ message: string; mode: EnhancedMode } | null>;
  onReady: () => void | Promise<void>;
  isAborted: (toolCallId: string) => boolean;

  /** Called after each turn to feed usage data back to the adaptive router. */
  onTurnComplete?: () => void;
  /** Called when the TUI emits an `error_max_turns` result. */
  onMaxTurnsReached?: () => void;

  // Callbacks
  onSessionFound: (id: string) => void;
  onThinkingChange?: (thinking: boolean) => void;
  onMessage: (message: SDKMessage) => void;
  onCompletionEvent?: (message: string) => void;
  onShellResult?: (output: string) => void;
  onSessionReset?: () => void;
  /** Called when a result record is observed in the JSONL stream. */
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
  /**
   * Exposes the PTY-backed controller for runtime control (interrupt,
   * stopTask, etc). Most methods are no-op stubs in PTY mode — see
   * `ClaudePtyController` doc comment.
   */
  onQueryReady?: (query: ClaudePtyController) => void;
  /** Exposes mid-turn user-input push (writes to PTY stdin). */
  onMessagesReady?: (push: (msg: SDKUserMessage) => void) => void;
  /** Called with context-window usage breakdown after each turn — null in PTY mode. */
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
  /** Called with initialization info (supported models) — empty in PTY mode. */
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
  /**
   * Lets the caller subscribe us to its external session-id discovery channel
   * (typically `Session.addSessionFoundCallback`, fed by the SessionStart
   * hook). Without this, a fresh PTY-mode session never tells its scanner
   * what JSONL file to watch — `opts.sessionId` is null on first start and
   * the scanner only learns ids through records it has already produced
   * (chicken-and-egg). Caller returns an unsubscribe fn we invoke at exit.
   */
  registerSessionFoundCallback?: (
    cb: (sessionId: string) => void,
  ) => (() => void) | void;
}): Promise<void> {
  // Check whether the requested session id is still resumable on disk.
  let startFrom = opts.sessionId;
  if (opts.sessionId && !claudeCheckSession(opts.sessionId, opts.path)) {
    startFrom = null;
  }

  // Honour `--resume <id>` if present in claudeArgs (first-spawn convention).
  if (!startFrom && opts.claudeArgs) {
    for (let i = 0; i < opts.claudeArgs.length; i++) {
      if (opts.claudeArgs[i] !== "--resume") continue;
      const nextArg = opts.claudeArgs[i + 1];
      if (
        nextArg !== undefined &&
        !nextArg.startsWith("-") &&
        nextArg.includes("-")
      ) {
        startFrom = nextArg;
        logger.debug(
          `[claudeRemote] Found --resume with session ID: ${startFrom}`,
        );
        break;
      }
      logger.debug(
        "[claudeRemote] Found --resume without session ID — not supported in remote mode",
      );
      break;
    }
  }

  // Pre-apply env vars before the PTY spawn so the child inherits them.
  if (opts.claudeEnvVars) {
    Object.entries(opts.claudeEnvVars).forEach(([key, value]) => {
      process.env[key] = value;
    });
  }

  // Get the initial message; nothing to do without one.
  const initial = await opts.nextMessage();
  if (!initial) return;

  // Special-command short-circuits.
  const specialCommand = parseSpecialCommand(initial.message);

  if (specialCommand.type === "clear") {
    opts.onCompletionEvent?.("Context was reset");
    opts.onSessionReset?.();
    return;
  }

  if (specialCommand.type === "shell" && specialCommand.shellCommand) {
    logger.debug(
      "[claudeRemote] Detected $ shell command:",
      specialCommand.shellCommand,
    );
    const output = await executeShellCommand(
      specialCommand.shellCommand,
      opts.path,
    );
    opts.onShellResult?.(output);
    return;
  }

  let isCompactCommand = false;
  if (specialCommand.type === "compact") {
    logger.debug(
      "[claudeRemote] /compact command detected — will process as normal but with compaction behavior",
    );
    isCompactCommand = true;
    opts.onCompletionEvent?.("Compaction started");
  }

  // Per-turn state.
  let mode: EnhancedMode = initial.mode;
  let model =
    resolveModelKey(initial.mode.model) ??
    opts.claudeEnvVars?.ANTHROPIC_MODEL ??
    process.env.ANTHROPIC_MODEL;
  const appliedSettingsState = createAppliedSettingsState();

  // Compose the effective system prompt (locale + append). The TUI takes the
  // combined string via `--append-system-prompt` instead of separate fields.
  const localeInstruction = buildLocaleInstruction(initial.mode.locale);
  const effectiveSystemPrompt = localeInstruction
    ? systemPrompt + "\n\n" + localeInstruction
    : systemPrompt;
  const appendParts = [initial.mode.appendSystemPrompt, effectiveSystemPrompt].filter(
    Boolean,
  );
  const mergedAppendSystemPrompt =
    appendParts.length > 0 ? appendParts.join("\n\n") : undefined;

  // The mode passed to buildClaudeCliFlags carries the merged append-prompt
  // and the resolved model so the CLI builder does not need to know about
  // the locale dance.
  const flagMode: EnhancedMode = {
    ...initial.mode,
    model: model ?? initial.mode.model,
    appendSystemPrompt: mergedAppendSystemPrompt,
  };

  const flagsResult = buildClaudeCliFlags({
    mode: flagMode,
    settingsPath: opts.hookSettingsPath,
    mcpServers: opts.mcpServers,
    resumeSessionId: startFrom ?? undefined,
    extraArgs: opts.claudeArgs,
  });
  for (const warning of flagsResult.warnings) {
    logger.debug(`[claudeRemote] CLI flag warning: ${warning}`);
  }

  // Build the child env. We let the PTY runtime sanitize (strip CLAUDECODE
  // etc) — caller-supplied overrides take precedence over process.env.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(opts.claudeEnvVars ?? {}),
  };

  // Spawn the PTY and surface the controller stub.
  const sdkCallAt = Date.now();
  let pty: ClaudePtyHandle;
  try {
    pty = startClaudePty({
      args: flagsResult.args,
      cwd: opts.path,
      env: childEnv,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.debug(`[claudeRemote] Failed to spawn claude PTY: ${msg}`);
    throw e;
  }
  const controller = createClaudePtyController(pty);
  opts.onQueryReady?.(controller);
  logger.debug(
    `[perf] sdk query() call completed (sync part): ${Date.now() - sdkCallAt}ms`,
  );

  // Gate every prompt write on the TUI being ready to receive keystrokes.
  // Shared promise → first writer pays the wait, the rest see it resolved.
  const ptyReady = waitForPtyReady(pty);

  // Bridge the PTY to the daemon's TerminalManager so the App's "Open Raw
  // Terminal" view can subscribe to the byte stream over the existing
  // `terminal-output` socket event. Only meaningful when this CLI was spawned
  // by a daemon (HAPPY_DAEMON_CONTROL_URL injected); standalone runs skip it.
  let teardownPtyBridge: (() => void) | undefined;
  if (opts.happySessionId && bridgeAvailable()) {
    const happySessionId = opts.happySessionId;
    const terminalId = buildClaudeTerminalId(happySessionId);
    // Best-effort attach — we do not await so a slow daemon never blocks the
    // PTY's first byte.
    void bridgeAttach({
      terminalId,
      sessionId: happySessionId,
      cols: 80,
      rows: 24,
      cwd: opts.path,
    });

    const router = attachClaudePtyRouter({
      sessionId: happySessionId,
      pty,
      onOutput: ({ data }) => {
        void bridgeData(terminalId, data);
      },
      onExit: ({ exitCode }) => {
        void bridgeExit(terminalId, exitCode);
      },
    });

    teardownPtyBridge = () => {
      router.dispose();
      void bridgeDetach(terminalId);
    };
  }

  // Re-apply profile env vars AFTER spawn (matches pre-migration behaviour
  // where settings.json could overwrite process.env). The PTY child has
  // already inherited the env above; this only fixes our own process.env so
  // downstream code in the same process sees the profile values.
  if (opts.claudeEnvVars) {
    Object.entries(opts.claudeEnvVars).forEach(([key, value]) => {
      process.env[key] = value;
    });
    logger.debug(
      `[claudeRemote] Re-applied ${Object.keys(opts.claudeEnvVars).length} profile env vars after spawn`,
    );
  }

  // Thinking state — mirrors the SDK era's per-turn updateThinking calls.
  let thinking = false;
  const updateThinking = (next: boolean) => {
    if (thinking === next) return;
    thinking = next;
    logger.debug(`[claudeRemote] Thinking state changed to: ${thinking}`);
    opts.onThinkingChange?.(thinking);
  };
  updateThinking(true);

  // Models broadcast (Controller returns an empty list under PTY).
  if (opts.onInitialized) {
    controller
      .initializationResult()
      .then((init) => {
        if (opts.signal?.aborted) return;
        opts.onInitialized?.({
          models: init.models?.map((m) => ({
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
        logger.debug("[claudeRemote] initializationResult failed:", e);
      });
  }

  // Lifecycle coordination — we resolve when the PTY exits or the caller
  // aborts. nextMessage()===null path kills the PTY explicitly.
  const seenSessionIds = new Set<string>();
  let firstResponseLogged = false;
  let aborted = false;
  let exitResolved = false;
  let exitResolve: () => void;
  const exitPromise = new Promise<void>((resolve) => {
    exitResolve = resolve;
  });

  // Per-turn aggregation for synthesizing the `result` record.
  // Claude TUI's JSONL stream does NOT emit a `type: "result"` record
  // (the SDK's `query()` stream did). It instead writes a
  // `type: "system", subtype: "turn_duration"` marker as the last record
  // of every turn. We accumulate usage / model / stop_reason from each
  // assistant message and convert that marker into a synthetic result so
  // `handleResult` — and therefore `onReady` → `closeClaudeSessionTurn`
  // → `nextMessage()` → next prompt write — actually fires.
  let turnAssistantCount = 0;
  let turnLastStopReason: string | undefined;
  type TurnModelUsageEntry = {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    costUSD: number;
    contextWindow: number;
    maxOutputTokens: number;
  };
  const turnModelUsage = new Map<string, TurnModelUsageEntry>();
  const resetTurnAggregates = () => {
    turnAssistantCount = 0;
    turnLastStopReason = undefined;
    turnModelUsage.clear();
  };

  const finishOnce = () => {
    if (exitResolved) return;
    exitResolved = true;
    teardownPtyBridge?.();
    teardownPtyBridge = undefined;
    exitResolve();
  };

  pty.onExit(({ exitCode, signal }) => {
    logger.debug(
      `[claudeRemote] PTY exited code=${exitCode} signal=${signal ?? "(none)"}`,
    );
    finishOnce();
  });

  if (opts.signal) {
    const signal = opts.signal;
    const abortHandler = () => {
      if (aborted) return;
      aborted = true;
      logger.debug("[claudeRemote] caller signal aborted — killing PTY");
      pty.kill("SIGTERM");
    };
    if (signal.aborted) abortHandler();
    else signal.addEventListener("abort", abortHandler, { once: true });
  }

  // Handle a single `result` record — drives the turn loop.
  let resultInFlight = false;
  const handleResult = async (raw: { type: "result" } & Record<string, unknown>) => {
    if (aborted || resultInFlight) return;
    resultInFlight = true;
    try {
      updateThinking(false);
      logger.debug("[claudeRemote] Result received");

      const result = raw as {
        result?: string;
        num_turns?: number;
        subtype?: string;
        total_cost_usd?: number;
        terminal_reason?: string;
        modelUsage?: Record<string, {
          inputTokens: number;
          outputTokens: number;
          cacheReadInputTokens: number;
          cacheCreationInputTokens: number;
          costUSD: number;
          contextWindow: number;
          maxOutputTokens: number;
        }>;
      };

      // Surface zero-turn local-command results (slash commands handled by
      // claude without an API call — e.g. "Unknown skill: …").
      if (
        result.num_turns === 0 &&
        result.result &&
        result.result.trim().length > 0
      ) {
        logger.debug(
          "[claudeRemote] Forwarding local command result:",
          result.result,
        );
        opts.onCompletionEvent?.(result.result);
      }

      if (result.subtype === "error_max_turns") {
        logger.debug(
          "[claudeRemote] Max turns reached — signaling needsContinue",
        );
        opts.onMaxTurnsReached?.();
      }

      if (result.total_cost_usd !== undefined || result.modelUsage) {
        opts.onResult?.({
          totalCostUsd: result.total_cost_usd ?? 0,
          numTurns: result.num_turns ?? 0,
          terminalReason: result.terminal_reason,
          modelUsage: result.modelUsage ?? {},
        });
      }

      // Context-window usage — PTY mode returns null; controller logs it.
      if (opts.onContextUsage) {
        controller
          .getContextUsage()
          .then((ctx) => {
            if (!ctx || opts.signal?.aborted) return;
            opts.onContextUsage?.({
              totalTokens: ctx.totalTokens,
              maxTokens: ctx.maxTokens,
              percentage: ctx.percentage,
              model: ctx.model,
              categories: ctx.categories,
              isAutoCompactEnabled: false,
              messageBreakdown: ctx.messageBreakdown
                ? {
                    toolCallTokens: ctx.messageBreakdown.toolCallTokens,
                    toolResultTokens: ctx.messageBreakdown.toolResultTokens,
                    attachmentTokens: ctx.messageBreakdown.attachmentTokens,
                    assistantMessageTokens:
                      ctx.messageBreakdown.assistantMessageTokens,
                    userMessageTokens: ctx.messageBreakdown.userMessageTokens,
                  }
                : undefined,
            });
          })
          .catch((e) => {
            logger.debug("[claudeRemote] getContextUsage failed:", e);
          });
      }

      opts.onTurnComplete?.();

      if (isCompactCommand) {
        logger.debug("[claudeRemote] Compaction completed");
        opts.onCompletionEvent?.("Compaction completed");
        isCompactCommand = false;
      }

      await opts.onReady();

      const next = await opts.nextMessage();
      if (!next) {
        logger.debug("[claudeRemote] nextMessage returned null — terminating PTY");
        pty.kill("SIGTERM");
        return;
      }

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
        // onShellResult already closes the turn; don't double-close via onReady.
        opts.onShellResult?.(output);
        return;
      }

      // Hot-swap branches — Controller stubs log + no-op in PTY mode. The
      // launcher's coldModeHash catches cases that genuinely need a fresh
      // process (plan/bypass transitions, model swap).
      const newModel =
        resolveModelKey(next.mode.model) ??
        opts.claudeEnvVars?.ANTHROPIC_MODEL ??
        process.env.ANTHROPIC_MODEL;
      if (newModel && newModel !== model) {
        logger.debug(
          `[claudeRemote] Hot-swap model requested ${model} → ${newModel} (no-op under PTY; cold restart handles this)`,
        );
        await controller.setModel(newModel);
        model = newModel;
      }

      const prevMode = mode;
      const newPermissionMode = mapToClaudeMode(next.mode.permissionMode);
      const currentPermissionMode = mapToClaudeMode(mode.permissionMode);
      if (newPermissionMode !== currentPermissionMode) {
        const requiresColdRestart =
          newPermissionMode === "plan" ||
          currentPermissionMode === "plan" ||
          newPermissionMode === "bypassPermissions" ||
          currentPermissionMode === "bypassPermissions";
        if (requiresColdRestart) {
          // Launcher should have already cold-restarted via coldModeHash.
          // Preserve our local permissionMode so subsequent diffs are sane.
          logger.debug(
            `[claudeRemote] permission-mode transition reached the hot path (${currentPermissionMode} → ${newPermissionMode}) — preserving PTY state`,
          );
          mode = { ...next.mode, permissionMode: mode.permissionMode };
        } else {
          await controller.setPermissionMode(newPermissionMode);
          mode = next.mode;
        }
      } else {
        mode = next.mode;
      }

      // Run the settings-diff for state tracking even though the controller
      // call is a no-op — `AppliedSettingsState` still accumulates for the
      // `get_context_usage` / `apply_settings` RPCs.
      await applyFlagSettingsFromModeDiff(
        controller,
        prevMode,
        next.mode,
        appliedSettingsState,
      );

      // Push the prompt to the PTY. `shouldQuery: false` (system-only
      // appends, e.g. progress sync) is not representable in TUI mode —
      // drop silently with a debug log, matching the plan's accepted loss.
      if (next.mode.shouldQuery === false) {
        logger.debug(
          "[claudeRemote] shouldQuery:false message dropped — TUI has no append-without-query semantics",
        );
        return;
      }
      // ptyReady is almost certainly resolved by now (we just consumed a
      // result), but await it anyway as cheap insurance against races.
      await ptyReady;
      writePromptToPty(pty, next.message);
    } finally {
      resultInFlight = false;
    }
  };

  // Set up the JSONL session scanner. Every raw record becomes an
  // SDKMessage-shaped object and is forwarded to opts.onMessage; result
  // records additionally drive the turn loop.
  const scanner = await createSessionScanner({
    sessionId: startFrom,
    workingDirectory: opts.path,
    onMessage: (raw) => {
      if (!firstResponseLogged) {
        firstResponseLogged = true;
        logger.debug(
          `[perf] sdk_call → first_response: ${Date.now() - sdkCallAt}ms (type=${raw.type})`,
        );
      }

      const sdkMsg = rawToSdkMessage(raw);
      if (sdkMsg) {
        logger.debugLargeJson(`[claudeRemote] onMessageReceived ${raw.type}`, sdkMsg);
        opts.onMessage(sdkMsg);
      }

      // Surface new session ids as the JSONL records show up.
      const rawRecord = raw as Record<string, unknown>;
      const sid = typeof rawRecord.sessionId === "string"
        ? rawRecord.sessionId
        : typeof rawRecord.session_id === "string"
          ? (rawRecord.session_id as string)
          : undefined;
      if (sid && !seenSessionIds.has(sid)) {
        seenSessionIds.add(sid);
        opts.onSessionFound(sid);
        // Make sure the scanner also follows future writes to this id.
        scanner.onNewSession(sid).catch(() => undefined);
      }

      // Tool-result abort detection — matches the SDK-era behaviour where
      // a tool that the caller marked aborted should tear the turn down.
      if (raw.type === "user") {
        const blocks = Array.isArray((raw as { message?: { content?: unknown } })
          .message?.content)
          ? ((raw as { message: { content: Array<Record<string, unknown>> } })
              .message.content)
          : [];
        for (const block of blocks) {
          const useId = (block as { tool_use_id?: unknown }).tool_use_id;
          if (
            (block as { type?: unknown }).type === "tool_result" &&
            typeof useId === "string" &&
            opts.isAborted(useId)
          ) {
            logger.debug("[claudeRemote] Tool aborted, tearing down PTY");
            aborted = true;
            pty.kill("SIGTERM");
            return;
          }
        }
      }

      // Aggregate per-turn data so we can synthesize a `result` record
      // when the TUI signals turn end. See `turnModelUsage` declaration.
      if (raw.type === "assistant") {
        turnAssistantCount += 1;
        const assistantRaw = raw as {
          message?: {
            model?: string;
            stop_reason?: string;
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_creation_input_tokens?: number;
              cache_read_input_tokens?: number;
            };
          };
        };
        if (typeof assistantRaw.message?.stop_reason === "string") {
          turnLastStopReason = assistantRaw.message.stop_reason;
        }
        const usage = assistantRaw.message?.usage;
        const model = assistantRaw.message?.model;
        if (usage && model) {
          const existing = turnModelUsage.get(model) ?? {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0,
            contextWindow: 0,
            maxOutputTokens: 0,
          };
          existing.inputTokens += usage.input_tokens ?? 0;
          existing.outputTokens += usage.output_tokens ?? 0;
          existing.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
          existing.cacheCreationInputTokens +=
            usage.cache_creation_input_tokens ?? 0;
          turnModelUsage.set(model, existing);
        }
      }

      if (raw.type === "system") {
        const systemRaw = raw as { subtype?: unknown };
        // TUI turn-end marker — the only "this turn is done" signal the
        // JSONL stream emits. Synthesize a `result` record so the
        // existing handleResult → onReady → nextMessage loop advances.
        // Without this, the first turn never closes: the App spinner
        // would spin forever AND no second user prompt would ever be
        // written to the PTY (nextMessage() is only consumed inside
        // handleResult).
        if (systemRaw.subtype === "turn_duration") {
          const modelUsageObj: Record<string, TurnModelUsageEntry> = {};
          for (const [k, v] of turnModelUsage) modelUsageObj[k] = v;
          const synthetic = {
            type: "result" as const,
            uuid: `synthetic-result-${Date.now()}`,
            subtype: "success",
            total_cost_usd: 0,
            num_turns: turnAssistantCount,
            terminal_reason: turnLastStopReason,
            modelUsage: modelUsageObj,
          };
          logger.debug(
            `[claudeRemote] synthesized result from turn_duration: num_turns=${synthetic.num_turns} stop_reason=${synthetic.terminal_reason ?? "(none)"} models=${Object.keys(modelUsageObj).length}`,
          );
          resetTurnAggregates();
          void handleResult(synthetic);
          return;
        }
        // Other system records (e.g. stop_hook_summary) re-assert
        // thinking=true so the App spinner stays consistent across
        // mid-turn restarts.
        updateThinking(true);
      }

      if (raw.type === "result") {
        void handleResult(raw as { type: "result" } & Record<string, unknown>);
      }
    },
  });

  // Subscribe to the caller's external session-id channel (typically fed by
  // the SessionStart hook in runClaude.ts). This is the only way a fresh
  // PTY-mode session learns which JSONL file the TUI is writing to before
  // the scanner has anything to read. Idempotent on the scanner side, so
  // a later in-band discovery via onMessage will no-op.
  const unsubscribeSessionFound = opts.registerSessionFoundCallback?.((sid) => {
    if (seenSessionIds.has(sid)) return;
    seenSessionIds.add(sid);
    logger.debug(
      `[claudeRemote] external session-id notification: ${sid} — handing to scanner`,
    );
    scanner.onNewSession(sid).catch(() => undefined);
  });

  // Mid-turn user input from the App composer — writes straight to PTY.
  // Callback is sync, so we fire-and-forget the readiness wait; in practice
  // the user can't compose a message faster than ~800ms after spawn anyway.
  opts.onMessagesReady?.((msg) => {
    const text = flattenUserContent(msg);
    if (!text) return;
    void ptyReady.then(() => writePromptToPty(pty, text));
  });

  // Initial prompt — skip when `continue` so the TUI resumes its own state.
  if (!initial.mode.continue) {
    await ptyReady;
    writePromptToPty(pty, initial.message);
  }

  try {
    await exitPromise;
  } catch (e) {
    if (e instanceof AbortError) {
      logger.debug("[claudeRemote] Aborted via AbortError");
    } else {
      throw e;
    }
  } finally {
    updateThinking(false);
    if (typeof unsubscribeSessionFound === "function") {
      try { unsubscribeSessionFound(); } catch { /* best-effort */ }
    }
    try {
      await scanner.cleanup();
    } catch (e) {
      logger.debug("[claudeRemote] scanner cleanup failed:", e);
    }
    if (!pty.exited) pty.kill("SIGTERM");
  }
}
