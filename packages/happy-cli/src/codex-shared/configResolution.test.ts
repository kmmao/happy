import { describe, expect, it } from "vitest";
import { resolveCodexRuntimeConfigFromEnv } from "./configResolution";

describe("resolveCodexRuntimeConfigFromEnv", () => {
  it("defaults to inherit mode", () => {
    expect(resolveCodexRuntimeConfigFromEnv({})).toEqual({
      configMode: "inherit",
      profileName: undefined,
      overrides: {},
    });
  });

  it("parses managed profile mode", () => {
    expect(
      resolveCodexRuntimeConfigFromEnv({
        HAPPY_CODEX_CONFIG_MODE: "managed-profile",
        HAPPY_CODEX_PROFILE: "happy_max",
      }),
    ).toEqual({
      configMode: "managed-profile",
      profileName: "happy_max",
      overrides: {},
    });
  });

  it("parses managed overrides", () => {
    expect(
      resolveCodexRuntimeConfigFromEnv({
        HAPPY_CODEX_CONFIG_MODE: "managed-overrides",
        HAPPY_CODEX_MODEL: "gpt-5.4",
        HAPPY_CODEX_REASONING_EFFORT: "high",
        HAPPY_CODEX_WEB_SEARCH: "live",
      }),
    ).toEqual({
      configMode: "managed-overrides",
      profileName: undefined,
      overrides: {
        model: "gpt-5.4",
        reasoningEffort: "high",
        webSearch: "live",
      },
    });
  });
});
