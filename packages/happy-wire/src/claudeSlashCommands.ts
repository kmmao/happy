/**
 * Wire schema for Claude slash commands with origin/source info.
 *
 * Background
 * ----------
 * Pre-change, `Metadata.slashCommands: string[]` carried only names. The CLI
 * scans 4 directory trees (`<cwd>/.claude/commands|skills`, `~/.claude/...`,
 * plugin installs) and de-dupes them into a flat array — losing the source.
 *
 * The App's `/` autocomplete therefore renders every command under one "CMD"
 * label, with no way to tell apart a project-local script from a user-global
 * helper or a plugin contribution.
 *
 * `ClaudeSlashCommand` keeps the origin so the App can group the popover by
 * source (Project / User / Plugin / Built-in) and surface the plugin name
 * for namespaced entries like `codex:codex-cli-runtime`.
 *
 * The legacy `slashCommands` + `slashCommandDescriptions` fields stay around
 * for backward compatibility — older Apps reading new metadata still get the
 * flat list; older CLIs writing old metadata still produce a usable (ungrouped)
 * popover in newer Apps.
 */

import * as z from "zod";

/**
 * Where a slash command lives on disk. Mirrors the directory hierarchy in
 * `claudeLocalCommands.ts` (CLI side).
 *
 * - `builtin` — provided by the App as fallback (e.g. `/compact`, `/clear`)
 * - `project` — `<cwd>/.claude/commands|skills/<name>{.md,/SKILL.md}`
 * - `user`    — `~/.claude/commands|skills/<name>{.md,/SKILL.md}`
 * - `plugin`  — `<pluginInstallPath>/commands|skills/...` — `plugin` field
 *               carries the plugin name (e.g. `codex`)
 */
export const ClaudeSlashCommandSourceSchema = z.enum([
  "builtin",
  "project",
  "user",
  "plugin",
]);

export type ClaudeSlashCommandSource = z.infer<
  typeof ClaudeSlashCommandSourceSchema
>;

/**
 * Whether the entry is a slash command (`<name>.md`) or a skill
 * (`<name>/SKILL.md`). Claude Code resolves `/<name>` uniformly across both,
 * but skills carry different semantics (longer-lived prompts) and the App
 * may want to surface that.
 */
export const ClaudeSlashCommandKindSchema = z.enum(["command", "skill"]);

export type ClaudeSlashCommandKind = z.infer<
  typeof ClaudeSlashCommandKindSchema
>;

export const ClaudeSlashCommandSchema = z.object({
  /**
   * Canonical name as typed by the user, sans leading slash. Plugin-namespaced
   * entries keep the `<plugin>:<name>` form (e.g. `codex:codex-cli-runtime`).
   */
  name: z.string(),
  /** One-line summary pulled from frontmatter or first body line. */
  description: z.string().optional(),
  source: ClaudeSlashCommandSourceSchema,
  kind: ClaudeSlashCommandKindSchema,
  /**
   * Plugin name when `source === "plugin"`. Absent for other sources.
   * Useful for sub-grouping the popover by plugin.
   */
  plugin: z.string().optional(),
});

export type ClaudeSlashCommand = z.infer<typeof ClaudeSlashCommandSchema>;
