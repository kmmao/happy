/**
 * apiMcpServers — REST API client for MCP server registry endpoints.
 *
 * Wraps the `/v1/mcp/servers` REST API with typed request/response.
 * These endpoints persist MCP server configs in the KV-based registry
 * on the server side. For runtime hot-loading, use `apiClaudeControl`.
 */

import type { AuthCredentials } from '@/auth/tokenStorage';
import type { McpRegistryEntry, McpTransportConfig } from '@kmmao/happy-wire';
import { backoff } from '@/utils/time';
import { throwIfNotOk } from '@/utils/http';
import { getServerUrl } from './serverConfig';

// ── Request/Response types ─────────────────────────────────────────────────

export interface RegisterServerRequest {
    name: string;
    transport: McpTransportConfig;
    enabled?: boolean;
    machineId?: string;
    description?: string;
    category?: string;
    icon?: string;
    tags?: string[];
    packageName?: string;
    version?: string;
    author?: string;
    homepage?: string;
}

export interface UpdateServerRequest {
    transport?: McpTransportConfig;
    enabled?: boolean;
    machineId?: string | null;
    description?: string | null;
    category?: string | null;
    icon?: string | null;
    tags?: string[] | null;
    packageName?: string | null;
    version?: string | null;
    author?: string | null;
    homepage?: string | null;
    toolInventory?: string[] | null;
    lastConnectedAt?: string | null;
    connectionCount?: number | null;
}

export interface ListServersQuery {
    machineId?: string;
    category?: string;
    enabled?: boolean;
}

export interface ServerResponse {
    server: McpRegistryEntry;
    registryVersion?: number;
}

export interface ListServersResponse {
    servers: McpRegistryEntry[];
    total: number;
    registryVersion: number;
}

// ── API functions ──────────────────────────────────────────────────────────

/**
 * Register (upsert) an MCP server in the persistent registry.
 */
export async function registerMcpServer(
    credentials: AuthCredentials,
    body: RegisterServerRequest,
): Promise<ServerResponse> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(`${API_ENDPOINT}/v1/mcp/servers`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        if (response.status === 409) {
            throw new Error('version-conflict');
        }

        throwIfNotOk(response, 'Failed to register MCP server');

        return await response.json() as ServerResponse;
    });
}

/**
 * List all MCP servers in the registry, with optional filters.
 */
export async function listMcpServers(
    credentials: AuthCredentials,
    query: ListServersQuery = {},
): Promise<ListServersResponse> {
    const API_ENDPOINT = getServerUrl();

    const params = new URLSearchParams();
    if (query.machineId) params.append('machineId', query.machineId);
    if (query.category) params.append('category', query.category);
    if (query.enabled !== undefined) params.append('enabled', String(query.enabled));

    const qs = params.toString();
    const url = qs ? `${API_ENDPOINT}/v1/mcp/servers?${qs}` : `${API_ENDPOINT}/v1/mcp/servers`;

    return await backoff(async () => {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${credentials.token}`,
            },
        });

        throwIfNotOk(response, 'Failed to list MCP servers');

        return await response.json() as ListServersResponse;
    });
}

/**
 * Get a single MCP server by name.
 */
export async function getMcpServer(
    credentials: AuthCredentials,
    name: string,
): Promise<McpRegistryEntry | null> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/mcp/servers/${encodeURIComponent(name)}`,
            {
                headers: {
                    'Authorization': `Bearer ${credentials.token}`,
                },
            },
        );

        if (response.status === 404) {
            return null;
        }

        throwIfNotOk(response, 'Failed to get MCP server');

        const data = await response.json() as ServerResponse;
        return data.server;
    });
}

/**
 * Update an MCP server's metadata. Pass `null` to clear a field.
 */
export async function updateMcpServer(
    credentials: AuthCredentials,
    name: string,
    updates: UpdateServerRequest,
): Promise<ServerResponse> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/mcp/servers/${encodeURIComponent(name)}`,
            {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${credentials.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(updates),
            },
        );

        if (response.status === 404) {
            throw new Error(`MCP server '${name}' not found`);
        }

        if (response.status === 409) {
            throw new Error('version-conflict');
        }

        throwIfNotOk(response, 'Failed to update MCP server');

        return await response.json() as ServerResponse;
    });
}

/**
 * Unregister an MCP server from the persistent registry.
 */
export async function deleteMcpServer(
    credentials: AuthCredentials,
    name: string,
): Promise<void> {
    const API_ENDPOINT = getServerUrl();

    await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/mcp/servers/${encodeURIComponent(name)}`,
            {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${credentials.token}`,
                },
            },
        );

        if (response.status === 409) {
            throw new Error('version-conflict');
        }

        throwIfNotOk(response, 'Failed to delete MCP server');
    });
}

/**
 * Toggle an MCP server's enabled/disabled state.
 */
export async function toggleMcpServerEnabled(
    credentials: AuthCredentials,
    name: string,
    enabled: boolean,
): Promise<ServerResponse> {
    const API_ENDPOINT = getServerUrl();

    return await backoff(async () => {
        const response = await fetch(
            `${API_ENDPOINT}/v1/mcp/servers/${encodeURIComponent(name)}/toggle`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${credentials.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ enabled }),
            },
        );

        if (response.status === 404) {
            throw new Error(`MCP server '${name}' not found`);
        }

        if (response.status === 409) {
            throw new Error('version-conflict');
        }

        throwIfNotOk(response, 'Failed to toggle MCP server');

        return await response.json() as ServerResponse;
    });
}
