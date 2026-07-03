import type { AIBackendProfile } from "@/sync/settings";
import { TokenStorage } from "@/auth/tokenStorage";
import {
  fetchAccountProfiles,
  createAccountProfile,
  updateAccountProfile,
} from "@/sync/apiAccountProfiles";
import { buildConflictRetryProfile, type ProfileRemoteState } from "./profileSettingsUtils";

/**
 * Account-profile persistence orchestration. Kept OUT of the pure, node-testable
 * `profileSettingsUtils` because it does I/O (credentials + REST), so importing
 * this module pulls in expo-secure-store / the API client. `profileSettingsUtils`
 * stays pure; this module carries the write invariant behind mockable seams.
 */

/** Fold the server's AiBackendProfile revisions into the id→{revision,updatedAt} map. */
export function buildRemoteState(
  remoteProfiles: Awaited<ReturnType<typeof fetchAccountProfiles>>,
): ProfileRemoteState {
  return remoteProfiles.reduce<ProfileRemoteState>((accumulator, entry) => {
    accumulator[entry.profile.id] = {
      revision: entry.revision,
      updatedAt: entry.profile.updatedAt ?? 0,
    };
    return accumulator;
  }, {});
}

/**
 * Persist one AiBackendProfile to the Account, owning the optimistic-locking
 * dance so no call site has to re-derive it: create when the profile is not yet
 * on the server; otherwise update at the known `revision`; and on a revision
 * conflict, rebuild the write from the server's current profile
 * (`buildConflictRetryProfile`) and retry once at the fresh revision. A second
 * conflict throws `revision-mismatch` for the caller to surface. No-ops silently
 * when the device has no credentials (account sync unavailable).
 */
export async function persistProfileToAccount(
  profile: AIBackendProfile,
  remoteEntry: ProfileRemoteState[string] | undefined,
): Promise<void> {
  const credentials = await TokenStorage.getCredentials();
  if (!credentials) {
    return;
  }

  if (!remoteEntry) {
    await createAccountProfile(credentials, profile);
    return;
  }

  const result = await updateAccountProfile(
    credentials,
    profile.id,
    profile,
    remoteEntry.revision,
  );

  if (result.success) {
    return;
  }

  const retryProfile = buildConflictRetryProfile(profile, result.current.profile);
  const retryResult = await updateAccountProfile(
    credentials,
    profile.id,
    retryProfile,
    result.current.revision,
  );

  if (!retryResult.success) {
    throw new Error("revision-mismatch");
  }
}
