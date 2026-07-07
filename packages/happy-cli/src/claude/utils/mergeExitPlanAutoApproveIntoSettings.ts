/**
 * mergeExitPlanAutoApproveIntoSettings — patch the temporary `--settings <path>`
 * JSON to inject (or remove) a `PreToolUse` hook for `ExitPlanMode` on
 * remote/Yolo sessions.
 *
 * Two hook scripts, one injection surface
 * ---------------------------------------
 * Two scripts can occupy the same settings slot; only one is active at a
 * time (`mode` picks):
 *
 *   1. `exit_plan_auto_approve.cjs` — the classic auto-approve. Emits
 *      `permissionDecision: "allow"` immediately so the TUI skips its
 *      "Ready to code?" picker without human input. Used when
 *      `HAPPY_YOLO_EXIT_PLAN_AUTO_APPROVE=1` (agent_loop / CI /
 *      unattended mode).
 *
 *   2. `exit_plan_approval_forwarder.cjs` — the new blocking bridge.
 *      Forwards the PreToolUse payload to Happy's local `hookServer`
 *      and BLOCKS on the response, which the App user drives via the
 *      permission picker. Default under Yolo, and the whole point of
 *      the plan-mode 429 mitigation.
 *
 * Both are `requiresUserInteraction` tools from Claude's perspective:
 * `permissionDecision: "allow"` MUST be paired with `updatedInput` to
 * bypass the picker (verified against the 2.1.150 binary). Each script
 * handles that concern; this module just wires ONE script per session.
 *
 * Why in-place patch
 * ------------------
 * Mirrors `mergeThinkingIntoSettings`: `generateHookSettings.ts` writes a
 * stable, mode-independent file at boot (SessionStart / StopFailure hooks).
 * ExitPlanMode auto-approve, by contrast, is gated on the per-spawn
 * `planModeLockdown` flag, which toggles across cold restarts. Mutating the
 * same `--settings <path>` file keeps it the single source of truth.
 *
 * Idempotent: we strip any previously-injected entry (identified by EITHER
 * script filename in its command) before optionally re-adding, so repeated
 * cold restarts, opt-in/opt-out toggles, and enable→disable transitions
 * converge cleanly without leaving stale or duplicate hooks. Other
 * PreToolUse entries the user may have are preserved untouched.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { projectPath } from "@/projectPath";
import { logger } from "@/ui/logger";

/** Filename of the classic auto-approve script. Kept exported for tests
 * and for cross-file references (see `runClaude.ts` / launcher branch). */
export const EXIT_PLAN_HOOK_SCRIPT = "exit_plan_auto_approve.cjs";

/** Filename of the new blocking bridge that surfaces plans through the
 * App picker. Also exported for tests and hookServer wiring. */
export const EXIT_PLAN_APPROVAL_FORWARDER_SCRIPT =
  "exit_plan_approval_forwarder.cjs";

/**
 * Injection variants for the `PreToolUse` slot.
 *   - `"none"`        — strip any prior entry, leave slot empty
 *   - `"auto-approve"`— inject the classic auto-approve script
 *   - `"app-picker"`  — inject the blocking bridge to the App picker
 *
 * A single enum-shaped string keeps callers explicit about intent —
 * `mergeExitPlanAutoApproveIntoSettings(path, true)` would silently
 * pick the wrong script if we later flipped the default.
 */
export type ExitPlanHookMode = "none" | "auto-approve" | "app-picker";

function scriptForMode(mode: ExitPlanHookMode): string | null {
  switch (mode) {
    case "auto-approve":
      return EXIT_PLAN_HOOK_SCRIPT;
    case "app-picker":
      return EXIT_PLAN_APPROVAL_FORWARDER_SCRIPT;
    case "none":
      return null;
  }
}

