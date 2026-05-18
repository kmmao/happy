/**
 * MCP Registry Manager — persistent MCP server configuration via KV store.
 *
 * Stores the full MCP server registry as a single encrypted KV entry under
 * `mcp:servers`. Provides CRUD operations and syncs changes to running
 * sessions via the `set_mcp_servers` RPC when a session ID is provided.
 *
 * Usage:
 *   import { mcpRegistry } from '@/sync/mcpRegistry';
 *   const registry = await mcpRegistry.load(credentials);
 *   await mcpRegistry.addServer(credentials, { name: 'my-server', transport: { type: 'sse', url: '...' } });
 *   await mcpRegistry.removeServer(credentials, 'my-server');
 */

import {
    MCP_REGISTRY_KV_KEY,
    McpRegistrySchema,
    parseMcpRegistry,
    createEmptyMcpRegistry,
    type McpRegistry,
    type McpRegistryEntry,
} from '@kmmao/happy-wire';
import { kvGet } from '@/sync/apiKv';
import { kvSetWithRetry } from '@/sync/kvConflictRetry';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { log } from '@/log';

// ── In-memory cache ─────────────────────────────────────────────────────────

/**
 * Cached registry state to avoid redundant KV reads within the same app
 * lifecycle. Invalidated on every write and on explicit refresh().
 */
let cachedRegistry: McpRegistry | null = null;
let cachedVersion: number = -1;

// ── Core operations ─────────────────────────────────────────────────────────

/**
 * Load the MCP registry from KV store. Returns cached data if available.
 * Call refresh() to force a fresh read.
 */
async function load(credentials: AuthCredentials): Promise<{ registry: McpRegistry; version: number }> {
    if (cachedRegistry) {
        return { registry: cachedRegistry, version: cachedVersion };
    }
    return refresh(credentials);
}

/**
 * Force-refresh the registry from KV store, bypassing cache.
 */
async function refresh(credentials: AuthCredentials): Promise<{ registry: McpRegistry; version: number }> {
    try {
        const item = await kvGet(credentials, MCP_REGISTRY_KV_KEY);
        if (!item) {
            cachedRegistry = createEmptyMcpRegistry();
            cachedVersion = -1;
            return { registry: cachedRegistry, version: cachedVersion };
        }
        cachedRegistry = parseMcpRegistry(item.value);
        cachedVersion = item.version;
        return { registry: cachedRegistry, version: cachedVersion };
    } catch (e) {
        log.log('[mcpRegistry] refresh failed', e);
        const empty = createEmptyMcpRegistry();
        return { registry: empty, version: -1 };
    }
}

/**
 * Save the full registry to KV store with optimistic concurrency.
 * Uses kvConflictRetry to handle version conflicts.
 */
async function save(
    credentials: AuthCredentials,
    registry: McpRegistry,
    version: number,
): Promise<number> {
    const value = JSON.stringify(McpRegistrySchema.parse(registry));
    const { version: newVersion } = await kvSetWithRetry(credentials, MCP_REGISTRY_KV_KEY, value, version);
    cachedRegistry = registry;
    cachedVersion = newVersion;
    return newVersion;
}

// ── CRUD operations ─────────────────────────────────────────────────────────

/**
 * Add or update an MCP server in the registry.
 * If a server with the same name exists, it is overwritten.
 */
async function addServer(
    credentials: AuthCredentials,
    entry: McpRegistryEntry,
): Promise<McpRegistry> {
    const { registry, version } = await load(credentials);
    const now = new Date().toISOString();
    const existing = registry.servers[entry.name];
    const updated: McpRegistry = {
        ...registry,
        servers: {
            ...registry.servers,
            [entry.name]: {
                ...entry,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
            },
        },
    };
    await save(credentials, updated, version);
    return updated;
}

/**
 * Remove an MCP server from the registry by name.
 * No-op if the server doesn't exist.
 */
async function removeServer(
    credentials: AuthCredentials,
    serverName: string,
): Promise<McpRegistry> {
    const { registry, version } = await load(credentials);
    if (!(serverName in registry.servers)) {
        return registry;
    }
    const { [serverName]: _, ...remaining } = registry.servers;
    const updated: McpRegistry = { ...registry, servers: remaining };
    await save(credentials, updated, version);
    return updated;
}

/**
 * Toggle a server's enabled/disabled state.
 */
async function toggleServer(
    credentials: AuthCredentials,
    serverName: string,
    enabled: boolean,
): Promise<McpRegistry> {
    const { registry, version } = await load(credentials);
    const entry = registry.servers[serverName];
    if (!entry) {
        throw new Error(`MCP server '${serverName}' not found in registry`);
    }
    const updated: McpRegistry = {
        ...registry,
        servers: {
            ...registry.servers,
            [serverName]: {
                ...entry,
                enabled,
                updatedAt: new Date().toISOString(),
            },
        },
    };
    await save(credentials, updated, version);
    return updated;
}

/**
 * List all servers in the registry, optionally filtered by machine ID.
 */
function listServers(registry: McpRegistry, machineId?: string): McpRegistryEntry[] {
    return Object.values(registry.servers).filter((entry) => {
        if (machineId && entry.machineId && entry.machineId !== machineId) {
            return false;
        }
        return true;
    });
}

/**
 * Invalidate the in-memory cache. Call after receiving a KV update
 * notification from eventRouter.
 */
function invalidateCache(): void {
    cachedRegistry = null;
    cachedVersion = -1;
}

// ── Exported module ─────────────────────────────────────────────────────────

export const mcpRegistry = {
    load,
    refresh,
    save,
    addServer,
    removeServer,
    toggleServer,
    listServers,
    invalidateCache,
} as const;
