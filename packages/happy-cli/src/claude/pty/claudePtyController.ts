/**
 * claudePtyController — a `Query`-shaped controller backed by a PTY.
 *
 * Why this exists
 * ---------------
 * Before the PTY migration the launcher consumed `OfficialQuery` from
 * `@anthropic-ai/claude-agent-sdk` for runtime control. Most of those
 * runtime knobs (hot-swap model / permission mode / MCP servers /
 * applyFlagSettings / stopTask / backgroundTasks / seedReadState /
 * reconnectMcpServer / toggleMcpServer) have no equivalent in the Claude
 * TUI — they were SDK-only conveniences. The migration plan accepted
 * that loss: behaviour changes are driven by the launcher's
 * `coldModeHash` cold-restart instead, and `applyFlagSettings` patches
 * happen at PTY spawn time (via `buildClaudeCliFlags` + temporary
 * settings.json) rather than at runtime.
 *
 * What remains on this controller is the subset that still has a real
 * behaviour in PTY mode:
 *
 *   • interrupt()                       → write Ctrl-C (0x03) to PTY stdin
 *   • approveExitPlan()                 → write "1\r" to confirm TUI plan-mode dialog
 *   • approveExitPlanWhenPickerReady()  → react to picker appearing in onData,
 *                                          with 2 s blind fallback
 *   • setModel()                        → write "/model <name>\r" to hot-swap the
 *                                          model within a session (no restart)
 *   • mcpServerStatus()                 → snapshot the launcher-side MCP config map
 *   • getContextUsage()       → reconstruct usage from JSONL snapshot
 *   • initializationResult()  → returns empty models[] (App still polls)
 *   • readFile()              → read the file from disk (handler gates the path)
 *
 * Type compatibility
 * ------------------
 * The returned object is shaped to match the subset of `OfficialQuery`
 * the launcher actually calls. It is NOT a full implementation of the
 * SDK interface, and consumers must not rely on returned values from
 * the no-op methods.
 *
 * getContextUsage — PTY implementation
 * -------------------------------------
 * The SDK's `getContextUsage()` queries a live in-process runtime object.
 * In PTY mode there is no such object. Instead, `claudeRemote.ts` tracks
 * the latest `assistant` message usage fields (input_tokens,
 * cache_read_input_tokens, cache_creation_input_tokens) from the session
 * JSONL scanner and passes a `getLatestUsage` getter at construction time.
 *
 * What we can reconstruct from session data:
 *   ✓ totalTokens  — sum of all three input buckets (the actual context window)
 *   ✓ maxTokens    — derived from model name via a hardcoded lookup table
 *   ✓ percentage   — totalTokens / maxTokens * 100
 *   ✓ model        — from assistant message
 *   ✓ apiUsage     — direct mapping of the four raw fields
 *   ✓ categories   — three input buckets (Cached context / Cache write /
 *                    New input) derived from the API's own usage fields;
 *                    NOT the SDK's system/tools/memory breakdown
 *
 * What remains unavailable in PTY mode:
 *   ✗ categories breakdown (system prompt / tools / memory / messages)
 *   ✗ memoryFiles, mcpTools, systemPromptSections (not in session JSONL)
 *   ✗ messageBreakdown per-category (would require parsing every message)
 */

import { readFile as fsReadFile } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";
import type { ClaudePtyHandle } from "./claudePtyRuntime";
import { logger } from "@/ui/logger";
import { probeMcpServer } from "@/claude/utils/mcpStatusProbe";

// ── UsageSnapshot ─────────────────────────────────────────────────────────────

/**
 * Raw token-usage extracted from the latest `assistant` JSONL message.
 * Populated by `claudeRemote.ts` as the session scanner emits messages;
 * consumed by `getContextUsage()` to synthesise a context-usage response.
 */
export interface UsageSnapshot {
  model: string;
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
}

// ── Model context-window limits ───────────────────────────────────────────────

