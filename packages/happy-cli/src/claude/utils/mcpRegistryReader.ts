/**
 * MCP Registry Reader — CLI-side utility to fetch and merge persistent MCP
 * server configs from the server's KV store.
 *
 * On session start, the CLI:
 *   1. Reads local `~/.claude/settings.json` mcpServers
 *   2. Fetches the account-level MCP registry from KV store
 *   3. Merges them (registry entries take precedence)
 *   4. Adds Happy's own MCP servers (always highest priority)
 *
 * This gives users a unified experience: they register MCP servers in the App
 * and the configs automatically appear on every machine.
 */

import { parseMcpRegistry, registryToSdkConfig, MCP_REGISTRY_KV_KEY } from "@kmmao/happy-wire";
import type { ApiClient } from "@/api/api";
import { logger } from "@/ui/logger";

/**
 * Fetch the MCP registry from the server's KV store and convert it to
 * SDK-compatible mcpServers config.
 *
 * @param api - Authenticated API client
 * @param machineId - Current machine ID for filtering machine-specific entries
 * @returns Record<string, config> to merge into QueryOptions.mcpServers
 */
export async function fetchMcpRegistryServers(
  api: ApiClient,
  machineId?: string,
): Promise<Record<string, Record<string, unknown>>> {
  try {
    const kvItem = await api.fetchKvValue(MCP_REGISTRY_KV_KEY);
    if (!kvItem) {
      logger.debug("[mcpRegistry] No MCP registry found in KV store");
      return {};
    }

    const registry = parseMcpRegistry(kvItem.value);
    const sdkConfig = registryToSdkConfig(registry, machineId);
    const serverNames = Object.keys(sdkConfig);
    logger.debug(
      `[mcpRegistry] Loaded ${serverNames.length} servers from registry: ${serverNames.join(", ")}`,
    );
    return sdkConfig;
  } catch (e) {
    logger.debug("[mcpRegistry] Failed to fetch MCP registry, using local config only", e);
    return {};
  }
}