/**
 * Absolute `command` + `args` written into the settings hook entry for
 * `mode`. The `app-picker` variant needs the hookServer port as an extra
 * argv so the forwarder knows where to POST — hence a struct return
 * rather than a bare string.
 *
 * Uses Claude Code 2.1.139+ exec form (`{command, args}`) — the runtime
 * runs `execvp(command, args)` directly, so path spaces / metachars
 * cannot smuggle shell commands.
 */
export function exitPlanHookEntry(
  mode: Exclude<ExitPlanHookMode, "none">,
  hookServerPort: number,
): { type: "command"; command: string; args: string[] } {
  const scriptName = scriptForMode(mode)!;
  const script = resolve(projectPath(), "scripts", scriptName);
  // The classic auto-approve script takes no argv; the forwarder takes
  // the hookServer port. Passing the port unconditionally would break
  // the classic script's `process.argv[2] === undefined` fast path.
  const args =
    mode === "app-picker" ? [script, String(hookServerPort)] : [script];
  return { type: "command", command: "node", args };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * True if this PreToolUse entry is one we previously injected — matches
 * both script names so a mode toggle strips the stale entry before
 * appending the new one. Detection scans `command` AND the `args` array
 * because the 2.1.139+ exec form puts the script path in `args`, not
 * `command`.
 */
function entryIsOurs(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((h) => {
    if (!isRecord(h)) return false;
    const commandStr = typeof h.command === "string" ? h.command : "";
    const argsArr = Array.isArray(h.args) ? h.args : [];
    const argsStr = argsArr
      .filter((a): a is string => typeof a === "string")
      .join(" ");
    const haystack = `${commandStr} ${argsStr}`;
    return (
      haystack.includes(EXIT_PLAN_HOOK_SCRIPT) ||
      haystack.includes(EXIT_PLAN_APPROVAL_FORWARDER_SCRIPT)
    );
  });
}

/**
 * Build the settings object with the ExitPlanMode hook set to `mode`.
 * Exposed for tests so the merge logic can be asserted without
 * filesystem round-trips.
 */
export function buildExitPlanAutoApproveSettings(
  current: Record<string, unknown>,
  mode: ExitPlanHookMode,
  hookServerPort: number,
): Record<string, unknown> {
  const hooks = isRecord(current.hooks) ? { ...current.hooks } : {};

  const existingPre = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  // Drop any prior injection of ours; preserve unrelated PreToolUse entries.
  const others = existingPre.filter((entry) => !entryIsOurs(entry));

  if (mode !== "none") {
    others.push({
      matcher: "ExitPlanMode",
      hooks: [exitPlanHookEntry(mode, hookServerPort)],
    });
  }

  if (others.length > 0) {
    hooks.PreToolUse = others;
  } else {
    delete hooks.PreToolUse;
  }

  return { ...current, hooks };
}

/**
 * Apply the ExitPlanMode hook patch to the settings JSON at `filepath`.
 * Safe to call repeatedly across cold restarts; errors are swallowed at
 * debug level so a malformed settings file never crashes session
 * bootstrap (Claude TUI warns on its own if the JSON it reads is
 * invalid).
 */
export function mergeExitPlanAutoApproveIntoSettings(
  filepath: string,
  mode: ExitPlanHookMode,
  hookServerPort: number,
): void {
  try {
    let current: Record<string, unknown> = {};
    if (existsSync(filepath)) {
      const raw = readFileSync(filepath, "utf-8");
      if (raw.trim()) {
        const parsed = JSON.parse(raw);
        if (isRecord(parsed)) current = parsed;
      }
    }

    const patched = buildExitPlanAutoApproveSettings(current, mode, hookServerPort);
    writeFileSync(filepath, JSON.stringify(patched, null, 2));
    logger.debug(
      `[mergeExitPlanAutoApprove] set ExitPlanMode hook to "${mode}" in ${filepath}`,
    );
  } catch (error) {
    logger.debug(
      `[mergeExitPlanAutoApprove] Failed to patch ${filepath}: ${error}`,
    );
  }
}
