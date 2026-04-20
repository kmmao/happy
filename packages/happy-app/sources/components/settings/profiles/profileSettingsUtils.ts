import type { AIBackendProfile } from "@/sync/settings";
import { DEFAULT_PROFILES } from "@/sync/profileUtils";

export interface ProfileRemoteStateEntry {
  revision: number;
  updatedAt: number;
}

export type ProfileRemoteState = Record<string, ProfileRemoteStateEntry>;
export type ProfileSyncStatus = "synced" | "pending" | "local-only";
export type ProfileSyncActionState = "hidden" | "disabled" | "enabled";

interface BuildProfileSettingsOverviewParams {
  profiles: AIBackendProfile[];
  remoteState: ProfileRemoteState;
}

interface ProfileSettingsOverview {
  customProfiles: AIBackendProfile[];
  syncedCount: number;
  pendingCount: number;
  localOnlyCount: number;
  overriddenBuiltInCount: number;
}

const BUILT_IN_PROFILE_IDS = new Set(DEFAULT_PROFILES.map((profile) => profile.id));

export function getProfileSyncStatus(
  profile: AIBackendProfile,
  remoteEntry?: ProfileRemoteStateEntry | null,
): ProfileSyncStatus {
  if (!remoteEntry) {
    return "local-only";
  }

  if ((profile.updatedAt ?? 0) > remoteEntry.updatedAt) {
    return "pending";
  }

  return "synced";
}

export function buildProfileSettingsOverview({
  profiles,
  remoteState,
}: BuildProfileSettingsOverviewParams): ProfileSettingsOverview {
  const customProfiles = profiles
    .filter((profile) => !BUILT_IN_PROFILE_IDS.has(profile.id))
    .slice()
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));

  let syncedCount = 0;
  let pendingCount = 0;
  let localOnlyCount = 0;
  let overriddenBuiltInCount = 0;

  profiles.forEach((profile) => {
    const syncStatus = getProfileSyncStatus(profile, remoteState[profile.id]);

    if (syncStatus === "synced") {
      syncedCount += 1;
    } else if (syncStatus === "pending") {
      pendingCount += 1;
    } else {
      localOnlyCount += 1;
    }

    if (BUILT_IN_PROFILE_IDS.has(profile.id)) {
      overriddenBuiltInCount += 1;
    }
  });

  return {
    customProfiles,
    syncedCount,
    pendingCount,
    localOnlyCount,
    overriddenBuiltInCount,
  };
}

export function getProfileSyncActionState(
  syncStatus: ProfileSyncStatus,
  accountSyncAvailable: boolean,
): ProfileSyncActionState {
  if (syncStatus === "synced") {
    return "hidden";
  }

  return accountSyncAvailable ? "enabled" : "disabled";
}

export function buildConflictRetryProfile(
  localProfile: AIBackendProfile,
  remoteProfile: AIBackendProfile,
  now = Date.now(),
): AIBackendProfile {
  return {
    ...remoteProfile,
    ...localProfile,
    id: remoteProfile.id,
    createdAt: remoteProfile.createdAt ?? localProfile.createdAt ?? now,
    updatedAt: now,
  };
}
