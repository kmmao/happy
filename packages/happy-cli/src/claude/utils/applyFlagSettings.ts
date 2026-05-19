/**
 * applyFlagSettings — unified entry point for hot-swapping SDK Settings-layer
 * fields on a running Query.
 *
 * Two callers share this:
 *
 * 1. **claudeRemote.ts (internal hot-swap)**: when EnhancedMode changes between
 *    turns, `buildFlagSettingsPatch(prev, next)` produces a diff, then
 *    `applyFlagSettings()` pushes it to the SDK.
 *
 * 2. **RPC handler (apply_settings)**: the App sends an explicit Settings patch
 *    via the `apply_settings` RPC; after `parseAndValidateSettings()`, this
 *    function pushes it to the SDK.
 *
 * ## Responsibilities
 *
 * - Validate the patch via `parseAndValidateSettings` (whitelist + type checks)
 * - Skip the SDK call when the patch is empty
 * - Call `Query.applyFlagSettings()` with the validated patch
 * - Track applied settings in `AppliedSettingsState` for introspection
 * - Log success/failure, always return a result (never throw)
 *
 * ## State tracking
 *
 * `AppliedSettingsState` accumulates a shallow merge of every successful patch.
 * The RPC handler for `get_context_usage` or future endpoints can read this
 * state to know what's currently in the flag layer. Clearing happens on cold
 * restart (launcher creates a fresh state per process).
 */

import type { Query as OfficialQuery } from "@anthropic-ai/claude-agent-sdk";
import type { EnhancedMode } from "@/claude/loop";
import { buildFlagSettingsPatch, describePatch } from "./flagSettingsPatch";
import { parseAndValidateSettings } from "./settingsParser";
import { logger } from "@/lib";

// ─── State tracking ───────────────────────────────────────────────────────────

/** Accumulated flag-layer settings state for introspection. */
export interface AppliedSettingsState {
  /** Shallow merge of all successfully applied patches (latest wins per key). */
  current: Record<string, unknown>;
  /** Number of successful applyFlagSettings calls. */
  applyCount: number;
  /** Timestamp of last successful apply. */
  lastAppliedAt: number | null;
}

export function createAppliedSettingsState(): AppliedSettingsState {
  return {
    current: {},
    applyCount: 0,
    lastAppliedAt: null,
  };
}

// ─── Result type ──────────────────────────────────────────────────────────────

export type ApplyResult =
  | { applied: true; keys: string[] }
  | { applied: false; reason: "empty" | "validation_error" | "sdk_error"; error?: string };

// ─── Core function ────────────────────────────────────────────────────────────

/**
 * Apply a raw settings patch to a running SDK Query.
 *
 * Validates input → skips empty → calls SDK → tracks state → returns result.
 * Never throws — all errors are captured in the result.
 *
 * @param query - The active SDK Query instance
 * @param rawSettings - Raw settings object (from RPC or buildFlagSettingsPatch)
 * @param state - Mutable state tracker (accumulated per process lifetime)
 */
export async function applyFlagSettings(
  query: OfficialQuery,
  rawSettings: Record<string, unknown>,
  state: AppliedSettingsState,
): Promise<ApplyResult> {
  // ── Validate ──
  const parsed = parseAndValidateSettings(rawSettings);
  if (!parsed.ok) {
    logger.debug(`[applyFlagSettings] Validation failed: ${parsed.error}`);
    return { applied: false, reason: "validation_error", error: parsed.error };
  }

  const settings = parsed.settings;
  const keys = Object.keys(settings);

  // ── Skip empty ──
  if (keys.length === 0) {
    logger.debug("[applyFlagSettings] Empty patch, skipping");
    return { applied: false, reason: "empty" };
  }

  // ── Apply to SDK ──
  try {
    await query.applyFlagSettings(settings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`[applyFlagSettings] SDK call failed: ${msg}`);
    return { applied: false, reason: "sdk_error", error: msg };
  }

  // ── Track state ──
  for (const key of keys) {
    if (settings[key] === null) {
      delete state.current[key];
    } else {
      state.current[key] = settings[key];
    }
  }
  state.applyCount++;
  state.lastAppliedAt = Date.now();

  logger.debug(
    `[applyFlagSettings] Applied: ${keys.join(",")} (total applies: ${state.applyCount})`,
  );
  return { applied: true, keys };
}

// ─── Convenience: from EnhancedMode diff ──────────────────────────────────────

/**
 * Build a patch from EnhancedMode diff and apply it.
 * Returns `{ applied: false, reason: "empty" }` when modes produce no
 * Settings-level diff.
 */
export async function applyFlagSettingsFromModeDiff(
  query: OfficialQuery,
  prev: EnhancedMode,
  next: EnhancedMode,
  state: AppliedSettingsState,
): Promise<ApplyResult> {
  const patch = buildFlagSettingsPatch(prev, next);
  if (!patch) {
    return { applied: false, reason: "empty" };
  }

  logger.debug(
    `[applyFlagSettings] Mode diff patch: ${describePatch(patch)}`,
  );

  // buildFlagSettingsPatch returns a typed FlagSettingsPatch which is a subset
  // of Settings — skip re-validation (it's already structurally correct).
  const settings = patch as Record<string, unknown>;
  const keys = Object.keys(settings);

  try {
    await query.applyFlagSettings(settings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`[applyFlagSettings] SDK call failed (mode diff): ${msg}`);
    return { applied: false, reason: "sdk_error", error: msg };
  }

  // Track state
  for (const key of keys) {
    if (settings[key] === null) {
      delete state.current[key];
    } else {
      state.current[key] = settings[key];
    }
  }
  state.applyCount++;
  state.lastAppliedAt = Date.now();

  return { applied: true, keys };
}
