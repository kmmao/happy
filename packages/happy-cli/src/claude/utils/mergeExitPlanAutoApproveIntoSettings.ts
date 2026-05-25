/**
 * mergeExitPlanAutoApproveIntoSettings — patch the temporary `--settings <path>`
 * JSON to inject (or remove) a `PreToolUse` hook that auto-approves
 * `ExitPlanMode` in remote/Yolo sessions.
 *
 * Why a hook instead of a keystroke
 * ---------------------------------
 * Claude TUI renders an interactive "Ready to code?" picker for ExitPlanMode
 * even under `--dangerously-skip-permissions` (bypassPermissions is NOT one of
 * the conditions that flip the tool's own `checkPermissions` to "allow" — only
 * an in-process subagent async-context is; verified against the 2.1.150
 * binary). The picker embeds a free-text input, so Happy's old "blind write
 * '1\r'" approach landed the digit in that text field and REJECTED the plan
 * ("The user doesn't want to proceed" → "[Request interrupted by user for tool
 * use]"). A `PreToolUse` allow-hook bypasses the picker deterministically,
 * independent of render timing or ANSI layout.
 *
 * Critical detail (see scripts/exit_plan_auto_approve.cjs): ExitPlanMode is a
 * `requiresUserInteraction()` tool, so the binary's hook pipeline only skips
 * the picker when the allow decision ALSO carries `updatedInput`. The script
 * handles that; this module just wires the script into settings.
 *
 * Why in-place patch
 * ------------------
 * Mirrors `mergeThinkingIntoSettings`: `generateHookSettings.ts` writes a
 * stable, mode-independent file at boot (SessionStart / StopFailure hooks).
 * ExitPlanMode auto-approve, by contrast, is gated on the per-spawn
 * `planModeLockdown` flag, which toggles across cold restarts. Mutating the
 * same `--settings <path>` file keeps it the single source of truth.
 *
 * Idempotent: we strip any previously-injected entry (identified by the script
 * filename in its command) before optionally re-adding, so repeated cold
 * restarts and enable→disable transitions converge cleanly without leaving
 * stale or duplicate hooks. Other PreToolUse entries the user may have are
 * preserved untouched.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { projectPath } from "@/projectPath";
import { logger } from "@/ui/logger";

/** Filename of the hook script, also used as the identity marker for the
 * injected entry so we can find/remove it idempotently. */
export const EXIT_PLAN_HOOK_SCRIPT = "exit_plan_auto_approve.cjs";

/** Absolute `node "<script>"` command written into the settings hook entry. */
export function exitPlanHookCommand(): string {
  const script = resolve(projectPath(), "scripts", EXIT_PLAN_HOOK_SCRIPT);
  return `node "${script}"`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** True if this PreToolUse entry is one we previously injected. */
function entryIsOurs(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some(
    (h) =>
      isRecord(h) &&
      typeof h.command === "string" &&
      h.command.includes(EXIT_PLAN_HOOK_SCRIPT),
  );
}

/**
 * Build the settings object with the ExitPlanMode auto-approve hook added
 * (`enabled=true`) or removed (`enabled=false`). Exposed for tests so the
 * merge logic can be asserted without filesystem round-trips.
 */
export function buildExitPlanAutoApproveSettings(
  current: Record<string, unknown>,
  enabled: boolean,
): Record<string, unknown> {
  const hooks = isRecord(current.hooks) ? { ...current.hooks } : {};

  const existingPre = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  // Drop any prior injection of ours; preserve unrelated PreToolUse entries.
  const others = existingPre.filter((entry) => !entryIsOurs(entry));

  if (enabled) {
    others.push({
      matcher: "ExitPlanMode",
      hooks: [{ type: "command", command: exitPlanHookCommand() }],
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
 * Apply the ExitPlanMode auto-approve patch to the settings JSON at
 * `filepath`. Safe to call repeatedly across cold restarts; errors are
 * swallowed at debug level so a malformed settings file never crashes session
 * bootstrap (Claude TUI warns on its own if the JSON it reads is invalid).
 */
export function mergeExitPlanAutoApproveIntoSettings(
  filepath: string,
  enabled: boolean,
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

    const patched = buildExitPlanAutoApproveSettings(current, enabled);
    writeFileSync(filepath, JSON.stringify(patched, null, 2));
    logger.debug(
      `[mergeExitPlanAutoApprove] ${enabled ? "enabled" : "disabled"} ExitPlanMode auto-approve in ${filepath}`,
    );
  } catch (error) {
    logger.debug(
      `[mergeExitPlanAutoApprove] Failed to patch ${filepath}: ${error}`,
    );
  }
}