/**
 * Known model → context window (input tokens) mapping.
 * All current Claude models share a 200k context window.
 * Prefix-matched so future minor versions (e.g. "claude-opus-4-8") resolve
 * without a code change.
 */
const MODEL_CONTEXT_LIMITS: Array<[prefix: string, maxTokens: number]> = [
  ["claude-opus-4", 200_000],
  ["claude-sonnet-4", 200_000],
  ["claude-haiku-4", 200_000],
  ["claude-3-5-sonnet", 200_000],
  ["claude-3-5-haiku", 200_000],
  ["claude-3-opus", 200_000],
  ["claude-3-sonnet", 200_000],
  ["claude-3-haiku", 200_000],
];

function maxTokensForModel(model: string): number {
  for (const [prefix, limit] of MODEL_CONTEXT_LIMITS) {
    if (model.startsWith(prefix)) return limit;
  }
  // Conservative fallback — matches every deployed Claude model today.
  return 200_000;
}

// ── Interface ─────────────────────────────────────────────────────────────────

/**
 * The narrow surface the launcher and RPC handlers actually need in PTY
 * mode. Each method has a concrete behaviour — no-op shims that mirrored
 * SDK-only knobs (setModel / setPermissionMode / setMcpServers /
 * applyFlagSettings / stopTask / backgroundTasks / seedReadState /
 * reconnectMcpServer / toggleMcpServer) were removed once their callers
 * proved to be dead paths; cold restart via `coldModeHash` replaces them.
 */
