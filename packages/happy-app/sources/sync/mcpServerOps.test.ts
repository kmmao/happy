import { describe, expect, it, vi, beforeEach } from 'vitest';
import { register, unregister, toggle } from './mcpServerOps';
import type { AuthCredentials } from '@/auth/tokenStorage';
import type { McpRegistryEntry } from '@kmmao/happy-wire';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/sync/mcpRegistry', () => ({
    mcpRegistry: {
        addServer: vi.fn(),
        removeServer: vi.fn(),
        toggleServer: vi.fn(),
    },
}));

vi.mock('@/sync/apiClaudeControl', () => ({
    addRemoteMcpServer: vi.fn(),
    removeRemoteMcpServer: vi.fn(),
    toggleMcpServer: vi.fn(),
}));

vi.mock('@/log', () => ({
    log: { log: vi.fn() },
}));

import { mcpRegistry } from '@/sync/mcpRegistry';
import { addRemoteMcpServer, removeRemoteMcpServer, toggleMcpServer } from '@/sync/apiClaudeControl';

const mockAddServer = vi.mocked(mcpRegistry.addServer);
const mockRemoveServer = vi.mocked(mcpRegistry.removeServer);
const mockToggleServer = vi.mocked(mcpRegistry.toggleServer);
const mockAddRemote = vi.mocked(addRemoteMcpServer);
const mockRemoveRemote = vi.mocked(removeRemoteMcpServer);
const mockToggleRemote = vi.mocked(toggleMcpServer);

const credentials: AuthCredentials = {
    token: 'test-token',
    secret: 'test-secret',
};

function makeEntry(overrides: Partial<McpRegistryEntry> = {}): McpRegistryEntry {
    return {
        name: 'test-server',
        transport: { type: 'sse', url: 'https://example.com/mcp' },
        enabled: true,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockAddServer.mockResolvedValue({ version: 1, servers: {} });
    mockRemoveServer.mockResolvedValue({ version: 1, servers: {} });
    mockToggleServer.mockResolvedValue({ version: 1, servers: {} });
    mockAddRemote.mockResolvedValue({ success: true, added: ['test-server'], errors: {} });
    mockRemoveRemote.mockResolvedValue({ success: true, removed: ['test-server'] });
    mockToggleRemote.mockResolvedValue({ success: true });
});

// ─── register() ───────────────────────────────────────────────────────────────

describe('register', () => {
    it('persists to registry and hot-loads to session', async () => {
        const entry = makeEntry();
        const r = await register(credentials, entry, 'session-1');

        expect(r.persisted).toBe(true);
        expect(r.loaded).toBe(true);
        expect(mockAddServer).toHaveBeenCalledWith(credentials, entry);
        expect(mockAddRemote).toHaveBeenCalledWith('session-1', 'test-server', {
            type: 'sse',
            url: 'https://example.com/mcp',
        });
    });

    it('persists only when no sessionId', async () => {
        const r = await register(credentials, makeEntry());

        expect(r.persisted).toBe(true);
        expect(r.loaded).toBe(false);
        expect(mockAddRemote).not.toHaveBeenCalled();
    });

    it('persists only when entry is disabled', async () => {
        const r = await register(credentials, makeEntry({ enabled: false }), 'session-1');

        expect(r.persisted).toBe(true);
        expect(r.loaded).toBe(false);
        expect(mockAddRemote).not.toHaveBeenCalled();
    });

    it('returns persisted=true even when hot-load fails', async () => {
        mockAddRemote.mockResolvedValue({
            success: false,
            added: [],
            errors: {},
            errorMessage: 'connection timeout',
        });

        const r = await register(credentials, makeEntry(), 'session-1');

        expect(r.persisted).toBe(true);
        expect(r.loaded).toBe(false);
        expect(r.loadError).toBe('connection timeout');
    });

    it('returns persisted=true when hot-load RPC throws', async () => {
        mockAddRemote.mockRejectedValue(new Error('network error'));

        const r = await register(credentials, makeEntry(), 'session-1');

        expect(r.persisted).toBe(true);
        expect(r.loaded).toBe(false);
        expect(r.loadError).toBe('network error');
    });

    it('returns persisted=false when registry write fails', async () => {
        mockAddServer.mockRejectedValue(new Error('KV conflict'));

        const r = await register(credentials, makeEntry(), 'session-1');

        expect(r.persisted).toBe(false);
        expect(r.loaded).toBe(false);
        expect(mockAddRemote).not.toHaveBeenCalled();
    });

    it('maps stdio transport correctly', async () => {
        const entry = makeEntry({
            transport: {
                type: 'stdio',
                command: 'npx',
                args: ['-y', 'mcp-server'],
                env: { NODE_ENV: 'production' },
            },
        });

        await register(credentials, entry, 'session-1');

        expect(mockAddRemote).toHaveBeenCalledWith('session-1', 'test-server', {
            type: 'stdio',
            command: 'npx',
            args: ['-y', 'mcp-server'],
            env: { NODE_ENV: 'production' },
        });
    });

    it('maps url transport correctly', async () => {
        const entry = makeEntry({
            transport: { type: 'url', url: 'https://mcp.example.com' },
        });

        await register(credentials, entry, 'session-1');

        expect(mockAddRemote).toHaveBeenCalledWith('session-1', 'test-server', {
            type: 'url',
            url: 'https://mcp.example.com',
        });
    });

    it('maps streamable-http transport correctly', async () => {
        const entry = makeEntry({
            transport: { type: 'streamable-http', url: 'https://mcp.example.com/stream' },
        });

        await register(credentials, entry, 'session-1');

        expect(mockAddRemote).toHaveBeenCalledWith('session-1', 'test-server', {
            type: 'streamable-http',
            url: 'https://mcp.example.com/stream',
        });
    });
});

