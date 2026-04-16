import type { ServerAiBackendProfile } from "@/sync/apiAccountProfiles";
import type { AIBackendProfile } from "@/sync/settings";

interface MergeAccountProfilesParams {
  localProfiles: AIBackendProfile[];
  remoteProfiles: ServerAiBackendProfile[];
}

interface MergeAccountProfilesResult {
  profiles: AIBackendProfile[];
  revisions: Record<string, number>;
}

function getProfileUpdatedAt(profile: AIBackendProfile): number {
  return profile.updatedAt ?? 0;
}

function chooseMergedProfile(
  localProfile: AIBackendProfile | undefined,
  remoteProfile: AIBackendProfile,
): AIBackendProfile {
  if (!localProfile) {
    return remoteProfile;
  }

  if (getProfileUpdatedAt(localProfile) > getProfileUpdatedAt(remoteProfile)) {
    return localProfile;
  }

  return remoteProfile;
}

export function mergeAccountProfiles({
  localProfiles,
  remoteProfiles,
}: MergeAccountProfilesParams): MergeAccountProfilesResult {
  const localProfileMap = new Map(
    localProfiles.map((profile) => [profile.id, profile]),
  );
  const mergedProfiles: AIBackendProfile[] = [];
  const revisions: Record<string, number> = {};
  const seenProfileIds = new Set<string>();

  remoteProfiles.forEach((entry) => {
    revisions[entry.profile.id] = entry.revision;
    mergedProfiles.push(
      chooseMergedProfile(localProfileMap.get(entry.profile.id), entry.profile),
    );
    seenProfileIds.add(entry.profile.id);
  });

  localProfiles.forEach((profile) => {
    if (!seenProfileIds.has(profile.id)) {
      mergedProfiles.push(profile);
    }
  });

  return {
    profiles: mergedProfiles,
    revisions,
  };
}
