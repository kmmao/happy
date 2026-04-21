import { describe, expect, it } from "vitest";
import { shouldFallbackToLegacyCodex } from "./backendFallback";

describe("shouldFallbackToLegacyCodex", () => {
  it("allows fallback for app-server transport/bootstrap failures", () => {
    expect(
      shouldFallbackToLegacyCodex(new Error("codex app-server exited with code 1")),
    ).toBe(true);
    expect(
      shouldFallbackToLegacyCodex(new Error("initialize failed: broken pipe")),
    ).toBe(true);
  });

  it("does not fallback for auth/config/model/rate-limit errors", () => {
    expect(
      shouldFallbackToLegacyCodex(new Error("Unauthorized: invalid_api_key")),
    ).toBe(false);
    expect(
      shouldFallbackToLegacyCodex(new Error("Failed to parse config.toml")),
    ).toBe(false);
    expect(
      shouldFallbackToLegacyCodex(new Error("Unknown model gpt-5.999")),
    ).toBe(false);
    expect(
      shouldFallbackToLegacyCodex(new Error("rate_limit_exceeded (429)")),
    ).toBe(false);
  });
});
