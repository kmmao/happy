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
