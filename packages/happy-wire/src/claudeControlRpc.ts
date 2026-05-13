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

// ── get_context_usage ───────────────────────────────────────────────────────
export const GetContextUsageRequestSchema = z.object({}).strict();
export const GetContextUsageResponseSchema = z.object({
    /** Per-category token counts (system prompt, messages, tools, MCP tools, memory files, etc.). */
    categories: z.array(z.object({
        name: z.string(),
        tokens: z.number().int().nonnegative(),
        /** CSS-style color string for visualization (hex, oklch, etc.). */
        color: z.string(),
        /** Whether the category is deferred / not yet loaded. */
        isDeferred: z.boolean().optional(),
    })),
    /** Total tokens consumed so far. */
    totalTokens: z.number().int().nonnegative(),
    /** Hard context window limit for the active model. */
    maxTokens: z.number().int().positive(),
    /** Percentage of context used (0–100). */
    percentage: z.number().nonnegative(),
    /** Active model name (e.g. "claude-opus-4-5"). */
    model: z.string(),
    /** CLAUDE.md and memory files loaded into context. */
    memoryFiles: z.array(z.object({
        path: z.string(),
        type: z.string(),
        tokens: z.number().int().nonnegative(),
    })),
    /** MCP tools currently loaded into context. */
    mcpTools: z.array(z.object({
        name: z.string(),
        serverName: z.string(),
        tokens: z.number().int().nonnegative(),
        isLoaded: z.boolean().optional(),
    })),
}).strict();
export type GetContextUsageRequest = z.infer<typeof GetContextUsageRequestSchema>;
export type GetContextUsageResponse = z.infer<typeof GetContextUsageResponseSchema>;

// ── get_context_detail ──────────────────────────────────────────────────────
export const GetContextDetailRequestSchema = z.object({
    /**
     * Category name from getContextUsage (e.g. "Messages", "System prompt",
     * "Skills", "Custom agents", "Autocompact buffer", "Memory files").
     */
    category: z.string().min(1).max(128),
    /**
     * When true, return only subcategory counts (no item content).
     * Only meaningful for the "Messages" category.
     */
    summaryOnly: z.boolean().optional(),
    /**
     * Filter to a specific subcategory within "Messages".
     * One of: "user", "system-reminder", "assistant".
     */
    subcategory: z.string().optional(),
}).strict();
export const GetContextDetailResponseSchema = z.object({
    /** Parsed JSONL records for the requested category. Empty when summaryOnly=true. */
    items: z.array(z.object({
        /** JSONL record type (user, assistant, attachment, system, summary, etc.) */
        type: z.string(),
        /** Role when applicable (user / assistant) */
        role: z.string().optional(),
        /** Full text content of the record. Truncated at 50 KB per item. */
        content: z.string(),
        /** UUID of the JSONL record */
        uuid: z.string().optional(),
        /** ISO timestamp of the record */
        timestamp: z.string().optional(),
    })),
    /** Category name echoed back for display */
    category: z.string(),
    /** Total number of matching items */
    totalItems: z.number().int().nonnegative(),
    /**
     * Subcategory breakdown for "Messages" when summaryOnly=true.
     * Each entry has a key, display label, and item count.
     */
    subcategories: z.array(z.object({
        /** Subcategory key: "user" | "system-reminder" | "assistant" */
        name: z.string(),
        /** Human-readable label */
        label: z.string(),
        /** Number of items in this subcategory */
        count: z.number().int().nonnegative(),
    })).optional(),
}).strict();
export type GetContextDetailRequest = z.infer<typeof GetContextDetailRequestSchema>;
export type GetContextDetailResponse = z.infer<typeof GetContextDetailResponseSchema>;

// ── get_mcp_servers ──────────────────────────────────────────────────────────
export const GetMcpServersRequestSchema = z.object({}).strict();
export const GetMcpServersResponseSchema = z.object({
    servers: z.array(z.object({
        name: z.string(),
        status: z.enum(['connected', 'failed', 'needs-auth', 'pending', 'disabled']),
        serverInfo: z.object({ name: z.string(), version: z.string() }).optional(),
        error: z.string().optional(),
        scope: z.string().optional(),
        toolCount: z.number().int().nonnegative().optional(),
        tools: z.array(z.object({
            name: z.string(),
            description: z.string().optional(),
        })).optional(),
    })),
}).strict();
export type GetMcpServersRequest = z.infer<typeof GetMcpServersRequestSchema>;
export type GetMcpServersResponse = z.infer<typeof GetMcpServersResponseSchema>;

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
    'get_context_usage',
    'get_mcp_servers',
    'get_context_detail',
] as const;

export type ClaudeControlMethod = typeof CLAUDE_CONTROL_METHODS[number];
