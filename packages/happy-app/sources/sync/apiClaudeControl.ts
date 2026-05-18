/**
 * Claude Control RPC client — App-side wrapper for the sidebar APIs
 * exposed by happy-cli (SDK 0.2.119+, extended in 0.3.142+).
 *
 * All calls go through `apiSocket.sessionRPC` which applies the existing
 * per-session E2E encryption (AES-256-GCM via Session.dataEncryptionKey). No
 * additional encryption layer is added here — params/response ciphertext
 * never leaves the session key boundary.
 *
 * Method naming convention matches the CLI-side registration in
 * packages/happy-cli/src/claude/rpc/claudeControlHandlers.ts: every method is
 * prefixed with `claude-control:` under the session scope.
 *
 * Tier model (see docs/encryption.md — pending update with claude-control):
 *   - Plaintext content: get_session_cost, get_binary_version, set_color
 *   - E2E content:       read_file
 *   - Permission-gated:  mcp_call
 *
 * Usage example:
 *   import { fetchSessionCost, remoteReadFile } from '@/sync/apiClaudeControl';
 *   const cost = await fetchSessionCost(sessionId);
 *   const file = await remoteReadFile(sessionId, 'src/app.ts');
 */

import { apiSocket } from '@/sync/apiSocket';
import type {
    GetSessionCostRequest,
    GetSessionCostResponse,
    GetBinaryVersionRequest,
    GetBinaryVersionResponse,
    SetColorRequest,
    SetColorResponse,
    ReadFileRequest,
    ReadFileResponse,
    McpCallRequest,
    McpCallResponse,
    GetContextUsageRequest,
    GetContextUsageResponse,
    GetMcpServersRequest,
    GetMcpServersResponse,
    GetContextDetailRequest,
    GetContextDetailResponse,
    SetMcpServersRequest,
    SetMcpServersResponse,
    ReconnectMcpServerRequest,
    ReconnectMcpServerResponse,
    ToggleMcpServerRequest,
    ToggleMcpServerResponse,
    ApplySettingsRequest,
    ApplySettingsResponse,
    ListSessionsRequest,
    ListSessionsResponse,
    GetSessionInfoRequest,
    GetSessionInfoResponse,
    DeleteSessionRequest,
    DeleteSessionResponse,
    RenameSessionRequest,
    RenameSessionResponse,
    GetSessionMessagesRequest,
    GetSessionMessagesResponse,
    ClaudeControlMethod,
} from '@kmmao/happy-wire';
import { CLAUDE_CONTROL_SCOPE } from '@kmmao/happy-wire';

function methodName(method: ClaudeControlMethod): string {
    return `${CLAUDE_CONTROL_SCOPE}:${method}`;
}

// ─── get_session_cost ───────────────────────────────────────────────────────

/**
 * Fetch the remote CLI's running cost summary for a session. Returns zero
 * totals when no `SessionCostTracker` records have been folded yet (CLI-side
 * integration pending — see DEFERRED item in commit notes).
 */
export async function fetchSessionCost(sessionId: string): Promise<GetSessionCostResponse> {
    return apiSocket.sessionRPC<GetSessionCostResponse, GetSessionCostRequest>(
        sessionId,
        methodName('get_session_cost'),
        {},
    );
}

// ─── get_binary_version ─────────────────────────────────────────────────────

/**
 * Fetch the remote Claude Code binary version and the happy-cli package
 * version controlling it. Useful for "Remote CLI vX.Y.Z" rows in session
 * settings or diagnostics panels.
 */
export async function fetchBinaryVersion(sessionId: string): Promise<GetBinaryVersionResponse> {
    return apiSocket.sessionRPC<GetBinaryVersionResponse, GetBinaryVersionRequest>(
        sessionId,
        methodName('get_binary_version'),
        {},
    );
}

// ─── set_color ──────────────────────────────────────────────────────────────

/**
 * Inform the CLI that the user chose a new accent color for this session.
 * The CLI stores this ephemerally (ack-only); App remains source of truth
 * for persisted color (store in session KV if you need durability).
 *
 * @param color - agent color name or the literal "default" to reset
 */
export async function setSessionColor(sessionId: string, color: string): Promise<SetColorResponse> {
    return apiSocket.sessionRPC<SetColorResponse, SetColorRequest>(
        sessionId,
        methodName('set_color'),
        { color },
    );
}

// ─── read_file ──────────────────────────────────────────────────────────────

/**
 * Read a file from the remote session's cwd. CLI applies:
 *   1. Path blacklist (~/.ssh, ~/.aws, ~/.gnupg, etc.) — returns `blacklisted_path`
 *   2. SDK Read-tool permission gating — returns `permission_denied`
 *   3. maxBytes cap (default 1 MiB)
 *
 * File contents are E2E-encrypted in transit (apiSocket session encryption).
 * The returned `contents` string is already decrypted and safe to render.
 *
 * @returns `ReadFileResponse` whose `result` is null when denied; see
 * `deniedReason` for the specific cause.
 */
