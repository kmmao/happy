import { describe, expect, it } from "vitest";
import type { AIBackendProfile } from "@/sync/settings";
import { mergeProfilesForDisplay } from "./profileUtils";

function createProfile(
  id: string,
  overrides: Partial<AIBackendProfile> = {},
): AIBackendProfile {
  return {
    id,
    name: `Profile ${id}`,
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

describe("mergeProfilesForDisplay", () => {
  it("includes local custom profiles that are missing from remote account profiles", () => {
    const remoteProfiles = [createProfile("anthropic", { isBuiltIn: true })];
    const localProfiles = [createProfile("custom-local", { name: "Local Custom" })];

    expect(mergeProfilesForDisplay(remoteProfiles, localProfiles)).toEqual([
      localProfiles[0],
      remoteProfiles[0],
    ]);
  });

  it("prefers remote profiles when both sources contain the same id", () => {
    const remoteProfile = createProfile("shared", { name: "Remote Version" });
    const localProfile = createProfile("shared", { name: "Local Version" });

    expect(mergeProfilesForDisplay([remoteProfile], [localProfile])).toEqual([
      remoteProfile,
    ]);
  });
});
