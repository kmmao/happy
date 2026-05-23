/**
 * Utilities for reading Claude's settings.json configuration
 *
 * Handles reading Claude's settings.json file to respect user preferences
 * like includeCoAuthoredBy setting for commit message generation.
 *
 * MCP server configs live in TWO places:
 *   1. `~/.claude.json` — the global state JSON Claude Code maintains at the
 *      user's home directory. Its `mcpServers` field is what `/mcp` displays
 *      under "User MCPs" and is the authoritative source.
 *   2. `~/.claude/settings.json` — the project-style settings file; some
 *      historical setups still keep `mcpServers` here. Kept as a fallback.
 *
 * When `CLAUDE_CONFIG_DIR` is set, both files relocate together: the
 * settings.json lives inside that directory, and the root .claude.json sits
 * as its sibling (`dirname(CLAUDE_CONFIG_DIR)/.claude.json`).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '@/ui/logger';

export interface ClaudeSettings {
  includeCoAuthoredBy?: boolean;
  [key: string]: any;
}

/**
 * Shape of `~/.claude.json` — Claude Code's global state JSON. We care about
 * `mcpServers` (User MCPs) and the per-project `projects[<cwd>]` slot, where
 * Claude Code persists each project's `disabledMcpServers` toggle list.
 */
export interface ClaudeRootConfig {
  mcpServers?: Record<string, unknown>;
  /**
   * Map keyed by absolute project cwd. Each entry mirrors a fraction of the
   * UI state — we read `disabledMcpServers` (the array `/mcp disable` writes
   * into) and ignore the rest as opaque.
   */
  projects?: Record<string, ClaudeProjectConfig>;
  [key: string]: any;
}

/**
 * Per-project slice of `~/.claude.json` that we look at. Only fields that
 * influence what MCP servers should appear connected are typed; everything
 * else is preserved opaquely.
 */
export interface ClaudeProjectConfig {
  disabledMcpServers?: unknown;
  [key: string]: any;
}

/**
 * Get Claude's config directory (`~/.claude` by default; overridable via
 * `CLAUDE_CONFIG_DIR`). Centralised so the various sibling helpers (settings,
 * plugins, etc.) all agree on the root.
 */
function getClaudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

/**
 * Get the path to Claude's settings.json file (inside the config dir).
 */
function getClaudeSettingsPath(): string {
  return join(getClaudeConfigDir(), 'settings.json');
}

/**
 * Get the directory Claude Code uses for marketplace plugins — the parent of
 * `installed_plugins.json` and each plugin's cached install tree.
 */
function getClaudePluginsDir(): string {
  return join(getClaudeConfigDir(), 'plugins');
}

/**
 * Get the path to Claude's root config file (`~/.claude.json`) — the file
 * `/mcp` displays as the source for User MCPs. When `CLAUDE_CONFIG_DIR` is
 * customised, this lives next to that dir (sibling, not child).
 */
function getClaudeRootConfigPath(): string {
  const override = process.env.CLAUDE_CONFIG_DIR;
  if (override) {
    return join(dirname(override), '.claude.json');
  }
  return join(homedir(), '.claude.json');
}

/**
 * Read Claude's settings.json file from the default location
 *
 * @returns Claude settings object or null if file doesn't exist or can't be read
 */
export function readClaudeSettings(): ClaudeSettings | null {
  try {
    const settingsPath = getClaudeSettingsPath();

    if (!existsSync(settingsPath)) {
      logger.debug(`[ClaudeSettings] No Claude settings file found at ${settingsPath}`);
      return null;
    }

    const settingsContent = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(settingsContent) as ClaudeSettings;

    logger.debug(`[ClaudeSettings] Successfully read Claude settings from ${settingsPath}`);
    logger.debug(`[ClaudeSettings] includeCoAuthoredBy: ${settings.includeCoAuthoredBy}`);

    return settings;
  } catch (error) {
    logger.debug(`[ClaudeSettings] Error reading Claude settings: ${error}`);
    return null;
  }
}

/**
 * Read Claude's root config file (`~/.claude.json`). Returns null when the
 * file is absent or unreadable. Parsing errors are swallowed and logged so
 * callers can degrade gracefully.
 */