export async function remoteReadFile(
    sessionId: string,
    path: string,
    maxBytes?: number,
): Promise<ReadFileResponse> {
    return apiSocket.sessionRPC<ReadFileResponse, ReadFileRequest>(
        sessionId,
        methodName('read_file'),
        maxBytes != null ? { path, maxBytes } : { path },
    );
}

// ─── mcp_call ───────────────────────────────────────────────────────────────

/**
 * Invoke an MCP tool directly on the remote CLI without going through a model
 * turn. **Security-critical.**
 *
 * The App MUST:
 *   1. Show a 2-step confirmation dialog (displaying tool name + arguments
 *      summary) before calling this function.
 *   2. Generate a per-call nonce (`clientConfirmToken`) that the user has
 *      just acknowledged. CLI logs the first 8 bytes of this token in its
 *      audit trail.
 *
 * The CLI enforces:
 *   - Default deny: every call returns `not_whitelisted` unless the operator
 *     has opted into a specific MCP server via `HAPPY_SIDEBAR_MCP_WHITELIST`.
 *   - MCP server name parsing (must match `mcp__<server>__<tool>`).
 *
 * Full MCP invocation wiring is currently stubbed in the CLI (whitelist
 * passes → returns `server_unavailable`); see CLI commit notes for follow-up.
 */
export async function invokeMcpCall(
    sessionId: string,
    args: {
        tool: string;
        arguments?: Record<string, unknown>;
        clientConfirmToken: string;
    },
): Promise<McpCallResponse> {
    return apiSocket.sessionRPC<McpCallResponse, McpCallRequest>(
        sessionId,
        methodName('mcp_call'),
        args,
    );
}

// ─── get_context_usage ──────────────────────────────────────────────────────

/**
 * Fetch the current context window usage breakdown from the remote Claude
 * session. Returns token counts by category (system prompt, messages, tools,
 * MCP tools, memory files, etc.) along with the model name and total/max/%.
 *
 * Returns a zeroed-out response when no query is active yet.
 */
export async function fetchContextUsage(sessionId: string): Promise<GetContextUsageResponse> {
    return apiSocket.sessionRPC<GetContextUsageResponse, GetContextUsageRequest>(
        sessionId,
        methodName('get_context_usage'),
        {},
    );
}

// ─── get_context_detail ──────────────────────────────────────────────────────

/**
 * Fetch the full content of a context category by reading the CLI's session
 * JSONL file. Returns a list of parsed records (messages, attachments, etc.)
 * with their text content, truncated at 10 KB per item.
 */
export async function fetchContextDetail(
    sessionId: string,
    category: string,
    options?: { summaryOnly?: boolean; subcategory?: string; limit?: number },
): Promise<GetContextDetailResponse> {
    return apiSocket.sessionRPC<GetContextDetailResponse, GetContextDetailRequest>(
        sessionId,
        methodName('get_context_detail'),
        { category, ...options },
    );
}

// ─── get_mcp_servers ─────────────────────────────────────────────────────────

/**
 * Fetch the MCP server connection status from the remote Claude session.
 * Returns the name, connection state, tool inventory, and error details for
 * each configured MCP server. Returns an empty list when no query is active.
 */
export async function fetchMcpServers(sessionId: string): Promise<GetMcpServersResponse> {
    return apiSocket.sessionRPC<GetMcpServersResponse, GetMcpServersRequest>(
        sessionId,
        methodName('get_mcp_servers'),
        {},
    );
}

// ─── set_mcp_servers (SDK 0.3.142+) ────────────────────────────────────────

/**
 * Hot-swap the full set of MCP servers on a running session. The SDK diffs
 * against the current config: newly added servers are connected, removed ones
 * are disconnected, unchanged ones keep their connection.
 *
 * @param servers - Full MCP server config map (keys = server names).
 * @returns Which servers were added, removed, and any per-server errors.
 */
export async function setMcpServers(
    sessionId: string,
    servers: SetMcpServersRequest['servers'],
): Promise<SetMcpServersResponse> {
    return apiSocket.sessionRPC<SetMcpServersResponse, SetMcpServersRequest>(
        sessionId,
        methodName('set_mcp_servers'),
        { servers },
    );
}

// ─── reconnect_mcp_server (SDK 0.3.142+) ───────────────────────────────────

/**
 * Reconnect a single MCP server by name. Useful when a server has a transient
 * failure (status = 'failed') and the user wants to retry without restarting
 * the entire session.
 */
