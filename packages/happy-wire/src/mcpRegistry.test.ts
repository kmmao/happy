import { describe, it, expect } from 'vitest';
import {
  McpRegistrySchema,
  McpRegistryEntrySchema,
  McpTransportConfigSchema,
  createEmptyMcpRegistry,
  registryToSdkConfig,
  parseMcpRegistry,
  MCP_REGISTRY_KV_KEY,
} from './mcpRegistry';

describe('McpRegistry', () => {
  describe('MCP_REGISTRY_KV_KEY', () => {
    it('should be mcp:servers', () => {
      expect(MCP_REGISTRY_KV_KEY).toBe('mcp:servers');
    });
  });

  describe('McpTransportConfigSchema', () => {
    it('should parse stdio config', () => {
      const config = McpTransportConfigSchema.parse({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        env: { NODE_ENV: 'production' },
      });
      expect(config.type).toBe('stdio');
      if (config.type === 'stdio') {
        expect(config.command).toBe('npx');
        expect(config.args).toEqual(['-y', '@modelcontextprotocol/server-memory']);
      }
    });

    it('should parse sse config', () => {
      const config = McpTransportConfigSchema.parse({
        type: 'sse',
        url: 'http://localhost:3000/mcp',
      });
      expect(config.type).toBe('sse');
    });

    it('should parse url config', () => {
      const config = McpTransportConfigSchema.parse({
        type: 'url',
        url: 'https://mcp.example.com/v1',
      });
      expect(config.type).toBe('url');
    });

    it('should parse streamable-http config', () => {
      const config = McpTransportConfigSchema.parse({
        type: 'streamable-http',
        url: 'http://localhost:8080/stream',
      });
      expect(config.type).toBe('streamable-http');
    });

    it('should reject invalid transport type', () => {
      expect(() => McpTransportConfigSchema.parse({ type: 'unknown' })).toThrow();
    });
  });

  describe('McpRegistryEntrySchema', () => {
    it('should parse a minimal entry', () => {
      const entry = McpRegistryEntrySchema.parse({
        name: 'my-server',
        transport: { type: 'sse', url: 'http://localhost:3000' },
      });
      expect(entry.name).toBe('my-server');
      expect(entry.enabled).toBe(true);
      expect(entry.machineId).toBeUndefined();
    });

    it('should parse a full entry with machineId', () => {
      const entry = McpRegistryEntrySchema.parse({
        name: 'local-fs',
        transport: { type: 'stdio', command: '/usr/local/bin/mcp-fs' },
        enabled: false,
        machineId: 'machine-abc',
        description: 'File system server on my laptop',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-05-18T00:00:00.000Z',
      });
      expect(entry.enabled).toBe(false);
      expect(entry.machineId).toBe('machine-abc');
      expect(entry.description).toBe('File system server on my laptop');
    });
  });

  describe('McpRegistrySchema', () => {
    it('should parse a valid registry', () => {
      const registry = McpRegistrySchema.parse({
        version: 1,
        servers: {
          'my-sse': {
            name: 'my-sse',
            transport: { type: 'sse', url: 'http://localhost:3000' },
            enabled: true,
          },
          'my-stdio': {
            name: 'my-stdio',
            transport: { type: 'stdio', command: 'node', args: ['server.js'] },
            enabled: false,
            machineId: 'machine-1',
          },
        },
      });
      expect(Object.keys(registry.servers)).toHaveLength(2);
    });

    it('should reject invalid version', () => {
      expect(() =>
        McpRegistrySchema.parse({ version: 2, servers: {} }),
      ).toThrow();
    });
  });

  describe('createEmptyMcpRegistry', () => {
    it('should return version 1 with empty servers', () => {
      const registry = createEmptyMcpRegistry();
      expect(registry.version).toBe(1);
      expect(registry.servers).toEqual({});
    });
  });

  describe('parseMcpRegistry', () => {
    it('should parse valid JSON', () => {
      const json = JSON.stringify({
        version: 1,
        servers: {
          test: {
            name: 'test',
            transport: { type: 'url', url: 'https://example.com' },
          },
        },
      });
      const registry = parseMcpRegistry(json);
      expect(Object.keys(registry.servers)).toHaveLength(1);
    });

    it('should return empty for null', () => {
      const registry = parseMcpRegistry(null);
      expect(registry.servers).toEqual({});
    });

    it('should return empty for empty string', () => {
      const registry = parseMcpRegistry('');
      expect(registry.servers).toEqual({});
    });

    it('should return empty for invalid JSON', () => {
      const registry = parseMcpRegistry('{not valid}');
      expect(registry.servers).toEqual({});
    });

    it('should return empty for wrong schema', () => {
      const registry = parseMcpRegistry(JSON.stringify({ version: 99 }));
      expect(registry.servers).toEqual({});
    });
  });

  describe('registryToSdkConfig', () => {
    const registry = McpRegistrySchema.parse({
      version: 1,
      servers: {
        'account-sse': {
          name: 'account-sse',
          transport: { type: 'sse', url: 'http://example.com/sse' },
          enabled: true,
        },
        disabled: {
          name: 'disabled',
          transport: { type: 'url', url: 'http://example.com/disabled' },
          enabled: false,
        },
        'machine-a-only': {
          name: 'machine-a-only',
          transport: { type: 'stdio', command: '/bin/mcp' },
          enabled: true,
          machineId: 'machine-a',
        },
        'machine-b-only': {
          name: 'machine-b-only',
          transport: { type: 'stdio', command: '/opt/mcp' },
          enabled: true,
          machineId: 'machine-b',
        },
      },
    });

    it('should include enabled account-wide servers', () => {
      const config = registryToSdkConfig(registry);
      expect(config['account-sse']).toBeDefined();
      expect(config['account-sse'].type).toBe('sse');
      expect(config['account-sse'].url).toBe('http://example.com/sse');
    });

    it('should exclude disabled servers', () => {
      const config = registryToSdkConfig(registry);
      expect(config['disabled']).toBeUndefined();
    });

    it('should include account-wide and matching machine servers when machineId is specified', () => {
      const config = registryToSdkConfig(registry, 'machine-a');
      expect(config['account-sse']).toBeDefined();
      expect(config['machine-a-only']).toBeDefined();
      expect(config['machine-b-only']).toBeUndefined();
    });

    it('should include all non-machine-specific servers when no machineId', () => {
      const config = registryToSdkConfig(registry);
      expect(config['account-sse']).toBeDefined();
      // Machine-specific servers are excluded when machineId is undefined
      // because entry.machineId is set but machineId param is undefined
      expect(config['machine-a-only']).toBeUndefined();
      expect(config['machine-b-only']).toBeUndefined();
    });

    it('should strip the type field and include rest of transport config', () => {
      const config = registryToSdkConfig(registry, 'machine-a');
      expect(config['machine-a-only']).toEqual({
        type: 'stdio',
        command: '/bin/mcp',
      });
    });
  });
});
