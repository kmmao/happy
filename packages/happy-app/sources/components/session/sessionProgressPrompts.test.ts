import { describe, expect, it } from "vitest";

import { getProgressRefreshPromptKey } from "./sessionProgressPrompts";

describe("getProgressRefreshPromptKey", () => {
  it("uses the Codex-specific prompt for codex sessions", () => {
    expect(getProgressRefreshPromptKey("codex")).toBe(
      "session.progressRefreshPromptCodex",
    );
  });

  it("normalizes flavor casing", () => {
    expect(getProgressRefreshPromptKey("CoDeX")).toBe(
      "session.progressRefreshPromptCodex",
    );
  });

  it("falls back to the Claude/TodoWrite prompt for other flavors", () => {
    expect(getProgressRefreshPromptKey("claude")).toBe(
      "session.progressRefreshPrompt",
    );
    expect(getProgressRefreshPromptKey("gemini")).toBe(
      "session.progressRefreshPrompt",
    );
    expect(getProgressRefreshPromptKey(null)).toBe(
      "session.progressRefreshPrompt",
    );
  });
});
