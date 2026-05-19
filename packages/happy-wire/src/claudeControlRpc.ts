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
 *   - MCP management tier (runtime server lifecycle, SDK 0.3.142+):
 *       set_mcp_servers, reconnect_mcp_server, toggle_mcp_server
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
    /** Messages 内部 token 细分（SDK messageBreakdown）。仅 SDK 0.2.139+ 返回。 */
    messageBreakdown: z.object({
        toolCallTokens: z.number().int().nonnegative(),
        toolResultTokens: z.number().int().nonnegative(),
        attachmentTokens: z.number().int().nonnegative(),
        assistantMessageTokens: z.number().int().nonnegative(),
        userMessageTokens: z.number().int().nonnegative(),
        redirectedContextTokens: z.number().int().nonnegative(),
        unattributedTokens: z.number().int().nonnegative(),
        toolCallsByType: z.array(z.object({
            name: z.string(),
            callTokens: z.number().int().nonnegative(),
            resultTokens: z.number().int().nonnegative(),
        })),
        attachmentsByType: z.array(z.object({
            name: z.string(),
            tokens: z.number().int().nonnegative(),
        })),
    }).optional(),
    /** System Prompt 各段 token 细分。 */
    systemPromptSections: z.array(z.object({
        name: z.string(),
        tokens: z.number().int().nonnegative(),
    })).optional(),
    /** API 实际用量（input/output/cache hit/miss）。 */
    apiUsage: z.object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        cacheCreationInputTokens: z.number().int().nonnegative(),
        cacheReadInputTokens: z.number().int().nonnegative(),
    }).nullable().optional(),
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

// ── set_mcp_servers (SDK 0.3.142+) ──────────────────────────────────────────
/**
 * Hot-swap the full set of MCP servers on a running session. The SDK diffs
 * against the current set, connects newly added servers, and disconnects
 * removed ones. Existing servers whose config hasn't changed keep their
 * connection alive.
 */
export const SetMcpServersRequestSchema = z.object({
    /** Full MCP server config map — keys are server names, values are McpServerConfig. */
    servers: z.record(z.string(), z.object({
        /** Transport type: 'stdio', 'sse', 'streamable-http', or 'url'. */
        type: z.string().optional(),
        /** Command for stdio transport. */
        command: z.string().optional(),
        /** Args for stdio transport. */
        args: z.array(z.string()).optional(),
        /** Environment variables for stdio transport. */
        env: z.record(z.string(), z.string()).optional(),
        /** URL for sse / streamable-http / url transports. */
        url: z.string().optional(),
    })),
}).strict();
export const SetMcpServersResponseSchema = z.object({
    /** Server names that were newly connected. */
    added: z.array(z.string()),
    /** Server names that were disconnected. */
    removed: z.array(z.string()),
    /** Per-server errors keyed by server name. Empty when all succeeded. */
    errors: z.record(z.string(), z.string()),
}).strict();
export type SetMcpServersRequest = z.infer<typeof SetMcpServersRequestSchema>;
export type SetMcpServersResponse = z.infer<typeof SetMcpServersResponseSchema>;

// ── reconnect_mcp_server (SDK 0.3.142+) ─────────────────────────────────────
/** Reconnect a single MCP server by name (e.g. after a transient failure). */
export const ReconnectMcpServerRequestSchema = z.object({
    serverName: z.string().min(1).max(256),
}).strict();
export const ReconnectMcpServerResponseSchema = z.object({
    success: z.literal(true),
}).strict();
export type ReconnectMcpServerRequest = z.infer<typeof ReconnectMcpServerRequestSchema>;
export type ReconnectMcpServerResponse = z.infer<typeof ReconnectMcpServerResponseSchema>;

// ── toggle_mcp_server (SDK 0.3.142+) ────────────────────────────────────────
/** Enable or disable a single MCP server without removing its config. */
export const ToggleMcpServerRequestSchema = z.object({
    serverName: z.string().min(1).max(256),
    enabled: z.boolean(),
}).strict();
export const ToggleMcpServerResponseSchema = z.object({
    success: z.literal(true),
}).strict();
export type ToggleMcpServerRequest = z.infer<typeof ToggleMcpServerRequestSchema>;
export type ToggleMcpServerResponse = z.infer<typeof ToggleMcpServerResponseSchema>;

// ── add_mcp_server (dynamic single-server registration) ────────────────────
/**
 * Register a single MCP server on a running session. The server is validated,
 * merged with existing user servers, and connected via `setMcpServers()`.
 * Protected server names (`happy`, `happy-knowledge`) are rejected.
 */
export const AddMcpServerRequestSchema = z.object({
    /** Unique server name. Must not collide with protected names. */
    name: z.string().min(1).max(256),
    /** Server transport config — same shape as SetMcpServersRequest entries. */
    config: z.object({
        type: z.string().optional(),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        url: z.string().optional(),
    }),
}).strict();
export const AddMcpServerResponseSchema = z.object({
    /** Whether the server was successfully added and connected. */
    success: z.boolean(),
    /** Server names that were newly connected (typically just the one added). */
    added: z.array(z.string()),
    /** Per-server errors. Empty on success. */
    errors: z.record(z.string(), z.string()),
    /** Error message when success is false. */
    errorMessage: z.string().optional(),
}).strict();
export type AddMcpServerRequest = z.infer<typeof AddMcpServerRequestSchema>;
export type AddMcpServerResponse = z.infer<typeof AddMcpServerResponseSchema>;

// ── remove_mcp_server (dynamic single-server unregistration) ───────────────
/**
 * Unregister and disconnect a single MCP server from a running session.
 * Protected server names are rejected. Removing a non-existent server is
 * idempotent (returns success).
 */
