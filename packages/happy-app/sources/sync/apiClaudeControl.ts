/**
 * Claude Control RPC client — App-side wrapper for the 6 sidebar APIs
 * exposed by happy-cli (SDK 0.2.119+).
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
 *   - E2E content:       read_file, file_suggestions
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
    FileSuggestionsRequest,
    FileSuggestionsResponse,
    McpCallRequest,
    McpCallResponse,
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

// ─── file_suggestions ───────────────────────────────────────────────────────

/**
 * Query the remote CLI for fuzzy-matched file paths under cwd. Intended for
 * at-mention autocomplete in the message composer. Returns at most `limit`
 * suggestions (CLI hard-caps 50; default 20).
 *
 * Paths are E2E-encrypted in transit; App should render relative paths only
 * (the CLI only returns project-relative paths).
 */
export async function fetchFileSuggestions(
    sessionId: string,
    query: string,
    limit?: number,
): Promise<FileSuggestionsResponse> {
    return apiSocket.sessionRPC<FileSuggestionsResponse, FileSuggestionsRequest>(
        sessionId,
        methodName('file_suggestions'),
        limit != null ? { query, limit } : { query },
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
