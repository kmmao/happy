/**
 * MCP Registry Manager — persistent MCP server configuration via REST API.
 *
 * Wraps the `/v1/mcp/servers` REST endpoints for CRUD operations on the
 * MCP server registry. The server handles KV storage, encoding, and
 * optimistic concurrency internally.
 *
 * Maintains an in-memory cache to avoid redundant API calls within the
 * same app lifecycle. Invalidated on every write and on explicit refresh().
 *
 * Usage:
 *   import { mcpRegistry } from '@/sync/mcpRegistry';
 *   const registry = await mcpRegistry.load(credentials);
 *   await mcpRegistry.addServer(credentials, { name: 'my-server', transport: { type: 'sse', url: '...' } });
 *   await mcpRegistry.removeServer(credentials, 'my-server');
 */

import {
    createEmptyMcpRegistry,
    type McpRegistry,
    type McpRegistryEntry,
} from '@kmmao/happy-wire';
import {
    registerMcpServer,
    listMcpServers,
    deleteMcpServer,
    toggleMcpServerEnabled,
} from '@/sync/apiMcpServers';
import type { AuthCredentials } from '@/auth/tokenStorage';
import { log } from '@/log';

// ── In-memory cache ─────────────────────────────────────────────────────────

/**
 * Cached registry state to avoid redundant API calls within the same app
 * lifecycle. Invalidated on every write and on explicit refresh().
 */
let cachedRegistry: McpRegistry | null = null;
let cachedVersion: number = -1;

// ── Core operations ─────────────────────────────────────────────────────────

/**
 * Load the MCP registry from the server. Returns cached data if available.
 * Call refresh() to force a fresh read.
 */
async function load(credentials: AuthCredentials): Promise<{ registry: McpRegistry; version: number }> {
    if (cachedRegistry) {
        return { registry: cachedRegistry, version: cachedVersion };
    }
    return refresh(credentials);
}

/**
 * Force-refresh the registry from the server, bypassing cache.
 */
async function refresh(credentials: AuthCredentials): Promise<{ registry: McpRegistry; version: number }> {
    try {
        const result = await listMcpServers(credentials);
        const registry: McpRegistry = {
            version: 1,
            servers: Object.fromEntries(
                result.servers.map((s) => [s.name, s]),
            ),
        };
        cachedRegistry = registry;
        cachedVersion = result.registryVersion;
        return { registry: cachedRegistry, version: cachedVersion };
    } catch (e) {
        log.log('[mcpRegistry] refresh failed', e);
        const empty = createEmptyMcpRegistry();
        return { registry: empty, version: -1 };
    }
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
    const result = await registerMcpServer(credentials, {
        name: entry.name,
        transport: entry.transport,
        enabled: entry.enabled,
        machineId: entry.machineId,
        description: entry.description,
        category: entry.category,
        icon: entry.icon,
        tags: entry.tags,
        packageName: entry.packageName,
        version: entry.version,
        author: entry.author,
        homepage: entry.homepage,
    });

    // Invalidate cache — next load() will fetch fresh data
    invalidateCache();

    // Return a synthetic registry with the updated server for immediate use
    const { registry } = await load(credentials);
    const updated: McpRegistry = {
        ...registry,
        servers: { ...registry.servers, [entry.name]: result.server },
    };
    cachedRegistry = updated;
    if (result.registryVersion !== undefined) {
        cachedVersion = result.registryVersion;
    }
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
    await deleteMcpServer(credentials, serverName);

    // Update cache
    if (cachedRegistry) {
        const { [serverName]: _, ...remaining } = cachedRegistry.servers;
        cachedRegistry = { ...cachedRegistry, servers: remaining };
    }

    return cachedRegistry ?? createEmptyMcpRegistry();
}

/**
 * Toggle a server's enabled/disabled state.
 */
async function toggleServer(
    credentials: AuthCredentials,
    serverName: string,
    enabled: boolean,
): Promise<McpRegistry> {
    const result = await toggleMcpServerEnabled(credentials, serverName, enabled);

    // Update cache
    if (cachedRegistry && cachedRegistry.servers[serverName]) {
        cachedRegistry = {
            ...cachedRegistry,
            servers: {
                ...cachedRegistry.servers,
                [serverName]: result.server,
            },
        };
        if (result.registryVersion !== undefined) {
            cachedVersion = result.registryVersion;
        }
    } else {
        invalidateCache();
    }

    return cachedRegistry ?? createEmptyMcpRegistry();
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
    addServer,
    removeServer,
    toggleServer,
    listServers,
    invalidateCache,
} as const;
