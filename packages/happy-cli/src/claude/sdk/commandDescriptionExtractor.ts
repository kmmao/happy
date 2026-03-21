/**
 * Command Description Extractor
 * Reads command/skill markdown files from the filesystem to extract descriptions
 * for slash commands reported by the SDK.
 *
 * Supported description formats:
 * - Frontmatter: `---\ndescription: ...\n---`
 * - Markdown heading: `# Title`
 * - Plain text first line
 *
 * File search paths (by priority):
 * 1. <cwd>/.claude/commands/<name>.md (project commands)
 * 2. ~/.claude/commands/<name>.md (user global commands)
 * 3. Plugin commands via plugin paths
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { logger } from "@/ui/logger";

const MAX_DESCRIPTION_LENGTH = 200;

/**
 * Extract description from a markdown file content.
 * Handles frontmatter, heading, and plain text formats.
 */
function extractDescriptionFromContent(content: string): string | undefined {
  const trimmed = content.trimStart();
  if (!trimmed) return undefined;

  // Frontmatter format: ---\ndescription: ...\n---
  if (trimmed.startsWith("---")) {
    const endIndex = trimmed.indexOf("---", 3);
    if (endIndex !== -1) {
      const frontmatter = trimmed.slice(3, endIndex);
      const match = frontmatter.match(/^description:\s*(.+)$/m);
      if (match) {
        return match[1].trim().slice(0, MAX_DESCRIPTION_LENGTH);
      }
    }
  }

  // First non-empty line
  const firstLine = trimmed.split("\n")[0].trim();

  // Markdown heading: # Title
  if (firstLine.startsWith("# ")) {
    return firstLine.slice(2).trim().slice(0, MAX_DESCRIPTION_LENGTH);
  }

  // Plain text first line (skip if it's frontmatter delimiter)
  if (firstLine !== "---") {
    return firstLine.slice(0, MAX_DESCRIPTION_LENGTH);
  }

  return undefined;
}

/**
 * Try to read a file and extract its description.
 * Returns undefined if file doesn't exist or has no description.
 */
async function tryExtractFromFile(
  filePath: string,
): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, "utf-8");
    return extractDescriptionFromContent(content);
  } catch {
    return undefined;
  }
}

/**
 * Extract descriptions for a list of command names by looking up their source files.
 *
 * @param commandNames - List of slash command names (e.g., ["release-cli", "everything-claude-code:plan"])
 * @param cwd - Current working directory (project root)
 * @param homeDir - User's home directory
 * @param pluginPaths - Plugin name→path mapping from SDK init message
 * @returns Map of command name → description
 */
export async function extractCommandDescriptions(
  commandNames: string[],
  cwd: string,
  homeDir: string,
  pluginPaths?: { name: string; path: string }[],
): Promise<Record<string, string>> {
  const descriptions: Record<string, string> = {};
  const pluginMap = new Map(
    (pluginPaths ?? []).map((p) => [p.name, p.path]),
  );

  const tasks = commandNames.map(async (cmd) => {
    let description: string | undefined;

    if (cmd.includes(":")) {
      // Plugin command: "namespace:command-name"
      const colonIndex = cmd.indexOf(":");
      const namespace = cmd.slice(0, colonIndex);
      const name = cmd.slice(colonIndex + 1);

      // Try plugin path from SDK init message
      const pluginPath = pluginMap.get(namespace);
      if (pluginPath) {
        // Try commands/ directory first
        description = await tryExtractFromFile(
          join(pluginPath, "commands", `${name}.md`),
        );
        // Then try skills/ directory
        if (!description) {
          description = await tryExtractFromFile(
            join(pluginPath, "skills", name, "SKILL.md"),
          );
        }
      }

      // Fallback: search in ~/.claude/plugins for this namespace
      if (!description) {
        const searchPaths = [
          join(homeDir, ".claude", "plugins", "marketplaces", namespace, "commands", `${name}.md`),
          join(homeDir, ".claude", "plugins", "marketplaces", namespace, "skills", name, "SKILL.md"),
          join(homeDir, ".claude", "plugins", "marketplaces", namespace, ".claude", "commands", `${name}.md`),
          join(homeDir, ".claude", "plugins", "marketplaces", namespace, ".claude", "skills", namespace, "skills", name, "SKILL.md"),
        ];
        for (const searchPath of searchPaths) {
          description = await tryExtractFromFile(searchPath);
          if (description) break;
        }
      }
    } else {
      // Regular command: check project first, then user global
      description = await tryExtractFromFile(
        join(cwd, ".claude", "commands", `${cmd}.md`),
      );
      if (!description) {
        description = await tryExtractFromFile(
          join(homeDir, ".claude", "commands", `${cmd}.md`),
        );
      }
    }

    if (description) {
      descriptions[cmd] = description;
    }
  });

  // Run all lookups in parallel with a timeout
  try {
    await Promise.race([
      Promise.allSettled(tasks),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 2000),
      ),
    ]);
  } catch {
    logger.debug(
      "[commandDescriptionExtractor] Timed out, returning partial results",
    );
  }

  logger.debug(
    `[commandDescriptionExtractor] Extracted ${Object.keys(descriptions).length} descriptions from ${commandNames.length} commands`,
  );

  return descriptions;
}
