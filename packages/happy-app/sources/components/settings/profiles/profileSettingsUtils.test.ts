import { describe, expect, it } from "vitest";
import type { AIBackendProfile } from "@/sync/settings";
import {
  buildConflictRetryProfile,
  buildProfileSettingsOverview,
  getProfileSyncActionState,
  getProfileSyncStatus,
  type ProfileRemoteState,
} from "./profileSettingsUtils";

function createProfile(
  overrides: Partial<AIBackendProfile> = {},
): AIBackendProfile {
  return {
    id: "profile-1",
    name: "Test Profile",
    anthropicConfig: {},
    environmentVariables: [],
    compatibility: { claude: true, codex: true, gemini: true },
    isBuiltIn: false,
    createdAt: 1,
    updatedAt: 1,
    version: "1.0.0",
    ...overrides,
  };
}

describe("profileSettingsUtils", () => {
  describe("getProfileSyncStatus", () => {
    it("returns local-only when no remote revision exists", () => {
      expect(getProfileSyncStatus(createProfile(), undefined)).toBe("local-only");
    });

    it("returns pending when local updatedAt is newer than the server snapshot", () => {
      expect(
        getProfileSyncStatus(createProfile({ updatedAt: 20 }), {
          revision: 4,
          updatedAt: 10,
        }),
      ).toBe("pending");
    });

    it("returns synced when the server snapshot is up to date", () => {
      expect(
        getProfileSyncStatus(createProfile({ updatedAt: 10 }), {
          revision: 4,
          updatedAt: 10,
        }),
      ).toBe("synced");
    });
  });

  describe("buildProfileSettingsOverview", () => {
    it("counts synced, pending, local-only, and built-in override profiles", () => {
      const profiles = [
        createProfile({
          id: "openai",
          name: "OpenAI Override",
          isBuiltIn: true,
          updatedAt: 5,
        }),
        createProfile({
          id: "custom-pending",
          name: "Custom Pending",
          updatedAt: 20,
        }),
        createProfile({
          id: "custom-local",
          name: "Custom Local",
          updatedAt: 15,
        }),
      ];

      const remoteState: ProfileRemoteState = {
        openai: { revision: 1, updatedAt: 5 },
        "custom-pending": { revision: 2, updatedAt: 10 },
      };

      const result = buildProfileSettingsOverview({
        profiles,
        remoteState,
      });

      expect(result.syncedCount).toBe(1);
      expect(result.pendingCount).toBe(1);
      expect(result.localOnlyCount).toBe(1);
      expect(result.overriddenBuiltInCount).toBe(1);
      expect(result.customProfiles.map((profile) => profile.id)).toEqual([
        "custom-pending",
        "custom-local",
      ]);
    });
  });

  describe("getProfileSyncActionState", () => {
    it("enables manual sync for local-only profiles when account sync is available", () => {
      expect(getProfileSyncActionState("local-only", true)).toBe("enabled");
    });

    it("enables manual sync for pending profiles when account sync is available", () => {
      expect(getProfileSyncActionState("pending", true)).toBe("enabled");
    });

    it("disables manual sync for unsynced profiles while signed out", () => {
      expect(getProfileSyncActionState("local-only", false)).toBe("disabled");
      expect(getProfileSyncActionState("pending", false)).toBe("disabled");
    });

    it("hides the manual sync action for already synced profiles", () => {
      expect(getProfileSyncActionState("synced", true)).toBe("hidden");
      expect(getProfileSyncActionState("synced", false)).toBe("hidden");
    });
  });

  describe("buildConflictRetryProfile", () => {
    it("preserves remote-only fields while applying local edits", () => {
      const localProfile = createProfile({
        id: "shared",
        name: "Local Draft",
        updatedAt: 40,
        description: undefined,
      });
      const remoteProfile = {
        ...createProfile({
          id: "shared",
          name: "Remote Version",
          createdAt: 5,
          updatedAt: 30,
          description: "from remote",
        }),
        futureField: "keep-me",
      } as AIBackendProfile & { futureField: string };

      const result = buildConflictRetryProfile(localProfile, remoteProfile, 100);

      expect(result.id).toBe("shared");
      expect(result.name).toBe("Local Draft");
      expect(result.createdAt).toBe(5);
      expect(result.updatedAt).toBe(100);
      expect(result.description).toBeUndefined();
      expect((result as typeof remoteProfile).futureField).toBe("keep-me");
    });
  });
});