export function readClaudeRootConfig(): ClaudeRootConfig | null {
  try {
    const rootPath = getClaudeRootConfigPath();

    if (!existsSync(rootPath)) {
      logger.debug(`[ClaudeSettings] No Claude root config file found at ${rootPath}`);
      return null;
    }

    const content = readFileSync(rootPath, 'utf-8');
    const parsed = JSON.parse(content) as ClaudeRootConfig;

    logger.debug(`[ClaudeSettings] Successfully read Claude root config from ${rootPath}`);
    return parsed;
  } catch (error) {
    logger.debug(`[ClaudeSettings] Error reading Claude root config: ${error}`);
    return null;
  }
}

/**
 * Read MCP server configurations Claude Code would see for this user.
 *
 * Merges both sources, with `~/.claude.json` winning on name conflicts
 * because that is the file `/mcp` actually displays and persists into.
 * Returns `{}` when neither source contributes anything.
 *
 * Callers should still spread Happy-owned MCPs *last* when building the
 * final config so they take precedence over user-defined ones.
 */
export function readClaudeMcpServers(): Record<string, unknown> {
  const fromSettings = pickMcpServers(readClaudeSettings(), 'settings.json');
  const fromRoot = pickMcpServers(readClaudeRootConfig(), '.claude.json');

  // Root config wins on conflict — Claude Code persists User MCPs there.
  const merged: Record<string, unknown> = { ...fromSettings, ...fromRoot };

  if (Object.keys(merged).length > 0) {
    logger.debug(
      `[ClaudeSettings] Resolved ${Object.keys(merged).length} mcpServers from Claude config: ${Object.keys(merged).join(', ')}`,
    );
  }
  return merged;
}

/**
 * Read the per-project disabled MCP server names for `cwd` from
 * `~/.claude.json` → `projects[cwd].disabledMcpServers`. Returns an empty
 * array when the file, the project slot, or the field is missing/malformed.
 *
 * Claude Code writes here when the user runs `/mcp disable <name>`; the
 * SDK and Claude CLI both honour it natively. Happy reads it so the App's
 * MCP panel and the `--mcp-config` JSON we synthesise stay in sync with
 * what the user actually sees in `/mcp`.
 */
export function readClaudeDisabledMcpServers(cwd: string): string[] {
  const config = readClaudeRootConfig();
  if (!config) return [];

  const projects = config.projects;
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) {
    return [];
  }

  const project = projects[cwd];
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    return [];
  }

  const disabled = (project as ClaudeProjectConfig).disabledMcpServers;
  if (!Array.isArray(disabled)) return [];

  const names = disabled.filter((x): x is string => typeof x === 'string' && x.length > 0);
  if (names.length > 0) {
    logger.debug(
      `[ClaudeSettings] Found ${names.length} disabled MCP servers for ${cwd}: ${names.join(', ')}`,
    );
  }
  return names;
}

/**
 * Annotate `disabled: true` on entries in `servers` whose names appear in
 * `disabledNames`. Pure: returns a new map and never mutates the input. Used
 * by callers that want to surface the disabled state to the PTY controller
 * (which already maps `disabled === true → status: 'disabled'`) without
 * tripping `--mcp-config` serialization — `buildClaudeCliFlags` filters
 * disabled entries out before they reach Claude CLI.
 */
export function markDisabledMcpServers<T extends Record<string, any>>(
  servers: T,
  disabledNames: readonly string[],
): T {
  if (disabledNames.length === 0) return servers;

  const disabledSet = new Set(disabledNames);
  const result: Record<string, unknown> = {};
  for (const [name, config] of Object.entries(servers)) {
    if (
      disabledSet.has(name) &&
      config &&
      typeof config === 'object' &&
      !Array.isArray(config)
    ) {
      result[name] = { ...(config as Record<string, unknown>), disabled: true };
    } else {
      result[name] = config;
    }
  }
  return result as T;
}

function pickMcpServers(
  source: Record<string, unknown> | null,
  label: string,
): Record<string, unknown> {
  if (!source) return {};
  const raw = source.mcpServers;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const servers = raw as Record<string, unknown>;
  const names = Object.keys(servers);
  if (names.length === 0) {
    return {};
  }
  logger.debug(`[ClaudeSettings] Found ${names.length} mcpServers in ${label}: ${names.join(', ')}`);
  return servers;
}

/**
 * Shape of `~/.claude/plugins/installed_plugins.json`. Claude Code writes
 * this when the user installs / updates a plugin from a marketplace; each
 * key is `"<plugin>@<marketplace>"` and the value is an array of install
 * records (one per scope: `user` / `project` / `local`).
 */
