/**
 * mergeThinkingIntoSettings — patch the temporary `--settings <path>` JSON
 * to express the user's chosen thinking mode in Claude TUI's native vocabulary.
 *
 * Why a separate module?
 * ----------------------
 * `generateHookSettings.ts` writes a stable, mode-independent file at session
 * boot (just the SessionStart / StopFailure hook entries). Thinking mode, on
 * the other hand, is a per-spawn EnhancedMode field that can change across
 * cold restarts. Mutating the same file in-place keeps `--settings <path>` as
 * the single source of truth and avoids juggling multiple --settings layers.
 *
 * Mapping
 * -------
 *   thinking = undefined / null            → no fields written (default adaptive)
 *   thinking.type === "adaptive"           → no fields written (default adaptive)
 *   thinking.type === "enabled"            → alwaysThinkingEnabled: true
 *                                            env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1"
 *
 * "disabled" intentionally has no representation here: the App's `messageMeta`
 * resolver collapses disabled → null before the wire hop (so we never receive
 * it). Claude TUI also has no "force-off" knob, so this is faithful.
 *
 * The patch is additive: we read the existing JSON, overlay the thinking
 * keys (and merge the `env` sub-object so we don't drop unrelated env vars),
 * then write back. Missing files are tolerated — we treat them as `{}`.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { EnhancedMode } from "@/claude/loop";
import { logger } from "@/ui/logger";

/**
 * Apply a thinking-mode patch to the settings JSON at `filepath`.
 *
 * Safe to call repeatedly across cold restarts. Errors are swallowed and
 * logged at debug level — we never want a malformed settings file to crash
 * the session bootstrap (Claude TUI itself will warn loudly if the JSON it
 * eventually reads is invalid).
 */
export function mergeThinkingIntoSettings(
  filepath: string,
  thinking: EnhancedMode["thinking"] | undefined,
): void {
  // Adaptive (or absent) is the Claude TUI default. Nothing to do.
  const type =
    thinking && typeof thinking === "object"
      ? (thinking as { type?: unknown }).type
      : undefined;
  if (type !== "enabled") {
    return;
  }

  try {
    let current: Record<string, unknown> = {};
    if (existsSync(filepath)) {
      const raw = readFileSync(filepath, "utf-8");
      if (raw.trim()) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          current = parsed as Record<string, unknown>;
        }
      }
    }

    const existingEnv =
      current.env && typeof current.env === "object" && !Array.isArray(current.env)
        ? (current.env as Record<string, unknown>)
        : {};

    const patched: Record<string, unknown> = {
      ...current,
      alwaysThinkingEnabled: true,
      env: {
        ...existingEnv,
        CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1",
      },
    };

    writeFileSync(filepath, JSON.stringify(patched, null, 2));
    logger.debug(
      `[mergeThinkingIntoSettings] enabled thinking written to ${filepath}`,
    );
  } catch (error) {
    logger.debug(
      `[mergeThinkingIntoSettings] Failed to patch ${filepath}: ${error}`,
    );
  }
}
