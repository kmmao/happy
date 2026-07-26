/**
 * mcpServerOps — high-level MCP server lifecycle operations.
 *
 * Orchestrates dual-write between:
 *   1. **Persistent registry** (KV store via `mcpRegistry`) — survives restarts
 *   2. **Running session** (RPC via `addRemoteMcpServer`) — immediate effect
 *
 * ## register()
 *
 * Persist → hot-load. If the session RPC fails, the registry write still
 * stands (the server will load on next session start). The App displays the
 * runtime error so the user knows the session needs a restart.
 *
 * ## unregister()
 *
 * Remove from registry → hot-unload. Same resilience model: even if the
 * running session can't unload (e.g. already disconnected), the server won't
 * appear on the next session start.
 *
 * ## Design decisions
 *
 * - Registry is authoritative (source of truth for account-wide config).
 * - Runtime loading is best-effort (session may be offline or idle).
 * - The protected name (`happy`) is rejected by both the
 *   registry module and the CLI-side RPC handler.
 */

import { mcpRegistry } from '@/sync/mcpRegistry';
import {
    addRemoteMcpServer,
    removeRemoteMcpServer,
    toggleMcpServer,
} from '@/sync/apiClaudeControl';
import type { McpRegistryEntry, McpTransportConfig } from '@kmmao/happy-wire';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { log } from '@/log';

// ─── Result types ─────────────────────────────────────────────────────────────

export interface RegisterResult {
    /** Whether the registry write succeeded (authoritative). */
    persisted: boolean;
    /** Whether the running session hot-loaded the server. */
    loaded: boolean;
    /** Error from the runtime hot-load (non-fatal — server persisted for next start). */
    loadError?: string;
}

export interface UnregisterResult {
    /** Whether the registry removal succeeded (authoritative). */
    persisted: boolean;
    /** Whether the running session unloaded the server. */
    unloaded: boolean;
    /** Error from the runtime unload (non-fatal). */
    unloadError?: string;
}

// ─── Transport → RPC config mapper ────────────────────────────────────────────

/**
 * Map a registry transport config to the RPC `config` shape understood by
 * `add_mcp_server`. The RPC uses a flat union vs the registry's discriminated
 * `McpTransportConfig`.
 */
function transportToRpcConfig(
    transport: McpTransportConfig,
): Record<string, unknown> {
    switch (transport.type) {
        case 'stdio':
            return {
                type: 'stdio',
                command: transport.command,
                ...(transport.args ? { args: transport.args } : {}),
                ...(transport.env ? { env: transport.env } : {}),
            };
        case 'sse':
            return { type: 'sse', url: transport.url };
        case 'url':
            return { type: 'url', url: transport.url };
        case 'streamable-http':
            return { type: 'streamable-http', url: transport.url };
        default:
            return { type: (transport as { type: string }).type };
    }
}

// ─── register() ───────────────────────────────────────────────────────────────

/**
 * Register an MCP server: persist to KV registry, then hot-load onto the
 * running session if a session ID is provided.
 *
 * @param credentials - Auth credentials for KV store access
 * @param entry - Full registry entry (name, transport, enabled, machineId, etc.)
 * @param sessionId - Active session ID for hot-loading. Omit to persist only.
 * @returns Registration result with persistence and runtime status
 */
export async function register(
    credentials: AuthCredentials,
    entry: McpRegistryEntry,
    sessionId?: string | null,
): Promise<RegisterResult> {
    // Step 1: Persist to registry (authoritative)
    try {
        await mcpRegistry.addServer(credentials, entry);
    } catch (e) {
        log.log('[mcpServerOps] register: registry write failed', e);
        return { persisted: false, loaded: false, loadError: 'Registry write failed' };
    }

    // Step 2: Hot-load onto running session (best-effort)
    if (!sessionId || !entry.enabled) {
        return { persisted: true, loaded: false };
    }

    try {
        const rpcConfig = transportToRpcConfig(entry.transport);
        const result = await addRemoteMcpServer(sessionId, entry.name, rpcConfig);
        if (!result.success) {
            const msg = result.errorMessage ?? 'Unknown error';
            log.log(`[mcpServerOps] register: hot-load failed — ${msg}`);
            return { persisted: true, loaded: false, loadError: msg };
        }
        return { persisted: true, loaded: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.log('[mcpServerOps] register: hot-load RPC failed', e);
        return { persisted: true, loaded: false, loadError: msg };
    }
}

// ─── unregister() ─────────────────────────────────────────────────────────────

/**
 * Unregister an MCP server: remove from KV registry, then hot-unload from
 * the running session if a session ID is provided.
 *
 * @param credentials - Auth credentials for KV store access
 * @param serverName - Server name to remove
 * @param sessionId - Active session ID for hot-unloading. Omit to persist only.
 * @returns Unregistration result with persistence and runtime status
 */
export async function unregister(
    credentials: AuthCredentials,
    serverName: string,
    sessionId?: string | null,
): Promise<UnregisterResult> {
    // Step 1: Remove from registry (authoritative)
    try {
        await mcpRegistry.removeServer(credentials, serverName);
    } catch (e) {
        log.log('[mcpServerOps] unregister: registry removal failed', e);
        return { persisted: false, unloaded: false, unloadError: 'Registry removal failed' };
    }

    // Step 2: Hot-unload from running session (best-effort)
    if (!sessionId) {
        return { persisted: true, unloaded: false };
    }

    try {
        const result = await removeRemoteMcpServer(sessionId, serverName);
        if (!result.success) {
            const msg = result.errorMessage ?? 'Unknown error';
            log.log(`[mcpServerOps] unregister: hot-unload failed — ${msg}`);
            return { persisted: true, unloaded: false, unloadError: msg };
        }
        return { persisted: true, unloaded: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.log('[mcpServerOps] unregister: hot-unload RPC failed', e);
        return { persisted: true, unloaded: false, unloadError: msg };
    }
}

// ─── toggle() ─────────────────────────────────────────────────────────────────

/**
 * Toggle an MCP server's enabled/disabled state in the registry, then
 * toggle it on the running session if a session ID is provided.
 *
 * @param credentials - Auth credentials for KV store access
 * @param serverName - Server name to toggle
 * @param enabled - New enabled state
 * @param sessionId - Active session ID for runtime toggle. Omit to persist only.
 */
export async function toggle(
    credentials: AuthCredentials,
    serverName: string,
    enabled: boolean,
    sessionId?: string | null,
): Promise<{ persisted: boolean; toggled: boolean; toggleError?: string }> {
    // Step 1: Persist toggle to registry
    try {
        await mcpRegistry.toggleServer(credentials, serverName, enabled);
    } catch (e) {
        log.log('[mcpServerOps] toggle: registry toggle failed', e);
        return { persisted: false, toggled: false, toggleError: 'Registry toggle failed' };
    }

    // Step 2: Runtime toggle (best-effort)
    if (!sessionId) {
        return { persisted: true, toggled: false };
    }

    try {
        await toggleMcpServer(sessionId, serverName, enabled);
        return { persisted: true, toggled: true };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.log('[mcpServerOps] toggle: runtime toggle RPC failed', e);
        return { persisted: true, toggled: false, toggleError: msg };
    }
}
