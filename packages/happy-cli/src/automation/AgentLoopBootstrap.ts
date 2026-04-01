import { access, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { constants as fsConstants } from "node:fs";
import type { AgentLoopDefinition } from "./AgentLoopStore";
import {
  suggestAgentLoops,
  type AgentLoopSuggestInput,
  type AgentLoopSuggestion,
} from "./AgentLoopSuggestion";

export interface DiscoveredGitRepo {
  directory: string;
  name: string;
}

export interface DiscoverLocalGitReposOptions {
  root: string;
  maxDepth?: number;
  limit?: number;
}

export interface AgentLoopBootstrapRepoPlan {
  repo: DiscoveredGitRepo;
  suggestions: AgentLoopSuggestion[];
}

const DEFAULT_IGNORE_DIRS = new Set([
  ".git",
  ".happy",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".pnpm-store",
]);

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function discoverLocalGitRepos(
  options: DiscoverLocalGitReposOptions,
): Promise<DiscoveredGitRepo[]> {
  const root = resolve(options.root);
  const maxDepth = Math.max(0, options.maxDepth ?? 4);
  const limit = Math.max(1, options.limit ?? 25);
  const results: DiscoveredGitRepo[] = [];
  const visited = new Set<string>();

  async function walk(directory: string, depth: number): Promise<void> {
    if (results.length >= limit || visited.has(directory)) {
      return;
    }
    visited.add(directory);

    if (await pathExists(join(directory, ".git"))) {
      results.push({ directory, name: basename(directory) || directory });
      return;
    }

    if (depth >= maxDepth) {
      return;
    }

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= limit) {
        return;
      }
      if (!entry.isDirectory()) {
        continue;
      }
      if (DEFAULT_IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      if (entry.name.startsWith(".")) {
        continue;
      }
      await walk(join(directory, entry.name), depth + 1);
    }
  }

  await walk(root, 0);
  return results.sort((a, b) => a.directory.localeCompare(b.directory));
}

export async function buildAgentLoopBootstrapPlan(input: {
  root: string;
  maxDepth?: number;
  limit?: number;
  suggestInput?: Omit<AgentLoopSuggestInput, "directory">;
  existingLoops?: AgentLoopDefinition[];
}): Promise<AgentLoopBootstrapRepoPlan[]> {
  const repos = await discoverLocalGitRepos({
    root: input.root,
    maxDepth: input.maxDepth,
    limit: input.limit,
  });
  const existingLoops = input.existingLoops ?? [];
  const plans: AgentLoopBootstrapRepoPlan[] = [];

  for (const repo of repos) {
    const suggestions = await suggestAgentLoops(
      {
        directory: repo.directory,
        agent: input.suggestInput?.agent,
        projectId: input.suggestInput?.projectId,
        profileId: input.suggestInput?.profileId,
      },
      existingLoops,
    );
    if (suggestions.length === 0) {
      continue;
    }
    plans.push({ repo, suggestions });
  }

  return plans;
}
