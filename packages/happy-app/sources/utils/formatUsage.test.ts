import { describe, expect, it } from "vitest";
import {
  getContextWindowSize,
  formatModelName,
  formatCostUsd,
  formatTokensCompact,
  formatDurationCompact,
} from "./formatUsage";

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

describe("value formatting owner (ADR-0061)", () => {
  it("formatModelName strips only a trailing 8-digit date suffix", () => {
    expect(formatModelName("claude-sonnet-4-6-20250514")).toBe("claude-sonnet-4-6");
    expect(formatModelName("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    // not a trailing date → untouched
    expect(formatModelName("gpt-5.4")).toBe("gpt-5.4");
  });

  it("formatCostUsd uses 4 decimals under a cent, else 2", () => {
    expect(formatCostUsd(0.0042)).toBe("$0.0042");
    expect(formatCostUsd(0.009)).toBe("$0.0090");
    expect(formatCostUsd(0.01)).toBe("$0.01");
    expect(formatCostUsd(1.2)).toBe("$1.20");
  });

  it("formatTokensCompact: lowercase k unit, M over a million, raw under 1000", () => {
    expect(formatTokensCompact(42)).toBe("42");
    expect(formatTokensCompact(1500)).toBe("1.5k");
    expect(formatTokensCompact(2_400_000)).toBe("2.4M");
  });

  it("formatDurationCompact: Xm Ys over a minute, else decimal seconds", () => {
    expect(formatDurationCompact(1400)).toBe("1.4s");
    expect(formatDurationCompact(65_000)).toBe("1m 5s");
    expect(formatDurationCompact(120_000)).toBe("2m 0s");
  });
});
