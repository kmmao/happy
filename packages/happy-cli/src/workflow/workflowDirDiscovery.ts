/**
 * Helpers for locating the Claude Code Workflow runtime's per-run directory
 * on disk. The runtime persists state under
 *   ~/.claude/projects/<encodedCwd>/<sessionId>/subagents/workflows/wf_<id>/
 *
 * `encodedCwd` mirrors the Claude SDK convention: replace each path
 * separator with `-`. So `/Users/foo/proj` becomes `-Users-foo-proj`.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export function encodeCwd(cwd: string): string {
  return cwd.replace(/[/\\]/g, "-");
}

export function getWorkflowsRoot(sessionId: string, cwd: string): string {
  return path.join(
    os.homedir(),
    ".claude",
    "projects",
    encodeCwd(cwd),
    sessionId,
    "subagents",
    "workflows",
  );
}

/**
 * Return the most recently modified `wf_*` sub-directory whose mtime is at
 * or after `startedAfterMs` (minus a small clock-skew grace window).
 *
 * Used right after a `task_started` SDK event with `task_type ===
 * "local_workflow"` to recover the workflow runtime's wf_<id> identifier —
 * the SDK message itself only carries the background-task id, not the
 * workflow run id.
 *
 * Returns null when the workflows root doesn't exist yet (workflow runtime
 * hadn't initialised by the time we scanned) or no qualifying directory is
 * present. The caller falls back to using the task_id as the run id and
 * skips agent-level event tracking.
 */
export function findRecentRunDir(
  workflowsRoot: string,
  startedAfterMs: number,
): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(workflowsRoot);
  } catch {
    return null;
  }
  const grace = 2_000;
  let best: { path: string; mtime: number } | null = null;
  for (const entry of entries) {
    if (!entry.startsWith("wf_")) continue;
    const full = path.join(workflowsRoot, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (stat.mtimeMs < startedAfterMs - grace) continue;
    if (!best || stat.mtimeMs > best.mtime) {
      best = { path: full, mtime: stat.mtimeMs };
    }
  }
  return best?.path ?? null;
}

export function extractRunId(runDir: string): string {
  return path.basename(runDir);
}
