import { readFile, readdir } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";
import { RpcHandlerManager } from "../../api/rpc/RpcHandlerManager";

/** Count directory entries (non-recursive). Returns 0 if dir missing. */
async function countDirEntries(dirPath: string): Promise<number> {
  try {
    const entries = await readdir(dirPath);
    return entries.filter((e) => !e.startsWith(".")).length;
  } catch {
    return 0;
  }
}

/** Read and parse a JSON file. Returns null on any error. */
async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

interface PluginJson {
  name?: string;
  version?: string;
  description?: string;
  author?: string | { name?: string };
  homepage?: string;
  license?: string;
  keywords?: string[];
}

interface MarketplaceJson {
  plugins?: Array<{
    name?: string;
    description?: string;
    category?: string;
  }>;
}

interface PluginMeta {
  name: string;
  path: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  license?: string;
  keywords?: string[];
  counts: { commands: number; skills: number; agents: number };
  subPlugins?: Array<{ name: string; description?: string; category?: string }>;
}

/** Read metadata for a single plugin directory. */
async function readPluginMeta(pluginName: string, pluginPath: string): Promise<PluginMeta> {
  const meta: PluginMeta = {
    name: pluginName,
    path: pluginPath,
    counts: { commands: 0, skills: 0, agents: 0 },
  };

  // Read .claude-plugin/plugin.json
  const pluginJson = await readJsonFile<PluginJson>(
    join(pluginPath, ".claude-plugin", "plugin.json"),
  );
  if (pluginJson) {
    meta.version = pluginJson.version;
    meta.description = pluginJson.description;
    meta.author =
      typeof pluginJson.author === "string"
        ? pluginJson.author
        : pluginJson.author?.name;
    meta.homepage = pluginJson.homepage;
    meta.license = pluginJson.license;
    meta.keywords = pluginJson.keywords;
  }

  // Read .claude-plugin/marketplace.json for sub-plugins
  const marketplace = await readJsonFile<MarketplaceJson>(
    join(pluginPath, ".claude-plugin", "marketplace.json"),
  );
  if (marketplace?.plugins && marketplace.plugins.length > 0) {
    meta.subPlugins = marketplace.plugins
      .filter((p) => p.name)
      .map((p) => ({
        name: p.name!,
        description: p.description,
        category: p.category,
      }));
    // Use marketplace description as fallback
    if (!meta.description && marketplace.plugins.length === 1) {
      meta.description = marketplace.plugins[0].description;
    }
  }

  // Count contents
  const [commands, skills, agents] = await Promise.all([
    countDirEntries(join(pluginPath, "commands")),
    countDirEntries(join(pluginPath, "skills")),
    countDirEntries(join(pluginPath, "agents")),
  ]);
  meta.counts = { commands, skills, agents };

  return meta;
}

/**
 * Register Claude Code plugin/marketplace discovery RPC handlers:
 * discoverPlugins, listInstalledPlugins, listMarketplaces,
 * listAvailablePlugins, inspectPlugin.
 *
 * All read from the user's ~/.claude plugin metadata; only discoverPlugins
 * additionally scans the project's .claude/plugins under workingDirectory.
 */
