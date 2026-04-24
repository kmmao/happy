import { describe, expect, it } from "vitest";
import { resolveCodexRuntimeConfigFromEnv } from "./configResolution";

describe("resolveCodexRuntimeConfigFromEnv", () => {
  it("defaults to inherit mode", () => {
    expect(resolveCodexRuntimeConfigFromEnv({})).toEqual({
      configMode: "inherit",
      profileName: undefined,
      overrides: {
        model: undefined,
      },
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
      overrides: {
        model: undefined,
      },
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

  it("accepts gpt-5.3-codex model overrides", () => {
    expect(
      resolveCodexRuntimeConfigFromEnv({
        HAPPY_CODEX_CONFIG_MODE: "managed-overrides",
        HAPPY_CODEX_MODEL: "gpt-5.3-codex",
      }),
    ).toEqual({
      configMode: "managed-overrides",
      profileName: undefined,
      overrides: {
        model: "gpt-5.3-codex",
      },
    });
  });

  it("normalizes legacy max reasoning effort to xhigh", () => {
    expect(
      resolveCodexRuntimeConfigFromEnv({
        HAPPY_CODEX_CONFIG_MODE: "managed-overrides",
        HAPPY_CODEX_REASONING_EFFORT: "max",
      }),
    ).toEqual({
      configMode: "managed-overrides",
      profileName: undefined,
      overrides: {
        model: undefined,
        reasoningEffort: "xhigh",
      },
    });
  });

  it("accepts gpt-5.5 model overrides", () => {
    expect(
      resolveCodexRuntimeConfigFromEnv({
        HAPPY_CODEX_CONFIG_MODE: "managed-overrides",
        HAPPY_CODEX_MODEL: "gpt-5.5",
      }),
    ).toEqual({
      configMode: "managed-overrides",
      profileName: undefined,
      overrides: {
        model: "gpt-5.5",
      },
    });
  });

  it("accepts gpt-5.4 model overrides", () => {
    expect(
      resolveCodexRuntimeConfigFromEnv({
        HAPPY_CODEX_CONFIG_MODE: "managed-overrides",
        HAPPY_CODEX_MODEL: "gpt-5.4",
      }),
    ).toEqual({
      configMode: "managed-overrides",
      profileName: undefined,
      overrides: {
        model: "gpt-5.4",
      },
    });
  });

  it("falls back to GPT-5.5 for unsupported Codex model overrides", () => {
    expect(
      resolveCodexRuntimeConfigFromEnv({
        HAPPY_CODEX_CONFIG_MODE: "managed-overrides",
        HAPPY_CODEX_MODEL: "gpt-5.4-mini",
      }),
    ).toEqual({
      configMode: "managed-overrides",
      profileName: undefined,
      overrides: {
        model: "gpt-5.5",
      },
    });
  });
});
