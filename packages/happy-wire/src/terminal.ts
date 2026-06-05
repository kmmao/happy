import * as z from "zod";

/**
 * Terminal wire types for Web terminal emulator feature.
 *
 * Data flow:
 *   App → machineRPC("terminal-spawn/resize/close") → CLI daemon (request-response)
 *   App → socket "terminal-input"  → Server relay → CLI daemon (streaming)
 *   CLI → socket "terminal-output" → Server relay → App           (streaming)
 */

// --- RPC request/response schemas (used by machineRPC) ---

export const terminalSpawnRequestSchema = z.object({
  /** Shell to use (defaults to user's default shell) */
  shell: z.string().optional(),
  /** Working directory */
  cwd: z.string().optional(),
  /** Initial terminal dimensions */
  cols: z.number().int().min(1).max(500).optional(),
  rows: z.number().int().min(1).max(200).optional(),
});
export type TerminalSpawnRequest = z.infer<typeof terminalSpawnRequestSchema>;

export const terminalSpawnResponseSchema = z.object({
  success: z.boolean(),
  terminalId: z.string().optional(),
  error: z.string().optional(),
});
export type TerminalSpawnResponse = z.infer<typeof terminalSpawnResponseSchema>;

export const terminalResizeRequestSchema = z.object({
  terminalId: z.string(),
  cols: z.number().int().min(1).max(500),
  rows: z.number().int().min(1).max(200),
});
export type TerminalResizeRequest = z.infer<typeof terminalResizeRequestSchema>;

export const terminalCloseRequestSchema = z.object({
  terminalId: z.string(),
});
export type TerminalCloseRequest = z.infer<typeof terminalCloseRequestSchema>;

/**
 * Claude PTY attach RPC — App asks the daemon "does this session have a
 * Claude TUI PTY right now, and if so, what's its current geometry plus
 * recent screen buffer for replay". Used by the App's dedicated "Claude"
 * side panel tab, which mirrors the running Claude CLI process separately
 * from the user's shell terminals.
 *
 * Unlike `terminal-spawn`, this RPC never creates a PTY — it only reports
 * on the externally-managed one owned by claudePtyRuntime in the session
 * child. After receiving `exists: true`, the App wires its xterm.js view
 * to the returned `terminalId` using the existing
 * `terminal-input` / `terminal-resize` / `terminal-close` paths.
 */
export const claudePtyAttachRequestSchema = z.object({
  sessionId: z.string().min(1),
});
export type ClaudePtyAttachRequest = z.infer<typeof claudePtyAttachRequestSchema>;

export const claudePtyAttachResponseSchema = z.object({
  success: z.boolean(),
  /**
   * `false` means the session is online but no Claude TUI is currently
   * attached (e.g. the user is running `happy` without a Claude child). The
   * App should render a "Claude not running" placeholder.
   */
  exists: z.boolean().optional(),
  terminalId: z.string().optional(),
  cols: z.number().int().positive().optional(),
  rows: z.number().int().positive().optional(),
  cwd: z.string().optional(),
  createdAt: z.number().optional(),
  /** Recent PTY output for replay on first attach. */
  snapshot: z.string().optional(),
  error: z.string().optional(),
});
export type ClaudePtyAttachResponse = z.infer<typeof claudePtyAttachResponseSchema>;

// --- Streaming event schemas (used via socket.io events) ---

/** App → Server → CLI: keyboard/paste input */
export const terminalInputPayloadSchema = z.object({
  machineId: z.string(),
  terminalId: z.string(),
  data: z.string(),
});
export type TerminalInputPayload = z.infer<typeof terminalInputPayloadSchema>;

/** CLI → Server → App: PTY output */
export const terminalOutputPayloadSchema = z.object({
  machineId: z.string(),
  terminalId: z.string(),
  data: z.string(),
});
export type TerminalOutputPayload = z.infer<typeof terminalOutputPayloadSchema>;

