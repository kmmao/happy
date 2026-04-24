/**
 * Unified runtime profile resolver for server-initiated sessions.
 *
 * Replaces the scattered resolution of AI backend profiles that previously
 * only covered Supervisor/Webhook paths. Now Cron/Manual Task/Research paths
 * also go through here so that `profileId + runtimeProfile` can be attached
 * to every `task-trigger` ephemeral the server emits.
 *
 * Priority (no silent fallback):
 *   1. `explicitProfileId` — profileId persisted on the triggering record
 *      itself (Task.profileId, TriggerSchedule.profileId, WebhookTrigger.profileId).
 *   2. `parseDefaultProfileId(project.supervisorConfig)` — project-level
 *      default. Same parser already used by Supervisor path.
 *
 * If neither yields a profileId, or the referenced profile is not found /
 * decryption fails, the resolver returns a typed failure. Callers are
 * expected to surface the failure via Inbox (see
 * `notifyRuntimeProfileFailure`) and NOT silently fall back to a built-in
 * default — per decision record "C4 archive-guard + decrypt-fail notify"
 * (2026-04-24).
 *
 * Feature flag: set env `RUNTIME_PROFILE_UNIFIED_RESOLVER=false` to disable
 * (callers will keep emitting payloads without `runtimeProfile`, matching
 * the pre-0.14.0 behavior). Default is enabled.
 */

import { log } from "@/utils/log";
import type { ResolvedRuntimeProfile } from "@/types/aiBackendProfile";
import {
  parseDefaultProfileId,
  resolveSupervisorProfile,
  type ResolvedSupervisorProfile,
} from "./supervisorProfileResolver";
import { inboxCreate } from "./inboxCreate";

export type RuntimeProfilePurpose =
  | "supervisor"
  | "webhook"
  | "cron"
  | "task-manual"
  | "task-retry"
  | "research";

export interface ResolveRuntimeProfileInput {
  accountId: string;
  /** profileId persisted on the triggering record (Task/Trigger/Webhook row). */
  explicitProfileId?: string | null;
  /** Project.supervisorConfig JSON string (may contain `defaultProfileId`). */
  projectSupervisorConfig?: string | null;
  purpose: RuntimeProfilePurpose;
}

export type ResolveRuntimeProfileFailureReason =
  | "missing"         // no profileId configured anywhere
  | "not-found"       // profileId set but AiBackendProfile row absent (archived/deleted/bogus)
  | "decrypt-failed"  // encryptedPayload cannot be decrypted
  | "empty";          // resolver returned no runtimeProfile (built-in id unknown, etc.)

export interface ResolveRuntimeProfileOk {
  ok: true;
  profileId: string;
  profileName?: string;
  runtimeProfile: ResolvedRuntimeProfile;
  profileSource: "explicit" | "project-default";
}

export interface ResolveRuntimeProfileFailure {
  ok: false;
  reason: ResolveRuntimeProfileFailureReason;
  message: string;
  /** Populated when the reason is `not-found`, `decrypt-failed`, or `empty`. */
  profileId?: string;
}

export type ResolveRuntimeProfileResult =
  | ResolveRuntimeProfileOk
  | ResolveRuntimeProfileFailure;

/**
 * Whether the unified resolver is enabled. Opt-out via
 * `RUNTIME_PROFILE_UNIFIED_RESOLVER=false`. Default is ON since CLI 0.72.0+
 * and App ProfilePicker are both shipped.
 */
export function isUnifiedRuntimeProfileResolverEnabled(): boolean {
  return process.env.RUNTIME_PROFILE_UNIFIED_RESOLVER !== "false";
}

export async function resolveRuntimeProfile(
  input: ResolveRuntimeProfileInput,
): Promise<ResolveRuntimeProfileResult> {
  const explicit = input.explicitProfileId?.trim();
  const hasExplicit = Boolean(explicit && explicit.length > 0);
  const profileId =
    (hasExplicit ? explicit : parseDefaultProfileId(input.projectSupervisorConfig ?? null)) ?? null;
  const profileSource: "explicit" | "project-default" = hasExplicit
    ? "explicit"
    : "project-default";

  if (!profileId) {
    return {
      ok: false,
      reason: "missing",
      message: `No profileId configured for ${input.purpose}. Set a project default profile or bind one explicitly to the triggering record.`,
    };
  }

  let resolved: ResolvedSupervisorProfile;
  try {
    resolved = await resolveSupervisorProfile(input.accountId, profileId);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (/not found/i.test(errorMessage)) {
      return { ok: false, reason: "not-found", message: errorMessage, profileId };
    }
    return { ok: false, reason: "decrypt-failed", message: errorMessage, profileId };
  }

  if (!resolved.runtimeProfile) {
    return {
      ok: false,
      reason: "empty",
      message: `Profile "${profileId}" resolved to an empty runtime profile (archived or unknown built-in id).`,
      profileId,
    };
  }

  return {
    ok: true,
    profileId,
    profileName: resolved.profileName,
    runtimeProfile: resolved.runtimeProfile,
    profileSource,
  };
}

/**
 * Surface a profile resolution failure to the operator via Inbox.
 *
 * Called when the unified resolver rejects a Cron/Webhook/Task dispatch. The
 * caller MUST abort the spawn (per the "no silent fallback" decision); this
 * function only records the failure and nudges the operator.
 *
 * Non-blocking: fire-and-forget via `void notifyRuntimeProfileFailure(...)`.
 */
export function notifyRuntimeProfileFailure(args: {
  accountId: string;
  purpose: RuntimeProfilePurpose;
  failure: ResolveRuntimeProfileFailure;
  referenceUrl?: string;
  refType?: string;
  refId?: string;
}): void {
  const { accountId, purpose, failure } = args;
  const humanBody =
    failure.reason === "missing"
      ? "No profileId configured. Set a default in project settings or bind one explicitly to the triggering record."
      : failure.reason === "not-found"
        ? `Profile "${failure.profileId}" not found or archived. Restore the profile or update the binding.`
        : failure.reason === "decrypt-failed"
          ? `Profile "${failure.profileId}" could not be decrypted: ${failure.message}`
          : `Profile "${failure.profileId}" resolved to an empty runtime. Check the profile definition.`;

  void inboxCreate({
    accountId,
    category: "system",
    eventType: "profile.resolve_failed",
    severity: "error",
    title: `Profile unavailable — ${purpose} skipped`,
    body: humanBody,
    referenceUrl: args.referenceUrl,
    refType: args.refType,
    refId: args.refId,
    groupKey: `profile:${failure.profileId ?? "missing"}:${failure.reason}`,
    skipPush: false,
  });
  log(
    { module: "profile" },
    `[profile-resolver] ${purpose} aborted for account ${accountId}: ${failure.reason} (${failure.message})`,
  );
}
