/**
 * claudeLocalCommands — discover Claude Code slash commands by scanning the
 * on-disk command + skill directories that `claude` TUI itself reads at
 * launch.
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
 * Mirrors the Codex side's `localSurface.ts` pattern: scan the same
 * directory trees Claude itself consults and emit a `{ slashCommands,
 * slashCommandDescriptions }` pair that can be stuffed straight into the
 * session metadata at startup.
 *
 * Slash commands (`<dir>/<name>.md`):
 *   <cwd>/.claude/commands/<name>.md           → "<name>"
 *   ~/.claude/commands/<name>.md               → "<name>"
 *   <pluginInstallPath>/commands/<name>.md     → "<plugin>:<name>"
 *
 * Skills (`<dir>/<name>/SKILL.md`):
 *   <cwd>/.claude/skills/<name>/SKILL.md       → "<name>"
 *   ~/.claude/skills/<name>/SKILL.md           → "<name>"
 *   <pluginInstallPath>/skills/<name>/SKILL.md → "<plugin>:<name>"
 *
 * Both surfaces are merged into the same `slashCommands` array — in
 * Claude Code typing `/<name>` resolves to either source uniformly (see
 * the Skill tool's "When users reference a 'slash command' or '/<something>',
 * they are referring to a skill" note in the Claude prompt). The App can
 * therefore present the union under one popup.
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

import type {
  ClaudeSlashCommand,
  ClaudeSlashCommandKind,
  ClaudeSlashCommandSource,
} from "@kmmao/happy-wire";

import { logger } from "@/ui/logger";

export interface ClaudeLocalCommands {
  /** Legacy flat list — kept for backward compat with older Apps. */
  slashCommands: string[];
  /** Legacy descriptions map — kept for backward compat with older Apps. */
  slashCommandDescriptions: Record<string, string>;
  /**
   * Rich list with per-entry source/kind/plugin info. Newer Apps consume
   * this to group the `/` popover by origin (project / user / plugin).
   */
  slashCommandsRich: ClaudeSlashCommand[];
}

interface CollectOptions {
  cwd?: string;
  userHome?: string;
}

interface CommandEntry {
  name: string;
  description: string | null;
  source: ClaudeSlashCommandSource;
  kind: ClaudeSlashCommandKind;
  /** Plugin name when `source === "plugin"`. */
  plugin?: string;
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
 *    Supports both inline (`description: text`) and block scalars
 *    (`description: >\n  multi-line text`, `description: |\n  preserved`).
 *    Block scalars are folded into a single line: `>` folds linebreaks to
 *    spaces (YAML semantics), `|` is conservatively folded the same way
 *    so the popover never renders raw `\n` in the one-line description.
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
    const fmLines = fmMatch[1].split(/\r?\n/);
    for (let i = 0; i < fmLines.length; i++) {
      const line = fmLines[i];
      // Block scalar form: `description: >` or `description: |` (with optional
      // chomp indicator `-`/`+`). Continuation lines follow, indented deeper
      // than the `description:` key.
      const block = line.match(/^description:\s*([>|])[-+]?\s*$/);
      if (block) {
        const folded: string[] = [];
        let baseIndent = -1;
        for (let j = i + 1; j < fmLines.length; j++) {
          const cont = fmLines[j];
          if (cont.trim() === "") {
            folded.push("");
            continue;
          }
          const indent = cont.match(/^(\s*)/)?.[1].length ?? 0;
          if (baseIndent < 0) baseIndent = indent;
          // Continuation lines must be indented at least as much as the first
          // continuation; once indent drops we've exited the block scalar.
          if (indent < baseIndent) break;
          folded.push(cont.slice(baseIndent));
        }
        const joined = folded
          .map((l) => l.trim())
          .filter((l) => l !== "")
          .join(" ")
          .trim();
        return joined || null;
      }
      // Inline form: `description: actual text`. Skip when value is empty or
      // is a sole block indicator (handled above).
      const inline = line.match(/^description:\s*(.+)$/);
      if (inline?.[1]) {
        const value = inline[1].trim();
        if (value === ">" || value === "|" || /^[>|][-+]?$/.test(value)) continue;
        return value.replace(/^['"]|['"]$/g, "");
      }
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
  source: ClaudeSlashCommandSource,
  plugin?: string,
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
    // Accept files and symlinks (which may resolve to files). Claude users
    // routinely manage commands via dotfile repos that symlink individual
    // .md files into ~/.claude/commands — Dirent.isFile() is false for the
    // symlink itself, so we'd lose those without this branch. readFile
    // follows symlinks, so a dangling link simply errors out below.
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
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
      source,
      kind: "command",
      ...(plugin ? { plugin } : {}),
    });
  }
  return results;
}