interface InstalledPluginRecord {
  installPath: string;
  scope?: string;
  version?: string;
  installedAt?: string;
  lastUpdated?: string;
}

interface InstalledPluginsFile {
  version?: number;
  plugins?: Record<string, InstalledPluginRecord[]>;
}

/**
 * Read MCP servers contributed by installed Claude Code plugins.
 *
 * For each entry in `~/.claude/plugins/installed_plugins.json` we look for
 * a `.mcp.json` at the plugin's `installPath`. Two on-disk shapes have been
 * observed in the wild:
 *
 *   { "<server>": <config>, ... }                  // flat (context7 plugin)
 *   { "mcpServers": { "<server>": <config> } }     // wrapped (some authors)
 *
 * Both are accepted. The returned keys mirror Claude Code's `/mcp` panel
 * format: `plugin:<plugin-name>:<server-name>`. Per-project disabling via
 * `disabledMcpServers` uses the same prefixed name, so the downstream
 * `markDisabledMcpServers` step treats plugin MCPs uniformly.
 *
 * Returns `{}` whenever the manifest is missing, malformed, or contributes
 * no servers — failure modes are swallowed and logged so callers can degrade
 * gracefully.
 */
export function readClaudePluginMcpServers(): Record<string, unknown> {
  let manifest: InstalledPluginsFile;
  try {
    const manifestPath = join(getClaudePluginsDir(), 'installed_plugins.json');
    if (!existsSync(manifestPath)) {
      logger.debug(`[ClaudeSettings] No plugin manifest at ${manifestPath}`);
      return {};
    }
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as InstalledPluginsFile;
  } catch (error) {
    logger.debug(`[ClaudeSettings] Error reading plugin manifest: ${error}`);
    return {};
  }

  const plugins = manifest.plugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
    return {};
  }

  const result: Record<string, unknown> = {};

  for (const [key, installs] of Object.entries(plugins)) {
    if (!Array.isArray(installs) || installs.length === 0) continue;

    // "<plugin>@<marketplace>" → the displayed prefix uses just the plugin name.
    const at = key.indexOf('@');
    const pluginName = at === -1 ? key : key.slice(0, at);
    if (!pluginName) continue;

    // Use the first install record — Claude Code resolves the same way when
    // multiple scopes are present (user/project/local), and in practice a
    // given plugin only has one install.
    const install = installs[0];
    const installPath = install && typeof install.installPath === 'string'
      ? install.installPath
      : null;
    if (!installPath) continue;

    const mcpJsonPath = join(installPath, '.mcp.json');
    if (!existsSync(mcpJsonPath)) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
    } catch (error) {
      logger.debug(`[ClaudeSettings] Skipping malformed ${mcpJsonPath}: ${error}`);
      continue;
    }

    const servers = extractPluginMcpServers(parsed);
    if (!servers) continue;

    for (const [serverName, config] of Object.entries(servers)) {
      result[`plugin:${pluginName}:${serverName}`] = config;
    }
  }

  if (Object.keys(result).length > 0) {
    logger.debug(
      `[ClaudeSettings] Resolved ${Object.keys(result).length} plugin MCP servers: ${Object.keys(result).join(', ')}`,
    );
  }
  return result;
}

/**
 * Accept either the flat `{ "<server>": config }` shape or the wrapped
 * `{ mcpServers: { ... } }` shape; reject anything else.
 */
function extractPluginMcpServers(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;
  const wrapped = obj.mcpServers;
  if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
    return wrapped as Record<string, unknown>;
  }

  // Flat shape — every value should be an object (the MCP server config).
  // Skip top-level scalar keys defensively.
  const flat: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flat[name] = value;
    }
  }
  return Object.keys(flat).length > 0 ? flat : null;
}

/**
 * Check if Co-Authored-By lines should be included in commit messages
 * based on Claude's settings
 * 
 * @returns true if Co-Authored-By should be included, false otherwise
 */
export function shouldIncludeCoAuthoredBy(): boolean {
  const settings = readClaudeSettings();
  
  // If no settings file or includeCoAuthoredBy is not explicitly set,
  // default to true to maintain backward compatibility
  if (!settings || settings.includeCoAuthoredBy === undefined) {
    return true;
  }
  
  return settings.includeCoAuthoredBy;
}