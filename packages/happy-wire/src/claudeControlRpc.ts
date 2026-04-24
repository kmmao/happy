/**
 * Claude Control RPC — wire schemas for the Claude-runtime-only sidebar APIs
 * added in SDK 0.2.119.
 *
 * These RPCs are registered by the Claude CLI's RpcHandlerManager and consumed
 * by Happy App through the standard encrypted RPC channel. Params and
 * responses are E2E encrypted by RpcHandlerManager at the transport layer;
 * the schemas here describe the plaintext shape on both ends.
 *
 * Namespace convention: methods are registered as `claude-control:<subtype>`
 * on RpcHandlerManager's scopePrefix so they never collide with codex/gemini
 * runtime RPCs.
 *
 * Tier classification (see docs/encryption.md for the full data-tier model):
 *   - Plaintext-content tier (simple pass-through, no content-level secrets):
 *       get_session_cost, get_binary_version, set_color
 *   - E2E content tier (payload contains user source / paths):
 *       read_file
 *   - Permission-gated (destructive side effects):
 *       mcp_call
 */

import { z } from 'zod';

export const CLAUDE_CONTROL_SCOPE = 'claude-control' as const;

// ── get_session_cost ────────────────────────────────────────────────────────
export const GetSessionCostRequestSchema = z.object({}).strict();
export const GetSessionCostResponseSchema = z.object({
    /** Pre-formatted single-line summary (same text `/usage` prints in non-interactive mode). */
    formatted: z.string(),
    /** Total USD spent on this session so far. */
    totalUsd: z.number().nonnegative(),
    /** Optional breakdown by model. */
    byModel: z.record(z.string(), z.object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        cacheCreationInputTokens: z.number().int().nonnegative().optional(),
        cacheReadInputTokens: z.number().int().nonnegative().optional(),
        costUsd: z.number().nonnegative(),
    })).optional(),
}).strict();
export type GetSessionCostRequest = z.infer<typeof GetSessionCostRequestSchema>;
export type GetSessionCostResponse = z.infer<typeof GetSessionCostResponseSchema>;

// ── get_binary_version ──────────────────────────────────────────────────────
export const GetBinaryVersionRequestSchema = z.object({}).strict();
export const GetBinaryVersionResponseSchema = z.object({
    /** Remote Claude Code binary version string, e.g. "2.1.119". */
    version: z.string(),
    /** Path to the binary if resolvable, informational only. */
    binaryPath: z.string().optional(),
    /** Happy-cli package version for context. */
    happyCliVersion: z.string().optional(),
}).strict();
export type GetBinaryVersionRequest = z.infer<typeof GetBinaryVersionRequestSchema>;
export type GetBinaryVersionResponse = z.infer<typeof GetBinaryVersionResponseSchema>;

// ── set_color ───────────────────────────────────────────────────────────────
export const SetColorRequestSchema = z.object({
    /** Agent color name or the literal "default" to reset. */
    color: z.string().min(1).max(64),
}).strict();
export const SetColorResponseSchema = z.object({
    success: z.literal(true),
    color: z.string(),
}).strict();
export type SetColorRequest = z.infer<typeof SetColorRequestSchema>;
export type SetColorResponse = z.infer<typeof SetColorResponseSchema>;

// ── read_file ───────────────────────────────────────────────────────────────
export const ReadFileRequestSchema = z.object({
    /** Path relative to cwd or absolute. CLI applies path blacklist + Read-tool permission gating. */
    path: z.string().min(1).max(4096),
    /** Optional max bytes to return; server-side hard cap enforces <= 1 MiB. */
    maxBytes: z.number().int().positive().max(1024 * 1024).optional(),
}).strict();
export const ReadFileResponseSchema = z.object({
    /** Null when permission denied / missing / blocked by CLI path blacklist. */
    result: z.object({
        contents: z.string(),
        absPath: z.string(),
        truncated: z.boolean().optional(),
    }).nullable(),
    /** Machine-readable reason when result is null. */
    deniedReason: z.enum(['not_found', 'permission_denied', 'blacklisted_path', 'too_large', 'error']).optional(),
}).strict();
export type ReadFileRequest = z.infer<typeof ReadFileRequestSchema>;
export type ReadFileResponse = z.infer<typeof ReadFileResponseSchema>;

// ── mcp_call ────────────────────────────────────────────────────────────────
export const McpCallRequestSchema = z.object({
    /** Fully-qualified MCP tool name, e.g. `mcp__fs__read`. Must pass CLI whitelist. */
    tool: z.string().regex(/^mcp__[a-z0-9_-]+__[a-z0-9_.-]+$/i, 'must be of form mcp__<server>__<tool>'),
    /** Tool arguments; schema-free, CLI passes through to MCP server. */
    arguments: z.record(z.string(), z.unknown()).optional(),
    /**
     * Client-nonce that App must have displayed to the user in a 2-step
     * confirm dialog. CLI uses this only for audit logging — the actual
     * confirmation happens on App side and is logged for security review.
     */
    clientConfirmToken: z.string().min(8).max(128),
}).strict();
export const McpCallResponseSchema = z.object({
    success: z.boolean(),
    /** Tool response payload, shape defined by each MCP tool. */
    result: z.unknown().optional(),
    /** Error code for UI to localize; see CLI handler for enum values. */
    errorCode: z.enum([
        'not_whitelisted',
        'server_unavailable',
        'tool_not_found',
        'invalid_arguments',
        'permission_denied',
        /**
         * SDK 0.2.119 defines the `mcp_call` control protocol type but does
         * not expose a public runtime method on the `Query` interface. Until
         * upstream lands a `callMcpTool()` / equivalent, the CLI handler
         * returns this code so the App can surface an honest "waiting on
         * SDK" state instead of masking the gap as a server error.
         */
        'sdk_not_implemented',
        'unknown',
    ]).optional(),
    errorMessage: z.string().optional(),
}).strict();
export type McpCallRequest = z.infer<typeof McpCallRequestSchema>;
export type McpCallResponse = z.infer<typeof McpCallResponseSchema>;

/**
 * Method name enum — consumers should derive typed handlers from this.
 * When adding a new method, update the CLI handler registration too.
 */
export const CLAUDE_CONTROL_METHODS = [
    'get_session_cost',
    'get_binary_version',
    'set_color',
    'read_file',
    'mcp_call',
] as const;

export type ClaudeControlMethod = typeof CLAUDE_CONTROL_METHODS[number];