/**
 * Scan a skills directory: `<dir>/<name>/SKILL.md` is the canonical layout
 * Claude TUI recognises. Flat single-file skills (`<dir>/<name>.md`) are
 * NOT included because empirically Claude Code TUI does not register them
 * as user-invocable.
 *
 * Each SKILL.md carries YAML frontmatter with at least `name:` and
 * `description:` keys. We use the directory name as the canonical
 * identifier (matching how Claude TUI itself surfaces the skill in its
 * `/` autocomplete), and only fall back to scanning frontmatter for the
 * description.
 */
async function readSkillsDir(
  dir: string,
  prefix: string,
  source: ClaudeSlashCommandSource,
  plugin?: string,
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
    // Accept directories AND symlinks. Many users (e.g. Matt Pocock's
    // setup) install skills by symlinking each `<name>/` from a shared
    // dotfile repo into `~/.claude/skills/`; `Dirent.isDirectory()` is
    // `false` for those symlinks even though the target is a directory.
    // The `pathExists(SKILL.md)` probe below uses `access()`, which
    // follows symlinks, so dangling / non-skill links are filtered out
    // naturally without an extra stat round-trip.
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".")) continue;

    const skillFile = join(dir, entry.name, "SKILL.md");
    if (!(await pathExists(skillFile))) continue;

    let content: string;
    try {
      content = await readFile(skillFile, "utf8");
    } catch (err) {
      logger.debug(`[claudeLocalCommands] Failed to read ${skillFile}: ${err}`);
      continue;
    }

    results.push({
      name: prefix ? `${prefix}:${entry.name}` : entry.name,
      description: extractDescription(content),
      source,
      kind: "skill",
      ...(plugin ? { plugin } : {}),
    });
  }
  return results;
}

/**
 * Walk `~/.claude/plugins/installed_plugins.json` and surface every plugin's
 * `commands/` and `skills/` dirs.
 *
 * The manifest format mirrors what `readClaudePluginMcpServers` already
 * parses for MCP servers — see `claudeSettings.ts` for the full schema
 * notes. Keys look like `"<plugin>@<marketplace>"`; we drop the marketplace
 * suffix and use the plain plugin name as the slash-command namespace
 * (e.g. `commit-commands:commit-push-pr`, `codex:codex-cli-runtime`). This
 * matches how Claude TUI itself presents plugin-contributed surfaces.
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

    const [cmds, skills] = await Promise.all([
      readCommandsDir(
        join(install.installPath, "commands"),
        pluginName,
        "plugin",
        pluginName,
      ),
      readSkillsDir(
        join(install.installPath, "skills"),
        pluginName,
        "plugin",
        pluginName,
      ),
    ]);
    all.push(...cmds, ...skills);
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

  const [pluginEntries, userCmds, projectCmds, userSkills, projectSkills] =
    await Promise.all([
      readPluginCommands(claudeHome),
      readCommandsDir(join(claudeHome, "commands"), "", "user"),
      readCommandsDir(join(cwd, ".claude", "commands"), "", "project"),
      readSkillsDir(join(claudeHome, "skills"), "", "user"),
      readSkillsDir(join(cwd, ".claude", "skills"), "", "project"),
    ]);

  // De-dupe by name. Iterate in low → high precedence order so later
  // writes overwrite earlier ones: plugin < user < project. Skills and
  // commands share the same namespace (Claude TUI resolves `/<name>`
  // uniformly across both), so a project-level command can shadow a
  // user-level skill of the same name, etc.
  const byName = new Map<string, CommandEntry>();
  for (const list of [
    pluginEntries,
    userCmds,
    userSkills,
    projectCmds,
    projectSkills,
  ]) {
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
  const slashCommandsRich: ClaudeSlashCommand[] = sorted.map((c) => ({
    name: c.name,
    ...(c.description ? { description: c.description } : {}),
    source: c.source,
    kind: c.kind,
    ...(c.plugin ? { plugin: c.plugin } : {}),
  }));

  logger.debug(
    `[claudeLocalCommands] Discovered ${slashCommands.length} slash commands ` +
      `(${projectCmds.length} project cmds, ${userCmds.length} user cmds, ` +
      `${projectSkills.length} project skills, ${userSkills.length} user skills, ` +
      `${pluginEntries.length} plugin entries)`,
  );

  return { slashCommands, slashCommandDescriptions, slashCommandsRich };
}
