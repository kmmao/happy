import { describe, expect, it } from "vitest";
import { parseLegacyCodexPlanPreview } from "./codexPlanCompat";

describe("parseLegacyCodexPlanPreview", () => {
  it("parses codex plan updates into structured rows", () => {
    expect(
      parseLegacyCodexPlanPreview(
        [
          "Plan updated",
          "[completed] Inspect logs",
          "[in_progress] Patch parser",
          "[pending] Verify UI",
        ].join("\n"),
      ),
    ).toEqual({
      explanation: "Plan updated",
      items: [
        { status: "completed", text: "Inspect logs" },
        { status: "in_progress", text: "Patch parser" },
        { status: "pending", text: "Verify UI" },
      ],
    });
  });

  it("returns null when the message is not a codex plan preview", () => {
    expect(parseLegacyCodexPlanPreview("plain text")).toBeNull();
  });
});
