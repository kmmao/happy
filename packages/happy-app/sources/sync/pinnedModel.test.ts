import { describe, expect, it } from "vitest";
import { resolvePinnedModelIdFromSelection } from "./pinnedModel";

describe("pinnedModel", () => {
  it("resolves an explicit selected model through model mappings", () => {
    expect(
      resolvePinnedModelIdFromSelection("sonnet", {
        sonnet: "MiniMax-M2.7",
      }),
    ).toBe("MiniMax-M2.7");
    expect(resolvePinnedModelIdFromSelection("gpt-5.4-pro", null)).toBe(
      "gpt-5.4-pro",
    );
  });

  it("does not pin the special default model key", () => {
    expect(resolvePinnedModelIdFromSelection("default", null)).toBeNull();
    expect(resolvePinnedModelIdFromSelection(null, null)).toBeNull();
  });
});