// ─── unregister() ─────────────────────────────────────────────────────────────

describe('unregister', () => {
    it('removes from registry and hot-unloads from session', async () => {
        const r = await unregister(credentials, 'test-server', 'session-1');

        expect(r.persisted).toBe(true);
        expect(r.unloaded).toBe(true);
        expect(mockRemoveServer).toHaveBeenCalledWith(credentials, 'test-server');
        expect(mockRemoveRemote).toHaveBeenCalledWith('session-1', 'test-server');
    });

    it('removes from registry only when no sessionId', async () => {
        const r = await unregister(credentials, 'test-server');

        expect(r.persisted).toBe(true);
        expect(r.unloaded).toBe(false);
        expect(mockRemoveRemote).not.toHaveBeenCalled();
    });

    it('returns persisted=true even when hot-unload fails', async () => {
        mockRemoveRemote.mockResolvedValue({
            success: false,
            removed: [],
            errorMessage: 'protected server',
        });

        const r = await unregister(credentials, 'test-server', 'session-1');

        expect(r.persisted).toBe(true);
        expect(r.unloaded).toBe(false);
        expect(r.unloadError).toBe('protected server');
    });

    it('returns persisted=true when hot-unload RPC throws', async () => {
        mockRemoveRemote.mockRejectedValue(new Error('session offline'));

        const r = await unregister(credentials, 'test-server', 'session-1');

        expect(r.persisted).toBe(true);
        expect(r.unloaded).toBe(false);
        expect(r.unloadError).toBe('session offline');
    });

    it('returns persisted=false when registry removal fails', async () => {
        mockRemoveServer.mockRejectedValue(new Error('KV error'));

        const r = await unregister(credentials, 'test-server', 'session-1');

        expect(r.persisted).toBe(false);
        expect(r.unloaded).toBe(false);
        expect(mockRemoveRemote).not.toHaveBeenCalled();
    });
});

// ─── toggle() ─────────────────────────────────────────────────────────────────

describe('toggle', () => {
    it('toggles in registry and runtime', async () => {
        const r = await toggle(credentials, 'test-server', false, 'session-1');

        expect(r.persisted).toBe(true);
        expect(r.toggled).toBe(true);
        expect(mockToggleServer).toHaveBeenCalledWith(credentials, 'test-server', false);
        expect(mockToggleRemote).toHaveBeenCalledWith('session-1', 'test-server', false);
    });

    it('toggles in registry only when no sessionId', async () => {
        const r = await toggle(credentials, 'test-server', true);

        expect(r.persisted).toBe(true);
        expect(r.toggled).toBe(false);
        expect(mockToggleRemote).not.toHaveBeenCalled();
    });

    it('returns persisted=true even when runtime toggle fails', async () => {
        mockToggleRemote.mockRejectedValue(new Error('timeout'));

        const r = await toggle(credentials, 'test-server', true, 'session-1');

        expect(r.persisted).toBe(true);
        expect(r.toggled).toBe(false);
        expect(r.toggleError).toBe('timeout');
    });

    it('returns persisted=false when registry toggle fails', async () => {
        mockToggleServer.mockRejectedValue(new Error('not found'));

        const r = await toggle(credentials, 'test-server', true, 'session-1');

        expect(r.persisted).toBe(false);
        expect(r.toggled).toBe(false);
        expect(mockToggleRemote).not.toHaveBeenCalled();
    });
});
