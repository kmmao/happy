/**
 * AI-powered agent loop suggestion generator.
 *
 * Gathers project context from the file system (README, package.json, CLAUDE.md,
 * directory listing) and calls the Anthropic API to generate targeted loop
 * configurations for the specific project.
 *
 * Pattern mirrors the server-side generateDimensionPrompt approach in
 * supervisorDimensionRoutes.ts, adapted for CLI filesystem access.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentLoopDefinition } from "./AgentLoopStore";
import type {
  AgentLoopSuggestion,
  AgentLoopSuggestInput,
} from "./AgentLoopSuggestion";

// ---------------------------------------------------------------------------
// Project context gathering
// ---------------------------------------------------------------------------

async function readFileSafe(filePath: string, maxChars: number): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, "utf-8");
    return content.slice(0, maxChars);
  } catch {
    return undefined;
  }
}

async function listDirectorySafe(directory: string, limit: number): Promise<string> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .slice(0, limit)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .join(", ");
  } catch {
    return "(unable to read directory)";
  }
}

export async function gatherProjectContext(directory: string): Promise<string> {
  const parts: string[] = [];

  parts.push(`Project directory: ${directory}`);

  const listing = await listDirectorySafe(directory, 60);
  parts.push(`Directory contents: ${listing}`);

  // package.json — include name, description, scripts keys, dep keys (not values)
  const pkgRaw = await readFileSafe(join(directory, "package.json"), 4000);
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
      const relevant = {
        name: pkg.name,
        description: pkg.description,
        scripts: pkg.scripts,
        dependencies: Object.keys((pkg.dependencies as Record<string, string>) ?? {}),
        devDependencies: Object.keys((pkg.devDependencies as Record<string, string>) ?? {}),
      };
      parts.push(`package.json:\n${JSON.stringify(relevant, null, 2)}`);
    } catch {
      parts.push(`package.json (raw):\n${pkgRaw.slice(0, 800)}`);
    }
  }

  // CLAUDE.md — project-specific AI instructions
  const claudeMd = await readFileSafe(join(directory, "CLAUDE.md"), 2000);
  if (claudeMd) {
    parts.push(`CLAUDE.md:\n${claudeMd}`);
  }

  // README.md
  const readme = await readFileSafe(join(directory, "README.md"), 1500);
  if (readme) {
    parts.push(`README.md:\n${readme}`);
  }

  return parts.join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "You are an expert at designing autonomous AI agent loops for software development projects. " +
  "Given a project's context (directory listing, package.json, CLAUDE.md, README), " +
  "generate 3-6 specific, targeted autonomous agent loops that would be genuinely useful for this project. " +
  "\n\n" +
  "Each loop MUST:\n" +
  "- Have a single, focused responsibility tailored to THIS project (not generic templates)\n" +
  "- Be actionable by Claude running autonomously without human guidance\n" +
  "- Have a realistic execution interval appropriate to the task frequency\n" +
  "- Include a detailed prompt (50-150 words) that Claude can execute independently\n" +
  "- Reference actual project details (framework, package names, paths) where possible\n" +
  "\n" +
  "Return a JSON array. Each item:\n" +
  "{\n" +
  '  "name": "string (concise, 2-4 words)",\n' +
  '  "description": "string (one sentence)",\n' +
  '  "prompt": "string (detailed autonomous instructions, 50-150 words)",\n' +
  '  "goal": "string (desired outcome, 15-30 words)",\n' +
  '  "currentFocus": "string (optional, specific current focus)",\n' +
  '  "intervalMinutes": number (30/60/120/360/720/1440),\n' +
  '  "fileWatchEnabled": boolean,\n' +
  '  "githubBridgeEnabled": boolean,\n' +
  '  "ciBridgeEnabled": boolean,\n' +
  '  "maxConsecutiveFailures": number (2-5),\n' +
  '  "tags": ["string"]\n' +
  "}\n\n" +
  "Return ONLY a valid JSON array. No markdown fences, no explanation, no preamble.";

// ---------------------------------------------------------------------------
// Types and helpers
// ---------------------------------------------------------------------------

interface AILoopRaw {
  name: string;
  description: string;
  prompt: string;
  goal: string;
  currentFocus?: string;
  intervalMinutes: number;
  fileWatchEnabled?: boolean;
  githubBridgeEnabled?: boolean;
  ciBridgeEnabled?: boolean;
  maxConsecutiveFailures?: number;
  tags?: string[];
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function findExistingLoop(
  existingLoops: AgentLoopDefinition[],
  directory: string,
  name: string,
): AgentLoopDefinition | undefined {
  const dir = directory.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  return existingLoops.find(
    (l) =>
      l.directory.trim().toLowerCase() === dir &&
      (l.name ?? "").trim().toLowerCase() === n,
  );
}

function parseJsonResponse(text: string): AILoopRaw[] {
  // Strip optional markdown code fences if the model adds them
  const cleaned = text
    .replace(/^```(?:json)?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
  return JSON.parse(cleaned) as AILoopRaw[];
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Generate agent loop suggestions for a project directory using the Claude API.
 *
 * Requires ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) to be set in the
 * process environment. Uses claude-haiku for fast, cost-effective generation.
 */
export async function suggestAgentLoopsWithAI(
  input: AgentLoopSuggestInput,
  existingLoops: AgentLoopDefinition[] = [],
): Promise<AgentLoopSuggestion[]> {
  const directory = input.directory.trim();
  if (!directory) {
    return [];
  }

  const apiKey =
    process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. AI loop generation requires an Anthropic API key.",
    );
  }

  const context = await gatherProjectContext(directory);

  const existingNames = existingLoops
    .filter((l) => l.directory.trim().toLowerCase() === directory.toLowerCase())
    .map((l) => l.name ?? l.id)
    .filter(Boolean);

  const userMessage = [
    `Generate autonomous agent loops for this project:\n\n${context}`,
    existingNames.length > 0
      ? `\n\nExisting loops (skip duplicates): ${existingNames.join(", ")}`
      : "",
  ].join("");

  const client = new Anthropic({
    apiKey,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  });

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const rawText =
    message.content.find((b) => b.type === "text")?.text?.trim() ?? "";

  const rawItems = parseJsonResponse(rawText);

  return rawItems
    .filter((item) => item.name && item.prompt)
    .map((item): AgentLoopSuggestion => {
      const existing = findExistingLoop(existingLoops, directory, item.name);
      return {
        key: slugify(item.name),
        name: item.name,
        description: item.description ?? "",
        rationale: "AI-generated based on project context analysis.",
        directory,
        intervalMs: Math.max(5 * 60_000, (item.intervalMinutes ?? 60) * 60_000),
        agent: input.agent ?? "claude",
        fileWatchEnabled: item.fileWatchEnabled ?? false,
        githubBridgeEnabled: item.githubBridgeEnabled ?? false,
        ciBridgeEnabled: item.ciBridgeEnabled ?? false,
        maxConsecutiveFailures: item.maxConsecutiveFailures ?? 3,
        retryBackoffMs: 5 * 60_000,
        prompt: item.prompt,
        goal: item.goal ?? "",
        currentFocus: item.currentFocus,
        tags: item.tags ?? [],
        confidence: "medium",
        alreadyConfigured: Boolean(existing),
        existingLoopId: existing?.id,
      };
    });
}