/** CLI → Server → App: terminal exited */
export const terminalExitPayloadSchema = z.object({
  machineId: z.string(),
  terminalId: z.string(),
  exitCode: z.number(),
});
export type TerminalExitPayload = z.infer<typeof terminalExitPayloadSchema>;

// --- Shared wire constants & helpers ---------------------------------------
//
// Centralised so CLI, daemon, App, and tests all agree on the same limits
// instead of redefining the same magic numbers in TerminalManager,
// claudePtyRouter, the daemon HTTP body validator, etc. Bumping a value here
// updates every consumer at once.

/**
 * Maximum byte-length of a single `terminal-output` socket emit. Larger PTY
 * bursts are split into chunks of at most this size by the producer side so
 * one screenful of output never blows up a single socket packet.
 */
export const TERMINAL_OUTPUT_CHUNK_BYTES = 8 * 1024;

/**
 * Rolling output buffer per terminal — used to replay the most recent screen
 * on reconnect. Also doubles as the upper bound the daemon HTTP body
 * validator enforces on `/claude-pty/data` payloads.
 */
export const TERMINAL_REPLAY_BUFFER_BYTES = 64 * 1024;

/**
 * Prefix used to mark an externally-managed PTY (currently the Claude TUI
 * spawned by happy-cli's PTY runtime) in the daemon's terminal registry.
 * The App can read the prefix off the wire to render a different UI affordance
 * for "raw Claude session" vs "ad-hoc shell".
 */
export const CLAUDE_PTY_TERMINAL_PREFIX = "claude:";

/**
 * Build the canonical terminalId for a Claude PTY belonging to a Happy
 * session. Use everywhere instead of inlining the `"claude:" + id` string.
 */
export function claudePtyTerminalId(happySessionId: string): string {
  return `${CLAUDE_PTY_TERMINAL_PREFIX}${happySessionId}`;
}

/**
 * Inverse of {@link claudePtyTerminalId}. Returns the session id if `id`
 * matches the Claude PTY format, else `null`.
 */
export function parseClaudePtyTerminalId(id: string): string | null {
  return id.startsWith(CLAUDE_PTY_TERMINAL_PREFIX)
    ? id.slice(CLAUDE_PTY_TERMINAL_PREFIX.length)
    : null;
}

/**
 * Split a string into chunks of at most `maxLen` UTF-16 code units, never
 * cutting through a surrogate pair. `node-pty` delivers data as JS strings
 * (UTF-16), and the only multi-code-unit grapheme cluster we can split mid-
 * way under naive `slice(i, i+n)` is a high+low surrogate pair (emoji,
 * astral-plane code points). Halved surrogates render as ` ` and corrupt
 * the App's xterm.js display until the next full chunk arrives.
 *
 * For ASCII-heavy terminal output this is a no-op; the cost is one
 * `charCodeAt` per chunk boundary.
 *
 * NOTE: This does NOT preserve grapheme clusters (combining marks, ZWJ
 * sequences) — only surrogate pairs. Splitting an emoji ZWJ family mid-
 * sequence may render as two separate emojis temporarily; that's an
 * accepted trade-off because xterm.js handles it without corruption.
 */
export function chunkStringSafe(input: string, maxLen: number): string[] {
  if (input.length <= maxLen) return [input];
  const chunks: string[] = [];
  let i = 0;
  while (i < input.length) {
    let end = Math.min(i + maxLen, input.length);
    if (end < input.length) {
      const code = input.charCodeAt(end - 1);
      // High surrogate at boundary → back off one so the pair stays together.
      if (code >= 0xd800 && code <= 0xdbff) end--;
    }
    // Defensive: pathological case where maxLen===1 and we just backed off
    // to 0 — emit a single code unit (the renderer will see a lone
    // surrogate, but that's better than an infinite loop).
    if (end <= i) end = i + 1;
    chunks.push(input.slice(i, end));
    i = end;
  }
  return chunks;
}