export function registerPluginHandlers(
  rpcHandlerManager: RpcHandlerManager,
  workingDirectory: string | null,
) {
  // ── Discover installed Claude Code plugins ──
  rpcHandlerManager.registerHandler("discoverPlugins", async () => {
    const dirs: Array<{ name: string; path: string }> = [];

    // Scan ~/.claude/plugins/marketplaces/
    const globalPluginsDir = join(homedir(), ".claude", "plugins", "marketplaces");
    try {
      const entries = await readdir(globalPluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push({ name: entry.name, path: join(globalPluginsDir, entry.name) });
        }
      }
    } catch {
      // ~/.claude/plugins/marketplaces/ may not exist
    }

    // Scan project-level .claude/plugins/ (session scope only — machine scope
    // has no project workspace to scan).
    if (workingDirectory !== null) {
      const projectPluginsDir = join(workingDirectory, ".claude", "plugins");
      try {
        const entries = await readdir(projectPluginsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            dirs.push({
              name: `${entry.name} (project)`,
              path: join(projectPluginsDir, entry.name),
            });
          }
        }
      } catch {
        // .claude/plugins/ may not exist in project
      }
    }

    // Read metadata for all discovered plugins in parallel
    const plugins = await Promise.all(
      dirs.map((d) => readPluginMeta(d.name, d.path)),
    );

    return { plugins };
  });

  // ── List truly installed plugins (from installed_plugins.json + enabledPlugins) ──
  rpcHandlerManager.registerHandler("listInstalledPlugins", async () => {
    const claudeDir = join(homedir(), ".claude");
    const pluginsDir = join(claudeDir, "plugins");

    // 1. Read installed_plugins.json
    interface InstalledEntry {
      scope: string;
      installPath: string;
      version: string;
      installedAt: string;
      lastUpdated: string;
      gitCommitSha?: string;
    }
    const installedFile = await readJsonFile<{
      version: number;
      plugins: Record<string, InstalledEntry[]>;
    }>(join(pluginsDir, "installed_plugins.json"));

    // 2. Read enabledPlugins from ~/.claude/settings.json
    const claudeSettings = await readJsonFile<{
      enabledPlugins?: Record<string, boolean>;
    }>(join(claudeDir, "settings.json"));
    const enabledMap = claudeSettings?.enabledPlugins ?? {};

    // 3. Read install-counts-cache.json
    const countsCache = await readJsonFile<{
      counts: Array<{ plugin: string; unique_installs: number }>;
    }>(join(pluginsDir, "install-counts-cache.json"));
    const installCounts = new Map(
      (countsCache?.counts ?? []).map((c) => [c.plugin, c.unique_installs]),
    );

    // 4. Build result
    interface InstalledPlugin {
      key: string; // e.g. "frontend-design@claude-plugins-official"
      name: string; // e.g. "frontend-design"
      marketplace: string; // e.g. "claude-plugins-official"
      version: string;
      enabled: boolean;
      scope: string;
      installPath: string;
      installedAt: string;
      lastUpdated: string;
      installs?: number;
      description?: string;
    }

    const results: InstalledPlugin[] = [];

    if (installedFile?.plugins) {
      // Read all marketplace.json files for descriptions
      const descMap = new Map<string, string>();
      const marketplacesDir = join(pluginsDir, "marketplaces");
      try {
        const mpDirs = await readdir(marketplacesDir, { withFileTypes: true });
        for (const mpDir of mpDirs) {
          if (!mpDir.isDirectory()) continue;
          const mpJson = await readJsonFile<MarketplaceJson>(
            join(marketplacesDir, mpDir.name, ".claude-plugin", "marketplace.json"),
          );
          if (mpJson?.plugins) {
            for (const p of mpJson.plugins) {
              if (p.name) {
                descMap.set(`${p.name}@${mpDir.name}`, p.description ?? "");
              }
            }
          }
        }
      } catch {
        // marketplaces dir may not exist
      }

      for (const [key, entries] of Object.entries(installedFile.plugins)) {
        const entry = entries[0]; // Take first (usually only one)
        if (!entry) continue;

        const atIdx = key.indexOf("@");
        const pluginName = atIdx > 0 ? key.slice(0, atIdx) : key;
        const marketplace = atIdx > 0 ? key.slice(atIdx + 1) : "unknown";

        results.push({
          key,
          name: pluginName,
          marketplace,
          version: entry.version,
          enabled: enabledMap[key] !== false, // default enabled if not in map
          scope: entry.scope,
          installPath: entry.installPath,
          installedAt: entry.installedAt,
          lastUpdated: entry.lastUpdated,
          installs: installCounts.get(key),
          description: descMap.get(key),
        });
      }
    }

    return { plugins: results };
  });

  // ── List marketplace sources ──
  rpcHandlerManager.registerHandler("listMarketplaces", async () => {
    const pluginsDir = join(homedir(), ".claude", "plugins");

    // Read known_marketplaces.json
    interface KnownMarketplace {
      source: { source: string; repo: string };
      installLocation: string;
      lastUpdated: string;
      autoUpdate?: boolean;
    }
    const known = await readJsonFile<Record<string, KnownMarketplace>>(
      join(pluginsDir, "known_marketplaces.json"),
    );

    // Read installed_plugins.json for counting
    const installedFile = await readJsonFile<{
      plugins: Record<string, unknown[]>;
    }>(join(pluginsDir, "installed_plugins.json"));

    interface MarketplaceInfo {
      name: string;
      repo: string;
      installLocation: string;
      lastUpdated: string;
      autoUpdate: boolean;
      availableCount: number;
      installedCount: number;
    }

    const results: MarketplaceInfo[] = [];

    if (known) {
      for (const [name, mp] of Object.entries(known)) {
        // Count available plugins from marketplace.json
        const mpJson = await readJsonFile<MarketplaceJson>(
          join(mp.installLocation, ".claude-plugin", "marketplace.json"),
        );
        const availableCount = mpJson?.plugins?.length ?? 0;

        // Count installed plugins from this marketplace
        let installedCount = 0;
        if (installedFile?.plugins) {
          for (const key of Object.keys(installedFile.plugins)) {
            if (key.endsWith(`@${name}`)) installedCount++;
          }
        }

        results.push({
          name,
          repo: mp.source.repo,
          installLocation: mp.installLocation,
          lastUpdated: mp.lastUpdated,
          autoUpdate: mp.autoUpdate ?? false,
          availableCount,
          installedCount,
        });
      }
    }

    return { marketplaces: results };
  });

  // ── List all available plugins from all marketplaces (for Discover UI) ──
  rpcHandlerManager.registerHandler("listAvailablePlugins", async () => {
    const pluginsDir = join(homedir(), ".claude", "plugins");

    // Read installed_plugins.json
    const installedFile = await readJsonFile<{
      plugins: Record<string, unknown[]>;
    }>(join(pluginsDir, "installed_plugins.json"));
    const installedKeys = new Set(
      Object.keys(installedFile?.plugins ?? {}),
    );

    // Read enabledPlugins
    const claudeSettings = await readJsonFile<{
      enabledPlugins?: Record<string, boolean>;
    }>(join(homedir(), ".claude", "settings.json"));
    const enabledMap = claudeSettings?.enabledPlugins ?? {};

    // Read install-counts-cache.json
    const countsCache = await readJsonFile<{
      counts: Array<{ plugin: string; unique_installs: number }>;
    }>(join(pluginsDir, "install-counts-cache.json"));
    const installCounts = new Map(
      (countsCache?.counts ?? []).map((c) => [c.plugin, c.unique_installs]),
    );

    // Read known_marketplaces.json
    interface KnownMarketplaceEntry {
      source: { source: string; repo: string };
      installLocation: string;
    }
    const known = await readJsonFile<Record<string, KnownMarketplaceEntry>>(
      join(pluginsDir, "known_marketplaces.json"),
    );

    interface AvailablePlugin {
      name: string;
      key: string; // "plugin-name@marketplace"
      marketplace: string;
      description?: string;
      category?: string;
      homepage?: string;
      installed: boolean;
      enabled: boolean;
      installs?: number;
    }

    const results: AvailablePlugin[] = [];

    if (known) {
      for (const [mpName, mp] of Object.entries(known)) {
        const mpJson = await readJsonFile<MarketplaceJson>(
          join(mp.installLocation, ".claude-plugin", "marketplace.json"),
        );
        if (!mpJson?.plugins) continue;

        for (const p of mpJson.plugins) {
          if (!p.name) continue;
          const key = `${p.name}@${mpName}`;
          results.push({
            name: p.name,
            key,
            marketplace: mpName,
            description: p.description,
            category: p.category,
            homepage: (p as Record<string, unknown>).homepage as string | undefined,
            installed: installedKeys.has(key),
            enabled: enabledMap[key] !== false && installedKeys.has(key),
            installs: installCounts.get(key),
          });
        }
      }
    }

    // Sort by install count (descending), then name
    results.sort((a, b) => {
      const ai = a.installs ?? 0;
      const bi = b.installs ?? 0;
      if (bi !== ai) return bi - ai;
      return a.name.localeCompare(b.name);
    });

    return { plugins: results };
  });

  // ── Inspect a single plugin (detailed) ──
  rpcHandlerManager.registerHandler(
    "inspectPlugin",
    async (params: { path: string }) => {
      const pluginPath = params.path;
      const pluginName = basename(pluginPath);

      const meta = await readPluginMeta(pluginName, pluginPath);

      // Read full lists of commands/skills/agents
      async function listDirNames(dirPath: string): Promise<string[]> {
        try {
          const entries = await readdir(dirPath);
          return entries
            .filter((e) => !e.startsWith("."))
            .map((e) => e.replace(/\.(md|json|yaml|yml)$/, ""))
            .sort();
        } catch {
          return [];
        }
      }

      const [commandList, skillList, agentList] = await Promise.all([
        listDirNames(join(pluginPath, "commands")),
        listDirNames(join(pluginPath, "skills")),
        listDirNames(join(pluginPath, "agents")),
      ]);

      return { ...meta, commandList, skillList, agentList };
    },
  );
}
