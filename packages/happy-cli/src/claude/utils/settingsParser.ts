/**
 * settingsParser — validates and normalizes raw settings from the App RPC
 * `apply_settings` endpoint before passing to `Query.applyFlagSettings()`.
 *
 * ## Design
 *
 * Uses a whitelist approach: only explicitly allowed Settings keys pass through.
 * Each key has a type validator; unknown/blocked keys cause the entire request
 * to be rejected (fail-closed). This is a security boundary — the App sends
 * arbitrary JSON over an encrypted channel, and we must ensure nothing harmful
 * (e.g. hooks with shell commands) reaches the SDK.
 *
 * ## Blocked keys (security)
 *
 * - `hooks` — could inject arbitrary shell commands
 * - `skillOverrides` — could bypass skill security restrictions
 * - `disableBundledSkills` — could hide bundled skills/workflows from the model
 *   (claude-code 2.1.169+); same threat surface as skillOverrides
 * - `enforceAvailableModels` — managed-only model allowlist enforcement flag
 *   (claude-code 2.1.175+); user/project scope must not be able to set or
 *   extend it via the App RPC
 * - `cleanupPeriodDays` — destructive (deletes old sessions)
 *
 * ## Null semantics
 *
 * Per SDK docs, passing `null` for a top-level key clears it from the flag
 * layer, falling back to lower-precedence sources. All nullable keys accept
 * `null` through this parser.
 */

import { logger } from "@/lib";

// ─── Result type ──────────────────────────────────────────────────────────────

export type SettingsParseResult =
  | { ok: true; settings: Record<string, unknown> }
  | { ok: false; error: string };

// ─── Blocked keys ─────────────────────────────────────────────────────────────

const BLOCKED_KEYS = new Set([
  "hooks",
  "skillOverrides",
  "disableBundledSkills",
  "enforceAvailableModels",
  "cleanupPeriodDays",
]);

// ─── Type validators ──────────────────────────────────────────────────────────

type Validator = (value: unknown, key: string) => string | null;

/** Value must be string or null. */
const stringOrNull: Validator = (v, key) => {
  if (v === null) return null;
  if (typeof v === "string") return null;
  return `${key}: expected string or null, got ${typeof v}`;
};

/** Value must be boolean or null. */
const booleanOrNull: Validator = (v, key) => {
  if (v === null) return null;
  if (typeof v === "boolean") return null;
  return `${key}: expected boolean or null, got ${typeof v}`;
};

/** Value must be string[] or null. */
const stringArrayOrNull: Validator = (v, key) => {
  if (v === null) return null;
  if (!Array.isArray(v)) return `${key}: expected string[] or null, got ${typeof v}`;
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== "string") {
      return `${key}[${i}]: expected string, got ${typeof v[i]}`;
    }
  }
  return null;
};

/** Value must be Record<string, string> or null. */
const stringRecordOrNull: Validator = (v, key) => {
  if (v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) {
    return `${key}: expected Record<string, string> or null, got ${typeof v}`;
  }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val !== "string") {
      return `${key}.${k}: expected string value, got ${typeof val}`;
    }
  }
  return null;
};

// ─── permissions sub-validator ────────────────────────────────────────────────

const PERMISSIONS_SUBKEYS: Record<string, Validator> = {
  allow: stringArrayOrNull,
  deny: stringArrayOrNull,
  ask: stringArrayOrNull,
  defaultMode: stringOrNull,
  additionalDirectories: stringArrayOrNull,
  disableBypassPermissionsMode: booleanOrNull,
};

const permissionsOrNull: Validator = (v, key) => {
  if (v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) {
    return `${key}: expected object or null, got ${typeof v}`;
  }
  const obj = v as Record<string, unknown>;
  for (const subKey of Object.keys(obj)) {
    const subValidator = PERMISSIONS_SUBKEYS[subKey];
    if (!subValidator) {
      return `${key}: unknown sub-key '${subKey}' (allowed: ${Object.keys(PERMISSIONS_SUBKEYS).join(", ")})`;
    }
    const err = subValidator(obj[subKey], `${key}.${subKey}`);
    if (err) return err;
  }
  return null;
};

// ─── Allowed top-level keys ───────────────────────────────────────────────────

const ALLOWED_KEYS: Record<string, Validator> = {
  permissions: permissionsOrNull,
  model: stringOrNull,
  env: stringRecordOrNull,
  enableAllProjectMcpServers: booleanOrNull,
  enabledMcpjsonServers: stringArrayOrNull,
  disabledMcpjsonServers: stringArrayOrNull,
  attribution: booleanOrNull,
  includeGitInstructions: booleanOrNull,
  respectGitignore: booleanOrNull,
  availableModels: (v, key) => {
    if (v === null) return null;
    if (!Array.isArray(v)) return `${key}: expected array or null`;
    return null;
  },
  modelOverrides: (v, key) => {
    if (v === null) return null;
    if (typeof v !== "object" || Array.isArray(v)) {
      return `${key}: expected object or null`;
    }
    return null;
  },
};

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse and validate raw settings from the App RPC. Returns a typed result
 * with either the validated settings object or an error message.
 *
 * @param raw - The raw `settings` field from `ApplySettingsRequest`
 * @returns Validated settings or error
 */
export function parseAndValidateSettings(raw: unknown): SettingsParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "settings must be a plain object" };
  }

  const input = raw as Record<string, unknown>;
  const validated: Record<string, unknown> = {};

  for (const key of Object.keys(input)) {
    // Check blocked keys first
    if (BLOCKED_KEYS.has(key)) {
      const msg = `key '${key}' is blocked for security reasons`;
      logger.debug(`[settingsParser] REJECTED: ${msg}`);
      return { ok: false, error: msg };
    }

    // Check allowed keys
    const validator = ALLOWED_KEYS[key];
    if (!validator) {
      const msg = `unknown key '${key}' (allowed: ${Object.keys(ALLOWED_KEYS).join(", ")})`;
      logger.debug(`[settingsParser] REJECTED: ${msg}`);
      return { ok: false, error: msg };
    }

    // Run type validator
    const err = validator(input[key], key);
    if (err) {
      logger.debug(`[settingsParser] REJECTED: ${err}`);
      return { ok: false, error: err };
    }

    validated[key] = input[key];
  }

  return { ok: true, settings: validated };
}
