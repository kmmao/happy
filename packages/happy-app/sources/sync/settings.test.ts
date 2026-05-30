import { describe, expect, it } from "vitest";
import { applySettings, settingsDefaults, settingsParse, type Settings, AIBackendProfileSchema } from "./settings";
import { getBuiltInProfile } from "./profileUtils";

const makeSettings = (overrides: Partial<Settings> = {}): Settings => ({
  ...settingsDefaults,
  ...overrides,
});

describe("settings", () => {
  describe("settingsParse", () => {
    it("returns defaults for invalid input", () => {
      expect(settingsParse(null)).toEqual(settingsDefaults);
      expect(settingsParse(undefined)).toEqual(settingsDefaults);
      expect(settingsParse("invalid")).toEqual(settingsDefaults);
    });

    it("preserves unknown fields", () => {
      expect(
        settingsParse({
          viewInline: true,
          unknownField: "some value",
        }),
      ).toEqual({
        ...settingsDefaults,
        viewInline: true,
        unknownField: "some value",
      });
    });

  });

  describe("applySettings", () => {
    it("applies delta and preserves unknown fields", () => {
      const currentSettings = makeSettings({
        viewInline: false,
        extraField: "keep me",
      } as never);

      expect(
        applySettings(currentSettings, {
          viewInline: true,
        }),
      ).toEqual({
        ...settingsDefaults,
        viewInline: true,
        extraField: "keep me",
      });
    });
  });

  describe("settingsDefaults", () => {
    it("excludes removed LiveKit and TTS fields", () => {
      expect("livekitWssUrl" in settingsDefaults).toBe(false);
      expect("livekitApiKey" in settingsDefaults).toBe(false);
      expect("livekitApiSecret" in settingsDefaults).toBe(false);
      expect("voiceBackend" in settingsDefaults).toBe(false);
      expect("ttsProvider" in settingsDefaults).toBe(false);
      expect("voiceboxEndpoint" in settingsDefaults).toBe(false);
    });
  });

  describe("AIBackendProfile validation", () => {
    it("accepts built-in Anthropic profile", () => {
      const profile = getBuiltInProfile("anthropic");
      expect(profile).not.toBeNull();
      expect(() => AIBackendProfileSchema.parse(profile)).not.toThrow();
    });
  });
});
