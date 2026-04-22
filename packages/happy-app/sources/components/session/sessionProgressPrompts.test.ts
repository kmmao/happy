import { describe, expect, it } from "vitest";

import {
  getProgressRefreshPromptKey,
  getProgressTodoPromptKey,
} from "./sessionProgressPrompts";
import type { TranslationKey } from "@/text";

// @ts-expect-error legacy key should stay removed
const _legacyVerifyKey: TranslationKey = "session.progressTodoPromptVerify";
// @ts-expect-error legacy key should stay removed
const _legacyContinueKey: TranslationKey = "session.progressTodoPromptContinue";
// @ts-expect-error legacy key should stay removed
const _legacyIssueKey: TranslationKey = "session.progressTodoPromptIssue";

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

describe("getProgressTodoPromptKey", () => {
  it("uses Codex-specific prompts for codex sessions", () => {
    expect(
      getProgressTodoPromptKey("codex", "completed", "verify"),
    ).toBe("session.progressTodoPromptVerifyCompletedCodex");
    expect(
      getProgressTodoPromptKey("CoDeX", "in_progress", "verify"),
    ).toBe("session.progressTodoPromptVerifyActiveCodex");
    expect(
      getProgressTodoPromptKey("codex", "pending", "continue"),
    ).toBe("session.progressTodoPromptContinueCodex");
    expect(
      getProgressTodoPromptKey("codex", "completed", "issue"),
    ).toBe("session.progressTodoPromptIssueCompletedCodex");
    expect(
      getProgressTodoPromptKey("codex", "in_progress", "issue"),
    ).toBe("session.progressTodoPromptIssueActiveCodex");
  });

  it("uses TodoWrite-oriented prompts for non-codex sessions", () => {
    expect(
      getProgressTodoPromptKey("claude", "completed", "verify"),
    ).toBe("session.progressTodoPromptVerifyCompleted");
    expect(
      getProgressTodoPromptKey("gemini", "in_progress", "verify"),
    ).toBe("session.progressTodoPromptVerifyActive");
    expect(
      getProgressTodoPromptKey(null, "pending", "continue"),
    ).toBe("session.progressTodoPromptContinueTodoWrite");
    expect(
      getProgressTodoPromptKey("claude", "completed", "issue"),
    ).toBe("session.progressTodoPromptIssueCompleted");
    expect(
      getProgressTodoPromptKey("claude", "pending", "issue"),
    ).toBe("session.progressTodoPromptIssueActive");
  });
});
