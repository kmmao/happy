/**
 * MCP Registry — persistent MCP server configuration schemas.
 *
 * The registry lives in UserKVStore under the key `mcp:servers`, providing:
 *   - Account-level persistence (survives session restarts)
 *   - Cross-device sync (all machines see the same registry)
 *   - Encrypted at rest (KV values are E2E encrypted)
 *   - Optimistic concurrency control (version-based)
 *   - Real-time updates via eventRouter
 *
 * Transport scoping:
 *   - `stdio` servers are machine-specific (binary paths differ per machine),
 *     stored with a `machineId` field so the CLI only loads servers for the
 *     current machine.
 *   - `sse` / `url` servers are account-wide (URLs are the same everywhere).
 *
 * Key convention: `mcp:servers` stores the full JSON registry blob.
 *
 * CLI reads this on session start and merges with local
 * `~/.claude/settings.json` mcpServers. Registry entries take precedence over
 * local entries with the same name (App is authoritative).
 */

import { z } from 'zod';

// ── Transport config variants ───────────────────────────────────────────────

export const McpStdioConfigSchema = z.object({
  type: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const McpSseConfigSchema = z.object({
  type: z.literal('sse'),
  url: z.string().url(),
});

export const McpUrlConfigSchema = z.object({
  type: z.literal('url'),
  url: z.string().url(),
});

export const McpStreamableHttpConfigSchema = z.object({
  type: z.literal('streamable-http'),
  url: z.string().url(),
});

export const McpTransportConfigSchema = z.discriminatedUnion('type', [
  McpStdioConfigSchema,
  McpSseConfigSchema,
  McpUrlConfigSchema,
  McpStreamableHttpConfigSchema,
]);

export type McpTransportConfig = z.infer<typeof McpTransportConfigSchema>;

// ── Registry entry ──────────────────────────────────────────────────────────

export const McpRegistryEntrySchema = z.object({
  /** Server display name — must be unique within the registry. */
  name: z.string().min(1).max(128),
  /** Transport configuration (determines how the SDK connects). */
  transport: McpTransportConfigSchema,
  /** Whether this server is enabled. Disabled servers are persisted but not loaded. */
  enabled: z.boolean().default(true),
  /**
   * Machine ID scope. When set, this entry is only loaded by the specified
   * machine. When null/undefined, the entry is account-wide (all machines).
   * Typically set for stdio servers whose binaries exist on a specific host.
   */
  machineId: z.string().optional(),
  /** Optional human-readable description. */
  description: z.string().max(512).optional(),
  /** ISO timestamp of when this entry was created. */
  createdAt: z.string().optional(),
  /** ISO timestamp of the last update. */
  updatedAt: z.string().optional(),
});

export type McpRegistryEntry = z.infer<typeof McpRegistryEntrySchema>;

// ── Full registry ───────────────────────────────────────────────────────────

/**
 * The complete MCP registry stored as a single KV blob.
 * Keyed by server name for O(1) lookup and dedup.
 */
export const McpRegistrySchema = z.object({
  /** Schema version for forward compatibility. */
  version: z.literal(1),
  /** Server entries keyed by name. */
  servers: z.record(z.string(), McpRegistryEntrySchema),
});

export type McpRegistry = z.infer<typeof McpRegistrySchema>;

// ── Constants ───────────────────────────────────────────────────────────────

/** KV store key for the MCP registry blob. */
export const MCP_REGISTRY_KV_KEY = 'mcp:servers' as const;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create an empty registry. */
export function createEmptyMcpRegistry(): McpRegistry {
  return { version: 1, servers: {} };
}

/**
 * Convert registry entries into the SDK's mcpServers config format.
 * Filters by machine ID and enabled status.
 *
 * @param registry - The full MCP registry
 * @param machineId - Current machine ID (to filter machine-specific entries)
 * @returns Record<string, config> suitable for SDK's `Options.mcpServers`
 */
export function registryToSdkConfig(
  registry: McpRegistry,
  machineId?: string,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, entry] of Object.entries(registry.servers)) {
    // Skip disabled servers
    if (!entry.enabled) continue;
    // Skip machine-specific entries that don't match
    if (entry.machineId && entry.machineId !== machineId) continue;

    const { type, ...transportConfig } = entry.transport;
    result[name] = { type, ...transportConfig };
  }
  return result;
}

/**
 * Safely parse a KV value string into an McpRegistry.
 * Returns an empty registry if the value is null, empty, or invalid.
 */
export function parseMcpRegistry(raw: string | null | undefined): McpRegistry {
  if (!raw) return createEmptyMcpRegistry();
  try {
    const parsed = JSON.parse(raw);
    return McpRegistrySchema.parse(parsed);
  } catch {
    return createEmptyMcpRegistry();
  }
}
