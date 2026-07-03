import { describe, it, expect } from "vitest";
import { classifyGeminiError } from "./geminiErrorClassify";

describe("classifyGeminiError", () => {
  it("classifies non-object errors as unknown", () => {
    expect(classifyGeminiError("boom")).toMatchObject({
      category: "unknown",
      isRetryable: false,
      userMessage: "Process error occurred",
    });
    expect(classifyGeminiError(null).category).toBe("unknown");
  });

  it("preserves the quirk: a bare Error instance reads as cli-not-installed", () => {
    // Error has no ENUMERABLE own keys (message/stack are non-enumerable), so
    // Object.keys(err).length === 0 → cli-not-installed. The original inline
    // cascade behaved identically (its `error instanceof Error` branch was
    // dead code, shadowed by the typeof-object branch). Pinned so a future
    // "fix" is a deliberate, visible change.
    expect(classifyGeminiError(new Error("nope")).category).toBe(
      "cli-not-installed",
    );
  });

  it("classifies an empty error object as cli-not-installed", () => {
    const r = classifyGeminiError({});
    expect(r.category).toBe("cli-not-installed");
    expect(r.userMessage).toContain("npm install -g @google/gemini-cli");
  });

  it("classifies a 404 as model-not-found and renders the current model", () => {
    const r = classifyGeminiError(
      { code: 404 },
      { currentModel: "gemini-2.5-flash" },
    );
    expect(r.category).toBe("model-not-found");
    expect(r.isRetryable).toBe(false);
    expect(r.userMessage).toContain('Model "gemini-2.5-flash" not found');
  });

  it("defaults the model name when none is supplied", () => {
    const r = classifyGeminiError({ message: "model not found" });
    expect(r.category).toBe("model-not-found");
    expect(r.userMessage).toContain('Model "gemini-2.5-pro" not found');
  });

  it("classifies -32603 / empty response as retryable empty-response", () => {
    expect(classifyGeminiError({ code: -32603 })).toMatchObject({
      category: "empty-response",
      isRetryable: true,
    });
    expect(
      classifyGeminiError({ details: "got empty response from model" })
        .isRetryable,
    ).toBe(true);
    expect(
      classifyGeminiError({ details: "Model stream ended early" }).category,
    ).toBe("empty-response");
  });

  it("classifies 429 / rate-limit strings (non-retryable)", () => {
    expect(classifyGeminiError({ code: 429 }).category).toBe("rate-limit");
    expect(
      classifyGeminiError({ details: "RESOURCE_EXHAUSTED" }).category,
    ).toBe("rate-limit");
    expect(classifyGeminiError({ code: 429 }).isRetryable).toBe(false);
  });

  it("classifies quota exhaustion and extracts a reset hint from any field", () => {
    const r = classifyGeminiError({
      message: "Your quota will reset after 3h20m35s.",
    });
    expect(r.category).toBe("quota");
    expect(r.isRetryable).toBe(false);
    expect(r.userMessage).toContain("Quota resets in 3h20m35s.");
    expect(r.userMessage).toContain("Gemini quota exceeded.");
  });

  it("quota without a reset hint omits the reset sentence", () => {
    const r = classifyGeminiError({ details: "capacity exhausted" });
    expect(r.category).toBe("quota");
    expect(r.userMessage).not.toContain("Quota resets");
  });

  it("classifies workspace auth-required (-32000)", () => {
    const r = classifyGeminiError({ code: -32000 });
    expect(r.category).toBe("auth-required");
    expect(r.userMessage).toContain("happy gemini project set");
  });

  it("rate-limit takes precedence over the generic quota branch for 429", () => {
    // A 429 that also mentions exhausted must still read as rate-limit
    // (the cascade order the original inline code preserved).
    const r = classifyGeminiError({ code: 429, details: "exhausted" });
    expect(r.category).toBe("rate-limit");
  });

  it("falls back to the error's own text when nothing matches", () => {
    expect(
      classifyGeminiError({ message: "weird custom failure", foo: 1 })
        .userMessage,
    ).toBe("weird custom failure");
  });
});