export const RemoveMcpServerRequestSchema = z.object({
    /** Server name to remove. */
    name: z.string().min(1).max(256),
}).strict();
export const RemoveMcpServerResponseSchema = z.object({
    success: z.boolean(),
    /** Server names that were disconnected (typically just the one removed). */
    removed: z.array(z.string()),
    /** Error message when success is false. */
    errorMessage: z.string().optional(),
}).strict();
export type RemoveMcpServerRequest = z.infer<typeof RemoveMcpServerRequestSchema>;
export type RemoveMcpServerResponse = z.infer<typeof RemoveMcpServerResponseSchema>;

// ── apply_settings (SDK 0.3.142+) ───────────────────────────────────────────
/**
 * Dynamically merge partial settings into the flag settings layer of a running
 * session via `Query.applyFlagSettings()`. Flag settings sit above
 * user/project/local settings and below managed policy settings.
 *
 * Typical use cases:
 *   - Update permission rules (allow/deny) without cold restart
 *   - Change hooks configuration
 *   - Toggle MCP server approval settings
 *   - Override model at the settings level
 *
 * Pass `null` for a top-level key to clear it from the flag layer (falls back
 * to lower-precedence sources). Successive calls shallow-merge top-level keys.
 */
export const ApplySettingsRequestSchema = z.object({
    /** Partial Settings object — only supplied keys are merged. */
    settings: z.record(z.string(), z.unknown()),
}).strict();
export const ApplySettingsResponseSchema = z.object({
    success: z.literal(true),
}).strict();
export type ApplySettingsRequest = z.infer<typeof ApplySettingsRequestSchema>;
export type ApplySettingsResponse = z.infer<typeof ApplySettingsResponseSchema>;

// ── Session Management (SDK 0.3.143+ standalone exports) ───────────────────

/** Session info shape returned by SDK's listSessions / getSessionInfo. */
export const SdkSessionInfoSchema = z.object({
    sessionId: z.string(),
    summary: z.string(),
    lastModified: z.number(),
    fileSize: z.number().optional(),
    customTitle: z.string().optional(),
    firstPrompt: z.string().optional(),
    gitBranch: z.string().optional(),
    cwd: z.string().optional(),
    tag: z.string().optional(),
    createdAt: z.number().optional(),
});
export type SdkSessionInfo = z.infer<typeof SdkSessionInfoSchema>;

// ── list_sessions ──────────────────────────────────────────────────────────
export const ListSessionsRequestSchema = z.object({
    /** Directory to scope results to. Omit for all projects. */
    dir: z.string().optional(),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
}).strict();
export const ListSessionsResponseSchema = z.object({
    sessions: z.array(SdkSessionInfoSchema),
}).strict();
export type ListSessionsRequest = z.infer<typeof ListSessionsRequestSchema>;
export type ListSessionsResponse = z.infer<typeof ListSessionsResponseSchema>;

// ── get_session_info ───────────────────────────────────────────────────────
export const GetSessionInfoRequestSchema = z.object({
    /** Session ID to look up. */
    targetSessionId: z.string().min(1),
    dir: z.string().optional(),
}).strict();
export const GetSessionInfoResponseSchema = z.object({
    session: SdkSessionInfoSchema.nullable(),
}).strict();
export type GetSessionInfoRequest = z.infer<typeof GetSessionInfoRequestSchema>;
export type GetSessionInfoResponse = z.infer<typeof GetSessionInfoResponseSchema>;

// ── delete_session ─────────────────────────────────────────────────────────
export const DeleteSessionRequestSchema = z.object({
    targetSessionId: z.string().min(1),
    dir: z.string().optional(),
}).strict();
export const DeleteSessionResponseSchema = z.object({
    success: z.literal(true),
}).strict();
export type DeleteSessionRequest = z.infer<typeof DeleteSessionRequestSchema>;
export type DeleteSessionResponse = z.infer<typeof DeleteSessionResponseSchema>;

// ── rename_session ─────────────────────────────────────────────────────────
export const RenameSessionRequestSchema = z.object({
    targetSessionId: z.string().min(1),
    title: z.string().min(1).max(500),
    dir: z.string().optional(),
}).strict();
export const RenameSessionResponseSchema = z.object({
    success: z.literal(true),
}).strict();
export type RenameSessionRequest = z.infer<typeof RenameSessionRequestSchema>;
export type RenameSessionResponse = z.infer<typeof RenameSessionResponseSchema>;

// ── get_session_messages ───────────────────────────────────────────────────
export const GetSessionMessagesRequestSchema = z.object({
    targetSessionId: z.string().min(1),
    dir: z.string().optional(),
    limit: z.number().int().positive().max(1000).optional(),
    offset: z.number().int().nonnegative().optional(),
    includeSystemMessages: z.boolean().optional(),
}).strict();
export const GetSessionMessagesResponseSchema = z.object({
    messages: z.array(z.object({
        type: z.enum(['user', 'assistant', 'system']),
        uuid: z.string(),
        sessionId: z.string(),
        content: z.unknown(),
    })),
    totalCount: z.number().int().nonnegative(),
}).strict();
export type GetSessionMessagesRequest = z.infer<typeof GetSessionMessagesRequestSchema>;
export type GetSessionMessagesResponse = z.infer<typeof GetSessionMessagesResponseSchema>;

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
    'set_mcp_servers',
    'reconnect_mcp_server',
    'toggle_mcp_server',
    'add_mcp_server',
    'remove_mcp_server',
    'apply_settings',
    'list_sessions',
    'get_session_info',
    'delete_session',
    'rename_session',
    'get_session_messages',
] as const;

export type ClaudeControlMethod = typeof CLAUDE_CONTROL_METHODS[number];
