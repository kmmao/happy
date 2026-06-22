/**
 * Suggestion commands functionality for slash commands
 * Reads commands directly from session metadata storage
 */

import Fuse from "fuse.js";
import type { ClaudeSlashCommand } from "@kmmao/happy-wire";
import {
  resolveCodexCompatibilitySlashCommands,
  resolveCodexPromptCommands,
} from "./codexSurface";
import { storage } from "./storage";

export type CommandItemKind = "slash" | "skill";

/**
 * Origin of a command shown in the `/` popover. Used by `CommandListPopover`
 * to group entries by source. Mirrors `ClaudeSlashCommandSource` from wire
 * plus an extra `codex` bucket for Codex-side prompts/skills (which use a
 * separate scanning surface).
 *
 * - `builtin` — App-provided fallback (`/compact`, `/clear`)
 * - `project` — `<cwd>/.claude/commands|skills/`
 * - `user`    — `~/.claude/commands|skills/`
 * - `plugin`  — `<pluginInstallPath>/commands|skills/`
 * - `codex`   — Codex prompts / skills (`metadata.codex.prompts|skills`)
 * - `unknown` — older CLI that only emits the flat `slashCommands` list
 *               with no source info; surfaced under a generic group
 */
export type CommandItemSource =
  | "builtin"
  | "project"
  | "user"
  | "plugin"
  | "codex"
  | "unknown";

export interface CommandItem {
  command: string; // The command without slash/sigil (e.g., "compact" or "tdd")
  description?: string; // Optional description of what the command does
  kind: CommandItemKind;
  source: CommandItemSource;
  /** Plugin name when `source === "plugin"`. */
  plugin?: string;
}

export interface FavoriteShortcut {
  kind: CommandItemKind;
  command: string;
}

export function getCommandItemKey(item: Pick<CommandItem, "kind" | "command">): string {
  return `${item.kind}:${item.command}`;
}

export function getCommandInsertionText(item: Pick<CommandItem, "kind" | "command">): string {
  return item.kind === "skill" ? `$${item.command} ` : `/${item.command} `;
}

export function normalizeFavoriteShortcut(
  shortcut: FavoriteShortcut | string,
): FavoriteShortcut {
  if (typeof shortcut === "string") {
    return { kind: "slash", command: shortcut };
  }
  return shortcut;
}

interface SearchOptions {
  limit?: number;
  threshold?: number;
  kinds?: CommandItemKind[];
}

// Commands to ignore/filter out
export const IGNORED_COMMANDS = [
  "add-dir",
  "agents",
  "config",
  "statusline",
  "bashes",
  "settings",
  "cost",
  "doctor",
  "exit",
  "help",
  "ide",
  "init",
  "install-github-app",
  "mcp",
  "memory",
  "migrate-installer",
  "model",
  "pr-comments",
  "release-notes",
  "resume",
  "status",
  "bug",
  "review",
  "security-review",
  "terminal-setup",
  "upgrade",
  "vim",
  "permissions",
  "hooks",
  "export",
  "logout",
  "login",
];

// Default commands always available
const DEFAULT_COMMANDS: CommandItem[] = [
  { command: "compact", description: "Compact the conversation history", kind: "slash", source: "builtin" },
  { command: "clear", description: "Clear the conversation", kind: "slash", source: "builtin" },
  // Native Claude Code built-ins that the CLI does not advertise via metadata.
  // Clicking inserts the literal `/command` text; the underlying native session executes it.
  { command: "goal", description: "Keep Claude working toward a goal until done", kind: "slash", source: "builtin" },
  { command: "code-review", description: "Review the current diff for bugs and cleanups", kind: "slash", source: "builtin" },
  { command: "ultrareview", description: "Cloud multi-agent deep code review", kind: "slash", source: "builtin" },
  { command: "security-review", description: "Security review of pending changes", kind: "slash", source: "builtin" },
  { command: "simplify", description: "Review changed code and apply simplifications", kind: "slash", source: "builtin" },
  { command: "verify", description: "Run the app to verify a change works", kind: "slash", source: "builtin" },
];

// Command descriptions for known tools/commands
const COMMAND_DESCRIPTIONS: Record<string, string> = {
  // Default commands
  compact: "Compact the conversation history",

  // Common tool commands
  help: "Show available commands",
  clear: "Clear the conversation",
  reset: "Reset the session",
  export: "Export conversation",
  debug: "Show debug information",
  status: "Show connection status",
  stop: "Stop current operation",
  abort: "Abort current operation",
  cancel: "Cancel current operation",

  // Add more descriptions as needed
};

// Merge rich (source-tagged) slash commands from CLI metadata.
// Each entry's source is preserved as-is so the UI can group by origin.
function mergeRichSlashCommands(
  commands: CommandItem[],
  rich: readonly ClaudeSlashCommand[],
): void {
  for (const entry of rich) {
    if (IGNORED_COMMANDS.includes(entry.name)) continue;
    if (commands.find((c) => c.kind === "slash" && c.command === entry.name)) {
      continue;
    }
    commands.push({
      command: entry.name,
      description: entry.description ?? COMMAND_DESCRIPTIONS[entry.name],
      kind: "slash",
      source: entry.source,
      ...(entry.plugin ? { plugin: entry.plugin } : {}),
    });
  }
}

