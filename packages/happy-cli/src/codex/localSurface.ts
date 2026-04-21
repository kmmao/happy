import { access, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type {
  CodexAgentSummary,
  CodexPromptSummary,
  CodexSkillSummary,
} from "@kmmao/happy-wire";

export type {
  CodexAgentSummary,
  CodexPromptSummary,
  CodexSkillSummary,
} from "@kmmao/happy-wire";

export interface CodexLocalSurface {
  slashCommands: string[];
  slashCommandDescriptions: Record<string, string>;
  prompts: CodexPromptSummary[];
  skills: CodexSkillSummary[];
  agents: CodexAgentSummary[];
}

interface CollectCodexLocalSurfaceOptions {
  cwd?: string;
  codexHome?: string;
  userHome?: string;
}

function resolvePath(pathValue: string): string {
  const expandedHome = pathValue.replace(/^~(?=\/|$)/, homedir());
  return isAbsolute(expandedHome) ? expandedHome : resolve(expandedHome);
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await access(pathValue, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function extractFrontmatterValue(
  content: string,
  key: string,
): string | null {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  const regex = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const match = frontmatterMatch[1]?.match(regex);
  if (!match?.[1]) {
    return null;
  }

  return match[1].trim().replace(/^['"]|['"]$/g, "");
}

function extractBodyDescription(content: string): string | null {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (
      line === "---" ||
      line.startsWith("#") ||
      line.startsWith("Source:")
    ) {
      continue;
    }
    return line;
  }

  return null;
}

function toSlashCommandName(promptName: string): string {
  return promptName.replace(/\.md$/i, "");
}

async function readPromptSummaries(dirPath: string): Promise<CodexPromptSummary[]> {
  if (!(await pathExists(dirPath))) {
    return [];
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  const promptEntries = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name));

  const prompts = await Promise.all(
    promptEntries.map(async (entry) => {
      const promptPath = join(dirPath, entry.name);
      const content = await readFile(promptPath, "utf8");
      return {
        name: toSlashCommandName(entry.name),
        path: promptPath,
        description: extractBodyDescription(content),
      } satisfies CodexPromptSummary;
    }),
  );

  return prompts;
}

async function readSkillSummaries(dirPath: string): Promise<CodexSkillSummary[]> {
  if (!(await pathExists(dirPath))) {
    return [];
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  const skillDirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  const skills = await Promise.all(
    skillDirs.map(async (entry) => {
      const skillPath = join(dirPath, entry.name, "SKILL.md");
      if (!(await pathExists(skillPath))) {
        return null;
      }

      const content = await readFile(skillPath, "utf8");
      const skill: CodexSkillSummary = {
        name: entry.name,
        description:
          extractFrontmatterValue(content, "description") ??
          extractBodyDescription(content) ??
          "",
        path: skillPath,
        enabled: true,
      };

      return skill;
    }),
  );

  return skills.filter((skill): skill is CodexSkillSummary => skill !== null);
}

async function readAgentSummaries(dirPath: string): Promise<CodexAgentSummary[]> {
  if (!(await pathExists(dirPath))) {
    return [];
  }

  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({
      name: basename(entry.name, ".toml"),
      path: join(dirPath, entry.name),
    }));
}

function dedupeByName<T extends { name: string }>(
  items: readonly T[],
): T[] {
  const deduped = new Map<string, T>();
  for (const item of items) {
    if (!deduped.has(item.name)) {
      deduped.set(item.name, item);
    }
  }
  return [...deduped.values()];
}

export async function collectCodexLocalSurface(
  options: CollectCodexLocalSurfaceOptions = {},
): Promise<CodexLocalSurface> {
  const cwd = resolvePath(options.cwd ?? process.cwd());
  const userHome = resolvePath(options.userHome ?? homedir());
  const codexHome = resolvePath(
    options.codexHome ?? process.env.CODEX_HOME ?? join(userHome, ".codex"),
  );

  const [projectPrompts, globalPrompts, projectSkills, globalSkills, projectAgents, globalAgents] =
    await Promise.all([
      readPromptSummaries(join(cwd, ".codex", "prompts")),
      readPromptSummaries(join(codexHome, "prompts")),
      readSkillSummaries(join(cwd, ".agents", "skills")),
      readSkillSummaries(join(userHome, ".agents", "skills")),
      readAgentSummaries(join(cwd, ".codex", "agents")),
      readAgentSummaries(join(codexHome, "agents")),
    ]);

  const prompts = dedupeByName([...projectPrompts, ...globalPrompts]);
  const skills = dedupeByName([...projectSkills, ...globalSkills]);
  const agents = dedupeByName([...projectAgents, ...globalAgents]);

  const slashCommands = prompts.map((prompt) => prompt.name);
  const slashCommandDescriptions = prompts.reduce<Record<string, string>>(
    (acc, prompt) => {
      if (prompt.description) {
        acc[prompt.name] = prompt.description;
      }
      return acc;
    },
    {},
  );

  return {
    slashCommands,
    slashCommandDescriptions,
    prompts,
    skills,
    agents,
  };
}
