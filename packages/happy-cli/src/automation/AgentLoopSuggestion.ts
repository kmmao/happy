import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import type { AgentLoopDefinition } from "./AgentLoopStore";
import type { AgentLoopCreateInput } from "./AgentLoopCoordinator";

export type AgentLoopSuggestionConfidence = "high" | "medium";

export interface AgentLoopSuggestion {
  key: string;
  name: string;
  description: string;
  rationale: string;
  directory: string;
  intervalMs: number;
  agent: "claude" | "codex" | "gemini";
  fileWatchEnabled?: boolean;
  githubBridgeEnabled?: boolean;
  ciBridgeEnabled?: boolean;
  eventSourceAllowlist?: string[];
  eventKeywordFilters?: string[];
  goal?: string;
  currentFocus?: string;
  workingMemory?: string;
  lastReflectionSummary?: string;
  maxConsecutiveFailures?: number;
  retryBackoffMs?: number;
  prompt: string;
  tags: string[];
  confidence: AgentLoopSuggestionConfidence;
  alreadyConfigured: boolean;
  existingLoopId?: string;
}

export interface AgentLoopSuggestInput {
  directory: string;
  agent?: "claude" | "codex" | "gemini";
  projectId?: string;
  profileId?: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(path: string): Promise<any | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return undefined;
  }
}

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function findMatchingLoop(existingLoops: AgentLoopDefinition[], directory: string, name: string): AgentLoopDefinition | undefined {
  const targetDirectory = normalize(directory);
  const targetName = normalize(name);
  return existingLoops.find((loop) => normalize(loop.directory) === targetDirectory && normalize(loop.name) === targetName);
}

function buildSuggestion(
  base: Omit<AgentLoopSuggestion, "alreadyConfigured" | "existingLoopId">,
  existingLoops: AgentLoopDefinition[],
): AgentLoopSuggestion {
  const existing = findMatchingLoop(existingLoops, base.directory, base.name);
  return {
    ...base,
    alreadyConfigured: Boolean(existing),
    existingLoopId: existing?.id,
  };
}

