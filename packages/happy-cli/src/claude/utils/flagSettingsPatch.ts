/**
 * flagSettingsPatch — builds a partial SDK Settings object from the diff
 * between two EnhancedMode snapshots.
 *
 * The SDK's `Query.applyFlagSettings()` merges into the "flag settings" layer
 * (above user/project/local, below managed policy). This module maps
 * EnhancedMode field changes to their Settings-layer equivalents.
 *
 * ## Mapping rules
 *
 * | EnhancedMode field       | Settings path                       | Notes |
 * |--------------------------|-------------------------------------|-------|
 * | allowedTools             | permissions.allow                   |       |
 * | disallowedTools          | permissions.deny                    |       |
 * | model (via Settings)     | model                               | Also hot-swapped via setModel(); Settings layer is secondary |
 * | env (future)             | env                                 | Not yet in EnhancedMode |
 *
 * Fields that live in SDK `Options` (not `Settings`) cannot be hot-swapped
 * via applyFlagSettings: thinking, effort, maxBudgetUsd, taskBudget,
 * customSystemPrompt, appendSystemPrompt, betas, etc. These remain in
 * coldModeHash and require process restart.
 */

import type { EnhancedMode } from "@/claude/loop";
import { logger } from "@/lib";

/** Partial SDK Settings shape — only includes keys we know how to hot-swap. */
export interface FlagSettingsPatch {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  model?: string | null;
}

/**
 * Compare two EnhancedMode snapshots and produce a Settings patch for
 * `Query.applyFlagSettings()`. Returns `null` when nothing changed (the
 * caller should skip the SDK call entirely).
 *
 * @param prev - The mode active before this turn
 * @param next - The incoming mode for the new turn
 * @returns Partial Settings to merge, or null if no Settings-level diff
 */
export function buildFlagSettingsPatch(
  prev: EnhancedMode,
  next: EnhancedMode,
): FlagSettingsPatch | null {
  const patch: FlagSettingsPatch = {};
  let hasChange = false;

  // ── permissions.allow (allowedTools) ───────────────────────────────────
  const prevAllow = prev.allowedTools ?? [];
  const nextAllow = next.allowedTools ?? [];
  const allowChanged = !arraysEqual(prevAllow, nextAllow);

  // ── permissions.deny (disallowedTools) ────────────────────────────────
  const prevDeny = prev.disallowedTools ?? [];
  const nextDeny = next.disallowedTools ?? [];
  const denyChanged = !arraysEqual(prevDeny, nextDeny);

  if (allowChanged || denyChanged) {
    patch.permissions = {};
    if (allowChanged) patch.permissions.allow = nextAllow;
    if (denyChanged) patch.permissions.deny = nextDeny;
    hasChange = true;
  }

  // ── Future: add more Settings-level fields here as they become ────────
  // available in EnhancedMode. Examples:
  //   - env: would map to Settings.env
  //   - hooks: would map to Settings.hooks
  //   - enableAllProjectMcpServers: would map to Settings.enableAllProjectMcpServers

  if (!hasChange) return null;

  logger.debug(
    `[flagSettingsPatch] Built patch: ${describePatch(patch)}`,
  );
  return patch;
}

/**
 * Produce a human-readable summary of a FlagSettingsPatch for logging.
 */
export function describePatch(patch: FlagSettingsPatch): string {
  const parts: string[] = [];
  if (patch.permissions) {
    const sub: string[] = [];
    if (patch.permissions.allow) sub.push(`allow[${patch.permissions.allow.length}]`);
    if (patch.permissions.deny) sub.push(`deny[${patch.permissions.deny.length}]`);
    parts.push(`permissions(${sub.join(",")})`);
  }
  if (patch.model !== undefined) {
    parts.push(`model(${patch.model ?? "null"})`);
  }
  return parts.join(", ") || "(empty)";
}

// ─── Internals ─────────────────────────────────────────────────────────────

/** Shallow array equality for string arrays. Order-sensitive. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