export interface ClaudePtyController {
  /** Send SIGINT-equivalent to the PTY (Ctrl-C). */
  interrupt(): Promise<void>;
  /**
   * Approve the Claude TUI's ExitPlanMode confirmation dialog by writing
   * the "1\r" keystroke to PTY stdin — selecting the first option
   * ("Yes, and auto-accept edits going forward"). Required because PTY
   * mode bypasses `canCallTool`: when Claude emits an ExitPlanMode tool_use
   * the TUI renders an in-terminal Yes/No picker that no App button can
   * reach. In Yolo/bypassPermissions mode the launcher invokes this
   * automatically so plan-mode sessions don't hang indefinitely.
   *
   * NOTE: TUI's exit-plan picker has no "bypassPermissions" option — it
   * only offers auto-accept-edits (option 1) or manual approval (option 2).
   * We pick option 1 because it preserves the closest equivalent of the
   * user's intent (no further per-tool prompts) for the rest of the turn.
   */
  approveExitPlan(): Promise<void>;
  /**
   * Robust variant of `approveExitPlan()`: sends "1\r" the moment the TUI
   * plan-mode picker is detected. Detection has three layers, fastest wins:
   *   1. the replay-buffer snapshot at call time — catches a picker already
   *      on screen before we subscribed (`onData` only delivers future
   *      chunks, so without this the case below fell to the blind timeout);
   *   2. a sliding window over subsequent `onData` chunks — catches a picker
   *      rendered after the call;
   *   3. a blind 2 s fallback keystroke if neither matched.
   *
   * Why this exists alongside `approveExitPlan()`:
   *   - `approveExitPlan()` is a primitive used by tests and any future
   *     RPC-triggered manual override. It writes "1\r" unconditionally.
   *   - `approveExitPlanWhenPickerReady()` is the production path used by
   *     the launcher in Yolo/bypass mode. The split keeps the primitive
   *     observable without the detection wiring.
   *
   * The fallback timeout exists because Subagent-emitted ExitPlanMode
   * tool_use events historically stalled the session for thousands of
   * seconds in Yolo mode (see commit 41aba1263 for the JSONL-detection
   * origin). A blind 600 ms send fixed the common case; 2 s with reactive
   * detection covers the slow/wrapped-output edge cases that motivated
   * this routine.
   *
   * Resolves once the keystroke is written (either reactively or via the
   * fallback). Never rejects — failures are logged and swallowed because
   * the alternative is silently hanging the session.
   */
  approveExitPlanWhenPickerReady(): Promise<void>;
  /**
   * Hot-swap the active model on a running session by writing the TUI's
   * `/model <name>\r` slash command to PTY stdin.
   *
   * Why this exists: the SDK era had `Query.setModel()`. PTY mode dropped it,
   * so the launcher's `coldModeHash` (which deliberately excludes model within
   * the same context-window tier) classified a model change as "hot-swap, no
   * restart" — but nothing actually re-applied the model, so the switch was
   * silently lost until an unrelated cold restart. `claudeCliFlags.ts`
   * documents `/model …` as the runtime-swap mechanism, and `mode.model` is the
   * same value passed to `--model` at spawn, so it is accepted verbatim here.
   *
   * `claudeRemote.ts` calls this just before writing the next prompt whenever
   * `mode.model` differs from the model last applied to the PTY, so the turn
   * runs under the new model. Never rejects — failures are logged and
   * swallowed (the caller treats it as fire-and-forget, like `approveExitPlan`).
   *
   * Verified against claude 2.1.150 (TUI probe): `/model <name>` with an
   * explicit argument applies immediately and inline (`⎿ Set model to … for
   * this session`) with NO selection picker — only bare `/model` (no argument)
   * opens the picker, which we never send. So a single blind write suffices and
   * the picker-navigation layer that `approveExitPlanWhenPickerReady` needs is
   * unnecessary here. The TUI also parses the Happy `[1m]` suffix as a 1M-context
   * request (rejected inline, no picker, on accounts without 1M access) — exactly
   * as boot `--model` treats the same resolved string, so no new failure mode.
   */
  setModel(model: string): Promise<void>;
  /** Initialization result — returns empty model list in PTY mode. */
  initializationResult(): Promise<{
    claude_code_version?: string;
    models?: Array<{
      value: string;
      displayName?: string;
      description?: string | null;
      supportsEffort?: boolean | null;
      supportedEffortLevels?: string[] | null;
      supportsAdaptiveThinking?: boolean | null;
    }>;
  }>;
  /**
   * Read a file from disk — sidebar uses this for the "view file" action.
   *
   * The caller (`claudeControlHandlers.read_file`) resolves the request path
   * against the session cwd and rejects blacklisted paths (`~/.ssh`, `~/.aws`,
   * `/etc/shadow`, …) BEFORE invoking this, so it passes an already-absolute,
   * already-vetted path. We read it with `node:fs/promises`, truncate to
   * `maxBytes`, and reject binaries (NUL byte / heavy U+FFFD after UTF-8
   * decode) to keep garbage out of the App's text viewer.
   *
   * Returns null on any failure (missing file, directory, permission error,
   * binary content); the handler maps null to `permission_denied`.
   */
  readFile(
    path: string,
    opts?: { maxBytes?: number },
  ): Promise<{
    contents: string;
    absPath: string;
    truncated: boolean;
  } | null>;
  /** Snapshot MCP server statuses from the launcher-side config map. */
  mcpServerStatus(): Promise<Array<{
    name: string;
    status: "failed" | "pending" | "connected" | "disabled" | "needs-auth";
    serverInfo?: { name: string; version: string };
    error?: string;
    scope?: string;
    tools?: Array<{ name: string; description?: string }>;
  }>>;
  /**
   * Context window usage breakdown.
   *
   * In PTY mode this is reconstructed from the latest `assistant` message's
   * usage fields (see module doc comment). Returns null before the first
   * assistant turn completes (no snapshot yet).
   */
  getContextUsage(): Promise<{
    totalTokens: number;
    maxTokens: number;
    percentage: number;
    model: string;
    categories: Array<{ name: string; tokens: number; color: string; isDeferred?: boolean }>;
    memoryFiles?: Array<{ path: string; type: string; tokens: number }>;
    mcpTools?: Array<{
      name: string;
      serverName: string;
      tokens: number;
      isLoaded: boolean;
    }>;
    systemPromptSections?: Array<{ name: string; tokens: number }>;
    messageBreakdown?: {
      toolCallTokens: number;
      toolResultTokens: number;
      attachmentTokens: number;
      assistantMessageTokens: number;
      userMessageTokens: number;
      redirectedContextTokens: number;
      unattributedTokens: number;
      toolCallsByType?: Array<{ name: string; callTokens: number; resultTokens: number }>;
      attachmentsByType?: Array<{ name: string; tokens: number }>;
    };
    apiUsage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    };
  } | null>;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a PTY-backed controller stub.
 *
 * @param pty            Live PTY handle — used by `interrupt()` and
 *                       `approveExitPlan()` to write control bytes / keys.
 * @param getLatestUsage Optional getter for the latest assistant-message usage
 *                       snapshot. Provided by `claudeRemote.ts` which updates
 *                       a shared reference as the session scanner emits
 *                       assistant messages. Defaults to `() => null` (no data).
 * @param getMcpServers  Optional getter for the MCP server config map that was
 *                       passed to `claudeRemote()` at session start. Used by
 *                       `mcpServerStatus()` to surface configured servers to the
 *                       App even though the PTY has no programmatic status API.
 *                       Defaults to `() => ({})` (empty — no servers reported).
 * @param getReplaySnapshot Optional getter for the PTY router's current
 *                       ANSI-aware screen snapshot. Used by
 *                       `approveExitPlanWhenPickerReady()` as the first
 *                       detection layer — it catches a plan-mode picker that
 *                       was already drawn before we subscribed to `onData`
 *                       (which only delivers future chunks). Provided by
 *                       `claudeRemote.ts` after the router attaches; defaults
 *                       to `() => ""` (no snapshot — falls through to the
 *                       onData window + blind 2 s fallback).
 */
