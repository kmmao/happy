import { describe, expect, it } from "vitest";
import {
  hasLegacyCodexPlanPreview,
  parseLegacyCodexPlanPreview,
} from "./legacyCodexPlanPreview";

describe("legacyCodexPlanPreview", () => {
  it("parses legacy Codex plan previews", () => {
    expect(
      parseLegacyCodexPlanPreview(
        [
          "Current rollout",
          "[completed] Inspect logs",
          "[in_progress] Patch parser",
          "[pending] Verify UI",
        ].join("\n"),
      ),
    ).toEqual({
      explanation: "Current rollout",
      items: [
        { status: "completed", text: "Inspect logs" },
        { status: "in_progress", text: "Patch parser" },
        { status: "pending", text: "Verify UI" },
      ],
    });
  });

  it("rejects plain text that only looks vaguely structured", () => {
    expect(hasLegacyCodexPlanPreview("plain text only")).toBe(false);
    expect(
      hasLegacyCodexPlanPreview(
        [
          "Some explanation",
          "- bullet one",
          "- bullet two",
        ].join("\n"),
      ),
    ).toBe(false);
  });

  it("rejects prose that merely quotes bracketed log lines", () => {
    expect(
      hasLegacyCodexPlanPreview(
        [
          "Findings so far:",
          "",
          "```",
          "[vite] hmr invalidate /src/context/font-provider.tsx",
          "[vite] hmr invalidate /src/context/layout-provider.tsx",
          "```",
          "",
          "Both providers mix component and hook exports.",
        ].join("\n"),
      ),
    ).toBe(false);
  });

  it("rejects a plan whose rows are interrupted by prose", () => {
    expect(
      hasLegacyCodexPlanPreview(
        [
          "Current rollout",
          "[completed] Inspect logs",
          "Actually, hold on.",
          "[pending] Verify UI",
        ].join("\n"),
      ),
    ).toBe(false);
  });
});