export async function reconnectMcpServer(
    sessionId: string,
    serverName: string,
): Promise<ReconnectMcpServerResponse> {
    return apiSocket.sessionRPC<ReconnectMcpServerResponse, ReconnectMcpServerRequest>(
        sessionId,
        methodName('reconnect_mcp_server'),
        { serverName },
    );
}

// ─── toggle_mcp_server (SDK 0.3.142+) ──────────────────────────────────────

/**
 * Enable or disable a single MCP server without removing its config. When
 * disabled, the server's tools are excluded from the Claude context; when
 * re-enabled, the server reconnects automatically.
 */
export async function toggleMcpServer(
    sessionId: string,
    serverName: string,
    enabled: boolean,
): Promise<ToggleMcpServerResponse> {
    return apiSocket.sessionRPC<ToggleMcpServerResponse, ToggleMcpServerRequest>(
        sessionId,
        methodName('toggle_mcp_server'),
        { serverName, enabled },
    );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
// ─── apply_settings (SDK 0.3.142+) ─────────────────────────────────────────

/**
 * Dynamically merge partial settings into the running session's flag settings
 * layer via `Query.applyFlagSettings()`. Flag settings sit above
 * user/project/local settings and below managed policy settings.
 *
 * Use cases:
 *   - Update permission rules (allow/deny) without cold restart
 *   - Change hooks configuration
 *   - Toggle MCP server approval settings
 *
 * @param settings - Partial Settings object; only supplied keys are merged.
 *   Pass `null` for a key to clear it from the flag layer.
 */
export async function applySettings(
    sessionId: string,
    settings: Record<string, unknown>,
): Promise<ApplySettingsResponse> {
    return apiSocket.sessionRPC<ApplySettingsResponse, ApplySettingsRequest>(
        sessionId,
        methodName('apply_settings'),
        { settings },
    );
}

// ─── Session Management (SDK 0.3.143+) ────────────────────────────────────

/**
 * List Claude Code sessions on the remote machine. These are the SDK's local
 * JSONL session files — not Happy sessions. Useful for session picker UI,
 * history browsing, or cleanup.
 *
 * @param dir - Optional project directory to scope results to.
 */
export async function listRemoteSessions(
    sessionId: string,
    options?: { dir?: string; limit?: number; offset?: number },
): Promise<ListSessionsResponse> {
    return apiSocket.sessionRPC<ListSessionsResponse, ListSessionsRequest>(
        sessionId,
        methodName('list_sessions'),
        options ?? {},
    );
}

/**
 * Get info about a specific Claude Code session on the remote machine.
 *
 * @param targetSessionId - The SDK session ID to look up (NOT the Happy session ID).
 */
export async function getRemoteSessionInfo(
    sessionId: string,
    targetSessionId: string,
    dir?: string,
): Promise<GetSessionInfoResponse> {
    return apiSocket.sessionRPC<GetSessionInfoResponse, GetSessionInfoRequest>(
        sessionId,
        methodName('get_session_info'),
        { targetSessionId, dir },
    );
}

/**
 * Delete a Claude Code session's JSONL file on the remote machine.
 * **Destructive** — the session data is permanently removed from the CLI's
 * local storage.
 */
export async function deleteRemoteSession(
    sessionId: string,
    targetSessionId: string,
    dir?: string,
): Promise<DeleteSessionResponse> {
    return apiSocket.sessionRPC<DeleteSessionResponse, DeleteSessionRequest>(
        sessionId,
        methodName('delete_session'),
        { targetSessionId, dir },
    );
}

/**
 * Rename a Claude Code session on the remote machine (sets customTitle).
 */
export async function renameRemoteSession(
    sessionId: string,
    targetSessionId: string,
    title: string,
    dir?: string,
): Promise<RenameSessionResponse> {
    return apiSocket.sessionRPC<RenameSessionResponse, RenameSessionRequest>(
        sessionId,
        methodName('rename_session'),
        { targetSessionId, title, dir },
    );
}

/**
 * Read messages from a Claude Code session on the remote machine.
 * Returns parsed JSONL records (user/assistant/system messages).
 */
export async function getRemoteSessionMessages(
    sessionId: string,
    targetSessionId: string,
    options?: { dir?: string; limit?: number; offset?: number; includeSystemMessages?: boolean },
): Promise<GetSessionMessagesResponse> {
    return apiSocket.sessionRPC<GetSessionMessagesResponse, GetSessionMessagesRequest>(
        sessionId,
        methodName('get_session_messages'),
        { targetSessionId, ...options },
    );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Helper: generate a client-side confirm token for mcp_call. Runs on both
 * React Native and web. CLI uses the first 8 bytes of this token for audit
 * correlation.
 */
export function generateMcpConfirmToken(): string {
    const bytes = new Uint8Array(16);
    const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
    if (g.crypto?.getRandomValues) {
        g.crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