export function createClaudePtyController(
  pty: ClaudePtyHandle,
  getLatestUsage: () => UsageSnapshot | null = () => null,
  getMcpServers: () => Record<string, unknown> = () => ({}),
  getReplaySnapshot: () => string = () => "",
): ClaudePtyController {
  return {
    async interrupt() {
      logger.debug("[ptyController] interrupt → Ctrl-C");
      pty.interrupt();
    },

    async approveExitPlan() {
      // "1" + CR selects the first option ("Yes, and auto-accept edits")
      // in the TUI's plan-mode confirmation dialog. CR (\r) matches the
      // submit convention used elsewhere in the PTY layer.
      logger.debug("[ptyController] approveExitPlan → write '1\\r'");
      pty.write("1\r");
    },

    approveExitPlanWhenPickerReady() {
      return new Promise<void>((resolve) => {
        let done = false;
        let unsubscribe: (() => void) | null = null;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        // Sliding window: picker text may arrive split across multiple
        // onData chunks (especially over a slow PTY pipe with small
        // framing). 1 KB is far more than any single picker render.
        let window = "";
        const WINDOW_MAX = 1024;

        // Match Claude TUI's plan-mode picker. The `❯` cursor glyph
        // precedes the first option; we allow up to 80 chars between it
        // and `1.` to absorb ANSI colour/bold escape sequences the TUI
        // interleaves with the visible glyphs. After `1.` we explicitly
        // skip zero-or-more CSI sequences (e.g. `\x1b[0m` colour resets)
        // and then require whitespace — this rejects prose like
        // `1.5kg` (no whitespace after the dot) without missing
        // ANSI-styled options like `\x1b[1m1.\x1b[0m Yes` where the
        // whitespace sits past a colour reset. The `\b` word boundary
        // is deliberately omitted because the byte before `1` is `m`
        // (the trailing char of a CSI sequence), which is a word char.
        const PICKER_PATTERN = /❯[\s\S]{0,80}?1\.(?:\x1b\[[\d;]*m)*\s/;

        const send = (reason: string) => {
          if (done) return;
          done = true;
          if (timeoutId !== null) clearTimeout(timeoutId);
          unsubscribe?.();
          logger.debug(
            `[ptyController] approveExitPlanWhenPickerReady (${reason}) → write '1\\r'`,
          );
          try {
            pty.write("1\r");
          } catch (err) {
            // Match the "swallow + log" promise contract documented on the
            // interface — propagating here would deadlock the launcher
            // because the caller treats this as fire-and-forget.
            logger.debug(
              `[ptyController] approveExitPlanWhenPickerReady write failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          resolve();
        };

        // Layer 1: the picker may already be on screen before we subscribe.
        // onData only delivers FUTURE chunks, so without this snapshot check
        // the "picker already drawn" case fell through to the blind 2 s
        // fallback. Seed the sliding window with the current screen so a
        // picker rendered moments before this call is detected immediately.
        const snapshot = getReplaySnapshot();
        if (snapshot && PICKER_PATTERN.test(snapshot)) {
          send("picker already on screen");
          return;
        }
        // Carry the snapshot into the window so a picker that is split across
        // the snapshot boundary and the first onData chunk still matches.
        window = snapshot.length > WINDOW_MAX
          ? snapshot.slice(snapshot.length - WINDOW_MAX)
          : snapshot;

        unsubscribe = pty.onData((data: string) => {
          if (done) return;
          window += data;
          if (window.length > WINDOW_MAX) {
            window = window.slice(window.length - WINDOW_MAX);
          }
          if (PICKER_PATTERN.test(window)) {
            send("picker detected");
          }
        });

        // Fallback: 2 s is roughly 3× the original 41aba1263 hardcoded
        // 600 ms and gives the TUI plenty of time on slow systems. It
        // also covers the "picker already drawn before subscribe" case,
        // since onData only delivers future chunks.
        timeoutId = setTimeout(() => send("2s fallback timeout"), 2000);
      });
    },

    async initializationResult() {
      // No equivalent in TUI mode — return empty so the launcher emits
      // an empty models[] update instead of waiting forever.
      return { models: [] };
    },

    async readFile(path: string, opts?: { maxBytes?: number }) {
      const maxBytes = opts?.maxBytes ?? 1024 * 1024;
      // The handler already resolved the path against the session cwd and ran
      // it through the blacklist; resolve again only as a defensive no-op for
      // the rare direct caller (tests) that passes a relative path.
      const absPath = isAbsolute(path) ? path : resolvePath(path);
      try {
        const buf = await fsReadFile(absPath);

        // Binary guard 1 — a NUL byte in the first 8 KiB is the classic
        // "this is not text" marker (executables, images, archives). Reject
        // before decoding so the App never receives a wall of mojibake.
        const scanLen = Math.min(buf.length, 8192);
        for (let i = 0; i < scanLen; i++) {
          if (buf[i] === 0) {
            logger.debug(`[ptyController] readFile(${absPath}) — binary (NUL byte) → null`);
            return null;
          }
        }

        const truncated = buf.length > maxBytes;
        const contents = (truncated ? buf.subarray(0, maxBytes) : buf).toString("utf-8");

        // Binary guard 2 — non-UTF-8 binaries without an early NUL (e.g.
        // Latin-1 blobs) decode to many U+FFFD replacement chars. A truncation
        // boundary can split one multibyte char (≤1 replacement char), so we
        // only bail when replacements are a meaningful fraction of the output.
        const replacements = (contents.match(/�/g) ?? []).length;
        if (contents.length > 0 && replacements / contents.length > 0.1) {
          logger.debug(
            `[ptyController] readFile(${absPath}) — binary (${replacements}/${contents.length} replacement chars) → null`,
          );
          return null;
        }

        logger.debug(
          `[ptyController] readFile(${absPath}) ok bytes=${buf.length} truncated=${truncated}`,
        );
        return { contents, absPath, truncated };
      } catch (err) {
        logger.debug(
          `[ptyController] readFile(${absPath}) failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    },

    async setModel(model: string) {
      // Reuse mode.model verbatim — it is the same value passed to `--model`
      // at spawn, and the TUI's `/model` accepts the same aliases / full IDs.
      logger.debug(`[ptyController] setModel → write '/model ${model}\\r'`);
      try {
        pty.write(`/model ${model}\r`);
      } catch (err) {
        // Fire-and-forget contract (see interface doc): swallow + log rather
        // than reject, so a transient write failure can't deadlock the caller.
        logger.debug(
          `[ptyController] setModel write failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },

    async mcpServerStatus() {
      const servers = getMcpServers();
      const entries = Object.entries(servers);

      if (entries.length === 0) {
        logger.debug("[ptyController] mcpServerStatus() — no servers configured");
        return [];
      }

      // PTY mode has no live MCP feedback (no SDK Query.mcpServerStatus()
      // hook to listen to). Earlier revisions optimistically reported
      // "connected" for every non-disabled server, which masked typos and
      // unreachable upstreams until the user actually invoked a tool. We
      // now run cached reachability probes per server (see
      // `mcpStatusProbe.ts`):
      //
      //   stdio → PATH-resolve `command` (`command not found` → "failed")
      //   url   → HEAD/GET ping with 2 s timeout (5xx / network err → "failed")
      //
      // Probe results are cached 60 s, so the App's 30 s poll cadence does
      // at most one round-trip per server per minute. Probes still cannot
      // detect a binary that exists but won't speak MCP — only the
      // launcher / claude itself sees that — but they correctly catch the
      // common misconfig cases that were previously invisible.
      const results = await Promise.all(
        entries.map(async ([name, config]) => {
          const probe = await probeMcpServer(name, config);
          logger.debug(
            `[ptyController] mcpServerStatus ${name}=${probe.status}${probe.error ? ` (${probe.error})` : ""}`,
          );
          return probe.error
            ? { name, status: probe.status, error: probe.error }
            : { name, status: probe.status };
        }),
      );

      return results;
    },

    async getContextUsage() {
      const snapshot = getLatestUsage();
      if (!snapshot) return null;

      const {
        model,
        inputTokens,
        cacheReadInputTokens,
        cacheCreationInputTokens,
        outputTokens,
      } = snapshot;

      // Total input tokens = all three input buckets (never includes output).
      const totalTokens = inputTokens + cacheReadInputTokens + cacheCreationInputTokens;
      const maxTokens = maxTokensForModel(model);
      const percentage = maxTokens > 0 ? (totalTokens / maxTokens) * 100 : 0;

      logger.debug(
        `[ptyController] getContextUsage: model=${model} total=${totalTokens}/${maxTokens} (${percentage.toFixed(1)}%)`,
      );

      return {
        totalTokens,
        maxTokens,
        percentage,
        model,
        // PTY mode can't reproduce the SDK's system/tools/memory split (those
        // counts aren't in the session JSONL). The one decomposition we CAN
        // derive at zero extra cost is the three input buckets the API already
        // reports, which together sum to totalTokens:
        //   • Cached context — cache_read: context reused from the prompt
        //     cache (cheap; the bulk of a long session)
        //   • Cache write     — cache_creation: context written to the cache
        //     this turn (full-priced now, reused cheaply next turn)
        //   • New input       — input: genuinely uncached input this turn
        // Zero-token buckets are dropped here: the App filters zeros for its
        // breakdown list but iterates `categories` verbatim for the legend +
        // ring donut, so an empty bucket would render as a "0" legend row.
        categories: [
          { name: "Cached context", tokens: cacheReadInputTokens, color: "#34C759" },
          { name: "Cache write", tokens: cacheCreationInputTokens, color: "#FF9500" },
          { name: "New input", tokens: inputTokens, color: "#007AFF" },
        ]
          .filter((c) => c.tokens > 0)
          .map((c) => ({ ...c, isDeferred: false })),
        apiUsage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_creation_input_tokens: cacheCreationInputTokens,
          cache_read_input_tokens: cacheReadInputTokens,
        },
      };
    },
  };
}
