import { describe, expect, it } from "vitest";
import { getContextWindowSize } from "./formatUsage";

describe("getContextWindowSize", () => {
  it("forces GPT-5.4 to use a 900K context window", () => {
    expect(getContextWindowSize("gpt-5.4", 258400)).toBe(900000);
    expect(getContextWindowSize("gpt-5.4", 950000)).toBe(900000);
    expect(getContextWindowSize("gpt-5.4")).toBe(900000);
  });

  it("still respects SDK-reported windows for other models", () => {
    expect(getContextWindowSize("claude-sonnet-4-6", 1000000)).toBe(1000000);
  });
});
