/**
 * claudeLocalCommands — discover Claude Code slash commands by scanning the
 * on-disk command directories that `claude` TUI itself reads at launch.
 *
 * Background
 * ----------
 * Pre-PTY-migration the SDK exposed an `available_commands` event that
 * surfaced every slash command the TUI knew about (built-ins + project +
 * user + plugin contributions). `runAcp.ts` consumed that event and pushed
 * the names into `session.metadata.slashCommands`, which the App uses to
 * populate its `/` autocomplete (see `suggestionCommands.ts`).
 *
 * Post-migration the TUI is driven directly via PTY. Inspection of real
 * `~/.claude/projects/<cwd>/<sid>.jsonl` files shows that the TUI never
 * writes a `system/init` record (let alone a `slash_commands` field) to
 * disk — that subtype was an SDK *stream* message that simply does not
 * exist in the on-disk JSONL we tail. So `metadata.slashCommands` stays
 * empty and the App falls back to its `[compact, clear]` defaults.
 *
 * What this module does
 * ---------------------
 * Mirrors the Codex side's `localSurface.ts` pattern: scan the same three
 * directory trees Claude itself consults and emit a `{ slashCommands,
 * slashCommandDescriptions }` pair that can be stuffed straight into the
 * session metadata at startup.
 *
 *   <cwd>/.claude/commands/<name>.md           → "<name>"
 *   ~/.claude/commands/<name>.md               → "<name>"
 *   <pluginInstallPath>/commands/<name>.md     → "<plugin>:<name>"
 *
 * Description extraction prefers a `description:` frontmatter key, falling
 * back to the first non-empty body line that is not a heading or HR. We
 * deliberately do NOT emit built-in TUI commands here (`/help`, `/status`,
 * `/model`, …) — the App's `IGNORED_COMMANDS` list strips them anyway, so
 * scanning them would only add noise. `/compact` and `/clear` continue to
 * come from the App's `DEFAULT_COMMANDS` fallback.
 */

import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { logger } from "@/ui/logger";

export interface ClaudeLocalCommands {
  slashCommands: string[];
  slashCommandDescriptions: Record<string, string>;
}

interface CollectOptions {
  cwd?: string;
  userHome?: string;
}

interface CommandEntry {
  name: string;
  description: string | null;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract a one-line description from a slash-command markdown file.
 *
 * 1. If a YAML frontmatter block exists and contains `description: …`,
 *    that wins. Surrounding quotes are stripped.
 * 2. Otherwise the first non-empty body line that is not a heading, HR,
 *    or closing-frontmatter marker is used. This matches what `claude`
 *    TUI displays in its own autocomplete preview.
 *
 * Returns `null` when nothing usable is found — the App then falls back to
 * its built-in `COMMAND_DESCRIPTIONS` map (or shows the command without
 * a description).
 */
function extractDescription(content: string): string | null {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const desc = fmMatch[1].match(/^description:\s*(.+)$/m);
    if (desc?.[1]) {
      return desc[1].trim().replace(/^['"]|['"]$/g, "");
    }
  }

  const body = fmMatch ? content.slice(fmMatch[0].length) : content;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "---") continue;
    if (trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return null;
}

async function readCommandsDir(
  dir: string,
  prefix: string,
): Promise<CommandEntry[]> {
  if (!(await pathExists(dir))) return [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    logger.debug(`[claudeLocalCommands] Failed to read ${dir}: ${err}`);
    return [];
  }

  const results: CommandEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;

    const base = entry.name.replace(/\.md$/i, "");
    if (!base) continue;

    const filePath = join(dir, entry.name);
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch (err) {
      logger.debug(`[claudeLocalCommands] Failed to read ${filePath}: ${err}`);
      continue;
    }

    results.push({
      name: prefix ? `${prefix}:${base}` : base,
      description: extractDescription(content),
    });
  }
  return results;
}

/**
 * Walk `~/.claude/plugins/installed_plugins.json` and surface every plugin's
 * `commands/` dir.
 *
 * The manifest format mirrors what `readClaudePluginMcpServers` already
 * parses for MCP servers — see `claudeSettings.ts` for the full schema
 * notes. Keys look like `"<plugin>@<marketplace>"`; we drop the marketplace
 * suffix and use the plain plugin name as the slash-command namespace
 * (e.g. `commit-commands:commit-push-pr`). This matches how Claude TUI
 * itself presents plugin-contributed commands.
 */
async function readPluginCommands(claudeHome: string): Promise<CommandEntry[]> {
  const manifestPath = join(claudeHome, "plugins", "installed_plugins.json");
  if (!(await pathExists(manifestPath))) return [];

  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (err) {
    logger.debug(`[claudeLocalCommands] Failed to read plugin manifest: ${err}`);
    return [];
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    logger.debug(`[claudeLocalCommands] Malformed plugin manifest: ${err}`);
    return [];
  }

  const plugins = (manifest as { plugins?: unknown })?.plugins;
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) {
    return [];
  }

  const all: CommandEntry[] = [];
  for (const [key, installs] of Object.entries(plugins as Record<string, unknown>)) {
    if (!Array.isArray(installs) || installs.length === 0) continue;

    const at = key.indexOf("@");
    const pluginName = at === -1 ? key : key.slice(0, at);
    if (!pluginName) continue;

    const install = installs[0] as { installPath?: unknown };
    if (typeof install?.installPath !== "string") continue;

    const cmds = await readCommandsDir(
      join(install.installPath, "commands"),
      pluginName,
    );
    all.push(...cmds);
  }
  return all;
}

/**
 * Discover every slash command available in this Claude session.
 *
 * Precedence on name collision: project > user > plugin. Project-level
 * commands shadow user-level ones (matching `claude` TUI's lookup order);
 * plugin commands are already namespaced so they almost never collide.
 *
 * Failure modes — missing dirs, malformed manifests, unreadable files —
 * are swallowed and logged at debug level. A best-effort partial list is
 * always preferable to no list at all.
 */
export async function collectClaudeLocalCommands(
  options: CollectOptions = {},
): Promise<ClaudeLocalCommands> {
  const cwd = options.cwd ?? process.cwd();
  const userHome = options.userHome ?? homedir();
  const claudeHome = join(userHome, ".claude");

  const [pluginCmds, userCmds, projectCmds] = await Promise.all([
    readPluginCommands(claudeHome),
    readCommandsDir(join(claudeHome, "commands"), ""),
    readCommandsDir(join(cwd, ".claude", "commands"), ""),
  ]);

  // De-dupe by name. Iterate in low → high precedence order so later
  // writes overwrite earlier ones: plugin < user < project.
  const byName = new Map<string, CommandEntry>();
  for (const list of [pluginCmds, userCmds, projectCmds]) {
    for (const entry of list) {
      byName.set(entry.name, entry);
    }
  }

  const sorted = [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const slashCommands = sorted.map((c) => c.name);
  const slashCommandDescriptions: Record<string, string> = {};
  for (const c of sorted) {
    if (c.description) {
      slashCommandDescriptions[c.name] = c.description;
    }
  }

  logger.debug(
    `[claudeLocalCommands] Discovered ${slashCommands.length} slash commands ` +
      `(${projectCmds.length} project, ${userCmds.length} user, ${pluginCmds.length} plugin)`,
  );

  return { slashCommands, slashCommandDescriptions };
}
