import { exec } from "child_process";
import { promisify } from "util";
import { run as runRipgrep } from "@/modules/ripgrep/index";
import { logger } from "@/ui/logger";

const execAsync = promisify(exec);

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "__pycache__", ".venv", "venv", "coverage", ".coverage",
  "target", "vendor", ".cache", ".parcel-cache",
]);

const MAX_FILES = 2000;
const MAX_SYMBOLS = 30;
const MAX_CONTENT_LENGTH = 8000;

export interface RepoMapResult {
  success: boolean;
  content: string;
  affectedFiles: string[];
  error?: string;
}

export interface RepoMapSubmitResult {
  submitted: boolean;
  skipped?: boolean;
  reason?: string;
  entryId?: string;
}

/**
 * Build a compact directory tree from a list of relative file paths.
 * Groups files by top-level directory with file count and extension summary.
 */
function buildCompactTree(files: string[]): string {
  const lines: string[] = [];
  const dirGroups = new Map<string, string[]>();
  const rootFiles: string[] = [];

  for (const file of files) {
    const slashIdx = file.indexOf("/");
    if (slashIdx === -1) {
      rootFiles.push(file);
    } else {
      const dir = file.slice(0, slashIdx);
      if (!dirGroups.has(dir)) dirGroups.set(dir, []);
      dirGroups.get(dir)!.push(file);
    }
  }

  const sortedDirs = [...dirGroups.entries()]
    .filter(([dir]) => !IGNORED_DIRS.has(dir))
    .sort((a, b) => a[0].localeCompare(b[0]));

  for (const [dir, dirFiles] of sortedDirs) {
    const extCount = new Map<string, number>();
    for (const f of dirFiles) {
      const ext = f.split(".").pop()?.toLowerCase() ?? "?";
      extCount.set(ext, (extCount.get(ext) ?? 0) + 1);
    }
    const topExts = [...extCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([e]) => e)
      .join("/");

    lines.push(`${dir}/ (${dirFiles.length} files, ${topExts})`);

    // Show second-level subdirs
    const subDirs = new Map<string, number>();
    for (const f of dirFiles) {
      const parts = f.split("/");
      if (parts.length > 2) {
        const subDir = parts[1];
        if (!IGNORED_DIRS.has(subDir)) {
          subDirs.set(subDir, (subDirs.get(subDir) ?? 0) + 1);
        }
      }
    }
    const topSubDirs = [...subDirs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    if (topSubDirs.length > 0) {
      lines.push(`  └─ ${topSubDirs.map(([d, c]) => `${d}/(${c})`).join(", ")}`);
    }
  }

  if (rootFiles.length > 0) {
    lines.push(`[root] ${rootFiles.slice(0, 10).join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Extract key exports from TypeScript/JavaScript source files using ripgrep.
 */
async function extractKeyExports(cwd: string): Promise<string> {
  try {
    const result = await runRipgrep([
      "--type", "ts",
      "-n",
      "--no-heading",
      "-m", "3",
      "^export (default |async |function |class |interface |type |const |enum )",
      ".",
    ], { cwd });

    if (result.exitCode !== 0 || !result.stdout.trim()) return "";

    const byFile = new Map<string, string[]>();
    const lines = result.stdout.trim().split("\n").slice(0, MAX_SYMBOLS * 3);

    for (const line of lines) {
      const match = line.match(
        /^([^:]+):\d+:export\s+(?:default\s+)?(?:async\s+)?(?:function\s+|class\s+|interface\s+|type\s+|const\s+|enum\s+)(\w+)/,
      );
      if (match) {
        const [, file, name] = match;
        if (!byFile.has(file)) byFile.set(file, []);
        const names = byFile.get(file)!;
        if (names.length < 5) names.push(name);
      }
    }

    return [...byFile.entries()]
      .slice(0, 15)
      .map(([f, names]) => `${f}: ${names.join(", ")}`)
      .join("\n");
  } catch (err) {
    logger.debug(`[repo-map] extractKeyExports failed: ${err}`);
    return "";
  }
}

/**
 * Generate a compact repo map for the given working directory.
 * Uses git ls-files for tracked file list and ripgrep for key exports.
 */
export async function generateRepoMap(workingDir: string): Promise<RepoMapResult> {
  try {
    let files: string[] = [];
    try {
      const { stdout } = await execAsync(
        "git ls-files --cached --others --exclude-standard 2>/dev/null",
        { cwd: workingDir, maxBuffer: 4 * 1024 * 1024 },
      );
      files = stdout.trim().split("\n").filter(Boolean).slice(0, MAX_FILES);
    } catch {
      logger.debug("[repo-map] git ls-files failed, using find fallback");
    }

    if (files.length === 0) {
      const { stdout } = await execAsync(
        "find . -type f -not -path '*/.git/*' -not -path '*/node_modules/*' 2>/dev/null | head -500",
        { cwd: workingDir, maxBuffer: 1024 * 1024 },
      );
      files = stdout.trim().split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""));
    }

    const tree = buildCompactTree(files);
    const exports = await extractKeyExports(workingDir);

    const parts: string[] = [
      `## Project Structure (${files.length} tracked files)`,
      "",
      tree,
    ];

    if (exports) {
      parts.push("", "## Key Exports", "", exports);
    }

    const content = parts.join("\n").slice(0, MAX_CONTENT_LENGTH);
    const affectedFiles = files.slice(0, 50);

    return { success: true, content, affectedFiles };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.debug(`[repo-map] generateRepoMap failed: ${message}`);
    return { success: false, content: "", affectedFiles: [], error: message };
  }
}

/**
 * Check if the project already has an active repo_map entry.
 */
async function hasRecentRepoMap(
  serverUrl: string,
  authToken: string,
  projectId: string,
): Promise<boolean> {
  try {
    const resp = await fetch(
      `${serverUrl}/v1/projects/${projectId}/knowledge?entryType=repo_map&limit=1`,
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    if (!resp.ok) return false;
    const data = (await resp.json()) as { total: number };
    return data.total > 0;
  } catch {
    return false;
  }
}

/**
 * Generate a repo map and submit it to the knowledge base.
 * Skips silently if a recent entry already exists (unless force=true).
 */
export async function generateAndSubmitRepoMap(
  workingDir: string,
  serverUrl: string,
  authToken: string,
  projectId: string,
  sessionId?: string,
  force = false,
): Promise<RepoMapSubmitResult> {
  try {
    if (!force) {
      const recent = await hasRecentRepoMap(serverUrl, authToken, projectId);
      if (recent) {
        logger.debug("[repo-map] recent repo_map exists, skipping");
        return { submitted: false, skipped: true, reason: "recent repo_map exists" };
      }
    }

    const result = await generateRepoMap(workingDir);
    if (!result.success) {
      logger.debug(`[repo-map] generation failed: ${result.error}`);
      return { submitted: false, reason: result.error };
    }

    const dirName = workingDir.split("/").filter(Boolean).pop() ?? "project";

    const body = {
      entryType: "repo_map",
      contributorType: "session",
      action: "create",
      title: `Repo Map: ${dirName}`,
      content: result.content,
      tags: ["repo-map", "codebase-structure"],
      confidence: "high",
      sessionId,
      affectedFiles: result.affectedFiles,
    };

    const resp = await fetch(`${serverUrl}/v1/projects/${projectId}/knowledge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown");
      logger.debug(`[repo-map] server rejected: ${resp.status} ${errText}`);
      return { submitted: false, reason: `server ${resp.status}: ${errText}` };
    }

    const data = (await resp.json()) as { action: string; entry?: { id: string } };
    logger.debug(`[repo-map] submitted, action=${data.action} id=${data.entry?.id}`);
    return { submitted: true, entryId: data.entry?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.debug(`[repo-map] generateAndSubmitRepoMap error: ${message}`);
    return { submitted: false, reason: message };
  }
}