// Merge slash commands from a metadata object into an existing list. Used as
// the fallback path when the CLI didn't emit `slashCommandsRich` (older CLI
// versions). Entries land in the `unknown` bucket because we can't tell
// project vs user vs plugin from the flat list alone.
function mergeSlashCommands(
  commands: CommandItem[],
  slashCommands: string[],
  descriptions?: Record<string, string>,
): void {
  for (const cmd of slashCommands) {
    if (IGNORED_COMMANDS.includes(cmd)) continue;
    if (!commands.find((c) => c.kind === "slash" && c.command === cmd)) {
      commands.push({
        command: cmd,
        description: descriptions?.[cmd] ?? COMMAND_DESCRIPTIONS[cmd],
        kind: "slash",
        // Plugin-namespaced names follow `<plugin>:<name>` — infer the origin
        // even without the rich list so existing plugin commands group
        // correctly when talking to an older CLI.
        ...(cmd.includes(":")
          ? { source: "plugin" as const, plugin: cmd.split(":", 1)[0] }
          : { source: "unknown" as const }),
      });
    }
  }
}

function mergeCodexPromptCommands(
  commands: CommandItem[],
  promptCommands: readonly Omit<CommandItem, "kind" | "source">[],
): void {
  for (const prompt of promptCommands) {
    if (IGNORED_COMMANDS.includes(prompt.command)) continue;
    if (!commands.find((command) => command.kind === "slash" && command.command === prompt.command)) {
      commands.push({
        command: prompt.command,
        description: prompt.description,
        kind: "slash",
        source: "codex",
      });
    }
  }
}

function mergeCodexSkills(
  commands: CommandItem[],
  skills: readonly { name: string; description?: string | null }[] | undefined,
): void {
  for (const skill of skills ?? []) {
    if (!skill.name) continue;
    if (!commands.find((command) => command.kind === "skill" && command.command === skill.name)) {
      commands.push({
        command: skill.name,
        description: skill.description ?? undefined,
        kind: "skill",
        source: "codex",
      });
    }
  }
}

// Merge one session's metadata into the running command list. Prefers the
// rich (source-tagged) list when the CLI emits one; falls back to the flat
// `slashCommands` field for older CLIs.
function mergeSessionMetadata(
  commands: CommandItem[],
  metadata: NonNullable<
    ReturnType<typeof storage.getState>["sessions"][string]
  >["metadata"],
): void {
  if (!metadata) return;
  if (metadata.slashCommandsRich && metadata.slashCommandsRich.length > 0) {
    mergeRichSlashCommands(commands, metadata.slashCommandsRich);
  } else {
    mergeSlashCommands(
      commands,
      resolveCodexCompatibilitySlashCommands(metadata),
      metadata.slashCommandDescriptions,
    );
  }
  mergeCodexPromptCommands(commands, resolveCodexPromptCommands(metadata));
  mergeCodexSkills(commands, metadata.codex?.skills);
}

// Get commands from session metadata
function getCommandsFromSession(sessionId: string): CommandItem[] {
  const state = storage.getState();

  // No sessionId — aggregate commands across all known sessions so the new
  // session page can show the full command set without requiring an active session.
  if (!sessionId) {
    const commands: CommandItem[] = [...DEFAULT_COMMANDS];
    for (const session of Object.values(state.sessions)) {
      mergeSessionMetadata(commands, session?.metadata);
    }
    return commands;
  }

  const session = state.sessions[sessionId];
  if (!session || !session.metadata) {
    return DEFAULT_COMMANDS;
  }

  const commands: CommandItem[] = [...DEFAULT_COMMANDS];
  mergeSessionMetadata(commands, session.metadata);
  return commands;
}

// Main export: search commands with fuzzy matching
export async function searchCommands(
  sessionId: string,
  query: string,
  options: SearchOptions = {},
): Promise<CommandItem[]> {
  const { limit = 10, threshold = 0.3, kinds } = options;

  // Get commands from session metadata (no caching)
  const commands = kinds && kinds.length > 0
    ? getCommandsFromSession(sessionId).filter((command) => kinds.includes(command.kind))
    : getCommandsFromSession(sessionId);

  // If query is empty, return all commands
  if (!query || query.trim().length === 0) {
    return commands.slice(0, limit);
  }

  // Setup Fuse for fuzzy search
  const fuseOptions = {
    keys: [
      { name: "command", weight: 0.7 },
      { name: "description", weight: 0.3 },
    ],
    threshold,
    includeScore: true,
    shouldSort: true,
    minMatchCharLength: 1,
    ignoreLocation: true,
    useExtendedSearch: true,
  };

  const fuse = new Fuse(commands, fuseOptions);
  const results = fuse.search(query, { limit });

  return results.map((result) => result.item);
}

// Get all available commands for a session
export function getAllCommands(sessionId: string): CommandItem[] {
  return getCommandsFromSession(sessionId);
}