export async function suggestAgentLoops(
  input: AgentLoopSuggestInput,
  existingLoops: AgentLoopDefinition[] = [],
): Promise<AgentLoopSuggestion[]> {
  const directory = input.directory.trim();
  if (!directory) {
    return [];
  }

  const suggestions: AgentLoopSuggestion[] = [];
  const agent = input.agent ?? "claude";
  const packageJson = await readJsonFile(join(directory, "package.json"));
  const hasCi = await pathExists(join(directory, ".github", "workflows"));
  const hasDocs = await pathExists(join(directory, "docs")) || await pathExists(join(directory, "README.md"));
  const hasDocker = await pathExists(join(directory, "Dockerfile")) || await pathExists(join(directory, "docker-compose.yml")) || await pathExists(join(directory, "docker-compose.yaml"));
  const hasGit = await pathExists(join(directory, ".git"));

  if (hasCi) {
    suggestions.push(buildSuggestion({
      key: "ci-watchdog",
      name: "CI Watchdog",
      description: "Wake on CI signals and keep the main branch healthy.",
      rationale: "Detected GitHub Actions workflow files.",
      directory,
      intervalMs: 10 * 60_000,
      agent,
      fileWatchEnabled: true,
      githubBridgeEnabled: true,
      ciBridgeEnabled: true,
      eventSourceAllowlist: ["github-webhook", "ci-webhook", "ci-workflow", "ci-check", "file-watch"],
      eventKeywordFilters: ["ci", "workflow", "test", "flake"],
      goal: "Keep CI healthy without waiting for manual checks.",
      currentFocus: "Watch workflow failures and triage the highest-signal breakages.",
      workingMemory: "Use event-triggered wakeups for failed workflow runs and preserve the active investigation path.",
      lastReflectionSummary: "Start by correlating recent CI failures with the latest code changes.",
      maxConsecutiveFailures: 3,
      retryBackoffMs: 5 * 60_000,
      prompt: "Continuously inspect CI outcomes, triage failures, correlate them with recent changes, and take the highest-value next maintenance action. Update loop memory before ending each run.",
      tags: ["ci", "quality", "autonomy"],
      confidence: "high",
    }, existingLoops));
  }

  if (packageJson) {
    const packageManager = typeof packageJson.packageManager === "string" ? packageJson.packageManager : undefined;
    suggestions.push(buildSuggestion({
      key: "dependency-hygiene",
      name: "Dependency Hygiene",
      description: "Track dependency drift, lockfile churn, and maintenance opportunities.",
      rationale: `Detected package.json${packageManager ? ` (${packageManager})` : ""}.`,
      directory,
      intervalMs: 24 * 60 * 60_000,
      agent,
      goal: "Keep dependencies healthy and reduce surprise breakage.",
      currentFocus: "Watch for risky dependency drift and recurring lockfile churn.",
      workingMemory: "Capture which packages are unstable, blocked upgrades, and test impact from previous updates.",
      lastReflectionSummary: "Start with the highest-risk or highest-churn dependency surfaces.",
      prompt: "Review package metadata, dependency churn, and recent maintenance signals. Identify the next dependency hygiene task worth doing, and keep the memory file updated with blockers and planned follow-ups.",
      tags: ["dependencies", "maintenance"],
      confidence: "medium",
    }, existingLoops));
  }

  if (hasDocs) {
    suggestions.push(buildSuggestion({
      key: "docs-drift",
      name: "Docs Drift",
      description: "Continuously detect documentation drift against the codebase.",
      rationale: "Detected repository docs surface (docs/ or README.md).",
      directory,
      intervalMs: 12 * 60 * 60_000,
      agent,
      goal: "Keep operator and contributor docs aligned with the real system.",
      currentFocus: "Find the highest-impact stale docs and usage guides.",
      workingMemory: "Track recurring stale areas, missing setup notes, and docs that block onboarding.",
      lastReflectionSummary: "Begin with recent code changes that likely invalidated docs.",
      prompt: "Inspect recent project changes and compare them to docs. Identify stale instructions, missing caveats, or high-value documentation updates, then update loop memory with what changed and what remains.",
      tags: ["docs", "quality"],
      confidence: "medium",
    }, existingLoops));
  }

  if (hasDocker) {
    suggestions.push(buildSuggestion({
      key: "runtime-smoke",
      name: "Runtime Smoke",
      description: "Watch deployment/runtime surfaces and prepare the next smoke validation step.",
      rationale: "Detected container/runtime descriptors.",
      directory,
      intervalMs: 6 * 60 * 60_000,
      agent,
      goal: "Maintain confidence that the packaged runtime still behaves as expected.",
      currentFocus: "Check the most failure-prone runtime surface first.",
      workingMemory: "Record unstable startup paths, missing env vars, and unresolved runtime regressions.",
      lastReflectionSummary: "Start from the last known runtime regression or risky infrastructure change.",
      maxConsecutiveFailures: 2,
      retryBackoffMs: 30 * 60_000,
      prompt: "Review container/runtime descriptors, recent infra changes, and smoke-test signals. Decide the next runtime validation or hardening action that reduces deployment risk, then update loop memory.",
      tags: ["runtime", "smoke", "deployment"],
      confidence: "medium",
    }, existingLoops));
  }

  if (hasGit) {
    suggestions.push(buildSuggestion({
      key: "project-guardian",
      name: "Project Guardian",
      description: "Maintain a broad project-health watchtower loop.",
      rationale: "Detected a Git repository; this is a generic health-maintenance baseline.",
      directory,
      intervalMs: 4 * 60 * 60_000,
      agent,
      fileWatchEnabled: true,
      githubBridgeEnabled: true,
      ciBridgeEnabled: true,
      eventSourceAllowlist: ["github-webhook", "ci-webhook", "ci-workflow", "ci-check", "file-watch"],
      goal: "Maintain overall project health proactively.",
      currentFocus: "Scan for the highest-leverage issue across CI, docs, and maintenance.",
      workingMemory: "Track cross-cutting risks, recurring friction, and opportunities worth revisiting later.",
      lastReflectionSummary: "Start with the single most leveraged maintenance frontier.",
      maxConsecutiveFailures: 3,
      retryBackoffMs: 10 * 60_000,
      prompt: "Act as a broad project-health guardian: scan the repo, maintenance surfaces, CI signals, and docs drift, then take or propose the single best next action. Keep your memory current for the next wakeup.",
      tags: ["guardian", "health", "autonomy"],
      confidence: hasCi ? "medium" : "high",
    }, existingLoops));
  }

  return suggestions.sort((a, b) => {
    if (a.alreadyConfigured !== b.alreadyConfigured) {
      return a.alreadyConfigured ? 1 : -1;
    }
    const confidenceOrder = { high: 0, medium: 1 } as const;
    const byConfidence = confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
    if (byConfidence !== 0) {
      return byConfidence;
    }
    return a.name.localeCompare(b.name);
  });
}

export function suggestionToCreateInput(
  suggestion: AgentLoopSuggestion,
  overrides: Pick<AgentLoopCreateInput, "projectId" | "profileId" | "runNow"> = {},
): AgentLoopCreateInput {
  return {
    name: suggestion.name,
    prompt: suggestion.prompt,
    directory: suggestion.directory,
    intervalMs: suggestion.intervalMs,
    agent: suggestion.agent,
    fileWatchEnabled: suggestion.fileWatchEnabled,
    githubBridgeEnabled: suggestion.githubBridgeEnabled,
    goal: suggestion.goal,
    currentFocus: suggestion.currentFocus,
    maxConsecutiveFailures: suggestion.maxConsecutiveFailures,
    retryBackoffMs: suggestion.retryBackoffMs,
    workingMemory: suggestion.workingMemory,
    lastReflectionSummary: suggestion.lastReflectionSummary,
    projectId: overrides.projectId,
    profileId: overrides.profileId,
    runNow: overrides.runNow,
  };
}
