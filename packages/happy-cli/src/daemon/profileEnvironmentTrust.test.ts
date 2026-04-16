import { describe, expect, it } from "vitest";
import { filterGuiEnvironmentVariables } from "./profileEnvironmentTrust";

describe("filterGuiEnvironmentVariables", () => {
  it("keeps operator-only vars for supervisor-triggered runs without a local profileId", () => {
    const result = filterGuiEnvironmentVariables(
      {
        OPENAI_API_KEY: "custom-openai-key",
        OPENAI_BASE_URL: "https://custom.example.com/v1",
        HAPPY_SUPERVISOR_PROJECT_ID: "project-1",
        CUSTOM_FLAG: "enabled",
      },
      {
        automationContext: {
          kind: "supervisor",
          projectId: "project-1",
          runId: "run-1",
        },
      },
      {
        OPENAI_API_KEY: "daemon-default-key",
        OPENAI_BASE_URL: "https://default.example.com/v1",
      },
    );

    expect(result.trusted).toBe(true);
    expect(result.stripped).toEqual([]);
    expect(result.environmentVariables).toEqual({
      OPENAI_API_KEY: "custom-openai-key",
      OPENAI_BASE_URL: "https://custom.example.com/v1",
      HAPPY_SUPERVISOR_PROJECT_ID: "project-1",
      CUSTOM_FLAG: "enabled",
    });
  });

  it("strips operator-only vars for untrusted ad-hoc env overrides", () => {
    const result = filterGuiEnvironmentVariables(
      {
        OPENAI_API_KEY: "custom-openai-key",
        OPENAI_BASE_URL: "https://custom.example.com/v1",
        CUSTOM_FLAG: "enabled",
      },
      {},
      {
        OPENAI_API_KEY: "daemon-default-key",
        OPENAI_BASE_URL: "https://default.example.com/v1",
      },
    );

    expect(result.trusted).toBe(false);
    expect(result.stripped).toEqual(["OPENAI_API_KEY", "OPENAI_BASE_URL"]);
    expect(result.environmentVariables).toEqual({
      CUSTOM_FLAG: "enabled",
    });
  });

  it("keeps operator-only vars when an explicit profileId is present", () => {
    const result = filterGuiEnvironmentVariables(
      {
        OPENAI_API_KEY: "custom-openai-key",
      },
      {
        profileId: "openai",
      },
      {
        OPENAI_API_KEY: "daemon-default-key",
      },
    );

    expect(result.trusted).toBe(true);
    expect(result.stripped).toEqual([]);
    expect(result.environmentVariables).toEqual({
      OPENAI_API_KEY: "custom-openai-key",
    });
  });
});
